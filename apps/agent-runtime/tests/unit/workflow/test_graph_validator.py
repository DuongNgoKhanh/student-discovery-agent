import copy

from agent_runtime.workflow.validator import validate_workflow
from tests.helpers.chatflow import FLOW, chatflow_content

KB = {"kb1": frozenset({"major", "province"})}


def check(workflow=None, kb=KB, **agent):
    content = chatflow_content(copy.deepcopy(workflow if workflow is not None else FLOW))
    content.update(agent)
    return validate_workflow(content["workflow"], content, kb)


def codes(findings):
    return {(item.path, item.code) for item in findings}


def flow(**changes):
    value = copy.deepcopy(FLOW)
    value.update(changes)
    return value


def edge(id, source, handle, target):
    return {"id": id, "source": source, "source_handle": handle, "target": target}


def test_the_example_flow_is_clean():
    assert check() == []


def test_a_cycle_names_its_nodes_and_the_back_edge():
    edges = copy.deepcopy(FLOW["edges"])
    edges[4]["target"] = "begin"  # ask.other -> begin
    found = check(flow(edges=edges))
    cycle = next(item for item in found if item.code == "workflow_cycle")
    assert cycle.path == "workflow.edges[4]" and "begin" in cycle.message and "ask" in cycle.message


def test_an_unreachable_node_and_a_dead_end_branch():
    nodes = [*FLOW["nodes"], {"id": "orphan", "type": "answer", "config": {"text": "x"}}]
    assert ("workflow.nodes[4]", "workflow_unreachable_node") in codes(check(flow(nodes=nodes)))
    gate = {"id": "gate", "type": "if_else", "config": {"condition": {"==": [{"var": "conv.stage"}, "explore"]}}}
    nodes = [FLOW["nodes"][0], gate, FLOW["nodes"][3]]
    edges = [edge("e1", "start", "next", "gate"), edge("e2", "gate", "true", "reply")]
    assert ("workflow.nodes[1]", "workflow_dead_end") in codes(check(flow(nodes=nodes, edges=edges)))


def test_an_unwired_classifier_label_points_at_the_label():
    edges = [item for item in FLOW["edges"] if item["id"] != "e4"]  # lam_bai
    assert ("workflow.nodes[2].config.labels[1]", "workflow_unwired_label") in codes(check(flow(edges=edges)))
    edges = [item for item in FLOW["edges"] if item["id"] != "e5"]  # other
    assert ("workflow.nodes[2]", "workflow_unwired_label") in codes(check(flow(edges=edges)))


def test_an_unwired_error_handle_is_allowed():
    assert not any(item.code in {"workflow_dead_end", "workflow_unwired_label"} for item in check())


def test_an_unsupported_node_type_and_duplicate_ids_are_each_reported():
    nodes = copy.deepcopy(FLOW["nodes"])
    nodes[3]["type"] = "http"
    nodes.append({"id": "begin", "type": "answer", "config": {"text": "x"}})
    found = codes(check(flow(nodes=nodes)))
    assert ("workflow.nodes[3].type", "workflow_node_type_unsupported") in found
    assert ("workflow.nodes[4].id", "duplicate_items") in found


def test_start_rules():
    nodes = [*FLOW["nodes"], {"id": "again", "type": "start"}]
    assert ("workflow.nodes", "workflow_start_invalid") in codes(check(flow(nodes=nodes)))
    assert ("workflow.entry", "workflow_start_invalid") in codes(check(flow(entry="reply")))


def test_edge_rules():
    edges = [*FLOW["edges"], edge("e6", "start", "next", "missing"), edge("e7", "begin", "sideways", "reply"),
             edge("e8", "begin", "next", "reply"), edge("e9", "reply", "next", "start")]
    found = codes(check(flow(edges=edges)))
    assert ("workflow.edges[5].target", "workflow_edge_invalid") in found
    assert ("workflow.edges[6].source_handle", "workflow_unknown_handle") in found
    assert ("workflow.edges[7].source_handle", "workflow_duplicate_handle_edge") in found
    assert ("workflow.edges[8].target", "workflow_edge_invalid") in found  # into start


def test_size_limits():
    nodes = [{"id": f"n{i}", "type": "answer", "config": {"text": "x"}} for i in range(51)]
    assert ("workflow.nodes", "workflow_too_large") in codes(check(flow(nodes=nodes, edges=[])))


def test_a_malformed_workflow_never_raises():
    for raw in (None, [], {"nodes": "x"}, {"nodes": [1, None], "edges": [3], "variables": ["a"]}):
        validate_workflow(raw, {}, {})

def node(id, type, **config):
    return {"id": id, "type": type, "config": config}


def linear(*middle, last=None):
    """start -> middle... -> reply, every handle wired to the next node (error handles left open)."""
    nodes = [{"id": "start", "type": "start"}, *middle, last or node("reply", "answer", text="ok")]
    edges = [edge(f"e{i}", a["id"], "next" if a["type"] in {"start", "assign"} else "success", b["id"])
             for i, (a, b) in enumerate(zip(nodes, nodes[1:], strict=False), 1)]
    return flow(nodes=nodes, edges=edges)


def test_expressions_are_checked_for_syntax_variables_and_types():
    def gate(condition):
        both = [edge("e1", "start", "next", "gate"), edge("e2", "gate", "true", "reply"),
                edge("e3", "gate", "false", "reply")]
        return flow(nodes=[{"id": "start", "type": "start"}, node("gate", "if_else", condition=condition),
                           node("reply", "answer", text="ok")], edges=both)

    at = "workflow.nodes[1].config.condition"
    assert check(gate({"==": [{"var": "conv.stage"}, "explore"]})) == []
    assert (at, "workflow_type_mismatch") in codes(check(gate({"==": [{"var": "conv.stage"}, 3]})))
    assert (at, "workflow_type_mismatch") in codes(check(gate({"==": [{"var": "conv.stage"}, "nope"]})))
    assert (at, "workflow_unknown_variable") in codes(check(gate({"==": [{"var": "conv.ghost"}, "x"]})))
    assert (at, "workflow_unknown_variable") in codes(check(gate({"==": [{"var": "sys.ghost"}, "x"]})))
    assert (at, "workflow_invalid_expression") in codes(check(gate({"eval": ["1"]})))
    assert (at, "workflow_type_mismatch") in codes(check(gate({"in": [{"var": "sys.query"}, {"var": "sys.query"}]})))
    assert check(gate({"in": ["a", {"var": "result.career_groups"}]})) == []


def test_templates_may_only_use_known_variables_and_earlier_nodes():
    assert check(linear(last=node("reply", "answer", text="{{sys.query}} {{conv.stage}} {{profile.anything}}"))) == []
    bad = check(linear(last=node("reply", "answer", text="{{sys.nope}} {{later.text}}")))
    assert sum(1 for item in bad if item.code == "workflow_unknown_variable") == 2
    prior = node("a", "llm", prompt="hi")
    assert check(linear(prior, last=node("reply", "answer", text="{{a.text}}"))) == []


def test_assign_may_only_write_declared_conv_variables_of_the_right_kind():
    def assign(**item):
        return linear(node("set", "assign", assignments=[item]))

    base = "workflow.nodes[1].config.assignments[0]"
    assert check(assign(variable="conv.stage", value="explore")) == []
    assert (f"{base}.variable", "workflow_assign_invalid") in codes(check(assign(variable="profile.entry_level", value="x")))
    assert (f"{base}.variable", "workflow_assign_invalid") in codes(check(assign(variable="conv.ghost", value="x")))
    assert (f"{base}.value", "workflow_assign_invalid") in codes(check(assign(variable="conv.stage", value=3)))
    assert (f"{base}.value", "workflow_assign_invalid") in codes(check(assign(variable="conv.stage", value="nope")))
    assert (f"{base}.operation", "workflow_assign_invalid") in codes(
        check(assign(variable="conv.stage", operation="add", value=1)))
    assert check(assign(variable="conv.stage", value={"var": "sys.query"})) == []


def test_tools_must_be_enabled_in_the_snapshot():
    work = linear(node("call", "tool", tool="assessment.start"))
    assert ("workflow.nodes[1].config.tool", "workflow_tool_not_enabled") in codes(check(work, tools=[]))
    assert ("workflow.nodes[1].config.tool", "workflow_tool_not_enabled") not in codes(check(work))
    agent = linear(node("helper", "agent", tools=["nope.tool"]))
    assert ("workflow.nodes[1].config.tools[0]", "workflow_tool_not_enabled") in codes(check(agent))
    steps = linear(node("helper", "agent", tools=[], max_tool_steps=8))
    assert ("workflow.nodes[1].config.max_tool_steps", "workflow_budget_exceeds_ceiling") in codes(
        check(steps, limits={"max_tool_steps": 2}))


def test_a_handoff_must_lead_straight_to_answer():
    mid = node("mid", "assign", assignments=[{"variable": "conv.stage", "value": "explore"}])
    nodes = [{"id": "start", "type": "start"}, node("call", "tool", tool="assessment.start"), mid,
             node("reply", "answer", text="ok")]
    edges = [edge("e1", "start", "next", "call"), edge("e2", "call", "success", "mid"),
             edge("e3", "mid", "next", "reply")]
    assert ("workflow.nodes[1]", "workflow_handoff_not_terminal") in codes(check(flow(nodes=nodes, edges=edges)))
    edges[1] = edge("e2", "call", "success", "reply")
    assert ("workflow.nodes[1]", "workflow_handoff_not_terminal") not in codes(check(flow(nodes=nodes[:2] + nodes[3:],
                                                                                         edges=[edges[0], edges[1]])))


def test_knowledge_nodes_check_the_base_and_the_filter_fields():
    work = linear(node("kb", "knowledge_retrieval", knowledge_base_id="kb1", query="{{sys.query}}",
                       filter_from_vars={"province": "profile.province", "ghost": "profile.x"}))
    found = codes(check(work))
    assert ("workflow.nodes[1].config.filter_from_vars.ghost", "field_not_found") in found
    assert ("workflow.nodes[1].config.filter_from_vars.province", "field_not_found") not in found
    assert ("workflow.nodes[1].config.knowledge_base_id", "knowledge_base_not_found") in codes(check(work, kb={}))


def test_the_budget_may_not_exceed_the_hard_ceiling():
    budget = {"max_nodes": 41, "max_llm_calls": 20, "turn_timeout_ms": 30001}
    found = codes(check(flow(budget=budget)))
    for key in budget:
        assert (f"workflow.budget.{key}", "workflow_budget_exceeds_ceiling") in found
    assert check(flow(budget={"max_nodes": 40, "max_llm_calls": 8, "turn_timeout_ms": 30000})) == []
