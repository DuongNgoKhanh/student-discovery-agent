"""Explicit capabilities and bounded raw ASGI authentication before dispatch."""
from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy.exc import DisconnectionError, InterfaceError, OperationalError, TimeoutError
from starlette.requests import Request

from agent_runtime.evaluations.services.validator import ExperienceValidator
from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.infrastructure.db.trace import DatabaseTraceSink
from agent_runtime.infrastructure.http.strict_json import read_strict_json
from agent_runtime.infrastructure.http.trace import request_trace_context
from agent_runtime.infrastructure.product.releases import ProductUnavailable
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import RuntimePolicy
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.conversations import ConversationService
from agent_runtime.sessions.services.history import HistoryCursorCodec, HistoryService
from agent_runtime.sessions.services.lifecycle import LifecycleService
from agent_runtime.sessions.services.results import ResultReadService
from agent_runtime.sessions.services.turn_handlers import PinnedAssessmentEngine, TurnHandler
from agent_runtime.sessions.services.turn_store import TurnStore
from agent_runtime.sessions.services.turns import TurnService

from .envelopes import failure

if TYPE_CHECKING:
    from agent_runtime.config.settings import Settings

PREFIX = "/api/v1/internal"


class SystemClock:
    def now(self):
        return datetime.now(UTC)


@dataclass(repr=False)
class RuntimeContainer:
    policy: RuntimePolicy | None
    verifier: CallerVerifier | None = None
    conversations: ConversationService | None = None
    history: HistoryService | None = None
    lifecycle: LifecycleService | None = None
    results: ResultReadService | None = None
    turns: TurnService | None = None
    product_ready: bool = False
    engine: object | None = None


def _decode_key(value):
    if not isinstance(value, str):
        raise ValueError
    key = base64.b64decode(value, validate=True)
    if len(key) < 32 or base64.b64encode(key).decode("ascii") != value:
        raise ValueError
    return key


def build_runtime(settings: Settings) -> RuntimeContainer | None:
    """No connection/migration at startup; malformed secrets fail closed silently.

    Keyring: JSON object mapping kid to canonical padded standard base64 bytes.
    Cursor: separate canonical padded standard base64 key, both >=32 decoded bytes.
    """
    # Authentication is independent of service configuration and DB readiness.
    try:
        if not settings.RUNTIME_INTERNAL_KEYRING:
            return None
        raw_keys = read_strict_json(settings.RUNTIME_INTERNAL_KEYRING.get_secret_value().encode("utf-8"))
        keys = {kid: _decode_key(value) for kid, value in raw_keys.items()}
        verifier = CallerVerifier(keys, SystemClock())
    except Exception:
        return None
    unavailable = RuntimeContainer(policy=None, verifier=verifier)
    engine = None
    try:
        if not settings.RUNTIME_DATABASE_URL:
            return unavailable
        policy = RuntimePolicy(environment=settings.RUNTIME_ENVIRONMENT,
            session_ttl_seconds=settings.RUNTIME_SESSION_TTL_SECONDS,
            content_retention_seconds=settings.RUNTIME_CONTENT_RETENTION_SECONDS,
            trace_retention_seconds=settings.RUNTIME_TRACE_RETENTION_SECONDS,
            internal_token_max_age_seconds=settings.RUNTIME_INTERNAL_TOKEN_MAX_AGE_SECONDS)
        codec = None
        if settings.RUNTIME_CURSOR_SIGNING_KEY:
            cursor_key = _decode_key(settings.RUNTIME_CURSOR_SIGNING_KEY.get_secret_value())
            if cursor_key in keys.values():
                raise ValueError
            codec = HistoryCursorCodec(cursor_key)
        engine = build_engine(settings.RUNTIME_DATABASE_URL.get_secret_value())
        uow = RuntimeUnitOfWork(engine)
        trace_sink = DatabaseTraceSink(uow)
        product, validator = ProductUnavailable(), ExperienceValidator()
        conversations = ConversationService(uow, product, validator, policy=policy, trace_sink=trace_sink)
        # Default engine registry is empty until DEC-04 and no completion projector exists before B-03/C-04;
        # pinned activities therefore fail closed instead of running an unregistered profile.
        store = TurnStore(uow, ActivityPersistence(uow, product, validator), conversations)
        turns = TurnService(store, TurnHandler(PinnedAssessmentEngine(), completion=None), trace_sink=trace_sink)
        return RuntimeContainer(policy=policy, verifier=verifier, conversations=conversations,
            history=HistoryService(uow, codec, trace_sink=trace_sink) if codec else None,
            lifecycle=LifecycleService(uow, trace_sink=trace_sink),
            results=ResultReadService(uow, trace_sink=trace_sink), turns=turns, engine=engine)
    except Exception:
        if engine is not None:
            engine.dispose()
        return unavailable


def _raw_target(scope):
    try:
        path = scope["raw_path"].decode("ascii")
        query = scope.get("query_string", b"").decode("ascii")
        target = path + ("?" + query if query else "")
        if (not path.startswith(PREFIX + "/") or "?" in path or "#" in target
                or any(ord(char) <= 32 or ord(char) >= 127 for char in target)
                or re.search(r"%(?![0-9A-Fa-f]{2})", target)):
            raise ValueError
        return target
    except (KeyError, UnicodeError, ValueError):
        raise RuntimeSessionError(400, "INVALID_REQUEST") from None


class InternalBoundary:
    """Buffer at most the configured cap; Content-Length is never trusted."""
    def __init__(self, app, runtime):
        self.app = app
        self.runtime = runtime

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not (
            scope["path"] == PREFIX or scope["path"].startswith(PREFIX + "/")
        ):
            await self.app(scope, receive, send)
            return
        meta = (str(uuid4()), str(uuid4()), datetime.now(UTC))
        try:
            raw = bytearray()
            policy = self.runtime.policy if self.runtime else None
            limit = policy.max_json_bytes if policy else 65536
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                if len(raw) + len(chunk) > limit:
                    raise RuntimeSessionError(413, "PAYLOAD_TOO_LARGE")
                raw.extend(chunk)
                if not message.get("more_body", False):
                    break
            target = _raw_target(scope)
            runtime = self.runtime
            request = Request(scope)
            def correlation(name: str) -> str:
                value = request.headers.get(name)
                try:
                    return str(UUID(value)) if value else str(uuid4())
                except (ValueError, AttributeError):
                    return str(uuid4())

            meta = (correlation("x-request-id"), correlation("x-trace-id"), datetime.now(UTC))
            for name in ("x-caller-context", "x-internal-caller"):
                if len(request.headers.getlist(name)) > 1:
                    raise RuntimeSessionError(401, "AUTH_CALLER_CONTEXT_INVALID")
            token = request.headers.get("x-caller-context")
            issuer = request.headers.get("x-internal-caller")
            if token is None or issuer is None:
                raise RuntimeSessionError(401, "AUTH_CALLER_CONTEXT_MISSING")
            if (issuer != "sda-product-bff" or not token
                    or len(token.encode("utf-8")) > (policy.max_jwt_bytes if policy else 8192)):
                raise RuntimeSessionError(401, "AUTH_CALLER_CONTEXT_INVALID")
            if runtime is None or runtime.verifier is None:
                # No configured trust root: never reveal service readiness to an unverified caller.
                raise RuntimeSessionError(401, "AUTH_CALLER_CONTEXT_INVALID")
            try:
                caller = runtime.verifier.verify(token, issuer,
                    RawRequestContext(scope["method"], target, bytes(raw)))
            except RuntimeSessionError as error:
                if error.status == 401:
                    raise RuntimeSessionError(401, "AUTH_CALLER_CONTEXT_INVALID") from None
                raise
            scope.setdefault("state", {}).update(runtime=runtime, caller=caller, raw_body=bytes(raw), meta=meta)

            async def replay_body():
                return {"type": "http.request", "body": bytes(raw), "more_body": False}

            async def no_store(message):
                if message["type"] == "http.response.start":
                    message["headers"] = [(key, value) for key, value in message["headers"]
                        if key.lower() != b"cache-control"] + [(b"cache-control", b"no-store")]
                await send(message)

            with request_trace_context(meta):
                await self.app(scope, replay_body, no_store)
        except RuntimeSessionError as error:
            await failure(error, *meta)(scope, receive, send)
        except (DisconnectionError, InterfaceError, OperationalError, TimeoutError):
            await failure(RuntimeSessionError(503, "SERVICE_UNAVAILABLE", {"kind": "dependency_down"}), *meta)(scope, receive, send)
        except Exception:
            await failure(RuntimeSessionError(500, "INTERNAL_ERROR"), *meta)(scope, receive, send)
