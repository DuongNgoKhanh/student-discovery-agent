"""Verified identity and the exact request bytes covered by its signature."""

from dataclasses import dataclass
from datetime import datetime

from pydantic import TypeAdapter, ValidationError

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import OwnerId


@dataclass(frozen=True)
class RawRequestContext:
    method: str
    request_target: str
    body: bytes


@dataclass(frozen=True)
class VerifiedCaller:
    owner_id: str
    issuer: str
    expires_at: datetime


@dataclass(frozen=True)
class VerifiedService:
    issuer: str
    purpose: str
    expires_at: datetime


def require_owner(caller: VerifiedCaller) -> None:
    """Revalidate trusted Python port inputs without leaking identity details."""
    try:
        TypeAdapter(OwnerId).validate_python(caller.owner_id)
    except (ValidationError, AttributeError, ValueError):
        raise RuntimeSessionError(401, "AUTH_REQUIRED") from None
