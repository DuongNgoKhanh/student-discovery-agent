import copy

from agent_runtime.agent.model import UnconfiguredModel
from agent_runtime.agent.validation import AgentSnapshotValidator
from agent_runtime.evaluations.services.persona import PersonaRunner
from agent_runtime.sessions.services.debug_runs import DebugRunService
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

PATH = ["start", "begin", "ask", "reply"]


def runner():
    return PersonaRunner(DebugRunService(models=lambda provider: UnconfiguredModel(), knowledge=None))


def run(cases, **flags):
    content = content_of(FLOW, persona_cases=cases)
    checker = AgentSnapshotValidator(knowledge=None, experiences=None, environment="demo", personas=runner())
    return checker.validate(content, **flags)


def case(id, *, path=PATH, mandatory=True, stub="hoi_hoc_phi"):
    return {"id": id, "title": f"Persona {id}", "mandatory": mandatory,
            "turns": [{"input": {"text": "x"}, "llm_stubs": {"ask": stub}, "expect": {"path": path}}]}


def test_passing_mandatory_cases_keep_the_snapshot_valid_and_are_reported():
    result = run([case("a"), case("b")])
    assert result.valid and [c.passed for c in result.persona_report.cases] == [True, True]


def test_a_failing_mandatory_case_blocks_and_names_the_case_and_the_step():
    result = run([case("a"), case("b", path=["start", "ask", "reply"])])
    assert not result.valid
    issue = next(i for i in result.issues if i.code == "persona_case_failed")
    assert issue.path == "persona_cases[1].turns[0].expect.path"
    assert "Persona b" in issue.message and "Bước 2" in issue.message


def test_a_failing_optional_case_is_reported_but_does_not_block():
    result = run([case("a"), case("b"), case("c", path=["start"], mandatory=False)])
    assert result.valid
    assert [c.passed for c in result.persona_report.cases] == [True, True, False]


def test_personas_can_be_skipped_and_are_skipped_when_the_graph_is_broken():
    assert run([case("a"), case("b")], personas=False).persona_report is None
    broken = content_of(FLOW)
    broken["workflow"]["edges"] = broken["workflow"]["edges"][:2]
    checker = AgentSnapshotValidator(knowledge=None, experiences=None, environment="demo", personas=runner())
    result = checker.validate(broken)
    assert not result.valid and result.persona_report is None


def test_a_stale_case_is_an_issue_and_agent_mode_runs_no_personas():
    result = run([case("a"), case("b", path=["start", "removed"])])
    assert ("persona_cases[1].turns[0].expect.path[1]", "persona_case_stale") in {(i.path, i.code) for i in result.issues}
    agent = AgentSnapshotValidator(knowledge=None, experiences=None, environment="demo", personas=runner())
    assert agent.validate({"greeting_text": "x", "allowed_activity_profiles": []}).persona_report is None
