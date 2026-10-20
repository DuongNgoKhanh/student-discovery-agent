"""Structural parse, display-name policy and canonical replay identity for turns."""
import pytest

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.turn import ConversationTurnResult
from agent_runtime.sessions.services.turn_input import (
    is_supported,
    parse_turn_input,
    turn_fingerprint,
    validate_display_name,
)
from tests.helpers.turns import turn_examples


def _invalid_input(value):
    with pytest.raises(RuntimeSessionError) as error:
        parse_turn_input(value)
    assert (error.value.status, error.value.code) == (422, "INVALID_INPUT")


def test_normalized_name_and_identity():
    examples = turn_examples()
    name_input = examples["name_input"]
    assert validate_display_name("  Ngân  An  ") == "Ngân An"
    assert validate_display_name("  " + "A" * 50 + "  ") == "A" * 50
    # Raw NFD/whitespace input longer than 50 still normalizes into a valid name.
    assert validate_display_name("　" * 10 + "Ngân" * 10 + " " * 10) == "Ngân" * 10

    equivalent_name = dict(reversed(list(name_input.items())))
    equivalent_name["payload"] = {"display_name": "  Ngân "}
    equivalent_name["idempotency_key"] = "other-key"
    assert turn_fingerprint(parse_turn_input(equivalent_name)) == turn_fingerprint(parse_turn_input(name_input))

    without_optional_revision = {k: v for k, v in name_input.items() if k != "expected_activity_revision"}
    assert turn_fingerprint(parse_turn_input(name_input)) != turn_fingerprint(
        parse_turn_input(without_optional_revision))
    # Omitted schema_version is the canonical default, not a different request.
    without_version = {k: v for k, v in name_input.items() if k != "schema_version"}
    assert turn_fingerprint(parse_turn_input(without_version)) == turn_fingerprint(parse_turn_input(name_input))


@pytest.mark.parametrize("change", [
    {"action": "submit_answer", "payload": {"question_id": "q1", "option_id": "o1"}},
    {"activity_id": "other_activity"},
    {"expected_revision": 2},
    {"expected_activity_revision": 1},
])
def test_identity_changes_with_semantic_fields(change):
    name_input = turn_examples()["name_input"]
    assert turn_fingerprint(parse_turn_input(name_input)) != turn_fingerprint(parse_turn_input(name_input | change))


@pytest.mark.parametrize("raw", [
    "A" * 51, "", "   ", "̂Lan", "Lan 2", "Lan 😀", "<b>Lan</b>", "Lan\x1fAnh", "Lan!","Lan\x00", "La​n", "Lan ́",
])
def test_rejects_invalid_name(raw):
    with pytest.raises(RuntimeSessionError) as error:
        validate_display_name(raw)
    assert (error.value.status, error.value.code) == (422, "INVALID_INPUT")


@pytest.mark.parametrize("field,value", [
    ("expected_revision", True), ("expected_revision", "1"), ("expected_revision", -1),
    ("expected_revision", 9007199254740992), ("expected_revision", 1.0),
    ("expected_activity_revision", None), ("expected_activity_revision", False),
    ("schema_version", 2), ("schema_version", True), ("action", "start_activity"),
    ("owner_id", "spoof"), ("progress", {"completed": 6}), ("idempotency_key", "k" * 257),
    ("idempotency_key", "bad key"),
])
def test_rejects_malformed_structure(field, value):
    _invalid_input(turn_examples()["name_input"] | {field: value})


def test_rejects_option_and_text_together_and_missing_fields():
    option = turn_examples()["option_input"]
    _invalid_input(option | {"payload": option["payload"] | {"text": "both"}})
    _invalid_input({k: v for k, v in option.items() if k != "expected_revision"})
    _invalid_input({k: v for k, v in turn_examples()["message_input"].items() if k != "content"})


def test_accepts_key_bound_and_unsupported_variants():
    examples = turn_examples()
    assert parse_turn_input(examples["name_input"] | {"idempotency_key": "k" * 256})
    assert is_supported(parse_turn_input(examples["name_input"]))
    assert is_supported(parse_turn_input(examples["option_input"]))
    for name in ("message_input", "text_input", "confirm_input", "edit_input"):
        assert not is_supported(parse_turn_input(examples[name]))


def test_result_example_matches_model():
    result = ConversationTurnResult.model_validate(turn_examples()["question_result"])
    assert result.blocks[0].type == "assessment_question"
    assert result.model_dump(mode="json")["committed_at"] == "2026-10-20T03:00:05Z"
