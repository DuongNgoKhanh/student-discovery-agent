"""OpenAI dialect: settings mapping and Chat Completions wire format, checked offline."""
import json

from agno.models.openai import OpenAIChat
from agno.models.response import ModelResponse

from agent_runtime.agent.model import (
    AssistantMessage,
    ModelSettings,
    SystemMessage,
    ToolCall,
    ToolResultMessage,
    UserMessage,
)
from agent_runtime.infrastructure.llm.openai_model import OpenAIChatModel

SETTINGS = ModelSettings(model_id="gpt-4.1-mini", temperature=0.2, max_output_tokens=300, timeout_ms=5000,
                         max_retries=1)


def test_settings_map_to_the_openai_client_and_sdk_retries_are_off():
    created = []

    class Stub:
        def __init__(self, **kwargs):
            created.append(kwargs)

        def invoke(self, **_):
            return ModelResponse(content="Chào em")

    reply = OpenAIChatModel("key", model_factory=Stub).invoke([UserMessage("hi")], [], SETTINGS)
    assert reply.text == "Chào em"
    kwargs = created[0]
    assert (kwargs["id"], kwargs["api_key"], kwargs["max_completion_tokens"], kwargs["timeout"],
            kwargs["max_retries"], kwargs["http_client"]) == ("gpt-4.1-mini", "key", 300, 5.0, 0, None)


def test_proxy_client_is_pooled_per_adapter():
    adapter = OpenAIChatModel("key", proxy_url="http://p:1")
    assert adapter.build(SETTINGS).http_client is adapter.build(SETTINGS).http_client


def _format(history):
    model = OpenAIChat(id="gpt-4.1-mini", api_key="unused")
    return [model._format_message(message) for message in OpenAIChatModel("unused").to_agno_messages(history)]


def test_parallel_tool_results_are_separate_tool_messages_and_signatures_stay_with_gemini():
    calls = (ToolCall(id="c1", name="a.one", arguments={}, provider_data={"thought_signature": "c2ln"}),
             ToolCall(id="c2", name="a.two", arguments={"x": 1}))
    formatted = _format([SystemMessage("persona"), UserMessage("hi"), AssistantMessage("Để mình xem", calls),
                         ToolResultMessage(call_id="c1", name="a.one", content={"r": 1}),
                         ToolResultMessage(call_id="c2", name="a.two", content={"r": 2})])
    assert [message["role"] for message in formatted] == ["developer", "user", "assistant", "tool", "tool"]
    assistant = formatted[2]
    assert assistant["content"] == "Để mình xem"
    assert [call["function"]["name"] for call in assistant["tool_calls"]] == ["a__one", "a__two"]
    assert all("thought_signature" not in call for call in assistant["tool_calls"])
    assert [(m["tool_call_id"], m["content"]) for m in formatted[3:]] == [
        ("c1", json.dumps({"r": 1})), ("c2", json.dumps({"r": 2}))]
