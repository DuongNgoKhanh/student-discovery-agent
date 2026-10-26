"""Provider-neutral model port: scripted fake and unconfigured fallback never raise."""
from types import SimpleNamespace

from agent_runtime.agent.model import (
    FakeModel,
    ModelReply,
    ModelSettings,
    ModelUnavailable,
    ToolCall,
    UnconfiguredModel,
    UserMessage,
)
from agent_runtime.infrastructure.llm.gemini_model import GeminiChatModel
from agent_runtime.infrastructure.llm.model_registry import build_model_port

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


def test_registry_builds_gemini_only_when_a_key_is_configured():
    configured = SimpleNamespace(GOOGLE_API_KEY="key", PROXY_URL=None)
    missing = SimpleNamespace(GOOGLE_API_KEY="", PROXY_URL=None)
    assert isinstance(build_model_port("gemini", config=configured), GeminiChatModel)
    assert isinstance(build_model_port("gemini", config=missing), UnconfiguredModel)
    assert isinstance(build_model_port("openai", config=configured), UnconfiguredModel)
