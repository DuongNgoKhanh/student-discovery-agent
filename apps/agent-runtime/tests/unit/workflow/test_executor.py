import logging

import pytest

from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.workflow import nodes as _nodes  # noqa: F401
from agent_runtime.workflow import registry
from agent_runtime.workflow.budget import Budget, BudgetExceeded
from agent_runtime.workflow.effects import AssignConv
from agent_runtime.workflow.events import NodeFinished, NodeStarted
from agent_runtime.workflow.executor import _live_nodes, run_workflow
from agent_runtime.workflow.nodes.answer import AnswerConfig
from agent_runtime.workflow.nodes.base import NodeCancelled, NodeError, NodeSpec
from tests.unit.workflow.helpers import MIN, ids, ports_for, scope_for, workflow

STAGE = {"name": "stage", "type": "enum", "values": ["welcome", "assessment", "explore"], "default": "welcome"}


def run(wf, *, stop=None, events=None, snapshot=None, **scope_args):
    ports = ports_for(**({"snapshot": snapshot} if snapshot else {}))
    return run_workflow(wf, scope_for(wf, **scope_args), ports, budget=Budget(wf.budget), new_id=ids(),
                        on_event=events.append if events is not None else None, should_stop=stop)


def chain():
    return workflow(
        [{"id": "start", "type": "start"},
         {"id": "in_test", "type": "if_else", "config": {"condition": {"==": [{"var": "conv.stage"}, "assessment"]}}},
         {"id": "begin", "type": "assign", "config": {"assignments": [{"variable": "conv.stage", "value": "assessment"}]}},
         {"id": "reply", "type": "answer", "config": {"text": "Giai đoạn {{conv.stage}}"}}],
        [("start", "next", "in_test"), ("in_test", "false", "begin"), ("in_test", "true", "reply"),
         ("begin", "next", "reply")], variables=[STAGE])


def test_the_minimal_fixture_runs_end_to_end():
    wf = AgentSnapshotV1.model_validate(MIN).workflow
    events = []
    result = run(wf, events=events)
    assert (result.status, result.path, result.fallback) == ("completed", ("start", "in_test", "reply"), None)
    assert [block.content for block in result.blocks] == ["Xin chào!"]
    assert [type(e) for e in events if isinstance(e, NodeStarted | NodeFinished)] == [NodeStarted, NodeFinished] * 3


def test_same_state_takes_the_same_path_every_time():
    runs = {run(chain()).path for _ in range(5)}
    assert runs == {("start", "in_test", "begin", "reply")}


def test_an_assign_is_visible_to_later_nodes_and_returned_as_one_conv_update():
    result = run(chain())
    assert result.conv == {"stage": "assessment"} and result.effects == (AssignConv("stage", "assessment", "set"),)
    assert result.blocks[0].content == "Giai đoạn assessment"


def test_a_turn_cancelled_after_an_assign_ran_returns_nothing_to_commit():
    calls = iter([False, False, False, True])  # start, in_test and begin run; the stop lands before reply
    result = run(chain(), stop=lambda: next(calls))
    assert result.path == ("start", "in_test", "begin")  # the assign did run
    assert (result.status, result.effects, result.blocks) == ("cancelled", (), ())
    assert result.conv == {"stage": "welcome"}


def test_exceeding_max_nodes_falls_back_and_drops_graph_effects():
    wf = workflow(chain().model_dump()["nodes"], [("start", "next", "in_test"), ("in_test", "false", "begin"),
                                                  ("begin", "next", "reply")], variables=[STAGE], max_nodes=3)
    result = run(wf)
    assert result.path == ("start", "in_test", "begin")  # the assign ran; reply is the node over budget
    assert (result.status, result.fallback, result.effects) == ("fallback", "workflow_budget", ())
    assert result.conv == {"stage": "welcome"}  # what the assign did is not returned for commit
    assert result.blocks[0].content == AgentSnapshotV1.model_validate(MIN).templates.busy_message


def failing_llm(monkeypatch, error_type="model_unavailable", cause=None, exc=None):
    """Replace the llm node type with one that always fails, so the executor's error paths can be tested."""
    def boom(ctx, config):
        raise exc if exc is not None else NodeError(error_type, cause=cause)

    monkeypatch.setitem(registry.REGISTRY, "llm", NodeSpec("llm", AnswerConfig, lambda c: ("success", "error"), {}, boom))


def test_a_node_error_without_an_error_edge_falls_back(monkeypatch):
    wf = workflow([{"id": "start", "type": "start"}, {"id": "m", "type": "llm", "config": {}},
                   {"id": "reply", "type": "answer"}],
                  [("start", "next", "m"), ("m", "success", "reply")])
    failing_llm(monkeypatch, cause="rate_limited")
    result = run(wf)
    assert (result.status, result.fallback) == ("fallback", "workflow_node_error")
    assert [r.error for r in result.records] == [None, "model_unavailable"]


def test_a_node_error_follows_the_error_edge_and_exposes_error_type(monkeypatch):
    wf = workflow([{"id": "start", "type": "start"}, {"id": "m", "type": "llm", "config": {}},
                   {"id": "sorry", "type": "answer", "config": {"text": "Lỗi: {{m.error_type}}"}}],
                  [("start", "next", "m"), ("m", "error", "sorry")])
    failing_llm(monkeypatch, "invalid_output")
    result = run(wf)
    assert result.status == "completed" and result.blocks[0].content == "Lỗi: invalid_output"
    assert result.path == ("start", "m", "sorry")


def test_a_handle_without_an_edge_falls_back():
    wf = workflow(chain().model_dump()["nodes"], [("start", "next", "in_test"), ("in_test", "true", "reply")],
                  variables=[STAGE])
    assert run(wf).fallback == "workflow_node_error"  # in_test went false; nothing is wired there


def test_a_node_streams_live_only_when_the_next_answer_passes_its_text_through():
    wf = workflow([{"id": "start", "type": "start"}, {"id": "a", "type": "agent"},
                   {"id": "r1", "type": "answer", "config": {"blocks": [{"type": "upstream"}]}},
                   {"id": "b", "type": "llm", "config": {"prompt": "x"}},
                   {"id": "r2", "type": "answer", "config": {"text": "Trước: {{b.text}}"}}],
                  [("start", "next", "a"), ("a", "success", "r1"), ("start", "next", "b"), ("b", "success", "r2")])
    assert _live_nodes(wf) == {"a"}


LLM_WF = [{"id": "start", "type": "start"}, {"id": "m", "type": "llm", "config": {}},
          {"id": "reply", "type": "answer"}]
LLM_EDGES = [("start", "next", "m"), ("m", "success", "reply")]
BUSY = AgentSnapshotV1.model_validate(MIN).templates.busy_message
UNKNOWN = AgentSnapshotV1.model_validate(MIN).templates.unknown_message


def run_implicit(wf):
    return run_workflow(wf, scope_for(wf), ports_for(), budget=Budget(wf.budget), new_id=ids(), implicit=True)


@pytest.mark.parametrize(("exc", "status", "code"), [
    (BudgetExceeded("llm_calls"), "fallback", "budget"),
    (NodeCancelled(), "cancelled", "cancelled"),
    (RuntimeError("boom"), "fallback", "unexpected"),
])
def test_an_interrupted_node_keeps_its_record_and_a_matching_finish_event(monkeypatch, exc, status, code):
    wf = workflow(LLM_WF, LLM_EDGES)
    failing_llm(monkeypatch, exc=exc)
    events = []
    result = run(wf, events=events)
    assert result.status == status
    assert (result.records[-1].node_id, result.records[-1].error, result.records[-1].handle) == ("m", code, None)
    started = [e.node_id for e in events if isinstance(e, NodeStarted)]
    finished = [(e.node_id, e.error) for e in events if isinstance(e, NodeFinished)]
    assert started == ["start", "m"] and finished == [("start", None), ("m", code)]


def test_an_interrupted_node_records_the_calls_it_made_before_stopping(monkeypatch):
    def spend_then_stop(ctx, config):
        ctx.budget.start_llm_call()
        raise BudgetExceeded("llm_calls")

    wf = workflow(LLM_WF, LLM_EDGES)
    monkeypatch.setitem(registry.REGISTRY, "llm",
                        NodeSpec("llm", AnswerConfig, lambda c: ("success", "error"), {}, spend_then_stop))
    result = run(wf)
    assert result.records[-1].llm_calls == 1 and result.llm_calls == 1


def test_an_unexpected_exception_falls_back_and_is_logged_with_traceback_and_node(monkeypatch, caplog):
    wf = workflow(LLM_WF, LLM_EDGES)
    failing_llm(monkeypatch, exc=RuntimeError("secret student text"))
    with caplog.at_level(logging.ERROR, logger="agent_runtime.workflow.executor"):
        result = run(wf)
    assert (result.status, result.fallback) == ("fallback", "workflow_node_error")
    assert result.blocks[0].content == BUSY
    [record] = [r for r in caplog.records if r.name == "agent_runtime.workflow.executor"]
    assert record.exc_info is not None and " m " in record.getMessage()
    assert "secret student text" not in record.getMessage()


def test_implicit_mode_keeps_the_nodes_own_failure_reason(monkeypatch):
    failing_llm(monkeypatch, cause="rate_limited")
    result = run_implicit(workflow(LLM_WF, LLM_EDGES))
    assert result.fallback == "rate_limited" and result.blocks[0].content == BUSY


def test_an_explicit_workflow_hides_the_nodes_cause(monkeypatch):
    failing_llm(monkeypatch, cause="rate_limited")
    assert run(workflow(LLM_WF, LLM_EDGES)).fallback == "workflow_node_error"


def test_a_deadline_is_reported_as_deadline_only_in_implicit_mode(monkeypatch):
    failing_llm(monkeypatch, exc=BudgetExceeded("deadline"))
    wf = workflow(LLM_WF, LLM_EDGES)
    assert run_implicit(wf).fallback == "deadline"
    assert run(wf).fallback == "workflow_budget"


def test_an_invalid_node_config_falls_back_as_a_node_error():
    wf = workflow([{"id": "start", "type": "start"}, {"id": "reply", "type": "answer", "config": {"bogus": 1}}],
                  [("start", "next", "reply")])
    result = run(wf)
    assert (result.status, result.fallback, result.blocks[0].content) == ("fallback", "workflow_node_error", BUSY)
    assert result.records[-1].error == "invalid_output"


def test_only_an_unusable_reply_uses_the_unknown_message():
    from agent_runtime.agent.loop import fallback_blocks
    snapshot = AgentSnapshotV1.model_validate(MIN)
    assert fallback_blocks(snapshot, "empty_reply", ids())[0].content == UNKNOWN != BUSY
