import json
from pathlib import Path

import pytest

from agent_runtime.agent.model import FakeModel, ModelReply
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.workflow.debug import DebugRunService
from tests.helpers.chatflow import FLOW, chatflow_content

FIXTURE = json.loads((Path(__file__).resolve().parents[5] / "contracts/fixtures/workflow-debug-run.json").read_text("utf-8"))
CONTENT = chatflow_content(FLOW)


def service(model=None):
    return DebugRunService(models=lambda provider: model or FakeModel(), knowledge=None)


def test_a_stubbed_run_returns_the_contract_shape_without_calling_a_model(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("a debug run must never open a database transaction")

    monkeypatch.setattr(RuntimeUnitOfWork, "begin", forbidden)
    model = FakeModel()
    result = service(model).run(CONTENT, {"message": "học phí MTU", "state": {"conv": {"stage": "welcome"}},
                                          "llm_stubs": {"ask": "hoi_hoc_phi"}})
    assert model.calls == []
    assert set(result) == set(FIXTURE["result"])
    assert result["status"] == "completed" and result["path"] == ["start", "begin", "ask", "reply"]
    assert result["llm_calls"] == 1 and result["tokens"] == {"input": 0, "output": 0}
    ask = next(item for item in result["node_runs"] if item["node_id"] == "ask")
    assert ask["handle"] == "hoi_hoc_phi" and result["run_id"].startswith("dbg_") and len(result["run_id"]) == 28
    assert {"kind": "assign_conv", "variable": "stage", "value": "explore", "operation": "set"} in result["effects"]
    assert result["expires_at"] > result["created_at"]


def test_a_node_without_a_stub_calls_the_real_model_and_the_budget_still_applies():
    model = FakeModel(ModelReply(text="other"))
    result = service(model).run(CONTENT, {"message": "xin chào"})
    assert len(model.calls) == 1 and result["llm_calls"] == 1
    flow = {**FLOW, "budget": {"max_nodes": 20, "max_llm_calls": 1, "turn_timeout_ms": 25000}}
    over = service().run(chatflow_content(flow), {"message": "x", "llm_stubs": {"ask": "other"}})
    assert over["status"] == "completed"  # one stubbed call is inside max_llm_calls = 1
    tight = {**FLOW, "budget": {"max_nodes": 2, "max_llm_calls": 6, "turn_timeout_ms": 25000}}
    fallback = service().run(chatflow_content(tight), {"message": "x"})
    assert (fallback["status"], fallback["fallback_reason"]) == ("fallback", "workflow_budget")


def test_an_interaction_run_sets_the_outcome_directly_and_never_runs_a_handler():
    result = service().run(CONTENT, {"interaction": {"action": "set_name", "outcome": "name_set"},
                                     "llm_stubs": {"ask": "other"}})
    assert result["status"] == "completed"


def test_invalid_content_or_request_is_a_422():
    for content, request in (({"greeting_text": "x"}, {"message": "hi"}), (CONTENT, {}),
                             (CONTENT, {"message": "a", "interaction": {"action": "x"}})):
        with pytest.raises(RuntimeSessionError) as error:
            service().prepare(content, request)
        assert error.value.status == 422


def test_events_stream_node_started_finished_delta_in_order():
    events = []
    service().run(CONTENT, {"message": "x", "llm_stubs": {"ask": "other"}}, lambda name, data: events.append((name, data)))
    names = [name for name, _ in events]
    assert names[:2] == ["workflow.node_started", "workflow.node_finished"]
    assert names.count("workflow.node_started") == names.count("workflow.node_finished") == 4
    assert names[-1] == "delta" and events[-1][1] == {"event": "delta", "text": "Giai đoạn explore"}


def test_the_admins_run_shows_node_inputs_in_full_and_stops_when_asked():
    result = service().run(CONTENT, {"message": "học phí MTU", "llm_stubs": {"ask": "hoi_hoc_phi"}})
    ask = next(item for item in result["node_runs"] if item["node_id"] == "ask")
    assert ask["input"] == "học phí MTU" and ask["output"] == {"label": "hoi_hoc_phi", "error_type": ""}
    stopped = service().run(CONTENT, {"message": "x", "llm_stubs": {"ask": "other"}}, should_stop=lambda: True)
    assert stopped["path"] == [] and stopped["effects"] == [] and stopped["blocks"] == []


def test_a_stub_that_is_not_text_is_a_json_reply():
    from agent_runtime.workflow.debug import StubModel

    reply = StubModel({"a": "ă"}).invoke([], (), None)
    assert reply.text == '{"a": "ă"}'
