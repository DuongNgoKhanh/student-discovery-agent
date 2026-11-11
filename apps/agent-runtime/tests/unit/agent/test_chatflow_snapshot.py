"""agent.snapshot.v1 chatflow fields: shape rules only; graph semantics belong to the T14 validator."""
import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from agent_runtime.agent.validation import AgentSnapshotValidator
from agent_runtime.evaluations.services.validator import ExperienceValidator, calculate_content_hash
from agent_runtime.sessions.schemas.activity import CapabilitySnapshot
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.schemas.workflow import NODE_TYPES, RESERVED_NODE_IDS
from agent_runtime.sessions.services.releases import validate_release
from agent_runtime.workflow.scope import _STATIC, Scope
from tests.helpers.builders import agent_release

FIXTURES = Path(__file__).resolve().parents[5] / "contracts/fixtures"


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


MIN = load("agent-snapshot-chatflow-min.json")
DEMO = load("agent-snapshot-demo.json")


# What the graph validator and the persona gate add on top of the schema; tests/unit/workflow/test_graph_validator.py
# and test_chatflow_validation.py own these, so the shape tests here look past them.
GRAPH_LAYER = frozenset({
    "workflow_cycle", "workflow_unreachable_node", "workflow_dead_end", "workflow_unwired_label",
    "workflow_start_invalid", "workflow_edge_invalid", "workflow_unknown_handle", "workflow_duplicate_handle_edge",
    "workflow_too_large", "workflow_unknown_variable", "workflow_assign_invalid", "workflow_tool_not_enabled",
    "workflow_handoff_not_terminal", "workflow_budget_exceeds_ceiling", "workflow_type_mismatch",
    "workflow_invalid_expression", "persona_cases_insufficient"})


def issues_of(content):
    # No tools in these fixtures, so the reference checks never touch the knowledge or experience ports.
    report = AgentSnapshotValidator(knowledge=None, experiences=None, environment="demo").validate(content)
    schema = [item for item in report.issues if item.code not in GRAPH_LAYER]
    return report.model_copy(update={"issues": tuple(schema), "valid": not schema}), [
        (item.path, item.code) for item in schema]


def with_workflow(**changes):
    content = deepcopy(MIN)
    content["workflow"].update(changes)
    return content


def test_snapshot_without_mode_stays_agent():
    snapshot = AgentSnapshotV1.model_validate(DEMO)
    assert snapshot.mode == "agent" and snapshot.workflow is None and snapshot.persona_cases == ()


def test_minimal_chatflow_snapshot_is_valid():
    report, found = issues_of(MIN)
    assert report.valid and found == []
    snapshot = AgentSnapshotV1.model_validate(MIN)
    assert snapshot.mode == "chatflow" and len(snapshot.workflow.nodes) == 3
    assert snapshot.persona_cases[0].mandatory is True


def test_minimal_chatflow_passes_release_import():
    release = validate_release(agent_release(content=deepcopy(MIN)), environment="demo",
                               capabilities=CapabilitySnapshot(), validator=ExperienceValidator())
    assert AgentSnapshotV1.model_validate(release.content).mode == "chatflow"


def test_chatflow_without_workflow_is_workflow_required():
    report, found = issues_of(load("agent-snapshot-chatflow-missing-workflow.json"))
    assert not report.valid and found == [("workflow", "workflow_required")]
    assert report.issues[0].message.startswith("Chế độ chatflow")


def test_agent_mode_with_workflow_is_not_allowed():
    content = deepcopy(MIN)
    content["mode"] = "agent"
    assert issues_of(content)[1] == [("workflow", "workflow_not_allowed")]


def test_unknown_mode_is_rejected():
    content = deepcopy(MIN)
    content["mode"] = "graph"
    assert issues_of(content)[1] == [("mode", "literal_error")]


def nodes_with(index, **changes):
    nodes = deepcopy(MIN["workflow"]["nodes"])
    nodes[index].update(changes)
    return with_workflow(nodes=nodes)


@pytest.mark.parametrize("content, expected", [
    (nodes_with(1, type="code"), ("workflow.nodes[1].type", "workflow_node_type_unsupported")),
    (nodes_with(1, type="http"), ("workflow.nodes[1].type", "workflow_node_type_unsupported")),
    (nodes_with(1, id="in_test_2", extra="x"), ("workflow.nodes[1].extra", "extra_forbidden")),
    (nodes_with(2, id="in_test"), ("workflow.nodes[2].id", "duplicate_items")),
    (nodes_with(1, id="Bad-Id"), ("workflow.nodes[1].id", "string_pattern_mismatch")),
    (with_workflow(nodes=[dict(id=f"n{i}", type="start") for i in range(51)]),
     ("workflow.nodes", "too_long")),
    (with_workflow(edges=[dict(id=f"e{i}", source="start", source_handle="next", target="reply")
                          for i in range(101)]), ("workflow.edges", "too_long")),
    (with_workflow(variables=[dict(name=f"v{i}", type="boolean", default=False) for i in range(31)]),
     ("workflow.variables", "too_long")),
    (with_workflow(variables=[MIN["workflow"]["variables"][0], MIN["workflow"]["variables"][0]]),
     ("workflow.variables[1].name", "duplicate_items")),
    (with_workflow(variables=[dict(name="stage", type="enum", values=["a"], default="b")]),
     ("workflow.variables[0].default", "workflow_variable_invalid")),
    (with_workflow(variables=[dict(name="stage", type="enum", default="a")]),
     ("workflow.variables[0].values", "workflow_variable_invalid")),
    (with_workflow(variables=[dict(name="n", type="number", default="3")]),
     ("workflow.variables[0].default", "workflow_variable_invalid")),
    (with_workflow(variables=[dict(name="n", type="number", default=True)]),
     ("workflow.variables[0].default", "workflow_variable_invalid")),
    (with_workflow(budget={"max_nodes": 0, "max_llm_calls": 6, "turn_timeout_ms": 25000}),
     ("workflow.budget.max_nodes", "greater_than_equal")),
])
def test_invalid_workflow_shape_reports_path_and_code(content, expected):
    report, found = issues_of(content)
    assert not report.valid and found == [expected]


@pytest.mark.parametrize("default", [10**400, float("nan"), float("inf"), 2**53])
def test_unsafe_number_default_is_a_validation_error_not_an_exception(default):
    # Straight through the model: AgentSnapshotValidator hashes the raw content first, and the canonical JSON
    # hasher itself rejects these values before the schema runs.
    content = with_workflow(variables=[dict(name="n", type="number", default=default)])
    with pytest.raises(ValidationError) as caught:
        AgentSnapshotV1.model_validate(content)
    assert [(e["loc"], e["type"]) for e in caught.value.errors()] == [
        (("workflow", "variables", 0), "workflow_variable_invalid")]


@pytest.mark.parametrize("default", [2**53 - 1, -(2**53 - 1), 1.5])
def test_number_variable_accepts_json_safe_numbers(default):
    content = with_workflow(variables=[dict(name="n", type="number", default=default)])
    report, found = issues_of(content)
    assert report.valid and found == []


def test_node_ui_position_changes_hash_but_not_shape():
    moved = deepcopy(MIN)
    moved["workflow"]["nodes"][0]["ui"]["position"] = {"x": 99, "y": 99}
    assert calculate_content_hash(moved) != calculate_content_hash(MIN)
    assert issues_of(moved)[0].valid


def test_persona_case_needs_a_turn():
    content = deepcopy(MIN)
    content["persona_cases"][0]["turns"] = []
    assert issues_of(content)[1] == [("persona_cases[0].turns", "too_short")]


def test_node_types_match_the_ten_phase_one_types():
    assert NODE_TYPES == {"start", "if_else", "intent_classifier", "llm", "agent", "knowledge_retrieval",
                          "tool", "profile_propose", "assign", "answer"}


def test_runtime_node_types_match_the_published_catalog_fixture():
    catalog = load("workflow-node-types.json")
    assert {item["type"] for item in catalog["node_types"]} == NODE_TYPES


@pytest.mark.parametrize("reserved", sorted(RESERVED_NODE_IDS))
def test_a_node_id_that_shadows_a_scope_namespace_is_rejected(reserved):
    report, found = issues_of(nodes_with(1, id=reserved))
    assert not report.valid and found == [("workflow.nodes[1].id", "workflow_node_id_reserved")]


def test_reserved_node_ids_are_exactly_the_heads_scope_routes_to_a_namespace():
    scope = Scope(sys={"x": 1}, conv={}, profile={"x": 2}, result={"x": 3}, variables=())
    for head in ("sys", "profile", "result"):
        scope.set_output(head, {"x": "node"})
        assert scope.get(f"{head}.x") != "node"
    assert RESERVED_NODE_IDS == {"conv", *_STATIC}
