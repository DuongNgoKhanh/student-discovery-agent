"""Validation and Evaluation Schemas matching OpenAPI specifications.

Conforms to:
- contracts/openapi/schemas/common.yaml (ValidationIssue, ValidationDetails)
- contracts/openapi/public/experience-validation-api.yaml (ValidationReport, SnapshotCommandInput,
  EvaluationReport, EvaluationCaseResult)
- apps/studio-api/src/modules/experiences/experiences.reports.ts (PublishReportInput)
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class EvaluationCaseResult(BaseModel):
    """Result of replaying one golden case; `passed` holds exactly when `issues` is empty."""

    case_id: str = Field(
        ...,
        min_length=1,
        # Echoes AssessmentGoldenCase.case_id, so it accepts the same alphabet (":" included).
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
        description="Identifier of the evaluation case",
    )
    mandatory: bool = Field(..., description="Whether passing this case is mandatory for publish gate")
    passed: bool = Field(..., description="True if actual execution matched all expected outcomes")
    expected: dict[str, Any] = Field(..., description="Expected deterministic outcome dictionary")
    actual: dict[str, Any] = Field(..., description="Actual outcome dictionary produced by the engine")
    issues: List[ValidationIssue] = Field(
        default_factory=list,
        description="List of issues or discrepancies found during evaluation",
    )

    model_config = ConfigDict(extra="allow", frozen=True)

    @model_validator(mode="after")
    def _passed_matches_issues(self) -> "EvaluationCaseResult":
        if self.passed == bool(self.issues):
            raise ValueError("passed must be true exactly when issues is empty")
        return self


class EvaluationReport(BaseModel):
    """Evaluation report conforming to experience-validation-api.yaml.

    `issues` is an additive report-level field (the contract allows additional properties): it
    carries why a report failed when the cause is not a single case (validation, no mandatory case).
    """

    id: str = Field(..., min_length=1, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    experience_id: str = Field(..., min_length=1, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    draft_revision: int = Field(..., ge=0, le=9007199254740991, description="Draft revision the caller captured")
    content_hash: str = Field(..., pattern=r"^sha256:[a-f0-9]{64}$", description="Exact content hash evaluated")
    definition_schema_version: str = Field(..., min_length=1)
    engine_version: str = Field(..., min_length=1)
    status: ValidationStatus = Field(
        ...,
        description="passed only if validation passed and every case passed; unsupported never passes",
    )
    mandatory_passed: bool = Field(
        ...,
        description=(
            "True if validation passed and at least one mandatory case exists and every mandatory case "
            "passed. Non-mandatory failures set status=failed without clearing this flag; the publish "
            "gate reads this flag."
        ),
    )
    cases: List[EvaluationCaseResult] = Field(default_factory=list, description="Individual case outcomes")
    issues: List[ValidationIssue] = Field(default_factory=list, description="Report-level issues")
    created_at: str = Field(..., pattern=r"Z$", description="ISO 8601 UTC timestamp ending in Z")

    @field_validator("created_at", mode="before")
    @classmethod
    def format_iso_timestamp(cls, v: Any) -> str:
        if isinstance(v, datetime):
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

    @model_validator(mode="after")
    def _flags_match_cases(self) -> "EvaluationReport":
        mandatory = [case for case in self.cases if case.mandatory]
        if self.mandatory_passed and not (mandatory and all(case.passed for case in mandatory)):
            raise ValueError("mandatory_passed requires at least one mandatory case and all of them passed")
        if self.status == ValidationStatus.PASSED and not (
            self.mandatory_passed and all(case.passed for case in self.cases)
        ):
            raise ValueError("status passed requires mandatory_passed and every case passed")
        if self.status == ValidationStatus.UNSUPPORTED and self.mandatory_passed:
            raise ValueError("an unsupported report never passes")
        if len({case.case_id for case in self.cases}) != len(self.cases):
            raise ValueError("case_id values must be unique")
        return self

    model_config = ConfigDict(extra="allow", use_enum_values=True, frozen=True)


_ID = r"^[A-Za-z0-9][A-Za-z0-9._-]*$"


class ExperienceSnapshotCommand(BaseModel):
    """Body of the internal validation/evaluation runs: SnapshotCommandInput plus the captured snapshot.

    Studio owns drafts, so it sends the exact definition it captured together with the contract's
    expected_revision/content_hash/idempotency_key (experience-validation-api.yaml).
    """

    experience_id: str = Field(..., min_length=1, pattern=_ID)
    definition: dict[str, Any]
    expected_revision: int = Field(..., strict=True, ge=0, le=9007199254740991)
    content_hash: str = Field(..., strict=True, pattern=r"^sha256:[a-f0-9]{64}$")
    idempotency_key: str = Field(..., strict=True, min_length=1, max_length=128, pattern=_ID)

    model_config = ConfigDict(extra="forbid", frozen=True)


class PublishReportInput(BaseModel):
    """Publish-gate verification input matching PublishReportInput from studio-api."""

    experience_id: str = Field(..., min_length=1, pattern=_ID)
    definition_hash: str = Field(..., pattern=r"^sha256:[a-f0-9]{64}$")
    definition_schema_version: str = Field(..., min_length=1)
    engine_version: str = Field(..., min_length=1)
    validation_id: str = Field(..., min_length=1, pattern=_ID)
    evaluation_id: str = Field(..., min_length=1, pattern=_ID)

    model_config = ConfigDict(extra="forbid", frozen=True)
