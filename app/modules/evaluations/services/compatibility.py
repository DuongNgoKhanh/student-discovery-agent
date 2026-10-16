"""Compatibility Service for Experience Definition and Engine Versions.

Implements DEC-04 registration check and profile capability validation:
- Checks engine version support for schema_version (1.0, 2.0).
- Maps rule schemas strictly by (schema_version, slot) to prevent slot-swapping or version-mismatch.
- Validates that engine_version in each rule document matches root engine_version.
- Default registry is EMPTY per OpenAPI contract ("DEC-04 unresolved; no rule schema is registered").
- Provides PILOT_ENGINE_REGISTRY for test environments and pilot execution.
- Ensures unsupported profiles return status='unsupported' and never pass.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

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


# Allowed rule schema references mapped strictly by (schema_version, slot)
ALLOWED_RULE_SCHEMAS_BY_SLOT: Dict[str, Dict[str, Set[str]]] = {
    "1.0": {
        "selection_rules": {"rule.schema.localis.selection:v1"},
        "scoring_rules": {"rule.schema.localis.scoring:v1"},
        "coverage_rules": {"rule.schema.localis.coverage.fixed:v1"},
        "tie_policy": {"rule.schema.localis.tie.hexagonal:v1"},
    },
    "2.0": {
        "selection_rules": {"rule.schema.localis.selection.adaptive_bounds:v1"},
        "scoring_rules": {"rule.schema.localis.scoring.mean_rating:v1"},
        "coverage_rules": {"rule.schema.localis.coverage.bounded_stop:v1"},
        "tie_policy": {"rule.schema.localis.tie.fixed_order:v1"},
    },
}

# Production default: EMPTY per OpenAPI ("DEC-04 unresolved; no rule schema is registered by this contract")
DEFAULT_ENGINE_REGISTRY: Dict[str, EngineProfile] = {}

# Pilot / Test registry: used in unit tests and controlled pilot environments
PILOT_ENGINE_REGISTRY: Dict[str, EngineProfile] = {
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
        # Default to empty registry unless explicitly injected
        self.registry = registry if registry is not None else DEFAULT_ENGINE_REGISTRY

    def check_engine_exists(self, engine_version: str) -> bool:
        """Check if engine version is registered."""
        return isinstance(engine_version, str) and engine_version in self.registry

    def check_compatibility(
        self,
        schema_version: str,
        engine_version: str,
        rule_docs: Dict[str, Any],  # slot -> rule_doc dict
    ) -> Tuple[ValidationStatus, List[ValidationIssue]]:
        """Verify engine and rule schema compatibility.

        Enforces:
        - Engine version registration.
        - Supported schema_version for registered engine.
        - Match between root engine_version and each rule doc's engine_version.
        - Strict (schema_version, slot) rule schema whitelist.
        - Profile rule schema support.

        Returns:
            (status, issues)
            status is PASSED if fully compatible, UNSUPPORTED if engine or any rule schema is not registered/supported.
        """
        issues: List[ValidationIssue] = []

        if not isinstance(engine_version, str) or engine_version not in self.registry:
            issues.append(
                ValidationIssue(
                    path="engine_version",
                    code="VAL_UNSUPPORTED_ENGINE_VERSION",
                    message=(
                        f"Engine version '{engine_version}' is not registered in the system capability registry. "
                        f"Registered engines: {sorted(list(self.registry.keys())) if self.registry else 'none (DEC-04 pending)'}."
                    ),
                    rule_id="ENGINE_REGISTRATION",
                )
            )
            return ValidationStatus.UNSUPPORTED, issues

        profile = self.registry[engine_version]

        # Check schema_version compatibility
        if not isinstance(schema_version, str) or schema_version not in profile.supported_schema_versions:
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

        allowed_slots = ALLOWED_RULE_SCHEMAS_BY_SLOT.get(schema_version, {})
        has_unsupported_rules = False

        for slot in ["selection_rules", "scoring_rules", "coverage_rules", "tie_policy"]:
            rule_doc = rule_docs.get(slot)
            if not isinstance(rule_doc, dict):
                continue

            rule_ref = rule_doc.get("rule_schema_ref")
            rule_eng = rule_doc.get("engine_version")

            # Check rule document engine_version matches root engine_version
            if isinstance(rule_eng, str) and rule_eng != engine_version:
                issues.append(
                    ValidationIssue(
                        path=f"{slot}.engine_version",
                        code="VAL_RULE_ENGINE_VERSION_MISMATCH",
                        message=(
                            f"Rule document '{slot}' engine_version '{rule_eng}' must match "
                            f"experience engine_version '{engine_version}'."
                        ),
                        rule_id="RULE_ENGINE_VERSION_MATCH",
                    )
                )

            # Check rule_schema_ref allowed for this (schema_version, slot)
            if isinstance(rule_ref, str):
                expected_refs = allowed_slots.get(slot, set())
                if rule_ref not in expected_refs:
                    has_unsupported_rules = True
                    issues.append(
                        ValidationIssue(
                            path=f"{slot}.rule_schema_ref",
                            code="VAL_UNSUPPORTED_RULE_SCHEMA",
                            message=(
                                f"Rule schema '{rule_ref}' is not permitted for slot '{slot}' in schema_version '{schema_version}'. "
                                f"Allowed schemas: {sorted(list(expected_refs))}."
                            ),
                            rule_id="RULE_SCHEMA_COMPATIBILITY",
                        )
                    )
                elif rule_ref not in profile.supported_rule_schemas:
                    has_unsupported_rules = True
                    issues.append(
                        ValidationIssue(
                            path=f"{slot}.rule_schema_ref",
                            code="VAL_UNSUPPORTED_RULE_SCHEMA",
                            message=(
                                f"Rule schema '{rule_ref}' is not registered under engine '{engine_version}'. "
                                "Unregistered rule profiles cannot be evaluated or published."
                            ),
                            rule_id="RULE_SCHEMA_COMPATIBILITY",
                        )
                    )

        if issues or has_unsupported_rules:
            # If any rule or engine compatibility issue, status is UNSUPPORTED
            return ValidationStatus.UNSUPPORTED, issues

        return ValidationStatus.PASSED, []
