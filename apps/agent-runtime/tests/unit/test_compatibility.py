"""Unit tests for CompatibilityChecker (Task C-01 / M-EVL / DEC-04).

Verifies engine capability registry, schema support, and DEC-04 rule schema registration.
"""

import pytest

from agent_runtime.evaluations.schemas.validation import ValidationStatus
from agent_runtime.evaluations.services.compatibility import (
    ALLOWED_RULE_SCHEMAS_BY_SLOT,
    CompatibilityChecker,
    DEFAULT_ENGINE_REGISTRY,
    EngineProfile,
    PILOT_ENGINE_REGISTRY,
)


class TestCompatibilityChecker:
    """Test suite for CompatibilityChecker."""

    def test_default_registry_is_empty(self):
        """Review #1: Default registry must be empty per OpenAPI contract (DEC-04 unresolved)."""
        checker = CompatibilityChecker()
        assert len(checker.registry) == 0
        assert not checker.check_engine_exists("career-assessment-v1")
        assert not checker.check_engine_exists("1.0.0")
        assert not checker.check_engine_exists("2.0.0")

    def test_pilot_engine_registration(self):
        """Pilot registry allows registered engines for testing/pilot runtime."""
        checker = CompatibilityChecker(registry=PILOT_ENGINE_REGISTRY)
        assert checker.check_engine_exists("career-assessment-v1")
        assert checker.check_engine_exists("1.0.0")
        assert checker.check_engine_exists("2.0.0")
        assert not checker.check_engine_exists("unknown-engine")

    def test_compatible_v1_rules(self):
        checker = CompatibilityChecker(registry=PILOT_ENGINE_REGISTRY)
        status, issues = checker.check_compatibility(
            schema_version="1.0",
            engine_version="career-assessment-v1",
            rule_docs={
                "selection_rules": {
                    "rule_schema_ref": "rule.schema.localis.selection:v1",
                    "engine_version": "career-assessment-v1",
                },
                "scoring_rules": {
                    "rule_schema_ref": "rule.schema.localis.scoring:v1",
                    "engine_version": "career-assessment-v1",
                },
                "coverage_rules": {
                    "rule_schema_ref": "rule.schema.localis.coverage.fixed:v1",
                    "engine_version": "career-assessment-v1",
                },
                "tie_policy": {
                    "rule_schema_ref": "rule.schema.localis.tie.hexagonal:v1",
                    "engine_version": "career-assessment-v1",
                },
            },
        )
        assert status == ValidationStatus.PASSED
        assert len(issues) == 0

    def test_compatible_v2_rules(self):
        checker = CompatibilityChecker(registry=PILOT_ENGINE_REGISTRY)
        status, issues = checker.check_compatibility(
            schema_version="2.0",
            engine_version="career-assessment-v1",
            rule_docs={
                "selection_rules": {
                    "rule_schema_ref": "rule.schema.localis.selection.adaptive_bounds:v1",
                    "engine_version": "career-assessment-v1",
                },
                "scoring_rules": {
                    "rule_schema_ref": "rule.schema.localis.scoring.mean_rating:v1",
                    "engine_version": "career-assessment-v1",
                },
                "coverage_rules": {
                    "rule_schema_ref": "rule.schema.localis.coverage.bounded_stop:v1",
                    "engine_version": "career-assessment-v1",
                },
                "tie_policy": {
                    "rule_schema_ref": "rule.schema.localis.tie.fixed_order:v1",
                    "engine_version": "career-assessment-v1",
                },
            },
        )
        assert status == ValidationStatus.PASSED
        assert len(issues) == 0

    def test_unregistered_rule_schema_returns_unsupported(self):
        checker = CompatibilityChecker(registry=PILOT_ENGINE_REGISTRY)
        status, issues = checker.check_compatibility(
            schema_version="2.0",
            engine_version="career-assessment-v1",
            rule_docs={
                "scoring_rules": {
                    "rule_schema_ref": "rule.schema.unregistered.scoring:v9",
                    "engine_version": "career-assessment-v1",
                },
            },
        )
        assert status == ValidationStatus.UNSUPPORTED
        assert len(issues) == 1
        assert issues[0].code == "VAL_UNSUPPORTED_RULE_SCHEMA"
        assert issues[0].path == "scoring_rules.rule_schema_ref"
        assert issues[0].rule_id == "RULE_SCHEMA_COMPATIBILITY"

    def test_slot_swapped_rule_schema_fails(self):
        """Review #2: Swap rule schema between slots must be rejected."""
        checker = CompatibilityChecker(registry=PILOT_ENGINE_REGISTRY)
        status, issues = checker.check_compatibility(
            schema_version="2.0",
            engine_version="career-assessment-v1",
            rule_docs={
                "selection_rules": {
                    "rule_schema_ref": "rule.schema.localis.tie.fixed_order:v1",  # tie_policy schema in selection_rules!
                    "engine_version": "career-assessment-v1",
                },
            },
        )
        assert status == ValidationStatus.UNSUPPORTED
        assert len(issues) == 1
        assert issues[0].code == "VAL_UNSUPPORTED_RULE_SCHEMA"
        assert issues[0].path == "selection_rules.rule_schema_ref"

    def test_v2_using_v1_rule_schema_fails(self):
        """Review #2: Doc 2.0 using rule.schema.localis.scoring:v1 must be rejected."""
        checker = CompatibilityChecker(registry=PILOT_ENGINE_REGISTRY)
        status, issues = checker.check_compatibility(
            schema_version="2.0",
            engine_version="career-assessment-v1",
            rule_docs={
                "scoring_rules": {
                    "rule_schema_ref": "rule.schema.localis.scoring:v1",  # v1 weights in v2 doc!
                    "engine_version": "career-assessment-v1",
                },
            },
        )
        assert status == ValidationStatus.UNSUPPORTED
        assert any(i.code == "VAL_UNSUPPORTED_RULE_SCHEMA" and i.path == "scoring_rules.rule_schema_ref" for i in issues)

    def test_v1_using_v2_rule_schema_fails(self):
        """Review #2: Doc 1.0 using selection.adaptive_bounds:v1 must be rejected."""
        checker = CompatibilityChecker(registry=PILOT_ENGINE_REGISTRY)
        status, issues = checker.check_compatibility(
            schema_version="1.0",
            engine_version="career-assessment-v1",
            rule_docs={
                "selection_rules": {
                    "rule_schema_ref": "rule.schema.localis.selection.adaptive_bounds:v1",
                    "engine_version": "career-assessment-v1",
                },
            },
        )
        assert status == ValidationStatus.UNSUPPORTED
        assert any(i.code == "VAL_UNSUPPORTED_RULE_SCHEMA" and i.path == "selection_rules.rule_schema_ref" for i in issues)

    def test_rule_engine_version_mismatch_fails(self):
        """Review #2: rule doc engine_version must match root engine_version."""
        checker = CompatibilityChecker(registry=PILOT_ENGINE_REGISTRY)
        status, issues = checker.check_compatibility(
            schema_version="2.0",
            engine_version="career-assessment-v1",
            rule_docs={
                "scoring_rules": {
                    "rule_schema_ref": "rule.schema.localis.scoring.mean_rating:v1",
                    "engine_version": "bogus-9",  # Does not match career-assessment-v1
                },
            },
        )
        assert status == ValidationStatus.UNSUPPORTED
        mismatch_issues = [i for i in issues if i.code == "VAL_RULE_ENGINE_VERSION_MISMATCH"]
        assert len(mismatch_issues) == 1
        assert mismatch_issues[0].path == "scoring_rules.engine_version"

    def test_incompatible_schema_version_returns_unsupported(self):
        checker = CompatibilityChecker(registry=PILOT_ENGINE_REGISTRY)
        status, issues = checker.check_compatibility(
            schema_version="3.0",
            engine_version="career-assessment-v1",
            rule_docs={},
        )
        assert status == ValidationStatus.UNSUPPORTED
        assert len(issues) == 1
        assert issues[0].code == "VAL_INCOMPATIBLE_ENGINE_VERSION"
        assert issues[0].path == "schema_version"

    def test_custom_engine_profile(self):
        custom_registry = {
            "custom-v1": EngineProfile(
                engine_version="custom-v1",
                supported_schema_versions={"1.0"},
                supported_rule_schemas={"rule.schema.localis.selection:v1"},
            )
        }
        checker = CompatibilityChecker(registry=custom_registry)
        status, issues = checker.check_compatibility(
            schema_version="1.0",
            engine_version="custom-v1",
            rule_docs={
                "selection_rules": {
                    "rule_schema_ref": "rule.schema.localis.selection:v1",
                    "engine_version": "custom-v1",
                }
            },
        )
        assert status == ValidationStatus.PASSED
        assert len(issues) == 0

