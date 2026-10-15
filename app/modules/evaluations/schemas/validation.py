"""Validation and Evaluation Schemas matching OpenAPI specifications.

Conforms to:
- docs/openapi/schemas/common.yaml (ValidationIssue, ValidationDetails)
- docs/openapi/experience-validation-api.yaml (ValidationReport, SnapshotCommandInput)
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator


class ValidationStatus(str, Enum):
    """Validation report status enum per OpenAPI spec."""

    PASSED = "passed"
    FAILED = "failed"
    UNSUPPORTED = "unsupported"


class ValidationIssue(BaseModel):
    """Field-level and rule-level validation issue conforming to common.yaml."""

    path: str = Field(
        ...,
        description="JSON path or dotted attribute path where the issue occurred (e.g. questions[0].choices)",
    )
    code: str = Field(
        ...,
        min_length=1,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        description="Standardized error code (e.g. VAL_INVALID_HOUSE_COUNT)",
    )
    message: str = Field(
        ...,
        min_length=1,
        description="Human-readable explanation of the validation failure",
    )
    rule_id: Optional[str] = Field(
        default=None,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        description="Rule/Constraint identifier (e.g. RULE_SCHEMA_COMPATIBILITY)",
    )

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class ValidationDetails(BaseModel):
    """Validation error details wrapper conforming to common.yaml."""

    kind: str = Field(default="validation", description="Details kind discriminator")
    issues: List[ValidationIssue] = Field(
        ..., min_length=1, description="List of structured validation issues"
    )

    model_config = ConfigDict(extra="allow")


class SnapshotCommandInput(BaseModel):
    """Snapshot command input conforming to experience-validation-api.yaml."""

    expected_revision: int = Field(
        ..., ge=0, le=9007199254740991, description="Expected draft revision"
    )
    content_hash: str = Field(
        ...,
        pattern=r"^sha256:[a-f0-9]{64}$",
        description="Content SHA256 hash formatted as sha256:...",
    )
    idempotency_key: str = Field(
        ...,
        min_length=1,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        description="Idempotency key for deterministic replay",
    )

    model_config = ConfigDict(extra="forbid")


class ValidationReport(BaseModel):
    """Full validation report conforming to experience-validation-api.yaml."""

    id: str = Field(
        ...,
        min_length=1,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        description="Unique report identifier",
    )
    experience_id: str = Field(
        ...,
        min_length=1,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
        description="ID of the experience validated",
    )
    draft_revision: int = Field(
        ..., ge=0, le=9007199254740991, description="Revision of the draft evaluated"
    )
    content_hash: str = Field(
        ...,
        pattern=r"^sha256:[a-f0-9]{64}$",
        description="Exact content hash evaluated",
    )
    definition_schema_version: str = Field(
        ..., min_length=1, description="Experience definition schema version (e.g. 1.0 or 2.0)"
    )
    engine_version: str = Field(
        ..., min_length=1, description="Target engine version evaluated against"
    )
    status: ValidationStatus = Field(
        ..., description="Validation outcome status: passed, failed, unsupported"
    )
    mandatory_passed: bool = Field(
        ..., description="True if status is passed and all mandatory invariants are met"
    )
    issues: List[ValidationIssue] = Field(
        default_factory=list, description="List of issues discovered during validation"
    )
    created_at: str = Field(
        ...,
        pattern=r"Z$",
        description="ISO 8601 UTC timestamp ending in Z",
    )

    @field_validator("created_at", mode="before")
    @classmethod
    def format_iso_timestamp(cls, v: Any) -> str:
        if isinstance(v, datetime):
            # Ensure UTC and ends with Z
            if v.tzinfo is None:
                v = v.replace(tzinfo=timezone.utc)
            else:
                v = v.astimezone(timezone.utc)
            return v.strftime("%Y-%m-%dT%H:%M:%SZ")
        if isinstance(v, str):
            if not v.endswith("Z"):
                raise ValueError("created_at timestamp must end with 'Z'")
            return v
        raise ValueError("Invalid datetime format for created_at")

    model_config = ConfigDict(extra="allow", use_enum_values=True)
