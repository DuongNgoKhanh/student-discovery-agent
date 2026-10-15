"""Unit tests for ExperienceValidator & CompatibilityChecker (Task C-01 / M-EVL).

Verifies:
- AT-01: Validator rejects invalid experience definitions with structured field-level and rule-level issues.
- AT-03: Compatibility checker verifies engine version and registered DEC-04 rule schemas.
- Invariant tests: House completeness, rating scale 1..5, baseline coverage, tie order, templates honesty.
"""

import json
from pathlib import Path
import pytest

from app.modules.evaluations.schemas.experience import ExperienceDefinitionDocument
from app.modules.evaluations.schemas.validation import ValidationStatus
from app.modules.evaluations.services.compatibility import (
    CompatibilityChecker,
    EngineProfile,
)
from app.modules.evaluations.services.validator import (
    ExperienceValidator,
    calculate_content_hash,
    validate_experience_definition,
)

FIXTURES_DIR = Path(__file__).resolve().parent.parent.parent / "app" / "modules" / "evaluations" / "fixtures"


@pytest.fixture
def valid_v1_doc():
    with open(FIXTURES_DIR / "valid_definition_v1.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def valid_v2_doc():
    with open(FIXTURES_DIR / "valid_definition_v2.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def validator():
    return ExperienceValidator()


class TestExperienceValidator:
    """Test suite for ExperienceValidator (M-EVL)."""

    def test_valid_definition_v1_passes(self, validator, valid_v1_doc):
        report = validator.validate(valid_v1_doc)
        assert report.status == ValidationStatus.PASSED
        assert report.mandatory_passed is True
        assert len(report.issues) == 0
        assert report.definition_schema_version == "1.0"
        assert report.content_hash.startswith("sha256:")
        assert len(report.content_hash) == 7 + 64

    def test_valid_definition_v2_passes(self, validator, valid_v2_doc):
        report = validator.validate(valid_v2_doc)
        assert report.status == ValidationStatus.PASSED
        assert report.mandatory_passed is True
        assert len(report.issues) == 0
        assert report.definition_schema_version == "2.0"
        assert report.content_hash.startswith("sha256:")

    def test_content_hash_deterministic(self, valid_v2_doc):
        hash1 = calculate_content_hash(valid_v2_doc)
        hash2 = calculate_content_hash(valid_v2_doc)
        assert hash1 == hash2
        assert hash1.startswith("sha256:")
        assert len(hash1) == 71

    def test_invalid_schema_version(self, validator, valid_v2_doc):
        doc = dict(valid_v2_doc)
        doc["schema_version"] = "9.9"
        report = validator.validate(doc)
        assert report.status == ValidationStatus.UNSUPPORTED
        assert report.mandatory_passed is False
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_INVALID_SCHEMA_VERSION" in issue_codes or "VAL_INCOMPATIBLE_ENGINE_VERSION" in issue_codes

    def test_unsupported_engine_version(self, validator, valid_v2_doc):
        doc = dict(valid_v2_doc)
        doc["engine_version"] = "unsupported-engine-v999"
        report = validator.validate(doc)
        assert report.status == ValidationStatus.UNSUPPORTED
        assert report.mandatory_passed is False
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_UNSUPPORTED_ENGINE_VERSION" in issue_codes

    def test_unsupported_dec04_rule_schema(self, validator):
        with open(FIXTURES_DIR / "invalid_definition_v2_unsupported_rule.json", "r", encoding="utf-8") as f:
            doc = json.load(f)
        report = validator.validate(doc)
        assert report.status == ValidationStatus.UNSUPPORTED
        assert report.mandatory_passed is False
        issues = [i for i in report.issues if i.code == "VAL_UNSUPPORTED_RULE_SCHEMA"]
        assert len(issues) >= 1
        assert issues[0].path == "scoring_rules.rule_schema_ref"
        assert issues[0].rule_id == "RULE_SCHEMA_COMPATIBILITY"

    def test_invalid_house_count(self, validator, valid_v2_doc):
        doc = dict(valid_v2_doc)
        # Drop one house (5 instead of 6)
        doc["houses"] = valid_v2_doc["houses"][:5]
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert report.mandatory_passed is False
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_INVALID_HOUSE_COUNT" in issue_codes

    def test_duplicate_house_id(self, validator, valid_v2_doc):
        doc = dict(valid_v2_doc)
        houses = list(valid_v2_doc["houses"])
        houses[1] = dict(houses[0])  # Duplicate house_r
        doc["houses"] = houses
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_DUPLICATE_HOUSE_ID" in issue_codes

    def test_invalid_v2_question_count(self, validator, valid_v2_doc):
        doc = dict(valid_v2_doc)
        # 29 items instead of 30
        doc["questions"] = valid_v2_doc["questions"][:29]
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_INVALID_QUESTION_COUNT" in issue_codes

    def test_invalid_v2_rating_scale(self, validator):
        with open(FIXTURES_DIR / "invalid_definition_v2_bad_rating.json", "r", encoding="utf-8") as f:
            doc = json.load(f)
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_INVALID_RATING" in issue_codes or "VAL_INCOMPLETE_RATING_SCALE" in issue_codes

    def test_invalid_v2_baseline_order(self, validator):
        with open(FIXTURES_DIR / "invalid_definition_v2_bad_baseline.json", "r", encoding="utf-8") as f:
            doc = json.load(f)
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_INVALID_BASELINE_COUNT" in issue_codes

    def test_invalid_v2_baseline_question_not_in_bank(self, validator, valid_v2_doc):
        doc = dict(valid_v2_doc)
        sel = dict(valid_v2_doc["selection_rules"])
        payload = dict(sel["payload"])
        payload["baseline_order"] = ["q_non_existent"] + valid_v2_doc["selection_rules"]["payload"]["baseline_order"][1:]
        sel["payload"] = payload
        doc["selection_rules"] = sel
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_BASELINE_QUESTION_NOT_IN_BANK" in issue_codes

    def test_invalid_v2_tie_order_not_holland(self, validator, valid_v2_doc):
        doc = dict(valid_v2_doc)
        tie = dict(valid_v2_doc["tie_policy"])
        payload = dict(tie["payload"])
        # Inverted order
        payload["order"] = ["house_c", "house_e", "house_s", "house_a", "house_i", "house_r"]
        tie["payload"] = payload
        doc["tie_policy"] = tie
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_INVALID_TIE_ORDER" in issue_codes

    def test_v2_template_promises_fixed_questions(self, validator, valid_v2_doc):
        doc = dict(valid_v2_doc)
        tmpl = dict(valid_v2_doc["templates"])
        tmpl["intro_prompt"] = "Chào bạn! Bài trắc nghiệm gồm 6 câu hỏi để tìm Hệ của bạn."
        doc["templates"] = tmpl
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_PROMISED_FIXED_QUESTIONS" in issue_codes

    def test_missing_required_fields(self, validator, valid_v2_doc):
        doc = dict(valid_v2_doc)
        del doc["definition_id"]
        del doc["houses"]
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        issue_codes = [issue.code for issue in report.issues]
        assert "VAL_MISSING_REQUIRED_FIELD" in issue_codes

    def test_pydantic_model_input(self, validator, valid_v2_doc):
        pydantic_doc = ExperienceDefinitionDocument(**valid_v2_doc)
        report = validator.validate(pydantic_doc)
        assert report.status == ValidationStatus.PASSED
        assert report.mandatory_passed is True

    def test_convenience_function(self, valid_v2_doc):
        report = validate_experience_definition(valid_v2_doc, experience_id="exp_01")
        assert report.experience_id == "exp_01"
        assert report.status == ValidationStatus.PASSED
