"""Unit tests for ExperienceValidator & CompatibilityChecker (Task C-01 / M-EVL).

Verifies:
- AT-01: Validator rejects invalid experience definitions with structured field-level and rule-level issues.
- AT-03: Compatibility checker verifies engine version and registered DEC-04 rule schemas.
- Invariant tests: House completeness, rating scale 1..5, baseline coverage, tie order, templates honesty.
- Review resolution: Golden case math, non-dict types, unhashable structures, strict booleans, OpenAPI extra="forbid", RFC 8785 hash parity, Definition 1.0 integrity.
"""

import copy
import json
from pathlib import Path

import pytest

from agent_runtime.evaluations.schemas.experience import ExperienceDefinitionDocument
from agent_runtime.evaluations.schemas.validation import ValidationStatus
from agent_runtime.evaluations.services.compatibility import (
    PILOT_ENGINE_REGISTRY,
    CompatibilityChecker,
)
from agent_runtime.evaluations.services.validator import (
    ExperienceValidator,
    calculate_content_hash,
    validate_experience_definition,
)
from tests.unit.conftest import with_engine


class TestExperienceValidator:
    """Test suite for ExperienceValidator (M-EVL)."""

    def test_default_registry_rejects_unregistered_engine(self, valid_v2_doc):
        """Review #1: an engine outside DEFAULT_ENGINE_REGISTRY returns UNSUPPORTED."""
        default_validator = ExperienceValidator()
        assert default_validator.validate(valid_v2_doc).status == ValidationStatus.PASSED
        report = default_validator.validate(with_engine(valid_v2_doc, "2.0.0"))
        assert report.status == ValidationStatus.UNSUPPORTED
        assert report.mandatory_passed is False
        assert any(i.code == "VAL_UNSUPPORTED_ENGINE_VERSION" and i.path == "engine_version" for i in report.issues)

    def test_definition_v1_requires_registered_payload_validation(self, validator, valid_v1_doc):
        report = validator.validate(valid_v1_doc)
        assert report.status == ValidationStatus.UNSUPPORTED
        assert report.mandatory_passed is False
        assert any(i.code == "VAL_UNSUPPORTED_RULE_PAYLOAD" for i in report.issues)
        assert report.definition_schema_version == "1.0"
        assert report.content_hash.startswith("sha256:")
        assert len(report.content_hash) == 7 + 64

    @pytest.mark.parametrize("max_total, passes", [(12, True), (20, True), (30, True), (11, False), (31, False)])
    def test_question_cap_is_a_profile_choice_within_the_bank(self, validator, valid_v2_doc, max_total, passes):
        doc = copy.deepcopy(valid_v2_doc)
        doc["coverage_rules"]["payload"]["max_total"] = max_total
        report = validator.validate(doc)
        assert (report.status == ValidationStatus.PASSED) is passes
        if not passes:
            assert any(i.path == "coverage_rules.payload.max_total" for i in report.issues)

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

    def test_content_hash_parity_dict_vs_pydantic_model(self, valid_v2_doc):
        """Review #8: Hash must be strictly identical whether input is dict or Pydantic model."""
        dict_hash = calculate_content_hash(valid_v2_doc)
        pydantic_doc = ExperienceDefinitionDocument(**valid_v2_doc)
        pydantic_hash = calculate_content_hash(pydantic_doc)
        assert dict_hash == pydantic_hash

    def test_content_hash_rejects_nan(self):
        """Review #8: RFC 8785 strict check must reject NaN and Infinity (allow_nan=False)."""
        bad_doc = {"rating": float("nan")}
        with pytest.raises(ValueError):
            calculate_content_hash(bad_doc)

    @pytest.mark.parametrize(
        "fixture",
        json.loads(
            (Path(__file__).resolve().parents[4] / "contracts/fixtures/experience-content-hash.json")
            .read_text(encoding="utf-8")
        ),
        ids=lambda fixture: fixture["name"],
    )
    def test_content_hash_shared_jcs_fixtures(self, fixture):
        assert calculate_content_hash(json.loads(fixture["input_json"])) == fixture["hash"]
        # Studio may send canonical numeric tokens as integers instead of exponent floats.
        assert calculate_content_hash(json.loads(fixture["canonical"])) == fixture["hash"]

    def test_content_hash_ignores_python_integer_float_distinction(self):
        assert calculate_content_hash({"score": 1}) == calculate_content_hash({"score": 1.0})

    def test_invalid_schema_version(self, validator, valid_v2_doc):
        doc = copy.deepcopy(valid_v2_doc)
        doc["schema_version"] = "9.9"
        report = validator.validate(doc)
        assert report.status == ValidationStatus.UNSUPPORTED
        assert report.mandatory_passed is False
        assert any(i.code in ("VAL_INVALID_SCHEMA_VERSION", "VAL_INCOMPATIBLE_ENGINE_VERSION") and i.path == "schema_version" for i in report.issues)

    def test_unsupported_engine_version(self, validator, valid_v2_doc):
        doc = copy.deepcopy(valid_v2_doc)
        doc["engine_version"] = "unsupported-engine-v999"
        report = validator.validate(doc)
        assert report.status == ValidationStatus.UNSUPPORTED
        assert report.mandatory_passed is False
        assert any(i.code == "VAL_UNSUPPORTED_ENGINE_VERSION" and i.path == "engine_version" for i in report.issues)

    def test_unsupported_dec04_rule_schema(self, validator, valid_v2_doc):
        doc = copy.deepcopy(valid_v2_doc)
        doc["scoring_rules"]["rule_schema_ref"] = "rule.schema.unregistered.scoring:v9"
        report = validator.validate(doc)
        assert report.status == ValidationStatus.UNSUPPORTED
        assert report.mandatory_passed is False
        issues = [i for i in report.issues if i.code == "VAL_UNSUPPORTED_RULE_SCHEMA"]
        assert len(issues) >= 1
        assert issues[0].path == "scoring_rules.rule_schema_ref"
        assert issues[0].rule_id == "RULE_SCHEMA_COMPATIBILITY"

    def test_slot_swapped_rule_schema(self, validator, valid_v2_doc):
        """Review #2: Swapping rule schemas across slots must fail."""
        doc = copy.deepcopy(valid_v2_doc)
        doc["selection_rules"]["rule_schema_ref"] = "rule.schema.localis.tie.fixed_order:v1"
        report = validator.validate(doc)
        assert report.status == ValidationStatus.UNSUPPORTED
        assert any(i.code == "VAL_UNSUPPORTED_RULE_SCHEMA" and i.path == "selection_rules.rule_schema_ref" for i in report.issues)

    def test_rule_engine_version_mismatch(self, validator, valid_v2_doc):
        """Review #2: Rule document engine_version mismatch must fail."""
        doc = copy.deepcopy(valid_v2_doc)
        doc["scoring_rules"]["engine_version"] = "bogus-9"
        report = validator.validate(doc)
        assert report.status == ValidationStatus.UNSUPPORTED
        assert any(i.code == "VAL_RULE_ENGINE_VERSION_MISMATCH" and i.path == "scoring_rules.engine_version" for i in report.issues)

    def test_invalid_house_count(self, validator, valid_v2_doc):
        doc = copy.deepcopy(valid_v2_doc)
        doc["houses"] = valid_v2_doc["houses"][:5]
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert report.mandatory_passed is False
        assert any(i.code == "VAL_INVALID_HOUSE_COUNT" and i.path == "houses" for i in report.issues)

    def test_duplicate_house_id(self, validator, valid_v2_doc):
        doc = copy.deepcopy(valid_v2_doc)
        houses = list(valid_v2_doc["houses"])
        houses[1] = dict(houses[0])
        doc["houses"] = houses
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_DUPLICATE_HOUSE_ID" and i.path == "houses[1].house_id" for i in report.issues)

    def test_invalid_v2_question_count(self, validator, valid_v2_doc):
        doc = copy.deepcopy(valid_v2_doc)
        doc["questions"] = valid_v2_doc["questions"][:29]
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_INVALID_QUESTION_COUNT" and i.path == "questions" for i in report.issues)

    def test_invalid_v2_rating_scale(self, validator, valid_v2_doc):
        doc = copy.deepcopy(valid_v2_doc)
        doc["questions"][0]["choices"][0]["rating"] = 0
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code in ("VAL_INVALID_RATING", "VAL_INCOMPLETE_RATING_SCALE") for i in report.issues)

    def test_seeded_v2_definition_passes(self, validator, valid_v2_doc):
        assert validator.validate(valid_v2_doc).status == ValidationStatus.PASSED

    @pytest.mark.parametrize("slot, key", [("selection_rules", "baseline_order"), ("tie_policy", "order")])
    def test_fixed_order_fields_are_rejected(self, validator, valid_v2_doc, slot, key):
        """Order is drawn per activity seed, so a fixed baseline or tie order would be silently ignored."""
        doc = copy.deepcopy(valid_v2_doc)
        doc[slot]["payload"][key] = ["house_r"]
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_UNEXPECTED_FIELD" and i.path == f"{slot}.payload.{key}" for i in report.issues)

    def test_v2_case_requires_seed(self, validator, valid_v2_doc):
        doc = copy.deepcopy(valid_v2_doc)
        del doc["evaluation_cases"][0]["seed"]
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_MISSING_REQUIRED_FIELD" and i.path == "evaluation_cases[0].seed" for i in report.issues)

    def test_v2_payload_selection_fallback_invalid(self, validator, valid_v2_doc):
        """Review #6: any fallback other than 'seeded' is rejected (unseeded 'random' would not replay)."""
        doc = copy.deepcopy(valid_v2_doc)
        doc["selection_rules"]["payload"]["fallback"] = "random"
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_INVALID_SELECTION_FALLBACK" and i.path == "selection_rules.payload.fallback" for i in report.issues)

    def test_v2_payload_min_answers_per_house_invalid(self, validator, valid_v2_doc):
        """Review #6: coverage_rules min_answers_per_house must equal 2."""
        doc = copy.deepcopy(valid_v2_doc)
        doc["coverage_rules"]["payload"]["min_answers_per_house"] = 0
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_INVALID_MIN_ANSWERS" and i.path == "coverage_rules.payload.min_answers_per_house" for i in report.issues)

    def test_v2_payload_scoring_rating_scale_invalid(self, validator, valid_v2_doc):
        """Review #6: scoring_rules rating_scale must be [1, 5]."""
        doc = copy.deepcopy(valid_v2_doc)
        doc["scoring_rules"]["payload"]["rating_scale"] = [0, 10]
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_INVALID_RATING_SCALE" and i.path == "scoring_rules.payload.rating_scale" for i in report.issues)

    def test_v2_template_promises_fixed_questions(self, validator, valid_v2_doc):
        doc = copy.deepcopy(valid_v2_doc)
        doc["templates"]["intro_prompt"] = "Chào bạn! Bài trắc nghiệm gồm 6 câu hỏi để tìm Hệ của bạn."
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_PROMISED_FIXED_QUESTIONS" and i.path == "templates.intro_prompt" for i in report.issues)

    def test_extra_forbidden_fields(self, validator, valid_v2_doc):
        """Review #9: OpenAPI extra='forbid' must reject unexpected properties."""
        doc = copy.deepcopy(valid_v2_doc)
        doc["unexpected_root_field"] = "bad"
        doc["questions"][0]["unexpected_q_field"] = 123
        doc["questions"][0]["choices"][0]["unexpected_opt_field"] = True
        doc["houses"][0]["unexpected_house_field"] = "extra"
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_UNEXPECTED_FIELD" and i.path == "unexpected_root_field" for i in report.issues)
        assert any(i.code == "VAL_UNEXPECTED_FIELD" and i.path == "questions[0].unexpected_q_field" for i in report.issues)
        assert any(i.code == "VAL_UNEXPECTED_FIELD" and i.path == "questions[0].choices[0].unexpected_opt_field" for i in report.issues)
        assert any(i.code == "VAL_UNEXPECTED_FIELD" and i.path == "houses[0].unexpected_house_field" for i in report.issues)

    def test_strict_int_validation_rejects_booleans(self, validator, valid_v2_doc):
        """Review #10: Booleans must not pass as integers (is_strict_int)."""
        doc = copy.deepcopy(valid_v2_doc)
        doc["questions"][0]["item_order"] = True  # bool as int
        doc["questions"][0]["choices"][0]["rating"] = True  # bool as int
        doc["coverage_rules"]["payload"]["min_answers_per_house"] = True  # bool as int
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_INVALID_ITEM_ORDER" and i.path == "questions[0].item_order" for i in report.issues)
        assert any(i.code == "VAL_INVALID_RATING" and i.path == "questions[0].choices[0].rating" for i in report.issues)
        assert any(i.code == "VAL_INVALID_MIN_ANSWERS" and i.path == "coverage_rules.payload.min_answers_per_house" for i in report.issues)

    def test_non_dict_elements_reported_cleanly(self, validator, valid_v2_doc):
        """Review #11: Non-dict elements inside lists must be reported as VAL_INVALID_TYPE."""
        doc = copy.deepcopy(valid_v2_doc)
        doc["houses"][0] = "string_house"
        doc["questions"][0] = 123
        doc["questions"][1]["choices"][0] = "string_choice"
        report = validator.validate(doc)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_INVALID_TYPE" and i.path == "houses[0]" for i in report.issues)
        assert any(i.code == "VAL_INVALID_TYPE" and i.path == "questions[0]" for i in report.issues)
        assert any(i.code == "VAL_INVALID_TYPE" and i.path == "questions[1].choices[0]" for i in report.issues)

    def test_malformed_payloads_and_unhashable_types_do_not_crash(self, validator, valid_v2_doc):
        """Review #4: Malformed payloads and unhashable types must not crash the validator."""
        # 1. Null or list payload in rule documents
        doc1 = copy.deepcopy(valid_v2_doc)
        doc1["selection_rules"]["payload"] = None
        doc1["scoring_rules"]["payload"] = [1, 2, 3]
        doc1["coverage_rules"]["payload"] = None
        doc1["tie_policy"]["payload"] = "not_a_dict"
        report1 = validator.validate(doc1)
        assert report1.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_MISSING_RULE_FIELD" and i.path == "selection_rules.payload" for i in report1.issues)
        assert any(i.code == "VAL_INVALID_TYPE" and i.path == "scoring_rules.payload" for i in report1.issues)

        # 2. Unhashable types in house_id
        doc2 = copy.deepcopy(valid_v2_doc)
        doc2["houses"][0]["house_id"] = ["unhashable_list"]
        report2 = validator.validate(doc2)
        assert report2.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_INVALID_TYPE" and i.path == "houses[0].house_id" for i in report2.issues)

    def test_missing_version_strings_and_invalid_caller_inputs(self, validator, valid_v2_doc):
        """Review #5: Missing/null versions and invalid caller inputs must create reports cleanly."""
        doc = copy.deepcopy(valid_v2_doc)
        doc["schema_version"] = None
        doc["engine_version"] = ""

        report = validator.validate(
            doc,
            experience_id="bad invalid ID!",  # fails regex
            draft_revision=-99,  # negative int
        )
        assert report.definition_schema_version == "unknown"
        assert report.engine_version == "unknown"
        assert report.experience_id == "unknown_experience"
        assert report.draft_revision == 0
        assert report.status == ValidationStatus.UNSUPPORTED
        assert report.mandatory_passed is False
        assert any(i.code == "VAL_INVALID_EXPERIENCE_ID" and i.path == "experience_id" for i in report.issues)
        assert any(i.code == "VAL_INVALID_DRAFT_REVISION" and i.path == "draft_revision" for i in report.issues)
        assert any(i.code == "VAL_MISSING_REQUIRED_FIELD" and i.path == "schema_version" for i in report.issues)
        assert any(i.code == "VAL_MISSING_REQUIRED_FIELD" and i.path == "engine_version" for i in report.issues)

    def test_definition_v1_validation(self, validator, valid_v1_doc):
        """Review #7 & #8: Structural validation for Definition 1.0."""
        # Non-list questions
        doc1 = copy.deepcopy(valid_v1_doc)
        doc1["questions"] = {"not": "a list"}
        report1 = validator.validate(doc1)
        assert report1.status == ValidationStatus.UNSUPPORTED
        assert any(i.code == "VAL_INVALID_TYPE" and i.path == "questions" for i in report1.issues)

        # Questions with non-dict elements
        doc2 = copy.deepcopy(valid_v1_doc)
        doc2["questions"] = [1, 2, 3, 4, 5, 6]
        report2 = validator.validate(doc2)
        assert report2.status == ValidationStatus.UNSUPPORTED
        assert any(i.code == "VAL_INVALID_TYPE" and i.path == "questions[0]" for i in report2.issues)

        # Duplicate question IDs in v1
        doc3 = copy.deepcopy(valid_v1_doc)
        doc3["questions"][1]["question_id"] = doc3["questions"][0]["question_id"]
        report3 = validator.validate(doc3)
        assert report3.status == ValidationStatus.UNSUPPORTED
        assert any(i.code == "VAL_DUPLICATE_QUESTION_ID" and i.path == "questions[1].question_id" for i in report3.issues)

        # Empty choices in v1
        doc4 = copy.deepcopy(valid_v1_doc)
        doc4["questions"][0]["choices"] = []
        report4 = validator.validate(doc4)
        assert report4.status == ValidationStatus.UNSUPPORTED
        assert any(i.code == "VAL_INVALID_CHOICE_COUNT" and i.path == "questions[0].choices" for i in report4.issues)

        # Empty rule payload in v1
        doc5 = copy.deepcopy(valid_v1_doc)
        doc5["selection_rules"]["payload"] = {}
        report5 = validator.validate(doc5)
        assert report5.status == ValidationStatus.UNSUPPORTED
        assert any(i.code == "VAL_MISSING_RULE_FIELD" and i.path == "selection_rules.payload" for i in report5.issues)

    def test_evaluation_cases_and_approval_refs_validation(self, validator, valid_v2_doc):
        """Review #3 & #9: Required evaluation_cases and approval_refs validation."""
        # Missing evaluation_cases
        doc_no_eval = copy.deepcopy(valid_v2_doc)
        del doc_no_eval["evaluation_cases"]
        report = validator.validate(doc_no_eval)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_MISSING_REQUIRED_FIELD" and i.path == "evaluation_cases" for i in report.issues)

        # Missing approval_refs
        doc_no_appr = copy.deepcopy(valid_v2_doc)
        del doc_no_appr["approval_refs"]
        report = validator.validate(doc_no_appr)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_MISSING_REQUIRED_FIELD" and i.path == "approval_refs" for i in report.issues)

        # Invalid option_id in evaluation case answers (not matching question choices)
        doc_bad_opt = copy.deepcopy(valid_v2_doc)
        doc_bad_opt["evaluation_cases"][0]["answers"][0]["option_id"] = "opt_bogus_not_in_bank"
        report = validator.validate(doc_bad_opt)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_EVALUATION_ANSWER_OPTION_MISMATCH" and i.path == "evaluation_cases[0].answers[0].option_id" for i in report.issues)

        # Insufficient answer count (<12 for v2)
        doc_few_ans = copy.deepcopy(valid_v2_doc)
        doc_few_ans["evaluation_cases"][0]["answers"] = doc_few_ans["evaluation_cases"][0]["answers"][:10]
        report = validator.validate(doc_few_ans)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_INVALID_GOLDEN_ANSWERS_COUNT" and i.path == "evaluation_cases[0].answers" for i in report.issues)

        # Missing question_ids in expected
        doc_missing_exp = copy.deepcopy(valid_v2_doc)
        del doc_missing_exp["evaluation_cases"][0]["expected"]["question_ids"]
        report = validator.validate(doc_missing_exp)
        assert report.status == ValidationStatus.FAILED
        assert any(i.code == "VAL_MISSING_REQUIRED_FIELD" and i.path == "evaluation_cases[0].expected.question_ids" for i in report.issues)

    def test_pydantic_model_input(self, validator, valid_v2_doc):
        pydantic_doc = ExperienceDefinitionDocument(**valid_v2_doc)
        report = validator.validate(pydantic_doc)
        assert report.status == ValidationStatus.PASSED
        assert report.mandatory_passed is True

    def test_convenience_function(self, valid_v2_doc):
        checker = CompatibilityChecker(registry=PILOT_ENGINE_REGISTRY)
        report = validate_experience_definition(valid_v2_doc, experience_id="exp_01", compatibility_checker=checker)
        assert report.experience_id == "exp_01"
        assert report.status == ValidationStatus.PASSED
