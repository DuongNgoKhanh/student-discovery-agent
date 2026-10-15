"""Evaluation and Validation Module (M-EVL).

Responsible for:
- Schema validation of ExperienceDefinitionDocument (1.0 and 2.0)
- DEC-04 Rule schema compatibility and Engine capability checking
- ValidationReport and EvaluationReport generation
"""

from app.modules.evaluations.schemas.experience import (
    ExperienceDefinitionDocument,
)
from app.modules.evaluations.schemas.validation import (
    ValidationIssue,
    ValidationReport,
    ValidationStatus,
)
from app.modules.evaluations.services.compatibility import (
    CompatibilityChecker,
)
from app.modules.evaluations.services.validator import (
    ExperienceValidator,
    calculate_content_hash,
    validate_experience_definition,
)

__all__ = [
    "ExperienceDefinitionDocument",
    "ValidationIssue",
    "ValidationReport",
    "ValidationStatus",
    "CompatibilityChecker",
    "ExperienceValidator",
    "calculate_content_hash",
    "validate_experience_definition",
]
