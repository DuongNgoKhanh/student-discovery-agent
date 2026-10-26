"""Provider-neutral model port: scripted fake and unconfigured fallback never raise."""
from types import SimpleNamespace

import pytest

from agent_runtime.agent.catalog import SUPPORTED_MODEL_PROVIDERS
from agent_runtime.agent.model import (
    FakeModel,
    ModelReply,
    ModelSettings,
    ToolCall,
    UnconfiguredModel,
    UserMessage,
)
from agent_runtime.infrastructure.llm.gemini_model import GeminiChatModel
from agent_runtime.infrastructure.llm.model_registry import MODEL_PROVIDERS, build_model_port
from agent_runtime.infrastructure.llm.openai_model import OpenAIChatModel
from agent_runtime.sessions.schemas.release import AgentModelConfig

SETTINGS = AgentModelConfig(ref="gemini/gemini-2.5-flash").settings()


def test_fake_model_replays_script_and_records_calls():
    call = ToolCall(id="c1", name="ui.suggest_replies", arguments={"items": []})
    fake = FakeModel(ModelReply(text="", tool_calls=(call,)),
                     lambda messages: ModelReply(text=f"seen {len(messages)}"))
    first = fake.invoke([UserMessage("hi")], [], SETTINGS)
    second = fake.invoke([UserMessage("hi"), UserMessage("again")], [], SETTINGS)
    assert first.tool_calls == (call,) and second.text == "seen 2"
    assert len(fake.calls) == 2 and fake.calls[0][2] == SETTINGS


def test_exhausted_script_fails_the_test():
    with pytest.raises(AssertionError):
        FakeModel().invoke([UserMessage("hi")], [], SETTINGS)


def test_settings_come_from_the_snapshot_model_config():
    assert SETTINGS == ModelSettings(model_id="gemini-2.5-flash", temperature=0.4, max_output_tokens=800,
                                     timeout_ms=8000, max_retries=1)


def test_unconfigured_model_reports_not_configured():
    assert UnconfiguredModel().invoke([UserMessage("hi")], [], SETTINGS).reason == "not_configured"


def test_registry_builds_each_provider_only_when_its_key_is_configured():
    configured = SimpleNamespace(GOOGLE_API_KEY="g", OPENAI_API_KEY="o", PROXY_URL=None)
    missing = SimpleNamespace(GOOGLE_API_KEY="", PROXY_URL=None)
    assert isinstance(build_model_port("gemini", config=configured), GeminiChatModel)
    assert isinstance(build_model_port("openai", config=configured), OpenAIChatModel)
    assert isinstance(build_model_port("gemini", config=missing), UnconfiguredModel)
    assert isinstance(build_model_port("openai", config=missing), UnconfiguredModel)
    assert isinstance(build_model_port("mistral", config=configured), UnconfiguredModel)


def test_every_supported_provider_has_an_adapter():
    assert set(MODEL_PROVIDERS) == SUPPORTED_MODEL_PROVIDERS
