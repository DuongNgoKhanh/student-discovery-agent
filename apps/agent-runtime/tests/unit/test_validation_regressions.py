"""Regression checks for untrusted definition JSON and report inputs."""

import copy

import pytest


@pytest.mark.parametrize("field", ["rule_schema_ref", "engine_version"])
@pytest.mark.parametrize("value", [[], {}, 1, False, ""])
def test_rule_metadata_must_be_strings(validator, definition, field, value):
    definition["selection_rules"][field] = value
    report = validator.validate(definition)
    assert not report.mandatory_passed
    assert any(i.path == f"selection_rules.{field}" for i in report.issues)


@pytest.mark.parametrize("reason", [[], {}])
def test_invalid_stopping_reason_returns_issue(validator, definition, reason):
    definition["evaluation_cases"][0]["expected"]["stopping_reason"] = reason
    report = validator.validate(definition)
    assert report.status == "failed"
    assert any(i.path.endswith("expected.stopping_reason") for i in report.issues)


@pytest.mark.parametrize("kwargs,path", [
    ({"experience_id": "exp:valid"}, "experience_id"),
    ({"draft_revision": 9007199254740992}, "draft_revision"),
])
def test_invalid_caller_inputs_return_report(validator, definition, kwargs, path):
    report = validator.validate(definition, **kwargs)
    assert report.status == "failed"
    assert any(i.path == path for i in report.issues)


@pytest.mark.parametrize("qids", [[None], ["bad id"], ["q_missing"], ["q_r_01"]])
def test_golden_question_ids_are_valid_paths(validator, definition, qids):
    definition["evaluation_cases"][0]["expected"]["question_ids"] = qids
    report = validator.validate(definition)
    assert report.status == "failed"
    assert any("expected.question_ids" in i.path for i in report.issues)


@pytest.mark.parametrize("value", [None, True, "5", [], {}])
def test_golden_scores_require_numbers(validator, definition, value):
    definition["evaluation_cases"][0]["expected"]["scores"]["house_r"] = value
    report = validator.validate(definition)
    assert report.status == "failed"
    assert any(i.path.endswith("expected.scores.house_r") for i in report.issues)


def test_golden_scores_require_house_keys(validator, definition):
    definition["evaluation_cases"][0]["expected"]["scores"] = {str(i): 3 for i in range(6)}
    report = validator.validate(definition)
    assert report.status == "failed"
    assert any(i.path.endswith("expected.scores") for i in report.issues)


def test_answer_extra_fields_are_rejected(validator, definition):
    definition["evaluation_cases"][0]["answers"][0]["unexpected"] = True
    report = validator.validate(definition)
    assert report.status == "failed"
    assert any(i.path.endswith("answers[0].unexpected") for i in report.issues)


@pytest.mark.parametrize("version", ["1.0", "2.0"])
def test_option_identifier_pattern(validator, definition, valid_v1_doc, version):
    if version == "1.0":
        definition = valid_v1_doc
    definition["questions"][-1]["choices"][-1]["option_id"] = "bad id"
    report = validator.validate(definition)
    assert not report.mandatory_passed
    assert any(i.path.endswith("option_id") and i.code == "VAL_INVALID_IDENTIFIER_FORMAT" for i in report.issues)


@pytest.mark.parametrize("slot,payload", [
    ("tie_policy", {"order": ["house_r"]}),
    ("scoring_rules", {"weights": {}}),
    ("selection_rules", {"initial_question_id": "q_demo_01", "branches": "invalid"}),
])
def test_legacy_rule_payloads_are_not_certified(validator, valid_v1_doc, slot, payload):
    definition = valid_v1_doc
    definition[slot]["payload"] = copy.deepcopy(payload)
    report = validator.validate(definition)
    assert report.status == "unsupported"
    assert not report.mandatory_passed
    assert any(i.code == "VAL_UNSUPPORTED_RULE_PAYLOAD" for i in report.issues)
