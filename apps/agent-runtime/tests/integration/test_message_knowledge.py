"""Knowledge answers: the model searches and picks refs, the server renders cards from the revisions it saw."""
import pytest
from sqlalchemy import select

from agent_runtime.agent.model import AssistantMessage, ModelReply, ToolCall
from agent_runtime.infrastructure.db.tables import runtime_traces
from agent_runtime.infrastructure.db.trace import DatabaseTraceSink
from tests.helpers.chat import EXPERIENCE, build_chat

pytestmark = pytest.mark.integration


def call(name, arguments):
    return ToolCall(id=f"call-{name}", name=name, arguments=arguments)


def blocks(data):
    return data["output"]["blocks"]


def show(title_prefix):
    def reply(messages):
        results = messages[-1].content["results"]
        ref = next(item["ref"] for item in results if item["title"].startswith(title_prefix))
        return ModelReply(text="", tool_calls=(call("knowledge.show", {"refs": [ref]}),))
    return reply


@pytest.fixture
def kb_chat(test_database, valid_v2_doc, validator):
    rig = build_chat(test_database, valid_v2_doc, validator, with_knowledge=True)
    try:
        yield rig
    finally:
        rig.dispose()


def test_answer_shows_a_card_built_from_the_searched_revision(kb_chat):
    kb_chat.model._outcomes += [
        ModelReply(text="", tool_calls=(call("knowledge.search", {"query": "học phí công nghệ thông tin"}),)),
        show("Trường Minh Họa A"),
        ModelReply(text="Đây là thông tin trường bạn hỏi nhé."),
    ]
    data = kb_chat.send("học phí ngành CNTT bao nhiêu?", revision=0, key="kb1").data
    lead, card = blocks(data)
    assert lead["type"] == "markdown" and card["type"] == "knowledge_card"
    assert (card["document_id"], card["revision"]) == ("demo_school_a_it", 1)
    assert {"label": "Học phí", "value": "25–30 triệu/năm (minh họa)"} in card["fields"]
    assert card["source_url"] == "https://ihrd.vn/demo/truong-a"
    stored = kb_chat.last_assistant_blocks()
    assert stored[1]["type"] == "knowledge_card" and stored[1]["revision"] == 1

    kb_chat.model._outcomes.append(ModelReply(text="Bạn hỏi thêm gì không?"))
    kb_chat.send("cảm ơn", revision=data["revision"], key="kb2")
    history = [m for m in kb_chat.model.calls[-1][0] if isinstance(m, AssistantMessage)]
    assert history[-1].text.endswith("[Hệ thống hiển thị: Trường Minh Họa A — Công nghệ thông tin (minh họa)]")
    assert "25–30" not in history[-1].text  # search results never enter the history


def test_question_mid_assessment_shows_the_card_then_the_current_question(kb_chat):
    kb_chat.model._outcomes += [
        ModelReply(text="", tool_calls=(call("assessment.start", {"experience_id": EXPERIENCE}),)),
        ModelReply(text="", tool_calls=(call("assessment.set_name", {"display_name": "Ngân"}),)),
        ModelReply(text="", tool_calls=(call("knowledge.search", {"query": "công tác xã hội Đà Nẵng"}),)),
        show("Trường Minh Họa B"),
        ModelReply(text="Mình gửi bạn thông tin nhé, giờ làm tiếp bài.",
                   tool_calls=(call("assessment.current_question", {}),)),
    ]
    kb_chat.send("làm bài", revision=0, key="m1")
    kb_chat.send("Ngân", revision=1, key="m2")
    data = kb_chat.send("trường công tác xã hội ở Đà Nẵng học phí bao nhiêu", revision=2, key="m3").data
    assert [block["type"] for block in blocks(data)] == ["markdown", "knowledge_card", "assessment_question"]
    assert data["activity"]["status"] == "in_progress"


def test_runtime_without_knowledge_tells_the_model_instead_of_failing(test_database, valid_v2_doc, validator):
    rig = build_chat(test_database, valid_v2_doc, validator)
    try:
        rig.model._outcomes += [
            ModelReply(text="", tool_calls=(call("knowledge.search", {"query": "học phí"}),)),
            ModelReply(text="Mình chưa tra cứu được lúc này."),
        ]
        data = rig.send("học phí bao nhiêu", revision=0, key="k").data
        assert data["status"] == "completed" and blocks(data)[0]["content"] == "Mình chưa tra cứu được lúc này."
        assert rig.model.calls[1][0][-1].content == {"error": "knowledge_unavailable"}
    finally:
        rig.dispose()


class CapturingSink:
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(event)


def test_turn_trace_names_hits_and_shown_cards_but_not_the_question(test_database, valid_v2_doc, validator):
    sink = CapturingSink()
    rig = build_chat(test_database, valid_v2_doc, validator, with_knowledge=True, trace_sink=sink)
    try:
        rig.model._outcomes += [
            ModelReply(text="", tool_calls=(call("knowledge.search", {"query": "học phí công nghệ thông tin"}),)),
            show("Trường Minh Họa A"),
            ModelReply(text="Đây nhé."),
        ]
        rig.send("học phí ngành CNTT bí mật", revision=0, key="t1")
        (event,) = sink.events
        assert (event.provider, event.agent_steps, event.fallback, event.fallback_reason) == ("gemini", 3, False, None)
        (search,) = event.knowledge
        assert search.kb_id == "kb_ihrd_demo" and ("demo_school_a_it", 1) in {hit[:2] for hit in search.hits}
        assert search.shown == ("demo_school_a_it",)
        assert "bí mật" not in str(event.model_dump()) and "công nghệ" not in str(event.model_dump())

        DatabaseTraceSink(rig.uow).emit(event)
        with rig.uow.begin() as session:
            row = session.execute(select(runtime_traces.c.agent_steps, runtime_traces.c.knowledge).where(
                runtime_traces.c.event_id == event.event_id)).one()
        assert row.agent_steps == 3 and row.knowledge[0]["shown"] == ["demo_school_a_it"]
    finally:
        rig.dispose()
