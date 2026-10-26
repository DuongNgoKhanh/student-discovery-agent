"""Provider-neutral model port: scripted fake and unconfigured fallback never raise."""
from agent_runtime.agent.model import (
    FakeModel,
    ModelReply,
    ModelSettings,
    ModelUnavailable,
    ToolCall,
    UnconfiguredModel,
    UserMessage,
)

SETTINGS = ModelSettings(model_id="gemini-2.5-flash")


def test_fake_model_replays_script_and_records_calls():
    call = ToolCall(id="c1", name="ui.suggest_replies", arguments={"items": []})
    fake = FakeModel(ModelReply(text="", tool_calls=(call,)),
                     lambda messages: ModelReply(text=f"seen {len(messages)}"))
    first = fake.invoke([UserMessage("hi")], [], SETTINGS)
    second = fake.invoke([UserMessage("hi"), UserMessage("again")], [], SETTINGS)
    assert first.tool_calls == (call,) and second.text == "seen 2"
    assert len(fake.calls) == 2 and fake.calls[0][2] == SETTINGS


def test_exhausted_script_is_unavailable_not_an_exception():
    assert FakeModel().invoke([UserMessage("hi")], [], SETTINGS) == ModelUnavailable(
        "invalid_response", "script exhausted")


def test_unconfigured_model_reports_not_configured():
    assert UnconfiguredModel().invoke([UserMessage("hi")], [], SETTINGS).reason == "not_configured"
