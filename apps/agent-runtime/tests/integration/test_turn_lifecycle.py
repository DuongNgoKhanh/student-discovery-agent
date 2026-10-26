"""begin/finish: one in-progress turn, replay through responses, cancel before commit, failure writes nothing."""
import pytest

from agent_runtime.agent.model import ModelReply
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.services.turn_input import parse_message_input
from agent_runtime.sessions.services.turns import Begun
from tests.helpers.chat import build_chat

pytestmark = pytest.mark.integration


@pytest.fixture
def chat(test_database, valid_v2_doc, validator):
    rig = build_chat(test_database, valid_v2_doc, validator)
    try:
        yield rig
    finally:
        rig.dispose()


def text(body, revision, key):
    return parse_message_input({"expected_revision": revision, "idempotency_key": key,
                                "content": [{"type": "text", "text": body}]})


def test_begin_then_finish_completes_with_a_compact_response(chat):
    chat.model._outcomes.append(ModelReply(text="Chào bạn!"))
    begun = chat.service.begin(chat.caller, chat.conversation_id, text("xin chào", 0, "k1"))
    assert isinstance(begun, Begun) and begun.response.status == "in_progress"
    done = chat.service.finish(chat.caller, begun)
    assert done.status == "completed" and done.revision == 1 and done.output.blocks[0].content == "Chào bạn!"
    assert chat.message_count() == 3 and chat.user_message_ids() == [begun.response.input_message_id]


def test_second_turn_while_one_runs_is_rejected_with_its_id(chat):
    begun = chat.service.begin(chat.caller, chat.conversation_id, text("một", 0, "k1"))
    with pytest.raises(RuntimeSessionError) as error:
        chat.service.begin(chat.caller, chat.conversation_id, text("hai", 0, "k2"))
    assert (error.value.status, error.value.code) == (409, "TURN_IN_PROGRESS")
    assert error.value.details["response_id"] == begun.response.id


def test_same_key_replays_the_finished_response(chat):
    chat.model._outcomes.append(ModelReply(text="Chào!"))
    first = chat.service.submit(chat.caller, chat.conversation_id, text("hi", 0, "k1"))
    again = chat.service.submit(chat.caller, chat.conversation_id, text("hi", 0, "k1"))
    assert again.replayed and again.data == first.data and len(chat.model.calls) == 1


def test_cancel_before_commit_writes_nothing(chat):
    chat.model._outcomes.append(ModelReply(text="sẽ bị hủy"))
    begun = chat.service.begin(chat.caller, chat.conversation_id, text("hi", 0, "k1"))
    chat.responses.cancel(chat.caller, begun.response.id)
    done = chat.service.finish(chat.caller, begun)
    assert done.status == "cancelled" and chat.message_count() == 1 and chat.revision() == 0


def test_engine_failure_after_begin_is_failed_and_writes_nothing(chat, monkeypatch):
    begun = chat.service.begin(chat.caller, chat.conversation_id, text("hi", 0, "k1"))
    monkeypatch.setattr(chat.service, "_run", lambda *a, **k: (_ for _ in ()).throw(
        RuntimeSessionError(422, "ENGINE_FAILURE")))
    done = chat.service.finish(chat.caller, begun)
    assert (done.status, done.error.code) == ("failed", "ENGINE_FAILURE") and chat.revision() == 0


def test_response_activity_is_a_summary(chat):
    chat.model._outcomes.append(ModelReply(text="ok"))
    data = chat.service.submit(chat.caller, chat.conversation_id, text("hi", 0, "k1")).data
    assert data["activity"] is None or "answers" not in data["activity"]
