"""Finalised turn messages, response and completion projections share one data source."""
from datetime import datetime, timezone

import pytest

from agent_runtime.evaluations.services.compatibility import PILOT_ENGINE_REGISTRY
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import MarkdownBlock
from agent_runtime.sessions.schemas.turn import ConversationTurnResult
from agent_runtime.sessions.services import turn_response
from agent_runtime.sessions.services.turn_handlers import PinnedAssessmentEngine, TurnHandler
from agent_runtime.sessions.services.turn_input import parse_turn_input
from agent_runtime.sessions.services.turn_response import finalize_turn
from tests.helpers.turns import FakeCompletionPort, advance, biased_option, interaction, make_turn_snapshot

COMMITTED_AT = datetime(2026, 10, 20, 3, 0, 5, tzinfo=timezone.utc)


@pytest.fixture
def handler():
    return TurnHandler(PinnedAssessmentEngine(PILOT_ENGINE_REGISTRY), FakeCompletionPort())


@pytest.fixture
def prepared_name_turn(handler, valid_v2_doc):
    snapshot = make_turn_snapshot(valid_v2_doc)
    request = parse_turn_input(interaction(snapshot, "set_name", {"display_name": " Ngân "}))
    return snapshot, request, handler.prepare(snapshot, request)


def _answer(snapshot, option_id=None):
    question = snapshot.activity.state.current_question
    return parse_turn_input(interaction(snapshot, "submit_answer", {
        "question_id": question.question_id, "option_id": option_id or biased_option(question.question_id)}))


def test_name_turn_response_matches_messages(prepared_name_turn):
    snapshot, request, draft = prepared_name_turn
    output = finalize_turn(snapshot, request, draft, COMMITTED_AT)
    user, assistant = output.patch.append_messages
    assert (user.role, assistant.role) == ("user", "assistant")
    assert user.turn_id == assistant.turn_id == output.result.turn_id
    assert output.result.message_id == assistant.message_id
    assert output.result.committed_at == COMMITTED_AT
    assert output.patch.response_data == output.result.model_dump(mode="json")
    assert user.text == "Ngân" and user.interaction.action == "set_name" and user.blocks == ()
    (block,) = assistant.blocks
    question = draft.next_state.current_question
    assert (block.type, block.schema_version, block.progress.completed) == ("assessment_question", 2, 0)
    assert (block.question_id, block.title, block.options) == (question.question_id, question.title, question.options)
    assert output.result.revision == snapshot.parent.revision + 1
    assert output.result.activity.revision == snapshot.activity.revision + 1
    assert output.patch.expected_activity_revision == snapshot.activity.revision
    ConversationTurnResult.model_validate(output.patch.response_data)


def test_option_history_uses_refs_without_raw_text(handler, prepared_name_turn):
    snapshot, _, draft = prepared_name_turn
    named = advance(snapshot, draft)
    request = _answer(named)
    output = finalize_turn(named, request, handler.prepare(named, request), COMMITTED_AT)
    user, assistant = output.patch.append_messages
    assert user.text is None
    assert user.interaction.model_dump() == {"activity_id": named.activity.id, "action": "submit_answer",
        "question_id": request.payload.question_id, "option_id": request.payload.option_id}
    assert output.result.blocks == assistant.blocks
    assert output.result.activity.progress.completed == 1


def test_completion_fixture_projection_is_atomic_input_only(handler, prepared_name_turn):
    """Fixture projector proves wiring/atomic inputs only; it is not golden scoring evidence."""
    snapshot, _, draft = prepared_name_turn
    current = advance(snapshot, draft)
    while True:
        request = _answer(current)
        step = handler.prepare(current, request)
        if step.completion is not None:
            break
        current = advance(current, step)
    output = finalize_turn(current, request, step, COMMITTED_AT)
    result = output.patch.new_result
    (card,) = output.result.blocks
    assert card.type == "personality_card" and card.result_id == result.result_id
    assert result.source_activity_revision == current.activity.revision + 1
    assert result.result_revision == current.next_result_revision
    assert result.result_projection.created_at == COMMITTED_AT
    assert card.data == result.card_projection == result.result_projection.data
    assert result.share_projection.display_name == card.data.display_name == "Ngân"
    assert output.result.activity.status == "completed"
    assert output.result.activity.result.result_id == result.result_id
    dumped = output.patch.response_data
    assert "statistics" not in str(dumped) and "score" not in str(dumped)


def test_mutated_nested_draft_is_internal_error(prepared_name_turn):
    snapshot, request, draft = prepared_name_turn
    state = draft.next_state.model_copy(update={"display_name": None})  # bypasses validation
    with pytest.raises(RuntimeSessionError) as error:
        finalize_turn(snapshot, request, draft.model_copy(update={"next_state": state}), COMMITTED_AT)
    assert (error.value.status, error.value.code) == (500, "INTERNAL_ERROR")


def test_response_is_projected_while_stored_message_stays_canonical(monkeypatch, valid_v2_doc, handler):
    snapshot = make_turn_snapshot(valid_v2_doc)  # adaptive capabilities: no markdown advertised
    request = parse_turn_input(interaction(snapshot, "set_name", {"display_name": "Ngân"}))
    draft = handler.prepare(snapshot, request)
    canonical = MarkdownBlock(block_id="md1", type="markdown", schema_version=1, content="**Chào** Ngân")
    monkeypatch.setattr(turn_response, "_assistant_block", lambda activity, draft: canonical)
    output = finalize_turn(snapshot, request, draft, COMMITTED_AT)
    assert output.patch.append_messages[1].blocks == (canonical,)
    (sent,) = output.result.blocks
    assert (sent.type, sent.block_id, sent.content) == ("text", "md1", "Chào Ngân")
    assert output.patch.response_data["blocks"][0]["type"] == "text"
