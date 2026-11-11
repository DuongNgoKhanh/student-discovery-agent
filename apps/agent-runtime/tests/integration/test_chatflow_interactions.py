import json

import pytest
from sqlalchemy import select

from agent_runtime.agent.model import ModelReply, ModelUnavailable, ToolCall, UserMessage
from agent_runtime.infrastructure.db.tables import activities as activities_table
from agent_runtime.infrastructure.db.tables import conversations as conversations_table
from agent_runtime.infrastructure.db.tables import runtime_traces
from agent_runtime.infrastructure.db.trace import DatabaseTraceSink
from agent_runtime.sessions.schemas.release import AgentTemplates
from tests.helpers.chat import EXPERIENCE, build_chat
from tests.helpers.chatflow import chatflow_content

pytestmark = pytest.mark.integration

FLOW = {
    "entry": "start",
    "variables": [{"name": "stage", "type": "enum", "values": ["welcome", "assessment"], "default": "welcome"}],
    "nodes": [{"id": "start", "type": "start"},
              {"id": "named", "type": "if_else",
               "config": {"condition": {"==": [{"var": "sys.interaction_outcome"}, "name_set"]}}},
              {"id": "begin", "type": "assign",
               "config": {"assignments": [{"variable": "conv.stage", "value": "assessment"}]}},
              {"id": "hello", "type": "answer", "config": {"text": "Chào bạn, mình bắt đầu nhé."}},
              {"id": "assist", "type": "agent", "config": {"tools": ["assessment.start"]}},
              {"id": "plain", "type": "answer", "config": {"blocks": [{"type": "upstream"}]}}],
    "edges": [{"id": "e1", "source": "start", "source_handle": "next", "target": "named"},
              {"id": "e2", "source": "named", "source_handle": "true", "target": "begin"},
              {"id": "e3", "source": "begin", "source_handle": "next", "target": "hello"},
              {"id": "e4", "source": "named", "source_handle": "false", "target": "assist"},
              {"id": "e5", "source": "assist", "source_handle": "success", "target": "plain"},
              {"id": "e6", "source": "assist", "source_handle": "handoff", "target": "plain"}]}


class LateSink:
    """The rig's UoW exists only after build_chat, so the sink is bound once the rig is built."""
    sink = None

    def emit(self, event):
        self.sink.emit(event)


@pytest.fixture
def rig(test_database, valid_v2_doc, validator):
    def make(flow=FLOW, *, traced=False):
        sink = LateSink() if traced else None
        chat = build_chat(test_database, valid_v2_doc, validator, agent_content=chatflow_content(flow),
                          trace_sink=sink)
        if traced:
            sink.sink = DatabaseTraceSink(chat.uow)
        made.append(chat)
        return chat

    made = []
    yield make
    for chat in made:
        chat.dispose()


def start_assessment(chat):
    chat.model._outcomes.append(ModelReply(text="", tool_calls=(ToolCall("c1", "assessment.start",
                                                                        {"experience_id": EXPERIENCE}),)))
    return chat.send("mình muốn làm bài", revision=0, key="m1").data["activity"]


def set_name(chat, activity, revision=1):
    body = {"activity_id": activity["id"], "action": "set_name", "payload": {"display_name": "Ngân"}}
    return chat.send(body, revision=revision, key="n1")


def test_handler_runs_first_then_the_graph_adds_a_lead_in_before_the_fixed_block(rig):
    chat = rig()
    activity = start_assessment(chat)
    data = set_name(chat, activity).data
    kinds = [block["type"] for block in data["output"]["blocks"]]
    assert kinds[0] in {"markdown", "text"} and kinds[-1] == "assessment_question"
    assert data["output"]["blocks"][0]["content"] == "Chào bạn, mình bắt đầu nhé."
    assert data["activity"]["status"] == "in_progress" and data["activity"]["display_name"] == "Ngân"
    assert chat.conv_vars() == {"stage": "assessment"} and chat.revision() == 2  # one commit, one revision
    stored = [block["type"] for block in chat.last_assistant_blocks()]
    assert stored == kinds  # the lead-in is persisted with the handler's block in the same message


def test_a_failing_graph_node_keeps_the_handlers_answer_and_its_next_question(rig):
    flow = {**FLOW, "nodes": [*FLOW["nodes"], {"id": "think", "type": "llm", "config": {"prompt": "x"}}],
            "edges": [edge if edge["id"] != "e3" else {**edge, "target": "think"} for edge in FLOW["edges"]]
                     + [{"id": "e7", "source": "think", "source_handle": "success", "target": "hello"}]}
    chat = rig(flow)
    activity = start_assessment(chat)
    chat.model._outcomes.append(ModelUnavailable("provider_error"))
    data = set_name(chat, activity).data
    kinds = [block["type"] for block in data["output"]["blocks"]]
    assert data["status"] == "completed" and kinds[-1] == "assessment_question"
    assert data["output"]["blocks"][0]["content"] == AgentTemplates().busy_message
    assert data["activity"]["status"] == "in_progress" and chat.conv_vars() == {"stage": "welcome"}


# Free text branches on the stored stage alone: nothing on that path assigns it, so turn 3 can only read it back.
READ_BACK = {**FLOW,
             "nodes": [*FLOW["nodes"],
                       {"id": "staged", "type": "if_else",
                        "config": {"condition": {"==": [{"var": "conv.stage"}, "assessment"]}}},
                       {"id": "busy", "type": "answer", "config": {"text": "Bạn đang làm bài, tiếp tục nhé."}}],
             "edges": [edge if edge["id"] != "e4" else {**edge, "target": "staged"} for edge in FLOW["edges"]]
                      + [{"id": "e7", "source": "staged", "source_handle": "true", "target": "busy"},
                         {"id": "e8", "source": "staged", "source_handle": "false", "target": "assist"}]}


def test_a_variable_an_interaction_assigned_is_read_back_from_storage_on_a_later_turn(rig):
    chat = rig(READ_BACK)
    activity = start_assessment(chat)  # stage is still welcome: the agent starts the activity
    assert chat.conv_vars() == {"stage": "welcome"}
    set_name(chat, activity)
    assert chat.conv_vars() == {"stage": "assessment"}
    calls = len(chat.model.calls)
    data = chat.send("còn bao nhiêu câu?", revision=2, key="m3").data
    assert data["output"]["blocks"][0]["content"] == "Bạn đang làm bài, tiếp tục nhé."
    assert len(chat.model.calls) == calls and chat.conv_vars() == {"stage": "assessment"}


# On an interaction the graph may ask for a handoff too: the handler already moved the activity, so it is dropped.
HANDOFF = {**FLOW,
           "nodes": [node if node["id"] != "assist" else {**node, "config": {
               "tools": ["assessment.start", "assessment.current_question"]}} for node in FLOW["nodes"]],
           "edges": [edge if edge["id"] != "e2" else {**edge, "target": "assist"} for edge in FLOW["edges"]]}


def test_a_handoff_the_graph_asks_for_on_an_interaction_is_dropped_and_flagged(rig):
    chat = rig(HANDOFF, traced=True)
    activity = start_assessment(chat)
    chat.model._outcomes.append(ModelReply(text="", tool_calls=(ToolCall("c2", "assessment.current_question", {}),)))
    data = set_name(chat, activity).data
    assert data["status"] == "completed" and data["activity"]["id"] == activity["id"]
    assert data["activity"]["display_name"] == "Ngân" and chat.revision() == 2
    assert data["output"]["blocks"][-1]["type"] == "assessment_question"
    with chat.uow.begin() as session:
        rows = session.execute(select(runtime_traces).where(
            runtime_traces.c.action == "conversation.turn")).mappings().all()
    flags = {row["response_id"]: row["workflow"]["activity_conflict"] for row in rows}
    assert flags[data["id"]] is True and sorted(flags.values()) == [False, True]
    assert "Ngân" not in json.dumps([row["workflow"] for row in rows], ensure_ascii=False)


def test_a_rejected_interaction_runs_no_graph_and_writes_nothing(rig):
    chat = rig()
    activity = start_assessment(chat)
    calls, before = len(chat.model.calls), chat.message_count()
    body = {"activity_id": activity["id"], "action": "submit_answer",
            "payload": {"question_id": "q-missing", "option_id": "o1"}}
    data = chat.send(body, revision=1, key="bad").data
    assert data["status"] == "failed" and len(chat.model.calls) == calls
    assert chat.message_count() == before and chat.revision() == 1 and chat.conv_vars() == {"stage": "welcome"}


# The name branch asks the agent for a lead-in: the model sees a code-owned summary of the button press.
GREET = {**FLOW, "edges": [edge if edge["id"] != "e3" else {**edge, "target": "assist"} for edge in FLOW["edges"]]}


def last_user_text(call):
    messages, _, _ = call
    return [message.text for message in messages if isinstance(message, UserMessage)][-1]


def test_an_agent_node_on_a_button_press_gets_the_interaction_summary_as_its_user_turn(rig):
    chat = rig(GREET, traced=True)
    activity = start_assessment(chat)
    chat.model._outcomes.append(ModelReply(text="Rất vui được gặp bạn."))
    data = set_name(chat, activity).data
    assert last_user_text(chat.model.calls[-1]) == "[Học sinh nhập tên: Ngân]"
    assert data["output"]["blocks"][0]["content"] == "Rất vui được gặp bạn."
    assert data["output"]["blocks"][-1]["type"] == "assessment_question"
    with chat.uow.begin() as session:
        rows = session.execute(select(runtime_traces).where(
            runtime_traces.c.action == "conversation.turn")).mappings().all()
    assert len(rows) == 2
    stored = json.dumps([{key: str(value) for key, value in row.items()} for row in rows], ensure_ascii=False)
    assert "Ngân" not in stored and "Học sinh nhập tên" not in stored


def test_a_replayed_button_press_returns_the_stored_response_without_running_the_graph(rig):
    chat = rig(GREET)
    activity = start_assessment(chat)
    chat.model._outcomes.append(ModelReply(text="Rất vui được gặp bạn."))
    first = set_name(chat, activity)
    calls, messages = len(chat.model.calls), chat.message_count()
    again = set_name(chat, activity)
    assert again.replayed and again.data == first.data and len(chat.model.calls) == calls
    assert chat.revision() == 2 and chat.message_count() == messages


def test_a_revision_bumped_while_the_graph_runs_commits_nothing(rig):
    chat = rig(GREET)
    activity = start_assessment(chat)
    before = chat.message_count()

    def bump_then_reply(messages):
        with chat.uow.begin() as session:  # another writer moves the conversation between Tx#1 and Tx#2
            session.execute(conversations_table.update().where(conversations_table.c.id == chat.conversation_id)
                            .values(revision=conversations_table.c.revision + 1))
        return ModelReply(text="Rất vui được gặp bạn.")
    chat.model._outcomes.append(bump_then_reply)
    data = set_name(chat, activity).data
    assert data["status"] == "failed" and data["error"]["code"] == "CONFLICT_REVISION"
    assert chat.conv_vars() == {"stage": "welcome"} and chat.message_count() == before and chat.revision() == 2
    with chat.uow.begin() as session:
        state = session.scalar(select(activities_table.c.state).where(activities_table.c.id == activity["id"]))
    assert state["status"] == "collecting_name"
