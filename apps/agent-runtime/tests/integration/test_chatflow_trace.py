import json

import pytest
from sqlalchemy import select

from agent_runtime.agent.model import ModelReply
from agent_runtime.infrastructure.db.tables import runtime_traces
from agent_runtime.infrastructure.db.trace import DatabaseTraceSink
from tests.helpers.chat import build_chat
from tests.helpers.chatflow import FLOW, chatflow_content

pytestmark = pytest.mark.integration

SENTINEL = "XQ-7731 em tên Lan"


class LateSink:
    """The rig's UoW exists only after build_chat, so the sink is bound once the rig is built."""
    sink = None

    def emit(self, event):
        self.sink.emit(event)


def stored_turn(rig):
    with rig.uow.begin() as session:
        return session.execute(select(runtime_traces).where(
            runtime_traces.c.action == "conversation.turn")).mappings().one()


def traced_rig(test_database, valid_v2_doc, validator, **kwargs):
    sink = LateSink()
    rig = build_chat(test_database, valid_v2_doc, validator, trace_sink=sink, **kwargs)
    sink.sink = DatabaseTraceSink(rig.uow)
    return rig


def test_the_turn_trace_is_stored_with_node_runs_and_without_student_text(test_database, valid_v2_doc, validator):
    rig = traced_rig(test_database, valid_v2_doc, validator, agent_content=chatflow_content(FLOW))
    try:
        rig.model._outcomes.append(ModelReply(text="hoi_hoc_phi"))
        sent = rig.send(SENTINEL, revision=0, key="m1")
        row = stored_turn(rig)
        trace = row["workflow"]
        assert [item["node_id"] for item in trace["node_runs"]] == ["start", "begin", "ask", "reply"]
        assert trace["mode"] == "chatflow" and row["response_id"].startswith("resp_")
        assert row["response_id"] == sent.data["id"]
        assert trace["content_hash"].startswith("sha256:") and trace["agent_release_id"]
        assert trace["node_runs"][2]["handle"] == "hoi_hoc_phi" and trace["node_runs"][2]["input"] is None
        assert trace["budget"]["llm_calls"] == 1 and trace["last_node"] == "reply"
        stored = json.dumps({key: str(value) for key, value in row.items()}, ensure_ascii=False)
        for secret in (SENTINEL, "XQ-7731", "Lan"):
            assert secret not in stored
    finally:
        rig.dispose()


def test_an_agent_mode_turn_is_traced_as_the_implicit_graph(test_database, valid_v2_doc, validator):
    rig = traced_rig(test_database, valid_v2_doc, validator)
    try:
        rig.model._outcomes.append(ModelReply(text="Chào bạn!"))
        rig.send(SENTINEL, revision=0, key="m1")
        row = stored_turn(rig)
        trace = row["workflow"]
        assert trace["mode"] == "agent" and [item["node_id"] for item in trace["node_runs"]] == [
            "start", "agent", "answer"]
        assert row["agent_steps"] == 1 and row["response_id"].startswith("resp_")
        stored = json.dumps({key: str(value) for key, value in row.items()}, ensure_ascii=False)
        assert SENTINEL not in stored and "Chào bạn" not in stored
    finally:
        rig.dispose()
