"""Gemini adapter: one agno model call per invoke, no tool execution, every failure normalised."""
import json

import httpx
from agno.exceptions import ModelProviderError
from agno.models.google import Gemini
from agno.models.metrics import Metrics
from agno.models.response import ModelResponse

from agent_runtime.agent.model import (
    AssistantMessage,
    ModelSettings,
    ModelUnavailable,
    SystemMessage,
    ToolCall,
    ToolDefinition,
    ToolResultMessage,
    UserMessage,
)
from agent_runtime.infrastructure.llm.gemini_model import GeminiChatModel, to_agno_message

SETTINGS = ModelSettings(model_id="gemini-2.5-flash", temperature=0.2, max_output_tokens=300,
                         timeout_ms=5000, max_retries=1)
PROPOSE = ToolDefinition(name="assessment.propose_answer", description="Đề xuất đáp án",
                         parameters={"type": "object", "properties": {"option_ids": {"type": "array"}}})


def stub_factory(*outcomes):
    created = []

    class Stub:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.invocations = []
            created.append(self)

        def invoke(self, **kwargs):
            self.invocations.append(kwargs)
            outcome = outcomes[sum(len(model.invocations) for model in created) - 1]
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

    return Stub, created


def test_text_reply_usage_and_settings_are_forwarded():
    factory, created = stub_factory(ModelResponse(content="Chào em", response_usage=Metrics(input_tokens=7,
                                                                                            output_tokens=3)))
    reply = GeminiChatModel("key", model_factory=factory).invoke([UserMessage("hi")], [], SETTINGS)
    assert (reply.text, reply.tool_calls, reply.usage.input_tokens, reply.usage.output_tokens) == ("Chào em", (), 7, 3)
    kwargs = created[0].kwargs
    assert (kwargs["id"], kwargs["api_key"], kwargs["temperature"], kwargs["max_output_tokens"]) == (
        "gemini-2.5-flash", "key", 0.2, 300)
    assert kwargs["client_params"]["http_options"].timeout == 5000
    assert created[0].invocations[0]["tools"] is None


def test_tool_calls_are_parsed_and_names_unwired():
    raw = {"id": "c1", "type": "function", "thought_signature": "c2ln",
           "function": {"name": "assessment__propose_answer", "arguments": json.dumps({"option_ids": ["o1"]})}}
    broken = {"id": "c2", "type": "function", "function": {"name": "assessment__propose_answer", "arguments": "{"}}
    factory, created = stub_factory(ModelResponse(content=None, tool_calls=[raw, broken]))
    reply = GeminiChatModel("key", model_factory=factory).invoke([UserMessage("em thích sửa máy")], [PROPOSE],
                                                                  SETTINGS)
    first, second = reply.tool_calls
    assert (first.name, first.arguments, first.provider_data["thought_signature"]) == (
        "assessment.propose_answer", {"option_ids": ["o1"]}, "c2ln")
    assert second.arguments is None and reply.text == ""
    (sent,) = created[0].invocations[0]["tools"]
    assert sent["function"]["name"] == "assessment__propose_answer"


def test_provider_errors_retry_then_report_unavailable():
    factory, _ = stub_factory(ModelProviderError("boom"), ModelResponse(content="ok"))
    assert GeminiChatModel("key", model_factory=factory).invoke([UserMessage("hi")], [], SETTINGS).text == "ok"
    factory, _ = stub_factory(ModelProviderError("boom"), ModelProviderError("boom"))
    failure = GeminiChatModel("key", model_factory=factory).invoke([UserMessage("hi")], [], SETTINGS)
    assert failure == ModelUnavailable("provider_error", "ModelProviderError")


def test_timeouts_are_not_retried():
    timeout = ModelProviderError("timed out")
    timeout.__cause__ = httpx.ReadTimeout("slow")
    factory, created = stub_factory(timeout, ModelResponse(content="late"))
    failure = GeminiChatModel("key", model_factory=factory).invoke([UserMessage("hi")], [], SETTINGS)
    assert failure.reason == "timeout" and len(created[0].invocations) == 1


def test_history_with_tool_round_trip_formats_offline_for_gemini():
    call = ToolCall(id="c1", name="assessment.propose_answer", arguments={"option_ids": ["o1"]})
    history = [SystemMessage("persona"), UserMessage("em thích sửa máy"), AssistantMessage(None, (call,)),
               ToolResultMessage(call_id="c1", name="assessment.propose_answer", content={"ok": True})]
    formatted, system = Gemini(id="gemini-2.5-flash", api_key="unused")._format_messages(
        [to_agno_message(message) for message in history])
    assert system == "persona"
    assert formatted[1].parts[0].function_call.name == "assessment__propose_answer"
    assert formatted[2].parts[0].function_response.response == {"result": json.dumps({"ok": True})}


def test_malformed_provider_response_is_invalid_response_and_not_retried():
    factory, created = stub_factory(ModelResponse(content=None, tool_calls=[{"id": "c1"}]),
                                    ModelResponse(content="again"))
    failure = GeminiChatModel("key", model_factory=factory).invoke([UserMessage("hi")], [], SETTINGS)
    assert failure == ModelUnavailable("invalid_response", "KeyError") and len(created[0].invocations) == 1


def test_setup_failures_never_raise_past_the_port():
    def broken_factory(**_):
        raise ValueError("bad config")

    failure = GeminiChatModel("key", model_factory=broken_factory).invoke([UserMessage("hi")], [], SETTINGS)
    assert failure == ModelUnavailable("provider_error", "ValueError")
