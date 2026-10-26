"""Agent turn loop: code decides what the model may do; handoffs end the turn; failures fall back to templates."""
import itertools
import json
from datetime import date
from pathlib import Path

from agent_runtime.agent.catalog import ProposeAnswerArguments, SetNameArguments
from agent_runtime.agent.loop import TextDelta, ToolCallStarted, offered_tools, run_agent_turn
from agent_runtime.agent.model import FakeModel, ModelReply, ModelUnavailable, ToolCall, ToolResultMessage, UserMessage
from agent_runtime.agent.prompt import AgentContext
from agent_runtime.sessions.schemas.release import AgentSnapshotV1

ROOT = Path(__file__).resolve().parents[5]
DEMO = json.loads((ROOT / "contracts/fixtures/agent-snapshot-demo.json").read_text(encoding="utf-8"))
SNAPSHOT = AgentSnapshotV1.model_validate(DEMO)
QUESTION = {"title": "Bạn có thích sửa đồ điện tử không?",
            "options": [{"id": "o1", "label": "Không thích"}, {"id": "o2", "label": "Thích"}]}
IN_PROGRESS = AgentContext(today=date(2026, 10, 26), phase="in_progress", display_name="Minh",
                           current_question=QUESTION)


class Executor:
    def __init__(self, **results):
        self.results = results
        self.calls = []

    def execute(self, name, arguments):
        self.calls.append((name, arguments))
        return self.results.get(name, {"ok": True})


def ids():
    counter = itertools.count(1)
    return lambda: f"b{next(counter)}"


def turn(model, executor=None, context=IN_PROGRESS, text="hi", snapshot=SNAPSHOT):
    return run_agent_turn(snapshot, model, executor or Executor(), context, [], text, new_id=ids())


def call(name, arguments, call_id="c1"):
    return ToolCall(id=call_id, name=name, arguments=arguments)


def test_plain_reply_becomes_a_markdown_block():
    result = turn(FakeModel(ModelReply(text="Chào **Minh**!")))
    (block,) = result.blocks
    assert (block.type, block.content, result.handoff, result.fallback) == ("markdown", "Chào **Minh**!", None, None)


def test_handoff_ends_the_turn_and_drops_text_the_model_wanted_to_add_later():
    executor = Executor(**{"assessment.propose_answer": {"proposal_id": "p1"}})
    model = FakeModel(ModelReply(text="Nghe hay đó!", tool_calls=(
        call("assessment.propose_answer", {"option_id": "o2"}), call("ui.suggest_replies", {"items": []}, "c2"))))
    result = turn(model, executor, text="hay tháo quạt ra sửa")
    assert len(model.calls) == 1  # never asked to continue, so it cannot invent the next question
    assert result.handoff.name == "assessment.propose_answer"
    assert result.handoff.arguments == ProposeAnswerArguments(option_id="o2")
    assert result.handoff.result == {"proposal_id": "p1"}
    assert [b.type for b in result.blocks] == ["markdown"] and executor.calls[0][0] == "assessment.propose_answer"


def test_handoff_without_text_yields_no_agent_blocks():
    result = turn(FakeModel(ModelReply(text="", tool_calls=(call("assessment.set_name", {"display_name": "Minh"}),))),
                  context=AgentContext(today=date(2026, 10, 26), phase="collecting_name"))
    assert result.blocks == () and result.handoff.arguments == SetNameArguments(display_name="Minh")


def test_rejected_handoff_goes_back_to_the_model_instead_of_ending_the_turn():
    executor = Executor(**{"assessment.set_name": {"error": "invalid_name"}})
    model = FakeModel(ModelReply(text="", tool_calls=(call("assessment.set_name", {"display_name": "M1nh"}),)),
                      ModelReply(text="Tên chỉ gồm chữ cái thôi nhé, bạn nhập lại giúp mình?"))
    result = turn(model, executor, context=AgentContext(today=date(2026, 10, 26), phase="collecting_name"))
    assert model.calls[1][0][-1].content == {"error": "invalid_name"}
    assert result.handoff is None and result.blocks[0].type == "markdown" and result.steps == 2


def test_non_handoff_tool_results_go_back_to_the_model():
    executor = Executor(**{"result.explain": {"top_codes": ["R", "I", "A"]}})
    model = FakeModel(ModelReply(text="", tool_calls=(call("result.explain", {}),)),
                      ModelReply(text="Bạn thuộc nhóm R-I-A."))
    result = turn(model, executor, context=AgentContext(today=date(2026, 10, 26), phase="completed"))
    second_messages = model.calls[1][0]
    assert isinstance(second_messages[-1], ToolResultMessage) and second_messages[-1].content == {
        "top_codes": ["R", "I", "A"]}
    assert result.blocks[0].content == "Bạn thuộc nhóm R-I-A." and result.steps == 2


def test_invalid_or_unknown_calls_are_rejected_before_any_tool_runs():
    executor = Executor()
    model = FakeModel(ModelReply(text="", tool_calls=(
        call("assessment.propose_answer", {"option_id": "o 2"}), call("shell.exec", {}, "c2"),
        call("assessment.set_name", None, "c3"))), ModelReply(text="Bạn nói rõ hơn nhé?"))
    result = turn(model, executor)
    errors = [m.content["error"] for m in model.calls[1][0] if isinstance(m, ToolResultMessage)]
    assert errors[0].startswith("invalid_arguments: option_id") and errors[1] == "unknown_tool"
    assert errors[2] == "invalid_arguments: not a JSON object"
    assert executor.calls == [] and result.blocks[0].content == "Bạn nói rõ hơn nhé?"


def test_suggestions_are_validated_deduplicated_and_rendered_after_the_text():
    items = [{"label": "Thích", "message_text": "Thích"}, {"label": "Thích", "message_text": "Rất thích"},
             {"label": "Không thích", "message_text": "Không thích"}]
    model = FakeModel(ModelReply(text="", tool_calls=(call("ui.suggest_replies", {"items": items}),)),
                      ModelReply(text="Bạn thấy sao?"))
    text, chips = turn(model).blocks
    assert text.type == "markdown" and chips.type == "suggestions"
    assert [(i.label, i.message_text) for i in chips.items] == [("Thích", "Thích"), ("Không thích", "Không thích")]


def test_model_failures_fall_back_to_templates():
    result = turn(FakeModel(ModelUnavailable("rate_limited", "ModelProviderError:429")))
    text, chips = result.blocks
    assert result.fallback == "rate_limited"
    assert (text.type, text.content) == ("text", SNAPSHOT.templates.unknown_message)
    assert [i.label for i in chips.items] == list(SNAPSHOT.templates.fallback_suggestions)


def test_no_model_configured_never_calls_one():
    snapshot = AgentSnapshotV1.model_validate({**DEMO, "model": None})
    model = FakeModel()
    assert turn(model, snapshot=snapshot).fallback == "not_configured" and model.calls == []


def test_runaway_tool_use_stops_at_the_step_limit():
    looping = ModelReply(text="", tool_calls=(call("result.explain", {}),))
    model = FakeModel(*[looping] * SNAPSHOT.limits.max_tool_steps)
    assert turn(model).fallback == "max_tool_steps" and len(model.calls) == SNAPSHOT.limits.max_tool_steps


def test_empty_reply_falls_back():
    assert turn(FakeModel(ModelReply(text="![](https://x.vn/a.png)"))).fallback == "empty_reply"


def test_unsafe_markup_is_reduced_before_it_becomes_a_block():
    result = turn(FakeModel(ModelReply(text="<b>Xem</b> [trang](https://evil.example) và [IHRD](https://ihrd.vn)")))
    assert result.blocks[0].content == "Xem trang và [IHRD](https://ihrd.vn)"


def test_input_and_history_are_bounded_by_snapshot_limits():
    model = FakeModel(ModelReply(text="ok"))
    history = [UserMessage(f"m{i}") for i in range(30)]
    run_agent_turn(SNAPSHOT, model, Executor(), IN_PROGRESS, history, "x" * 5000, new_id=ids())
    messages = model.calls[0][0]
    users = [m for m in messages if isinstance(m, UserMessage)]
    assert len(users) == SNAPSHOT.limits.history_messages + 1 and users[0].text == "m10"
    assert len(users[-1].text) == SNAPSHOT.limits.max_input_chars


def test_offered_tools_carry_catalog_schemas_and_binding_details():
    tools = offered_tools(SNAPSHOT)
    assert set(tools) == {binding.name for binding in SNAPSHOT.tools}
    start = tools["assessment.start"].definition
    assert "exp_riasec (Bài khám phá tính cách)" in start.description
    assert start.parameters["required"] == ["experience_id"]
    suggest = tools["ui.suggest_replies"].definition.parameters
    assert suggest["properties"]["items"]["items"]["required"] == ["label", "message_text"]


def test_events_stream_text_and_announce_tool_calls():
    events = []
    model = FakeModel(ModelReply(text="", tool_calls=(call("result.explain", {}),)), ModelReply(text="Xong rồi"))
    run_agent_turn(SNAPSHOT, model, Executor(), IN_PROGRESS, [], "hi", new_id=ids(), on_event=events.append)
    assert events[0] == ToolCallStarted("result.explain")
    assert "".join(e.text for e in events if isinstance(e, TextDelta)) == "Xong rồi"


def test_handoff_tools_are_not_announced():
    events = []
    model = FakeModel(ModelReply(text="", tool_calls=(call("assessment.current_question", {}),)))
    run_agent_turn(SNAPSHOT, model, Executor(), IN_PROGRESS, [], "hi", new_id=ids(), on_event=events.append)
    assert not any(isinstance(e, ToolCallStarted) for e in events)


def test_should_stop_cancels_before_the_next_model_call():
    model = FakeModel(ModelReply(text="", tool_calls=(call("result.explain", {}),)))
    stops = iter([False, True])
    result = run_agent_turn(SNAPSHOT, model, Executor(), IN_PROGRESS, [], "hi", new_id=ids(),
                            should_stop=lambda: next(stops))
    assert result.cancelled and result.blocks == () and len(model.calls) == 1


def test_deadline_falls_back_to_templates():
    now = iter([0.0, 100.0])
    model = FakeModel(ModelReply(text="", tool_calls=(call("result.explain", {}),)))
    result = run_agent_turn(SNAPSHOT, model, Executor(), IN_PROGRESS, [], "hi", new_id=ids(), deadline=10.0,
                            clock=lambda: next(now))
    assert result.fallback == "deadline" and len(model.calls) == 1
