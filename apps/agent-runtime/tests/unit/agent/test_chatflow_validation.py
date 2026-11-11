import copy

from agent_runtime.agent.validation import AgentSnapshotValidator
from tests.helpers.chatflow import FLOW, chatflow_content


def content_of(workflow, **extra):
    """The demo agent without its tools: the reference checks would otherwise need real experience and KB ports."""
    content = chatflow_content(copy.deepcopy(workflow))
    content["tools"] = []
    content.update(extra)
    return content


def report(content):
    result = AgentSnapshotValidator(knowledge=None, experiences=None, environment="demo").validate(content)
    return result, {(item.path, item.code) for item in result.issues}


def test_one_call_returns_every_kind_of_graph_error():
    """AT-91: nine different mistakes in one draft, all reported with their paths."""
    workflow = copy.deepcopy(FLOW)
    workflow["nodes"][3]["type"] = "http"                                   # unsupported type
    workflow["nodes"].append({"id": "begin", "type": "answer"})             # duplicate id
    workflow["nodes"].append({"id": "orphan", "type": "answer"})            # unreachable
    workflow["nodes"][1]["config"]["assignments"][0]["variable"] = "profile.entry_level"
    workflow["edges"][4]["target"] = "begin"                                # ask.other -> begin: a cycle
    workflow["edges"] = [e for e in workflow["edges"] if e["id"] != "e4"]   # lam_bai label unwired
    workflow["nodes"].append({"id": "gate", "type": "if_else",
                              "config": {"condition": {"==": [{"var": "conv.stage"}, "explore"]}}})
    workflow["edges"].append({"id": "e9", "source": "start", "source_handle": "next", "target": "gate"})
    workflow["edges"].append({"id": "e10", "source": "gate", "source_handle": "true", "target": "reply"})  # false: dead end
    workflow["budget"] = {"max_nodes": 20, "max_llm_calls": 20, "turn_timeout_ms": 25000}
    workflow["nodes"].append({"id": "call", "type": "tool", "config": {"tool": "assessment.start"}})  # not enabled
    result, found = report(content_of(workflow))
    assert not result.valid
    for pair in (("workflow.nodes[3].type", "workflow_node_type_unsupported"),
                 ("workflow.nodes[4].id", "duplicate_items"),
                 ("workflow.nodes[1].config.assignments[0].variable", "workflow_assign_invalid"),
                 ("workflow.budget.max_llm_calls", "workflow_budget_exceeds_ceiling"),
                 ("workflow.nodes[7].config.tool", "workflow_tool_not_enabled")):
        assert pair in found, pair
    codes = {code for _, code in found}
    assert {"workflow_cycle", "workflow_unreachable_node", "workflow_dead_end", "workflow_unwired_label"} <= codes


def test_a_clean_chatflow_snapshot_is_valid():
    result, found = report(content_of(FLOW))
    assert result.valid and found == set()


def test_a_schema_error_in_the_workflow_is_not_reported_twice():
    workflow = copy.deepcopy(FLOW)
    workflow["nodes"][3]["type"] = "http"
    result, _ = report(content_of(workflow))
    assert [i.path for i in result.issues].count("workflow.nodes[3].type") == 1


def test_fewer_than_two_mandatory_cases_is_one_issue():
    content = content_of(FLOW)
    content["persona_cases"] = content["persona_cases"][:1]
    _, found = report(content)
    assert ("persona_cases", "persona_cases_insufficient") in found
