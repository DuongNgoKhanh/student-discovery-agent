from dataclasses import make_dataclass
from datetime import date
from types import SimpleNamespace

from agent_runtime.agent.catalog import NO_CONTEXT, ToolContext
from agent_runtime.agent.model import FakeModel, ModelReply, ModelUnavailable
from agent_runtime.knowledge.schemas import MetadataField, Record, RetrievalResult
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.services import chatflow_turns
from agent_runtime.sessions.services.chatflow_turns import (
    interaction_outcome,
    plan_from_run,
    run_interaction_turn,
    run_message_turn,
)
from agent_runtime.sessions.services.message_turns import EXPLAIN_FALLBACK, EXPLAIN_REQUEST_TEXT
from agent_runtime.workflow.executor import WorkflowRun
from tests.unit.workflow.helpers import MIN
from tests.unit.workflow.helpers import agent as demo_agent

CARD = {"house": {"house_id": "h1", "name": "Nhà Sáng Tạo"}, "strengths": ["sáng tạo"], "tendencies": ["tò mò"],
        "career_groups": ["Thiết kế"], "quote": "Cứ thử đi."}


def snapshot(agent, history=(), *, activity=None, result_card=None, current_result=None, user_turns=0):
    parent = SimpleNamespace(conv_vars={"stage": "assessment"}, capability_snapshot=SimpleNamespace(
        supported_blocks=(SimpleNamespace(type="text"), SimpleNamespace(type="markdown"))), display_name=None)
    return SimpleNamespace(agent=agent, parent=parent, activity=activity, result_card=result_card,
                           current_result=current_result, history=history, today=date(2026, 11, 10),
                           user_turns=user_turns)


def message(text):
    return SimpleNamespace(explain=None, content=SimpleNamespace(text=text))


def captured_scope(monkeypatch):
    """Record the Scope a turn hands to the executor instead of running the graph."""
    seen = []

    def capture(workflow, scope, ports, **kwargs):
        seen.append((scope, ports))
        return WorkflowRun("completed", (), (), (), scope.conv_values())
    monkeypatch.setattr(chatflow_turns, "run_workflow", capture)
    return seen


def test_scope_exposes_the_system_namespace_for_a_message(monkeypatch):
    seen = captured_scope(monkeypatch)
    history = (SimpleNamespace(role="user", text="chào", interaction=None),
               SimpleNamespace(role="assistant", blocks=()))
    # turn_index is the stored count of student messages, not the (possibly shorter) history window's.
    run_message_turn(snapshot(demo_agent(), history, user_turns=31), message("học phí"), model=None, executor=None,
                     tool_context=NO_CONTEXT, knowledge_port=None, clock=lambda: 0.0)
    scope, ports = seen[0]
    assert scope.get("sys.query") == "học phí" and scope.get("sys.interaction_outcome") == "none"
    assert scope.get("sys.client_blocks") == ["text", "markdown"] and scope.get("sys.turn_index") == 31
    assert scope.get("sys.interaction") is None and scope.get("sys.activity_status") is None
    assert ports.user_text == "học phí"


def test_scope_of_an_explain_request_has_no_query_and_exposes_the_result(monkeypatch):
    seen = captured_scope(monkeypatch)
    activity = SimpleNamespace(state=SimpleNamespace(status="completed", display_name="Minh"))
    request = SimpleNamespace(explain=SimpleNamespace(), content=None)
    run_message_turn(snapshot(demo_agent(), activity=activity, result_card=CARD, current_result=("r1", 3)), request,
                     model=None, executor=None, tool_context=NO_CONTEXT, knowledge_port=None, clock=lambda: 0.0)
    scope, ports = seen[0]
    assert (scope.get("sys.query"), scope.get("sys.interaction"), scope.get("sys.interaction_outcome")) == (
        "", "explain_result", "explain_requested")
    assert scope.get("sys.activity_status") == "completed"
    assert (scope.get("result.house_id"), scope.get("result.revision")) == ("h1", 3)
    assert ports.user_text == EXPLAIN_REQUEST_TEXT


def draft(completion=None, next_state=None):
    return SimpleNamespace(completion=completion, next_state=next_state)


def request(action):
    return SimpleNamespace(action=action)


def test_outcome_is_derived_from_the_action_and_whether_the_activity_completed():
    assert interaction_outcome(request("set_name"), draft()) == "name_set"
    assert interaction_outcome(request("submit_answer"), draft()) == "answer_recorded"
    assert interaction_outcome(request("submit_answer"), draft(completion=object())) == "assessment_completed"
    assert interaction_outcome(request("confirm_answer"), draft()) == "answer_confirmed"
    assert interaction_outcome(request("edit_answer"), draft()) == "answer_edited"
    assert interaction_outcome(request("something_else"), draft()) == "none"


class Activity(SimpleNamespace):
    def model_copy(self, *, update):
        return Activity(**{**vars(self), **update})


def chat_snapshot(**changes):
    before = Activity(state=SimpleNamespace(status="collecting_name", display_name=None))
    return replace_snapshot(snapshot(chatflow_agent(), activity=before, **changes))


def replace_snapshot(namespace):
    # run_interaction_turn copies the snapshot with dataclasses.replace; a frozen dataclass mirror stands in.
    fields = vars(namespace)
    return make_dataclass("Snap", list(fields), frozen=True)(**fields)


def chatflow_agent():
    return AgentSnapshotV1.model_validate(MIN)


def test_the_graph_of_an_interaction_sees_the_post_handler_state_and_no_student_text(monkeypatch):
    seen = captured_scope(monkeypatch)
    after = SimpleNamespace(status="in_progress", display_name="Ngân", current_question=None)
    run_interaction_turn(chat_snapshot(), request("set_name"), draft(next_state=after), model=None,
                         tool_context=NO_CONTEXT, knowledge_port=None, knowledge=None, clock=lambda: 0.0)
    scope, ports = seen[0]
    assert (scope.get("sys.interaction"), scope.get("sys.interaction_outcome")) == ("set_name", "name_set")
    assert scope.get("sys.activity_status") == "in_progress" and scope.get("sys.query") == ""
    assert ports.user_text == "[Học sinh nhập tên: Ngân]" and ports.tools.snapshot.activity.state is after
    assert scope.get("conv.stage") == "assessment"  # read from the conversation's stored variables


def test_a_completing_interaction_exposes_the_new_result_to_the_graph(monkeypatch):
    seen = captured_scope(monkeypatch)
    completion = SimpleNamespace(card=SimpleNamespace(house=SimpleNamespace(house_id="h2"),
                                                      career_groups=("Y tế",)), result_revision=1)
    done = SimpleNamespace(status="completed", display_name="Ngân")
    run_interaction_turn(chat_snapshot(result_card=CARD, current_result=("r0", 4)), request("submit_answer"),
                         draft(completion=completion, next_state=done), model=None, tool_context=NO_CONTEXT,
                         knowledge_port=None, knowledge=None, clock=lambda: 0.0)
    scope, _ = seen[0]
    assert scope.get("sys.interaction_outcome") == "assessment_completed"
    assert (scope.get("result.house_id"), scope.get("result.career_groups"), scope.get("result.revision")) == (
        "h2", ["Y tế"], 1)


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
    plan = plan_from_run(snapshot(chatflow_agent()), finished, message("chào"), handler=None, persistence=None)
    assert plan.blocks == run.blocks and plan.conv_vars == {"stage": "done"}
    assert plan.start is None and plan.draft is None


def test_an_agent_mode_plan_never_writes_conversation_variables():
    run = run_agent_mode(FakeModel(ModelReply(text="Chào bạn!")))
    finished = WorkflowRun("completed", run.records, run.blocks, (), {"stage": "done"})
    plan = plan_from_run(snapshot(demo_agent()), finished, message("chào"), handler=None, persistence=None)
    assert plan.blocks == run.blocks and plan.conv_vars is None


def test_an_explain_request_that_falls_back_gets_the_card_only_explanation():
    activity = SimpleNamespace(state=SimpleNamespace(status="completed", display_name="Minh"))
    fallback = WorkflowRun("fallback", (), (), (), {"stage": "assessment"}, fallback="timeout")
    request = SimpleNamespace(explain=SimpleNamespace(), content=None)
    plan = plan_from_run(snapshot(demo_agent(), activity=activity, result_card=CARD), fallback, request,
                         handler=None, persistence=None)
    assert [block.content for block in plan.blocks] == [EXPLAIN_FALLBACK.format(
        house="Nhà Sáng Tạo", name="Minh", strengths="sáng tạo", tendencies="tò mò", career_groups="Thiết kế",
        quote="Cứ thử đi.")]
    assert plan.conv_vars is None  # mode = agent


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


def test_only_a_message_turn_requires_the_graph_to_produce_a_reply(monkeypatch):
    required = []

    def capture(workflow, scope, ports, **kwargs):
        required.append(kwargs["reply_required"])
        return WorkflowRun("completed", (), (), (), scope.conv_values())
    monkeypatch.setattr(chatflow_turns, "run_workflow", capture)
    run_message_turn(snapshot(chatflow_agent()), message("chào"), model=None, executor=None,
                     tool_context=NO_CONTEXT, knowledge_port=None, clock=lambda: 0.0)
    after = SimpleNamespace(status="in_progress", display_name="Ngân", current_question=None)
    run_interaction_turn(chat_snapshot(), request("set_name"), draft(next_state=after), model=None,
                         tool_context=NO_CONTEXT, knowledge_port=None, knowledge=None, clock=lambda: 0.0)
    assert required == [True, False]  # a handled interaction already has the handler's block as its reply
