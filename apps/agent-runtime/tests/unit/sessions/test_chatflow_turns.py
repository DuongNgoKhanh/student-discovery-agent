from datetime import date
from types import SimpleNamespace

from agent_runtime.agent.catalog import NO_CONTEXT
from agent_runtime.agent.model import FakeModel, ModelReply, ModelUnavailable
from agent_runtime.sessions.services.chatflow_turns import build_scope, plan_from_run, run_message_turn
from agent_runtime.sessions.services.message_turns import EXPLAIN_FALLBACK
from agent_runtime.workflow.executor import WorkflowRun
from agent_runtime.workflow.implicit import implicit_workflow
from tests.unit.workflow.helpers import agent as demo_agent

CARD = {"house": {"house_id": "h1", "name": "Nhà Sáng Tạo"}, "strengths": ["sáng tạo"], "tendencies": ["tò mò"],
        "career_groups": ["Thiết kế"], "quote": "Cứ thử đi."}


def snapshot(agent, history=(), *, activity=None, result_card=None, current_result=None):
    parent = SimpleNamespace(conv_vars={"stage": "assessment"}, capability_snapshot=SimpleNamespace(
        supported_blocks=(SimpleNamespace(type="text"), SimpleNamespace(type="markdown"))), display_name=None)
    return SimpleNamespace(agent=agent, parent=parent, activity=activity, result_card=result_card,
                           current_result=current_result, history=history, today=date(2026, 11, 10))


def message(text):
    return SimpleNamespace(explain=None, content=SimpleNamespace(text=text))


def test_scope_exposes_the_system_namespace_for_a_message():
    agent = demo_agent()
    history = (SimpleNamespace(role="user"), SimpleNamespace(role="assistant"))
    scope = build_scope(snapshot(agent, history), message("học phí"), implicit_workflow(agent),
                        SimpleNamespace(snapshot=lambda: {}))
    assert scope.get("sys.query") == "học phí" and scope.get("sys.interaction_outcome") == "none"
    assert scope.get("sys.client_blocks") == ["text", "markdown"] and scope.get("sys.turn_index") == 1
    assert scope.get("sys.interaction") is None and scope.get("sys.activity_status") is None


def test_scope_of_an_explain_request_has_no_query_and_exposes_the_result():
    agent = demo_agent()
    activity = SimpleNamespace(state=SimpleNamespace(status="completed", display_name="Minh"))
    request = SimpleNamespace(explain=SimpleNamespace(), content=None)
    scope = build_scope(snapshot(agent, activity=activity, result_card=CARD, current_result=("r1", 3)), request,
                        implicit_workflow(agent), SimpleNamespace(snapshot=lambda: {}))
    assert (scope.get("sys.query"), scope.get("sys.interaction"), scope.get("sys.interaction_outcome")) == (
        "", "explain_result", "explain_requested")
    assert scope.get("sys.activity_status") == "completed"
    assert (scope.get("result.house_id"), scope.get("result.revision")) == ("h1", 3)


def run_agent_mode(model):
    return run_message_turn(snapshot(demo_agent()), message("chào"), model=model, executor=None,
                            tool_context=NO_CONTEXT, knowledge_port=None, clock=lambda: 0.0)


def test_agent_mode_runs_the_implicit_graph_with_the_agents_own_fallbacks():
    done = run_agent_mode(FakeModel(ModelReply(text="Chào bạn!")))
    assert (done.status, done.path, done.agent_steps) == ("completed", ("start", "agent", "answer"), 1)
    assert [block.content for block in done.blocks] == ["Chào bạn!"]
    busy = run_agent_mode(FakeModel(ModelUnavailable("timeout")))
    assert (busy.status, busy.fallback) == ("fallback", "timeout")
    assert busy.blocks[0].content == demo_agent().templates.busy_message


def test_a_plan_carries_the_runs_blocks_and_conversation_variables():
    run = run_agent_mode(FakeModel(ModelReply(text="Chào bạn!")))
    finished = WorkflowRun("completed", run.records, run.blocks, (), {"stage": "done"})
    plan = plan_from_run(snapshot(demo_agent()), finished, message("chào"), handler=None, persistence=None)
    assert plan.blocks == run.blocks and plan.conv_vars == {"stage": "done"}
    assert plan.start is None and plan.draft is None


def test_an_explain_request_that_falls_back_gets_the_card_only_explanation():
    activity = SimpleNamespace(state=SimpleNamespace(status="completed", display_name="Minh"))
    fallback = WorkflowRun("fallback", (), (), (), {"stage": "assessment"}, fallback="timeout")
    request = SimpleNamespace(explain=SimpleNamespace(), content=None)
    plan = plan_from_run(snapshot(demo_agent(), activity=activity, result_card=CARD), fallback, request,
                         handler=None, persistence=None)
    assert [block.content for block in plan.blocks] == [EXPLAIN_FALLBACK.format(
        house="Nhà Sáng Tạo", name="Minh", strengths="sáng tạo", tendencies="tò mò", career_groups="Thiết kế",
        quote="Cứ thử đi.")]
    assert plan.conv_vars == {"stage": "assessment"}
