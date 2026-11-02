"""Evaluation and Validation Module (M-EVL).

Responsible for:
- Schema validation of ExperienceDefinitionDocument (1.0 and 2.0)
- DEC-04 Rule schema compatibility and Engine capability checking
- ValidationReport and EvaluationReport generation
- Deterministic golden-case evaluation runner
- Publish-gate verification over an in-memory report store
"""

from agent_runtime.evaluations.schemas.experience import (
    ExperienceDefinitionDocument,
)
from agent_runtime.evaluations.schemas.validation import (
    EvaluationCaseResult,
    EvaluationReport,
    ExperienceSnapshotCommand,
    PublishReportInput,
    SnapshotCommandInput,
    ValidationIssue,
    ValidationReport,
    ValidationStatus,
)
from agent_runtime.evaluations.services.compatibility import (
    CompatibilityChecker,
)
from agent_runtime.evaluations.services.publish_gate import (
    PublishGateService,
    ReportStore,
)
from agent_runtime.evaluations.services.runner import (
    EvaluationRunner,
)
from agent_runtime.evaluations.services.validator import (
    ExperienceValidator,
    calculate_content_hash,
    validate_experience_definition,
)

__all__ = [
    "ExperienceDefinitionDocument",
    "ValidationIssue",
    "ValidationReport",
    "ValidationStatus",
    "EvaluationCaseResult",
    "EvaluationReport",
    "ExperienceSnapshotCommand",
    "PublishReportInput",
    "SnapshotCommandInput",
    "CompatibilityChecker",
    "ExperienceValidator",
    "calculate_content_hash",
    "validate_experience_definition",
    "EvaluationRunner",
    "PublishGateService",
    "ReportStore",
]
