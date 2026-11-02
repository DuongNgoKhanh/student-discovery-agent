"""Explain-result turns: one explanation per current result, a card-based fallback, a system line in history."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from agent_runtime.agent.loop import AgentTurn
from agent_runtime.agent.model import UserMessage
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import StoredInteraction, TextBlock
from agent_runtime.sessions.schemas.history import MessageView
from agent_runtime.sessions.schemas.turn import ExplainResult
from agent_runtime.sessions.services.message_turns import (
    EXPLAIN_REQUEST_TEXT,
    chat_history,
    check_explain,
    explain_fallback,
    plan_message_turn,
)

CARD = {"house": {"house_id": "house_s", "name": "Người Chữa Lành"}, "strengths": ["Lắng nghe", "Giao tiếp"],
        "tendencies": ["Giúp đỡ người khác"], "career_groups": ["Tâm lý học", "Điều dưỡng"],
        "quote": "Bạn làm thế giới ấm áp hơn."}
EXPLAIN = ExplainResult(activity_id="act1", result_id="res1", result_revision=1)
NOW = datetime(2026, 11, 2, tzinfo=timezone.utc)


def explained_view(result_id="res1", result_revision=1):
    return MessageView(message_id="m1", role="user", blocks=(), conversation_revision=5, created_at=NOW,
                       interaction=StoredInteraction(activity_id="act1", action="explain_result", question_id=None,
                                                     option_id=None, result_id=result_id,
                                                     result_revision=result_revision))


def snapshot(*, status="completed", current=("res1", 1), history=()):
    activity = SimpleNamespace(id="act1", state=SimpleNamespace(status=status, display_name="Minh"))
    return SimpleNamespace(activity=activity, current_result=current, history=history, result_card=CARD)


def test_check_accepts_the_current_unexplained_result():
    check_explain(snapshot(), EXPLAIN)
    check_explain(snapshot(history=(explained_view(result_revision=2),)), EXPLAIN)  # another revision


@pytest.mark.parametrize("state", [
    {"status": "in_progress"}, {"current": None}, {"current": ("res1", 2)}, {"current": ("other", 1)},
    {"history": (explained_view(),)},
])
def test_check_rejects_stale_missing_or_repeated_results(state):
    with pytest.raises(RuntimeSessionError) as error:
        check_explain(snapshot(**state), EXPLAIN)
    assert (error.value.status, error.value.code) == (422, "INVALID_ACTIVITY_TRANSITION")


def test_history_shows_a_system_line_for_explain_requests():
    assert chat_history([explained_view()]) == [UserMessage(EXPLAIN_REQUEST_TEXT)]


def test_fallback_is_built_from_the_card():
    block = explain_fallback(CARD, "Minh")
    assert isinstance(block, TextBlock)
    assert "**Người Chữa Lành**" in block.content and "Minh" in block.content
    assert "Tâm lý học, Điều dưỡng" in block.content and "Bạn làm thế giới ấm áp hơn." in block.content


def test_explain_turn_that_fell_back_gets_the_card_template():
    request = SimpleNamespace(explain=EXPLAIN)
    busy = TextBlock(block_id="b1", type="text", schema_version=1, content="Mình đang bận")
    plan = plan_message_turn(snapshot(), AgentTurn((busy,), fallback="deadline"), request,
                             handler=None, persistence=None)
    (block,) = plan.blocks
    assert "**Người Chữa Lành**" in block.content
