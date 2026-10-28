"""Explicit capabilities and bounded raw ASGI authentication before dispatch."""
from __future__ import annotations

import base64
import functools
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy.exc import DisconnectionError, InterfaceError, OperationalError, TimeoutError
from starlette.requests import Request

from agent_runtime.evaluations.services.validator import ExperienceValidator
from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier, ServiceVerifier
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.infrastructure.db.trace import DatabaseTraceSink
from agent_runtime.infrastructure.http.strict_json import read_strict_json
from agent_runtime.infrastructure.http.trace import request_trace_context
from agent_runtime.infrastructure.product.delivery import CompositeReleaseSource, HttpProductReleaseSource
from agent_runtime.infrastructure.product.local_files import LocalReleaseSource
from agent_runtime.infrastructure.product.releases import ProductUnavailable
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import RuntimePolicy
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.completion import EngineCompletionPort
from agent_runtime.sessions.services.conversations import ConversationService
from agent_runtime.sessions.services.history import HistoryCursorCodec, HistoryService
from agent_runtime.sessions.services.lifecycle import LifecycleService
from agent_runtime.sessions.services.responses import ResponseService
from agent_runtime.sessions.services.results import ResultReadService
from agent_runtime.sessions.services.turn_handlers import PinnedAssessmentEngine, TurnHandler
from agent_runtime.sessions.services.turn_store import TurnStore
from agent_runtime.sessions.services.turns import TurnService

from .envelopes import failure

if TYPE_CHECKING:
    from agent_runtime.config.settings import Settings

PREFIX = "/api/v1/internal"
SERVICE_ROUTES: dict[tuple[str, str], str] = {
    ("POST", PREFIX + "/knowledge/retrieval"): "knowledge.retrieval",
    ("POST", PREFIX + "/agent-snapshots:validate"): "agent.validate",
}


class SystemClock:
    def now(self):
        return datetime.now(UTC)


@dataclass(repr=False)
class RuntimeContainer:
    policy: RuntimePolicy | None
    verifier: CallerVerifier | None = None
    service_verifier: ServiceVerifier | None = None
    conversations: ConversationService | None = None
    history: HistoryService | None = None
    lifecycle: LifecycleService | None = None
    results: ResultReadService | None = None
    turns: TurnService | None = None
    responses: ResponseService | None = None
    product_ready: bool = False
    engine: object | None = None
    knowledge: object | None = None
    agent_validation: object | None = None


def _decode_key(value):
    if not isinstance(value, str):
        raise ValueError
    key = base64.b64decode(value, validate=True)
    if len(key) < 32 or base64.b64encode(key).decode("ascii") != value:
        raise ValueError
    return key


def _build_service_verifier(settings: Settings, student_keys: dict[str, bytes]) -> ServiceVerifier | None:
    """A bad Studio keyring disables only the Studio path; student traffic must keep working."""
    if not settings.RUNTIME_STUDIO_KEYRING:
        return None
    try:
        raw = read_strict_json(settings.RUNTIME_STUDIO_KEYRING.get_secret_value().encode("utf-8"))
        keys = {kid: _decode_key(value) for kid, value in raw.items()}
        if set(keys.values()) & set(student_keys.values()):
            return None
        return ServiceVerifier(keys, SystemClock())
    except Exception:
        return None


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
    service_verifier = _build_service_verifier(settings, keys)
    unavailable = RuntimeContainer(policy=None, verifier=verifier, service_verifier=service_verifier)
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
        local = LocalReleaseSource(settings.RUNTIME_LOCAL_RELEASES_DIR) if settings.RUNTIME_LOCAL_RELEASES_DIR else None
        agent_source = local
        if settings.RUNTIME_AGENT_RELEASE_SOURCE == "product":
            agent_source = None
            if settings.RUNTIME_PRODUCT_URL and settings.RUNTIME_PRODUCT_SIGNING_KEY:
                delivery_key = _decode_key(settings.RUNTIME_PRODUCT_SIGNING_KEY.get_secret_value())
                if delivery_key not in keys.values():
                    agent_source = HttpProductReleaseSource(settings.RUNTIME_PRODUCT_URL, delivery_key,
                                                            settings.RUNTIME_PRODUCT_SIGNING_KID)
        product = CompositeReleaseSource(agent=agent_source or ProductUnavailable(),
                                         experience=local or ProductUnavailable())
        validator = ExperienceValidator()
        conversations = ConversationService(uow, product, validator, policy=policy, trace_sink=trace_sink)
        store = TurnStore(uow, ActivityPersistence(uow, product, validator), conversations)
        handler = TurnHandler(PinnedAssessmentEngine(), completion=EngineCompletionPort())
        # Imported lazily: provider SDKs load only when a runtime with a database is built.
        from agent_runtime.infrastructure.llm.embedding_registry import build_embedding_ports
        from agent_runtime.infrastructure.llm.model_registry import build_model_port
        from agent_runtime.knowledge.retrieval import PgKnowledge
        # Query path: no retries; a failed embed degrades to keyword search. The embedding timeout and the
        # SQL statement timeout run in sequence, so the worst case is their sum, not one shared budget.
        knowledge = PgKnowledge(uow, build_embedding_ports(
            settings, timeout_ms=settings.KNOWLEDGE_RETRIEVAL_TIMEOUT_MS, max_retries=0),
            timeout_ms=settings.KNOWLEDGE_RETRIEVAL_TIMEOUT_MS)
        from agent_runtime.agent.validation import AgentSnapshotValidator
        agent_validation = AgentSnapshotValidator(knowledge, product, policy.environment)
        responses = ResponseService(uow, trace_sink=trace_sink)
        turns = TurnService(store, handler, models=functools.cache(build_model_port), responses=responses,
                            knowledge=knowledge, trace_sink=trace_sink)
        return RuntimeContainer(policy=policy, verifier=verifier, service_verifier=service_verifier,
            conversations=conversations,
            history=HistoryService(uow, codec, trace_sink=trace_sink) if codec else None,
            lifecycle=LifecycleService(uow, trace_sink=trace_sink),
            results=ResultReadService(uow, trace_sink=trace_sink), turns=turns, responses=responses, engine=engine,
            knowledge=knowledge, agent_validation=agent_validation,
            product_ready=agent_source is not None)
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
            if (issuer not in ("sda-product-bff", "sda-studio-api") or not token
                    or len(token.encode("utf-8")) > (policy.max_jwt_bytes if policy else 8192)):
                raise RuntimeSessionError(401, "AUTH_CALLER_CONTEXT_INVALID")
            service = issuer == "sda-studio-api"
            verifier = runtime.service_verifier if service and runtime else runtime.verifier if runtime else None
            if verifier is None:
                # No configured trust root: never reveal service readiness to an unverified caller.
                raise RuntimeSessionError(401, "AUTH_CALLER_CONTEXT_INVALID")
            context = RawRequestContext(scope["method"], target, bytes(raw))
            try:
                caller = verifier.verify(token, context) if service else verifier.verify(token, issuer, context)
            except RuntimeSessionError as error:
                if error.status == 401:
                    raise RuntimeSessionError(401, "AUTH_CALLER_CONTEXT_INVALID") from None
                raise
            if service and SERVICE_ROUTES.get((scope["method"], target)) != caller.purpose:
                raise RuntimeSessionError(403, "FORBIDDEN")
            scope.setdefault("state", {}).update(runtime=runtime, caller=caller, raw_body=bytes(raw), meta=meta)

            replayed = False

            async def replay_body():
                # Body once, then the real channel: streaming responses poll it for http.disconnect.
                nonlocal replayed
                if replayed:
                    return await receive()
                replayed = True
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
