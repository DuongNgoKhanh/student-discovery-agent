from datetime import date

import pytest
from pydantic import BaseModel, ValidationError

from agent_runtime.agent.model import FakeModel, ModelReply, ModelUnavailable, ToolCall, ToolResultMessage
from agent_runtime.agent.prompt import AgentContext
from agent_runtime.sessions.schemas.activity import KnowledgeCardBlock
from agent_runtime.tools.kit import Answered
from agent_runtime.workflow.budget import Budget
from agent_runtime.workflow.executor import run_workflow
from agent_runtime.workflow.implicit import implicit_workflow
from tests.helpers.toolbox import scripted_toolbox
from tests.unit.workflow.helpers import agent, ids, ports_for, scope_for, workflow

CONTEXT = AgentContext(today=date(2026, 11, 10))


def run_implicit(model, *, events=None):
    snapshot = agent()
    wf = implicit_workflow(snapshot)
    ports = ports_for(snapshot=snapshot, model=model, tools=scripted_toolbox(snapshot)[0], agent_context=CONTEXT,
                      user_text="chào")
    return run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget), new_id=ids(), implicit=True,
                        on_event=events.append if events is not None else None)


def test_implicit_graph_runs_the_agent_and_returns_its_blocks():
    result = run_implicit(FakeModel(ModelReply(text="Chào **Minh**!")))
    assert (result.status, result.path) == ("completed", ("start", "agent", "answer"))
    assert [block.content for block in result.blocks] == ["Chào **Minh**!"]
    assert result.agent_steps == 1 and result.llm_calls == 1


def test_implicit_graph_keeps_the_agents_own_fallback_reason_and_template():
    result = run_implicit(FakeModel(ModelUnavailable("rate_limited")))
    assert (result.status, result.fallback) == ("fallback", "rate_limited")
    assert result.blocks[0].content == agent().templates.busy_message
    empty = run_implicit(FakeModel(ModelReply(text="![](https://x.vn/a.png)")))
    assert empty.fallback == "empty_reply" and empty.blocks[0].content == agent().templates.unknown_message


def test_implicit_graph_streams_the_agents_text_live_and_tool_calls():
    events = []
    model = FakeModel(ModelReply(text="", tool_calls=(ToolCall("c1", "ui.suggest_replies", {"items": [
        {"label": "A", "message_text": "A"}]}),)), ModelReply(text="Xong nhé"))
    run_implicit(model, events=events)
    texts = [event.text for event in events if type(event).__name__ == "TextDelta"]
    assert "".join(texts) == "Xong nhé"


def test_an_explicit_agent_node_only_sees_its_own_tools():
    wf = workflow([{"id": "start", "type": "start"},
                   {"id": "assess", "type": "agent", "config": {"tools": ["assessment.set_name"]}},
                   {"id": "reply", "type": "answer", "config": {"blocks": [{"type": "upstream"}]}}],
                  [("start", "next", "assess"), ("assess", "success", "reply"), ("assess", "handoff", "reply")])
    model = FakeModel(ModelReply(text="", tool_calls=(ToolCall("c1", "knowledge.search", {"query": "x"}),)),
                      ModelReply(text="Không tra được"))
    toolbox, calls = scripted_toolbox(agent())
    ports = ports_for(model=model, tools=toolbox, agent_context=CONTEXT, user_text="học phí")
    result = run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget), new_id=ids())
    assert result.status == "completed"
    offered = [definition.name for definition in model.calls[0][1]]
    assert offered == ["assessment.set_name"]
    tool_result = next(m for m in model.calls[1][0] if isinstance(m, ToolResultMessage))
    assert tool_result.content == {"error": "unknown_tool"} and calls == []


def test_a_tool_handoff_ends_the_node_on_the_handoff_handle():
    wf = workflow([{"id": "start", "type": "start"}, {"id": "a", "type": "agent", "config": {"tools": ["*"]}},
                   {"id": "reply", "type": "answer", "config": {"blocks": [{"type": "upstream"}]}}],
                  [("start", "next", "a"), ("a", "success", "reply"), ("a", "handoff", "reply")])
    model = FakeModel(ModelReply(text="Mình ghi tên nhé", tool_calls=(
        ToolCall("c1", "assessment.set_name", {"display_name": "Minh"}),)))
    ports = ports_for(model=model, tools=scripted_toolbox(agent())[0], agent_context=CONTEXT,
                      user_text="mình là Minh")
    result = run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget), new_id=ids())
    assert result.handoff.name == "assessment.set_name" and result.path == ("start", "a", "reply")


def test_a_tool_that_raises_answers_the_model_with_tool_unavailable_instead_of_failing_the_turn():
    snapshot = agent()
    wf = implicit_workflow(snapshot)
    model = FakeModel(ModelReply(text="", tool_calls=(ToolCall("c1", "result.explain", {}),)),
                      ModelReply(text="Mình chưa xem được kết quả lúc này."))
    broken = scripted_toolbox(snapshot, {"result.explain": lambda call: (_ for _ in ()).throw(RuntimeError())})[0]
    ports = ports_for(snapshot=snapshot, model=model, tools=broken, agent_context=CONTEXT, user_text="chào")
    result = run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget), new_id=ids(), implicit=True)
    tool_result = next(m for m in model.calls[1][0] if isinstance(m, ToolResultMessage))
    assert tool_result.content == {"error": "tool_unavailable"}
    assert (result.status, result.fallback) == ("completed", None)


def test_an_unexpected_failure_in_agent_mode_still_fails_the_turn_as_before():
    def crash(messages):
        raise RuntimeError("model adapter crashed")

    snapshot = agent()
    wf = implicit_workflow(snapshot)
    ports = ports_for(snapshot=snapshot, model=FakeModel(crash), tools=scripted_toolbox(snapshot)[0],
                      agent_context=CONTEXT, user_text="chào")
    with pytest.raises(RuntimeError, match="model adapter crashed"):
        run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget), new_id=ids(), implicit=True)


def test_steps_taken_before_the_turn_deadline_are_still_counted():
    now, armed = [0.0], [False]

    def clock():
        if armed[0]:  # the loop's own deadline check passes; the budget's check right after it does not
            armed[0], now[0] = False, 100.0
            return 0.0
        return now[0]

    def arming(call):
        armed[0] = True
        return {"ok": True}

    snapshot = agent()
    wf = implicit_workflow(snapshot)
    model = FakeModel(ModelReply(text="", tool_calls=(ToolCall("c1", "result.explain", {}),)))
    ports = ports_for(snapshot=snapshot, model=model, tools=scripted_toolbox(snapshot, {"result.explain": arming})[0],
                      agent_context=CONTEXT, user_text="chào")
    result = run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget, clock=clock), new_id=ids(),
                          implicit=True)
    assert (result.status, result.fallback, result.agent_steps, result.llm_calls) == ("fallback", "deadline", 1, 1)


def test_a_validation_error_inside_the_agent_is_not_mistaken_for_a_bad_node_config():
    class Strict(BaseModel):
        value: int

    def broken(messages):  # a tool's own ValidationError answers tool_unavailable; the loop's propagates
        return Strict.model_validate({"value": "not a number"})

    snapshot = agent()
    wf = implicit_workflow(snapshot)
    ports = ports_for(snapshot=snapshot, model=FakeModel(broken), tools=scripted_toolbox(snapshot)[0],
                      agent_context=CONTEXT, user_text="chào")
    with pytest.raises(ValidationError):
        run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget), new_id=ids(), implicit=True)


def test_an_invalid_agent_config_is_a_node_error():
    wf = workflow([{"id": "start", "type": "start"}, {"id": "a", "type": "agent", "config": {"max_tool_steps": 99}},
                   {"id": "reply", "type": "answer", "config": {"blocks": [{"type": "upstream"}]}}],
                  [("start", "next", "a"), ("a", "success", "reply")])
    ports = ports_for(model=FakeModel(), tools=scripted_toolbox(agent())[0], agent_context=CONTEXT, user_text="chào")
    result = run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget), new_id=ids())
    assert (result.status, result.fallback, result.records[-1].error) == (
        "fallback", "workflow_node_error", "invalid_output")


class JumpingClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def late(reply, clock):
    """The model answers, but only after the turn deadline has passed."""
    def outcome(messages):
        clock.now = 1000.0
        return reply
    return outcome


def test_a_reply_that_arrives_after_the_deadline_is_still_answered_in_agent_mode():
    clock = JumpingClock()
    snapshot = agent()
    wf = implicit_workflow(snapshot)
    ports = ports_for(snapshot=snapshot, model=FakeModel(late(ModelReply(text="Muộn nhưng xong"), clock)),
                      tools=scripted_toolbox(snapshot)[0], agent_context=CONTEXT, user_text="chào")
    result = run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget, clock=clock), new_id=ids(),
                          implicit=True)
    assert (result.status, result.fallback, result.path) == ("completed", None, ("start", "agent", "answer"))
    assert [block.content for block in result.blocks] == ["Muộn nhưng xong"]


def test_a_handoff_that_arrives_after_the_deadline_is_kept_in_agent_mode():
    clock = JumpingClock()
    snapshot = agent()
    wf = implicit_workflow(snapshot)
    reply = ModelReply(text="Mình ghi tên nhé", tool_calls=(
        ToolCall("c1", "assessment.set_name", {"display_name": "Minh"}),))
    toolbox, calls = scripted_toolbox(snapshot)
    ports = ports_for(snapshot=snapshot, model=FakeModel(late(reply, clock)), tools=toolbox, agent_context=CONTEXT,
                      user_text="mình là Minh")
    result = run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget, clock=clock), new_id=ids(),
                          implicit=True)
    assert (result.status, result.fallback) == ("completed", None)
    assert result.handoff.name == "assessment.set_name" and [name for name, _ in calls] == ["assessment.set_name"]


def test_a_model_node_past_the_deadline_still_falls_back_in_an_explicit_graph():
    clock = JumpingClock()
    wf = workflow([{"id": "start", "type": "start"}, {"id": "a", "type": "agent", "config": {"tools": ["*"]}},
                   {"id": "reply", "type": "answer", "config": {"blocks": [{"type": "upstream"}]}}],
                  [("start", "next", "a"), ("a", "success", "reply")])
    model = FakeModel()
    ports = ports_for(model=model, tools=scripted_toolbox(agent())[0], agent_context=CONTEXT, user_text="chào")
    budget = Budget(wf.budget, clock=clock)
    clock.now = 1000.0  # past the deadline before the turn starts: start may run, the agent may not
    result = run_workflow(wf, scope_for(wf), ports, budget=budget, new_id=ids())
    assert (result.status, result.fallback, result.path) == ("fallback", "workflow_budget", ("start",))
    assert model.calls == []


CARD = KnowledgeCardBlock(block_id="card1", type="knowledge_card", schema_version=1, title="Học phí",
                          fields=({"label": "Mức", "value": "10 triệu"},), document_id="doc1", revision=1,
                          updated_at="2026-11-10T00:00:00Z")


def test_each_agent_node_keeps_only_the_cards_its_own_run_produced():
    """Cards travel on the agent turn: a later agent node that shows nothing has none of an earlier node's."""
    from agent_runtime.sessions.schemas.activity import NewMessage
    wf = workflow([{"id": "start", "type": "start"},
                   {"id": "a1", "type": "agent", "config": {"tools": ["*"]}},
                   {"id": "a2", "type": "agent", "config": {"tools": ["*"]}},
                   {"id": "reply", "type": "answer", "config": {"blocks": [{"type": "upstream"}]}}],
                  [("start", "next", "a1"), ("a1", "success", "a2"), ("a2", "success", "reply")])
    model = FakeModel(ModelReply(text="", tool_calls=(ToolCall("c1", "knowledge.show", {"refs": ["k1"]}),)),
                      ModelReply(text="Đây là học phí"), ModelReply(text="Còn gì nữa không?"))
    toolbox, calls = scripted_toolbox(agent(), {"knowledge.show": Answered({"shown": 1}, blocks=(CARD,))})
    ports = ports_for(model=model, tools=toolbox, agent_context=CONTEXT, user_text="học phí")
    result = run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget), new_id=ids())
    assert result.status == "completed" and [name for name, _ in calls] == ["knowledge.show"]
    assert [block.type for block in result.blocks].count("knowledge_card") == 1
    NewMessage(message_id="m1", turn_id="t1", role="assistant", blocks=result.blocks)  # ids stay unique
