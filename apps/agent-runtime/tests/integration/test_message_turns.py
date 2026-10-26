"""Free-text message turns: the agent loop's handoffs drive the assessment through server-checked commits."""
import pytest

from agent_runtime.agent.model import ModelReply, SystemMessage, ToolCall, UserMessage
from agent_runtime.sessions.errors import RuntimeSessionError
from tests.helpers.chat import EXPERIENCE, build_chat
from tests.helpers.turns import biased_option

pytestmark = pytest.mark.integration


def call(name, arguments):
    return ToolCall(id=f"call-{name}", name=name, arguments=arguments)


@pytest.fixture
def chat(test_database, valid_v2_doc, validator):
    rig = build_chat(test_database, valid_v2_doc, validator)
    try:
        yield rig.model, rig.send, rig.message_count
    finally:
        rig.dispose()


def blocks(data):
    return data["output"]["blocks"]


def answer(activity, question_id, option_id):
    return {"activity_id": activity["id"], "action": "submit_answer",
            "payload": {"question_id": question_id, "option_id": option_id}}


def test_free_text_starts_names_and_proposes_through_server_rendered_blocks(chat):
    model, send, message_count = chat
    shown = {}
    model._outcomes += [
        ModelReply(text="Bắt đầu nhé!", tool_calls=(call("assessment.start", {"experience_id": EXPERIENCE}),)),
        ModelReply(text="", tool_calls=(call("assessment.set_name", {"display_name": "Ngân"}),)),
        lambda messages: ModelReply(text="Mình hiểu rồi.", tool_calls=(
            call("assessment.propose_answer", {"option_id": shown["option"]}),)),
    ]

    started = send("mình muốn làm bài", revision=0, key="m1").data
    assert started["status"] == "completed" and started["revision"] == 1
    assert started["activity"]["status"] == "collecting_name" and "answers" not in started["activity"]
    assert [block["type"] for block in blocks(started)] == ["markdown", "text"]

    named = send("Mình tên Ngân", revision=1, key="m2").data
    assert named["activity"]["status"] == "in_progress" and named["activity"]["display_name"] == "Ngân"
    (question,) = blocks(named)
    assert question["type"] == "assessment_question"
    shown["option"] = question["options"][-1]["id"]

    proposed = send("khá thích", revision=2, key="m3").data
    assert [block["type"] for block in blocks(proposed)] == ["markdown", "text", "assessment_question"]
    assert question["options"][-1]["label"] in blocks(proposed)[1]["content"]
    assert blocks(proposed)[2]["question_id"] == question["question_id"]
    assert proposed["activity"]["revision"] == named["activity"]["revision"]  # a proposal never answers
    phase = [m.text for m in model.calls[2][0] if isinstance(m, SystemMessage) and m.text.startswith("Trạng thái")]
    assert shown["option"] in phase[0]  # the model sees the current question's option ids
    assert UserMessage("Mình tên Ngân") in model.calls[2][0]  # committed history reaches the model

    answered = send(answer(proposed["activity"], question["question_id"], shown["option"]), revision=3, key="a1")
    assert answered.data["activity"]["progress"]["completed"] == 1
    assert message_count() == 1 + 4 * 2


def test_message_replays_without_rerunning_the_model_and_rejects_stale_revisions(chat):
    model, send, message_count = chat
    model._outcomes.append(ModelReply(text="Chào bạn!"))
    first = send("xin chào", revision=0, key="hello")
    again = send("xin chào", revision=0, key="hello")
    assert again.replayed and again.data == first.data and len(model.calls) == 1
    with pytest.raises(RuntimeSessionError) as conflict:
        send("còn đó không", revision=0, key="stale")
    assert conflict.value.status == 409 and len(model.calls) == 1
    assert message_count() == 3


def test_rejected_handoff_leaves_state_unchanged(chat):
    model, send, _ = chat
    model._outcomes += [ModelReply(text="", tool_calls=(call("assessment.set_name", {"display_name": "Ngân"}),)),
                        ModelReply(text="Bạn muốn làm bài khám phá không?")]
    data = send("mình tên Ngân", revision=0, key="early").data
    assert data["activity"] is None and [block["type"] for block in blocks(data)] == ["markdown"]
    assert model.calls[1][0][-1].content["error"] == "not_collecting_name"


def test_completed_result_is_explained_from_the_stored_card(chat):
    model, send, _ = chat
    model._outcomes += [
        ModelReply(text="", tool_calls=(call("assessment.start", {"experience_id": EXPERIENCE}),)),
        ModelReply(text="", tool_calls=(call("assessment.set_name", {"display_name": "Ngân"}),)),
    ]
    send("làm bài", revision=0, key="m1")
    data = send("Ngân", revision=1, key="m2").data
    while data["activity"]["status"] == "in_progress":
        question_id = data["activity"]["current_question"]["question_id"]
        data = send(answer(data["activity"], question_id, biased_option(question_id)),
                    revision=data["revision"], key=f"a-{data['revision']}").data
    card = blocks(data)[0]["data"]
    model._outcomes += [ModelReply(text="", tool_calls=(call("result.explain", {}),)),
                        ModelReply(text="Bạn thuộc **" + card["house"]["name"] + "**.")]
    explained = send("giải thích thêm về card này đi", revision=data["revision"], key="explain").data
    assert model.calls[-1][0][-1].content["house"] == card["house"]["name"]
    assert blocks(explained)[0]["content"] == "Bạn thuộc **" + card["house"]["name"] + "**."
    assert explained["activity"]["status"] == "completed"
