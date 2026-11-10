import pytest
from pydantic import ValidationError

import agent_runtime.workflow.nodes  # noqa: F401  (registers the node types)
from agent_runtime.sessions.schemas.workflow import WorkflowNode
from agent_runtime.workflow import registry
from agent_runtime.workflow.effects import AssignConv
from agent_runtime.workflow.nodes.base import NodeContext, NodeError, RunState
from tests.unit.workflow.helpers import budget_for, ids, ports_for, scope_for, workflow


def run(node_dict, wf, *, scope=None, state=None, **scope_args):
    node = WorkflowNode.model_validate(node_dict)
    spec = registry.get(node.type)
    config = spec.config_model.model_validate(node.config)
    scope = scope or scope_for(wf, **scope_args)
    state = state or RunState()
    deltas = []
    ctx = NodeContext(node=node, scope=scope, ports=ports_for(), model=None, budget=budget_for(wf), state=state,
                      new_id=ids(), emit=deltas.append, should_stop=lambda: False, streaming=True)
    return spec, spec.run(ctx, config), scope, deltas


STAGE = {"name": "stage", "type": "enum", "values": ["welcome", "assessment"], "default": "welcome"}
OFFERED = {"name": "offered", "type": "string_list", "default": []}
COUNT = {"name": "count", "type": "number", "default": 0}


def test_start_goes_next():
    wf = workflow([{"id": "start", "type": "start"}], [])
    _, result, _, _ = run({"id": "start", "type": "start"}, wf)
    assert result.handle == "next"


def test_if_else_picks_handle_and_reports_the_comparison():
    node = {"id": "c", "type": "if_else", "config": {"condition": {"==": [{"var": "conv.stage"}, "assessment"]}}}
    wf = workflow([node], [], variables=[STAGE])
    _, result, _, _ = run(node, wf, conv={"stage": "assessment"})
    assert (result.handle, result.output) == ("true", {"matched": True})
    assert result.reason["parts"][0].operator == "=="
    _, result, _, _ = run(node, wf)
    assert result.handle == "false"


def test_if_else_rejects_an_unsafe_condition_when_the_config_is_built():
    spec = registry.get("if_else")
    with pytest.raises(ValidationError):
        spec.config_model.model_validate({"condition": {"map": []}})


def test_assign_set_append_clear_and_add():
    node = {"id": "a", "type": "assign", "config": {"assignments": [
        {"variable": "conv.stage", "value": "assessment"},
        {"variable": "conv.offered", "operation": "append", "value": "fee"},
        {"variable": "conv.count", "operation": "add", "value": 2}]}}
    wf = workflow([node], [], variables=[STAGE, OFFERED, COUNT])
    _, result, scope, _ = run(node, wf, conv={"offered": ["job"], "count": 1})
    assert result.handle == "next"
    assert scope.conv_values() == {"stage": "assessment", "offered": ["job", "fee"], "count": 3}
    assert result.effects == (AssignConv("stage", "assessment", "set"), AssignConv("offered", ["job", "fee"], "append"),
                              AssignConv("count", 3, "add"))


def test_assign_append_is_idempotent_and_clear_restores_the_default():
    node = {"id": "a", "type": "assign", "config": {"assignments": [
        {"variable": "conv.offered", "operation": "append", "value": "job"},
        {"variable": "conv.count", "operation": "clear"}]}}
    wf = workflow([node], [], variables=[OFFERED, COUNT])
    _, _, scope, _ = run(node, wf, conv={"offered": ["job"], "count": 5})
    assert scope.conv_values() == {"offered": ["job"], "count": 0}


def test_assign_reads_variables_and_templates_and_checks_types():
    node = {"id": "a", "type": "assign", "config": {"assignments": [
        {"variable": "conv.stage", "value": {"var": "sys.interaction_outcome"}}]}}
    wf = workflow([node], [], variables=[STAGE])
    with pytest.raises(NodeError) as error:  # "none" is not one of the enum values
        run(node, wf)
    assert error.value.error_type == "invalid_output"


def test_assign_config_requires_a_value_except_for_clear():
    spec = registry.get("assign")
    with pytest.raises(ValidationError):
        spec.config_model.model_validate({"assignments": [{"variable": "conv.stage"}]})
    assert spec.config_model.model_validate({"assignments": [{"variable": "conv.count", "operation": "clear"}]})


def test_answer_renders_text_and_suggestions_and_ends_the_branch():
    node = {"id": "reply", "type": "answer", "config": {
        "text": "Bạn đang ở {{conv.stage}}.", "blocks": [{"type": "suggestions", "items": ["Làm bài", "Học phí"]}]}}
    wf = workflow([node], [], variables=[STAGE])
    spec, result, _, deltas = run(node, wf)
    assert result.handle is None and spec.handles(spec.config_model.model_validate(node["config"])) == ()
    assert [b.type for b in result.blocks] == ["markdown", "suggestions"]
    assert result.blocks[0].content == "Bạn đang ở welcome."
    assert [e.text for e in deltas] == ["Bạn đang ở welcome."]


def test_answer_upstream_adds_blocks_of_earlier_nodes_and_stays_silent_when_streamed():
    node = {"id": "reply", "type": "answer", "config": {"blocks": [{"type": "upstream"}]}}
    wf = workflow([node], [])
    state = RunState()
    state.blocks_by_node.append(("agent", ()))
    _, result, _, deltas = run(node, wf, state=state)
    assert result.blocks == () and deltas == []
