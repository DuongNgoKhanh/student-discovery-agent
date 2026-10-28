"""Verify short-lived Product context against the unchanged internal request."""

from collections.abc import Mapping
from datetime import UTC, datetime
from hashlib import sha256
from hmac import compare_digest

import jwt
from pydantic import TypeAdapter

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.ports import Clock
from agent_runtime.sessions.schemas.common import OwnerId

from .caller import RawRequestContext, VerifiedCaller, VerifiedService

_AUDIENCE = "sda-agent-runtime"
_ISSUER = "sda-product-bff"
_REQUIRED_CLAIMS = (
    "iss", "aud", "caller_type", "owner_id", "iat", "exp", "method", "request_target", "body_sha256"
)
_SERVICE_ISSUER = "sda-studio-api"
_SERVICE_PURPOSES = frozenset({"knowledge.retrieval"})
_SERVICE_CLAIMS = (
    "iss", "aud", "caller_type", "purpose", "iat", "exp", "method", "request_target", "body_sha256"
)


def _checked_keyring(keyring: Mapping[str, bytes]) -> dict[str, bytes]:
    keys = dict(keyring)
    if not keys or any(
        not isinstance(kid, str) or not kid.strip() or not isinstance(key, bytes) or len(key) < 32
        for kid, key in keys.items()
    ):
        raise ValueError("Invalid internal keyring configuration")
    return keys


def _verified_claims(token: str, keyring: Mapping[str, bytes], clock: Clock, issuer: str,
                     required: tuple[str, ...], request: RawRequestContext) -> tuple[dict, datetime]:
    """Raise ValueError/PyJWTError for anything that is not a fresh, bound, correctly signed token."""
    if len(token.encode("utf-8")) > 8192:
        raise ValueError("Invalid context size")
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if (
        header.get("alg") != "HS256"
        or header.get("typ") != "sda-internal+jwt"
        or set(header) - {"alg", "typ", "kid"}
        or not isinstance(kid, str)
        or kid not in keyring
    ):
        raise ValueError("Invalid context header")
    claims = jwt.decode(
        token,
        keyring[kid],
        algorithms=["HS256"],
        issuer=issuer,
        audience=_AUDIENCE,
        options={
            "require": list(required),
            "strict_aud": True,
            "verify_exp": False,
            "verify_iat": False,
            "verify_nbf": False,
        },
    )
    if any(not isinstance(claims[name], str) for name in required if name not in {"iat", "exp"}):
        raise ValueError("Invalid context claims")
    issued_at, expires_at = claims["iat"], claims["exp"]
    if type(issued_at) is not int or type(expires_at) is not int:
        raise ValueError("Invalid context timestamps")
    if not 0 < expires_at - issued_at <= 60:
        raise ValueError("Invalid context lifetime")
    now = clock.now().timestamp()
    if not issued_at <= now < expires_at:
        raise ValueError("Invalid context time")
    if (
        claims["method"] != claims["method"].upper()
        or claims["method"] != request.method
        or claims["request_target"] != request.request_target
        or not compare_digest(claims["body_sha256"], sha256(request.body).hexdigest())
    ):
        raise ValueError("Invalid request binding")
    return claims, datetime.fromtimestamp(expires_at, UTC)


class CallerVerifier:
    def __init__(self, keyring: Mapping[str, bytes], clock: Clock) -> None:
        self._keyring = _checked_keyring(keyring)
        self._clock = clock

    def verify(
        self, token: str, internal_caller: str | None, request: RawRequestContext
    ) -> VerifiedCaller:
        if internal_caller != _ISSUER:
            raise RuntimeSessionError(403, "FORBIDDEN")
        if not isinstance(token, str) or not token or len(token) > 8192:
            raise RuntimeSessionError(401, "AUTH_REQUIRED")
        try:
            claims, expiration = _verified_claims(token, self._keyring, self._clock, _ISSUER,
                                                  _REQUIRED_CLAIMS, request)
            TypeAdapter(OwnerId).validate_python(claims["owner_id"])
        except (jwt.PyJWTError, ValueError, TypeError, OverflowError):
            raise RuntimeSessionError(401, "AUTH_REQUIRED") from None
        if claims["caller_type"] != "student":
            raise RuntimeSessionError(403, "FORBIDDEN")
        return VerifiedCaller(owner_id=claims["owner_id"], issuer=_ISSUER, expires_at=expiration)


class ServiceVerifier:
    """Studio calls the runtime as a service, never as a student: no owner, one purpose per token."""

    def __init__(self, keyring: Mapping[str, bytes], clock: Clock) -> None:
        self._keyring = _checked_keyring(keyring)
        self._clock = clock

    def verify(self, token: str, request: RawRequestContext) -> VerifiedService:
        if not isinstance(token, str) or not token or len(token) > 8192:
            raise RuntimeSessionError(401, "AUTH_REQUIRED")
        try:
            claims, expiration = _verified_claims(token, self._keyring, self._clock, _SERVICE_ISSUER,
                                                  _SERVICE_CLAIMS, request)
        except (jwt.PyJWTError, ValueError, TypeError, OverflowError):
            raise RuntimeSessionError(401, "AUTH_REQUIRED") from None
        if claims["caller_type"] != "studio_service" or claims["purpose"] not in _SERVICE_PURPOSES:
            raise RuntimeSessionError(403, "FORBIDDEN")
        return VerifiedService(issuer=_SERVICE_ISSUER, purpose=claims["purpose"], expires_at=expiration)
