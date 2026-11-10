from datetime import date
from types import SimpleNamespace

from agent_runtime.agent.catalog import NO_CONTEXT, ToolContext
from agent_runtime.agent.model import FakeModel, ModelReply, ModelUnavailable
from agent_runtime.knowledge.schemas import MetadataField, Record, RetrievalResult
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.services.chatflow_turns import build_scope, plan_from_run, run_message_turn
from agent_runtime.sessions.services.message_turns import EXPLAIN_FALLBACK
from agent_runtime.workflow.executor import WorkflowRun
from agent_runtime.workflow.implicit import implicit_workflow
from tests.unit.workflow.helpers import MIN
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
    run, _, _ = run_message_turn(snapshot(demo_agent()), message("chào"), model=model, executor=None,
                                 tool_context=NO_CONTEXT, knowledge_port=None, clock=lambda: 0.0)
    return run


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


KB_FIELDS = {"kb1": (MetadataField(id="f1", name="entry_levels", type="string_list", filterable=True),),
             "kb2": (MetadataField(id="f2", name="tuition", type="number", filterable=True),)}


def kb_agent(kb_id="kb2", variables=(), tools=(), **config):
    nodes = [{"id": "start", "type": "start"},
             {"id": "kb", "type": "knowledge_retrieval", "config": {"knowledge_base_id": kb_id, "query": "học phí", **config}},
             {"id": "reply", "type": "answer", "config": {"text": "ok", "blocks": [{"type": "knowledge_card", "ref": "kb.k1"}]}}]
    edges = [{"id": "e1", "source": "start", "source_handle": "next", "target": "kb"},
             {"id": "e2", "source": "kb", "source_handle": "found", "target": "reply"},
             {"id": "e3", "source": "kb", "source_handle": "empty", "target": "reply"},
             {"id": "e4", "source": "kb", "source_handle": "error", "target": "reply"}]
    return AgentSnapshotV1.model_validate({**MIN, "workflow": {
        "entry": "start", "variables": list(variables), "nodes": nodes, "edges": edges, "budget": {}},
        "tools": list(tools)})


class FieldsPort:
    def __init__(self):
        self.read, self.requests = [], []

    def fields(self, kb_ids):
        self.read.extend(kb_ids)
        return {kb_id: KB_FIELDS[kb_id] for kb_id in kb_ids}

    def retrieve(self, request, *, required=None):
        self.requests.append(request)
        record = Record(content="x", score=0.9, title="Trường A", metadata={
            "tuition": 15000000, "document_id": "a", "revision": 1, "chunk": 0, "updated_at": "2026-10-27T03:00:00Z"})
        return RetrievalResult(records=(record,))


def turn_service(port):
    from agent_runtime.sessions.services.turns import TurnService
    store = SimpleNamespace(uow=object(), access=SimpleNamespace(clock=None))
    return TurnService(store, handler=None, responses=object(), knowledge=port)


def test_workflow_fields_reads_only_the_kbs_a_node_uses_that_are_not_already_known():
    port = FieldsPort()
    service = turn_service(port)
    assert service._workflow_fields(kb_agent("kb2"), {}) == {"kb2": KB_FIELDS["kb2"]}
    assert service._workflow_fields(kb_agent("kb2"), {"kb2": ()}) == {}
    assert service._workflow_fields(demo_agent(), {}) == {} and port.read == ["kb2"]


def test_run_message_turn_merges_the_workflow_fields_so_a_filter_variable_resolves():
    show = {"display": [{"field": "tuition", "label": "Học phí"}]}
    agent = kb_agent("kb2", filter_from_vars={"tuition": "conv.budget"},
                     variables=[{"name": "budget", "type": "number", "default": 9000000}],
                     tools=[{"name": "knowledge.search", "version": 1, "params": {"knowledge_base_id": "kb1"}},
                            {"name": "knowledge.show", "version": 1, "params": show}])
    port = FieldsPort()
    ctx = ToolContext(knowledge_fields={"kb1": KB_FIELDS["kb1"]})  # known KBs come from the agent tool context
    merged = turn_service(port)._workflow_fields(agent, ctx.knowledge_fields)
    run, _, _ = run_message_turn(snapshot(agent), message("học phí"), model=None, executor=None, tool_context=ctx,
                                 knowledge_port=port, knowledge_fields=merged, clock=lambda: 0.0)
    assert run.path == ("start", "kb", "reply") and run.records[1].handle == "found"
    assert [(c.name, c.comparison_operator, c.value) for c in port.requests[0].metadata_condition.conditions] == [
        ("tuition", "=", 9000000)]
    assert [block.type for block in run.blocks] == ["markdown", "knowledge_card"]
    # without the merged fields kb2 is unreadable, so the filter cannot be checked
    bare, _, _ = run_message_turn(snapshot(agent), message("học phí"), model=None, executor=None, tool_context=ctx,
                                  knowledge_port=port, clock=lambda: 0.0)
    assert bare.records[1].handle == "error"


def test_run_message_turn_returns_the_budget_it_used_and_the_workflow_that_ran():
    agent = demo_agent()
    run, used, workflow = run_message_turn(snapshot(agent), message("chào"), model=FakeModel(ModelReply(text="Chào!")),
                                           executor=None, tool_context=NO_CONTEXT, knowledge_port=None,
                                           clock=lambda: 0.0)
    assert (used.nodes, used.llm_calls) == (len(run.path), 1)
    assert [node.id for node in workflow.nodes] == ["start", "agent", "answer"]
