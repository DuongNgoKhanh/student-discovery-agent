import copy

from agent_runtime.agent.model import UnconfiguredModel
from agent_runtime.evaluations.services.persona import PersonaRunner, stale_cases
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.services.debug_runs import DebugRunService
from tests.helpers.chatflow import FLOW, chatflow_content

PATH = ["start", "begin", "ask", "reply"]


def runner():
    return PersonaRunner(DebugRunService(models=lambda provider: UnconfiguredModel(), knowledge=None))


def run(cases):
    content = chatflow_content(copy.deepcopy(FLOW))
    content["tools"] = []  # the demo agent's tools are not what these cases are about
    content["persona_cases"] = cases
    return runner().run(AgentSnapshotV1.model_validate(content), content), content


def case(id="fee", *, turns=None, mandatory=True, **extra):
    stub = {"ask": "hoi_hoc_phi"}
    turns = turns or [{"input": {"text": "học phí"}, "llm_stubs": stub,
                       "expect": {"path": PATH, "conv": {"stage": "explore"}, "proposals": 0, "status": "completed",
                                  "blocks_absent": ["knowledge_card"]}}]
    return {"id": id, "title": f"case {id}", "mandatory": mandatory, "turns": turns, **extra}


def test_a_case_that_matches_passes():
    report, _ = run([case()])
    assert [(c.id, c.passed, c.mismatches) for c in report.cases] == [("fee", True, ())]


def test_two_runs_give_the_same_report():
    first, _ = run([case(), case("other", turns=[{"input": {"text": "x"}, "llm_stubs": {"ask": "lam_bai"}}])])
    second, _ = run([case(), case("other", turns=[{"input": {"text": "x"}, "llm_stubs": {"ask": "lam_bai"}}])])
    assert first == second and first.model_dump_json() == second.model_dump_json()


def test_a_wrong_path_names_the_step_and_points_at_the_expectation():
    turn = {"input": {"text": "x"}, "llm_stubs": {"ask": "other"}, "expect": {"path": ["start", "ask", "reply"]}}
    report, _ = run([case(turns=[turn])])
    mismatch = report.cases[0].mismatches[0]
    assert not report.cases[0].passed
    assert mismatch.path == "persona_cases[0].turns[0].expect.path"
    assert "Bước 2" in mismatch.message and "ask" in mismatch.message and "begin" in mismatch.message


def test_every_kind_of_expectation_can_fail():
    turn = {"input": {"text": "x"}, "llm_stubs": {"ask": "other"},
            "expect": {"blocks_present": ["knowledge_card"], "conv": {"stage": "welcome"}, "proposals": 2,
                       "status": "fallback"}}
    report, _ = run([case(turns=[turn])])
    paths = {m.path for m in report.cases[0].mismatches}
    base = "persona_cases[0].turns[0].expect"
    assert paths == {f"{base}.blocks_present", f"{base}.conv.stage", f"{base}.proposals", f"{base}.status"}


def test_a_missing_stub_fails_closed_instead_of_calling_a_model():
    report, _ = run([case(turns=[{"input": {"text": "x"}, "expect": {"path": PATH}}])])
    assert not report.cases[0].passed
    assert any("dự phòng" in m.message for m in report.cases[0].mismatches)


def test_conv_values_carry_over_between_turns_and_initial_state_applies():
    stub = {"ask": "other"}
    turns = [{"input": {"text": "a"}, "llm_stubs": stub, "expect": {"conv": {"stage": "explore"}}},
             {"input": {"text": "b"}, "llm_stubs": stub, "expect": {"conv": {"stage": "explore"}}}]
    report, _ = run([case(turns=turns, initial_state={"conv": {"stage": "welcome"}})])
    assert report.cases[0].passed


def test_a_case_that_cannot_run_is_a_failure_not_an_exception():
    bad = case(turns=[{"input": {"interaction": {"action": "x"}}, "llm_stubs": {}}],
               initial_state={"activity": {"status": ["x"]}})
    report, _ = run([bad])
    assert not report.cases[0].passed


def test_stale_cases_point_at_nodes_and_variables_that_no_longer_exist():
    turn = {"input": {"text": "x"}, "llm_stubs": {"gone": "x", "begin": "x"},
            "expect": {"path": ["start", "removed"], "conv": {"ghost": 1}}}
    _, content = run([case(turns=[turn])])
    found = dict(stale_cases(AgentSnapshotV1.model_validate(content)))
    base = "persona_cases[0].turns[0]"
    assert set(found) == {f"{base}.expect.path[1]", f"{base}.llm_stubs.gone", f"{base}.llm_stubs.begin",
                          f"{base}.expect.conv.ghost"}


def test_a_model_node_without_a_stub_fails_even_when_its_error_edge_is_wired():
    content = chatflow_content(copy.deepcopy(FLOW))
    content["tools"] = []
    content["workflow"]["edges"].append({"id": "e6", "source": "ask", "source_handle": "error", "target": "reply"})
    content["persona_cases"] = [case(turns=[{"input": {"text": "x"}}])]  # no stub, and nothing else is expected
    report = runner().run(AgentSnapshotV1.model_validate(content), content)
    assert not report.cases[0].passed
    assert report.cases[0].mismatches[0].path == "persona_cases[0].turns[0].llm_stubs"


class _DownKnowledge:
    def fields(self, kb_ids):
        raise ConnectionError("postgresql://user:secret@db/x")


def test_an_unreachable_knowledge_store_is_a_503_for_the_persona_gate_but_degrades_a_plain_run():
    import pytest

    from agent_runtime.sessions.errors import RuntimeSessionError

    models = lambda provider: UnconfiguredModel()  # noqa: E731
    assert DebugRunService(models, _DownKnowledge())._fields(["kb"]) == {}
    with pytest.raises(RuntimeSessionError) as raised:
        DebugRunService(models, _DownKnowledge(), strict_knowledge=True)._fields(["kb"])
    assert raised.value.status == 503 and "secret" not in str(raised.value.details)
