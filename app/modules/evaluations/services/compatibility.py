"""Compatibility Service for Experience Definition and Engine Versions.

Implements DEC-04 registration check and profile capability validation:
- Checks engine version support for schema_version (1.0, 2.0)
- Validates registered rule schemas for selection, scoring, coverage, and tie_policy
- Ensures unsupported profiles return status='unsupported' and never pass.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from app.modules.evaluations.schemas.validation import ValidationIssue, ValidationStatus


@dataclass(frozen=True)
class EngineProfile:
    """Capability specification for an Engine version."""

    engine_version: str
    supported_schema_versions: Set[str] = field(default_factory=lambda: {"1.0", "2.0"})
    supported_activity_types: Set[str] = field(
        default_factory=lambda: {
            "personality_assessment",
            "personality_assessment_adaptive",
        }
    )
    supported_rule_schemas: Set[str] = field(
        default_factory=lambda: {
            # Definition 1.0 rule schemas
            "rule.schema.localis.selection:v1",
            "rule.schema.localis.scoring:v1",
            "rule.schema.localis.coverage.fixed:v1",
            "rule.schema.localis.tie.hexagonal:v1",
            # Definition 2.0 (ADR-002) rule schemas
            "rule.schema.localis.selection.adaptive_bounds:v1",
            "rule.schema.localis.scoring.mean_rating:v1",
            "rule.schema.localis.coverage.bounded_stop:v1",
            "rule.schema.localis.tie.fixed_order:v1",
        }
    )


# Default Engine Registry
DEFAULT_ENGINE_REGISTRY: Dict[str, EngineProfile] = {
    "career-assessment-v1": EngineProfile(
        engine_version="career-assessment-v1",
        supported_schema_versions={"1.0", "2.0"},
    ),
    "1.0.0": EngineProfile(
        engine_version="1.0.0",
        supported_schema_versions={"1.0", "2.0"},
    ),
    "2.0.0": EngineProfile(
        engine_version="2.0.0",
        supported_schema_versions={"1.0", "2.0"},
    ),
}


class CompatibilityChecker:
    """Verifies compatibility between experience definition and engine runtime."""

    def __init__(self, registry: Optional[Dict[str, EngineProfile]] = None):
        self.registry = registry if registry is not None else DEFAULT_ENGINE_REGISTRY

    def check_engine_exists(self, engine_version: str) -> bool:
        """Check if engine version is registered."""
        return engine_version in self.registry

    def check_compatibility(
        self,
        schema_version: str,
        engine_version: str,
        rule_schemas: Dict[str, str],  # dict of field_name -> rule_schema_ref
    ) -> Tuple[ValidationStatus, List[ValidationIssue]]:
        """Verify engine and rule schema compatibility.

        Returns:
            (status, issues)
            status is PASSED if fully compatible, UNSUPPORTED if engine or any rule schema is not registered.
        """
        issues: List[ValidationIssue] = []

        if engine_version not in self.registry:
            issues.append(
                ValidationIssue(
                    path="engine_version",
                    code="VAL_UNSUPPORTED_ENGINE_VERSION",
                    message=(
                        f"Engine version '{engine_version}' is not registered in the system capability registry. "
                        f"Supported engines: {sorted(list(self.registry.keys()))}."
                    ),
                    rule_id="ENGINE_REGISTRATION",
                )
            )
            return ValidationStatus.UNSUPPORTED, issues

        profile = self.registry[engine_version]

        # Check schema_version compatibility
        if schema_version not in profile.supported_schema_versions:
            issues.append(
                ValidationIssue(
                    path="schema_version",
                    code="VAL_INCOMPATIBLE_ENGINE_VERSION",
                    message=(
                        f"Engine version '{engine_version}' does not support definition schema version '{schema_version}'. "
                        f"Supported schema versions: {sorted(list(profile.supported_schema_versions))}."
                    ),
                    rule_id="ENGINE_COMPATIBILITY",
                )
            )

        # Check DEC-04 rule schemas registration
        unsupported_rules = False
        for field_path, rule_ref in rule_schemas.items():
            if rule_ref not in profile.supported_rule_schemas:
                unsupported_rules = True
                issues.append(
                    ValidationIssue(
                        path=f"{field_path}.rule_schema_ref",
                        code="VAL_UNSUPPORTED_RULE_SCHEMA",
                        message=(
                            f"Rule schema '{rule_ref}' is not registered or unsupported under engine '{engine_version}' (DEC-04). "
                            "Unregistered rule profiles cannot be evaluated or published."
                        ),
                        rule_id="RULE_SCHEMA_COMPATIBILITY",
                    )
                )

        if issues or unsupported_rules:
            return ValidationStatus.UNSUPPORTED, issues

        return ValidationStatus.PASSED, []
