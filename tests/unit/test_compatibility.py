"""Unit tests for CompatibilityChecker (Task C-01 / M-EVL / DEC-04).

Verifies engine capability registry, schema support, and DEC-04 rule schema registration.
"""

import pytest

from app.modules.evaluations.schemas.validation import ValidationStatus
from app.modules.evaluations.services.compatibility import (
    CompatibilityChecker,
    DEFAULT_ENGINE_REGISTRY,
    EngineProfile,
)


class TestCompatibilityChecker:
    """Test suite for CompatibilityChecker."""

    def test_default_engine_registration(self):
        checker = CompatibilityChecker()
        assert checker.check_engine_exists("career-assessment-v1")
        assert checker.check_engine_exists("1.0.0")
        assert checker.check_engine_exists("2.0.0")
        assert not checker.check_engine_exists("unknown-engine")

    def test_compatible_v1_rules(self):
        checker = CompatibilityChecker()
        status, issues = checker.check_compatibility(
            schema_version="1.0",
            engine_version="career-assessment-v1",
            rule_schemas={
                "selection_rules": "rule.schema.localis.selection:v1",
                "scoring_rules": "rule.schema.localis.scoring:v1",
                "coverage_rules": "rule.schema.localis.coverage.fixed:v1",
                "tie_policy": "rule.schema.localis.tie.hexagonal:v1",
            },
        )
        assert status == ValidationStatus.PASSED
        assert len(issues) == 0

    def test_compatible_v2_rules(self):
        checker = CompatibilityChecker()
        status, issues = checker.check_compatibility(
            schema_version="2.0",
            engine_version="career-assessment-v1",
            rule_schemas={
                "selection_rules": "rule.schema.localis.selection.adaptive_bounds:v1",
                "scoring_rules": "rule.schema.localis.scoring.mean_rating:v1",
                "coverage_rules": "rule.schema.localis.coverage.bounded_stop:v1",
                "tie_policy": "rule.schema.localis.tie.fixed_order:v1",
            },
        )
        assert status == ValidationStatus.PASSED
        assert len(issues) == 0

    def test_unregistered_rule_schema_returns_unsupported(self):
        checker = CompatibilityChecker()
        status, issues = checker.check_compatibility(
            schema_version="2.0",
            engine_version="career-assessment-v1",
            rule_schemas={
                "scoring_rules": "rule.schema.unregistered.scoring:v9",
            },
        )
        assert status == ValidationStatus.UNSUPPORTED
        assert len(issues) == 1
        assert issues[0].code == "VAL_UNSUPPORTED_RULE_SCHEMA"
        assert issues[0].rule_id == "RULE_SCHEMA_COMPATIBILITY"

    def test_incompatible_schema_version_returns_unsupported(self):
        checker = CompatibilityChecker()
        status, issues = checker.check_compatibility(
            schema_version="3.0",
            engine_version="career-assessment-v1",
            rule_schemas={},
        )
        assert status == ValidationStatus.UNSUPPORTED
        assert len(issues) == 1
        assert issues[0].code == "VAL_INCOMPATIBLE_ENGINE_VERSION"

    def test_custom_engine_profile(self):
        custom_registry = {
            "custom-v1": EngineProfile(
                engine_version="custom-v1",
                supported_schema_versions={"1.0"},
                supported_rule_schemas={"rule.schema.custom:v1"},
            )
        }
        checker = CompatibilityChecker(registry=custom_registry)
        status, issues = checker.check_compatibility(
            schema_version="1.0",
            engine_version="custom-v1",
            rule_schemas={"selection_rules": "rule.schema.custom:v1"},
        )
        assert status == ValidationStatus.PASSED
        assert len(issues) == 0
