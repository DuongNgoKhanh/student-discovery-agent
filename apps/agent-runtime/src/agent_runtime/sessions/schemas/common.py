"""Shared validated primitives; all persisted counters remain JSON safe."""
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

JsonObject = dict[str, Any]
JsonSafeInt = Annotated[int, Field(strict=True, ge=0, le=9007199254740991)]
PositiveRevision = Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]
OpaqueId = Annotated[str, StringConstraints(min_length=1, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")]
IdempotencyKey = Annotated[str, StringConstraints(
    strict=True, min_length=1, max_length=256, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")]
OutcomeOperation = Annotated[str, StringConstraints(
    strict=True, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")]
OutcomeScope = Annotated[str, StringConstraints(
    strict=True, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")]


def _owner(value: str) -> str:
    # UTF-8 rejects lone surrogates; PostgreSQL text also cannot store NUL.
    if not value.strip() or "\x00" in value or len(value.encode("utf-8")) > 1024:
        raise ValueError("invalid owner identity")
    return value


OwnerId = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=256), AfterValidator(_owner)]
NonEmptyText = Annotated[str, StringConstraints(min_length=1, pattern=r"\S")]
ContentHash = Annotated[str, StringConstraints(pattern=r"^sha256:[a-f0-9]{64}$")]


def _utc(value: datetime) -> datetime:
    if value.utcoffset() != timedelta(0):
        raise ValueError("timestamp must be timezone-aware UTC")
    return value


UtcDatetime = Annotated[datetime, AfterValidator(_utc)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ServiceResponse(ContractModel):
    status: Annotated[int, Field(strict=True, ge=100, le=599)]
    data: JsonObject
    replayed: bool = False


class RuntimePolicy(ContractModel):
    environment: Literal["demo"]
    session_ttl_seconds: Literal[3600] = 3600
    content_retention_seconds: Literal[86400] = 86400
    trace_retention_seconds: Literal[86400] = 86400
    internal_token_max_age_seconds: Literal[60] = 60
    max_json_bytes: Annotated[int, Field(strict=True, ge=1, le=65536)] = 65536
    max_jwt_bytes: Annotated[int, Field(strict=True, ge=1, le=8192)] = 8192
    max_release_content_bytes: Annotated[int, Field(strict=True, ge=1, le=2097152)] = 2097152
    history_default_limit: Literal[20] = 20
    history_max_limit: Literal[100] = 100
    cleanup_batch_size: Annotated[int, Field(strict=True, ge=1, le=100)] = 100
    cleanup_interval_seconds: Literal[60] = 60
