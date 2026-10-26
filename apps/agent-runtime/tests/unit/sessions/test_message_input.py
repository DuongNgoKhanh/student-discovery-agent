"""Wire input for POST /messages maps onto the internal turn input; responses never carry answers[]."""
import pytest

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.responses import TurnResponse
from agent_runtime.sessions.schemas.turn import MessageTurnInput, SetNameInteraction, SubmitAnswerInteraction
from agent_runtime.sessions.services.turn_input import parse_message_input, to_message_body

BASE = {"expected_revision": 3, "idempotency_key": "k1"}


def test_text_part_maps_to_message_turn():
    request = parse_message_input({**BASE, "content": [{"type": "text", "text": "chào"}]})
    assert isinstance(request, MessageTurnInput) and request.content.text == "chào"


def test_interaction_part_maps_to_the_existing_interaction_union():
    request = parse_message_input({**BASE, "content": [{"type": "interaction", "activity_id": "a1",
        "expected_activity_revision": 2, "action": "submit_answer",
        "payload": {"question_id": "q1", "option_id": "o1"}}]})
    assert isinstance(request, SubmitAnswerInteraction)
    assert (request.activity_id, request.expected_activity_revision, request.payload.option_id) == ("a1", 2, "o1")


@pytest.mark.parametrize("content", [[], [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}],
                                     [{"type": "text", "text": "  "}], [{"type": "image", "url": "x"}]])
def test_content_must_be_exactly_one_known_part(content):
    with pytest.raises(RuntimeSessionError) as error:
        parse_message_input({**BASE, "content": content})
    assert (error.value.status, error.value.code) == (422, "INVALID_INPUT")


def test_message_body_round_trips():
    request = parse_message_input({**BASE, "content": [{"type": "interaction", "activity_id": "a1",
        "action": "set_name", "payload": {"display_name": "Ngân"}}]})
    assert isinstance(request, SetNameInteraction)
    assert parse_message_input(to_message_body(request)) == request


def test_turn_response_has_no_answer_history():
    assert "answers" not in TurnResponse.model_json_schema()["$defs"]["ActivitySummary"]["properties"]
