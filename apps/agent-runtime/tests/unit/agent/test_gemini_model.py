"""Gemini dialect over the shared agno adapter: retries, failure normalisation and wire format."""
import json

import httpx
import pytest
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
from agent_runtime.infrastructure.llm.gemini_model import GeminiChatModel

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
    assert failure == ModelUnavailable("provider_error", "ModelProviderError:502")  # agno default status


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
    formatted, system = _format(history)
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


def _format(history):
    return Gemini(id="gemini-2.5-flash", api_key="unused")._format_messages(
        GeminiChatModel("unused").to_agno_messages(history))


def test_zero_arg_call_with_empty_provider_arguments_replays_and_keeps_signature():
    raw = {"id": "c1", "type": "function", "thought_signature": "c2ln",
           "function": {"name": "assessment__propose_answer", "arguments": ""}}
    call = ToolCall(id="c1", name="assessment.propose_answer", arguments={}, provider_data=raw)
    formatted, _ = _format([UserMessage("hi"), AssistantMessage(None, (call,)),
                            ToolResultMessage(call_id="c1", name="assessment.propose_answer", content={"ok": 1})])
    part = formatted[1].parts[0]
    assert part.function_call.name == "assessment__propose_answer" and part.thought_signature


def test_parallel_tool_results_form_one_function_response_turn():
    calls = (ToolCall(id="c1", name="a.one", arguments={}), ToolCall(id="c2", name="a.two", arguments={"x": 1}))
    formatted, _ = _format([UserMessage("hi"), AssistantMessage(None, calls),
                            ToolResultMessage(call_id="c1", name="a.one", content={"r": 1}),
                            ToolResultMessage(call_id="c2", name="a.two", content={"r": 2})])
    assert len(formatted) == 3 and len(formatted[1].parts) == 2
    assert [part.function_response.name for part in formatted[2].parts] == ["a__one", "a__two"]


def test_multiple_system_messages_are_joined():
    _, system = _format([SystemMessage("persona"), SystemMessage("brief"), UserMessage("hi")])
    assert system == "persona\n\nbrief"


def test_empty_assistant_message_is_dropped():
    formatted, _ = _format([UserMessage("hi"), AssistantMessage(None, ()), UserMessage("again")])
    assert [content.role for content in formatted] == ["user", "user"]


def test_deterministic_client_errors_are_not_retried_but_rate_limits_are():
    factory, created = stub_factory(ModelProviderError("bad", status_code=400), ModelResponse(content="x"))
    failure = GeminiChatModel("key", model_factory=factory).invoke([UserMessage("hi")], [], SETTINGS)
    assert failure == ModelUnavailable("provider_error", "ModelProviderError:400") and len(created[0].invocations) == 1
    factory, _ = stub_factory(ModelProviderError("slow down", status_code=429), ModelResponse(content="ok"))
    assert GeminiChatModel("key", model_factory=factory).invoke([UserMessage("hi")], [], SETTINGS).text == "ok"


def test_proxy_url_is_wired_into_http_options():
    factory, created = stub_factory(ModelResponse(content="ok"))
    GeminiChatModel("key", proxy_url="http://p:1", model_factory=factory).invoke([UserMessage("hi")], [], SETTINGS)
    assert created[0].kwargs["client_params"]["http_options"].client_args == {"proxy": "http://p:1"}


def test_empty_completion_is_invalid_response():
    factory, _ = stub_factory(ModelResponse(content="  "))
    failure = GeminiChatModel("key", model_factory=factory).invoke([UserMessage("hi")], [], SETTINGS)
    assert failure == ModelUnavailable("invalid_response", "empty response")


def test_missing_call_id_and_non_object_arguments_are_normalised():
    raw = {"type": "function", "function": {"name": "assessment__propose_answer", "arguments": "[1]"}}
    factory, _ = stub_factory(ModelResponse(content=None, tool_calls=[raw]))
    (call,) = GeminiChatModel("key", model_factory=factory).invoke([UserMessage("hi")], [PROPOSE],
                                                                    SETTINGS).tool_calls
    assert (call.id, call.arguments) == ("call_0", None)


def test_conversion_bugs_raise_instead_of_posing_as_provider_errors():
    factory, created = stub_factory(ModelResponse(content="ok"))
    result = ToolResultMessage(call_id="c1", name="a.one", content={"at": object()})
    with pytest.raises(TypeError):
        GeminiChatModel("key", model_factory=factory).invoke([UserMessage("hi"), result], [], SETTINGS)
    assert created == []


def test_assistant_text_and_tool_calls_replay_as_one_model_turn():
    call = ToolCall(id="c1", name="a.one", arguments={})
    formatted, _ = _format([UserMessage("hi"), AssistantMessage("Để mình xem", (call,)),
                            ToolResultMessage(call_id="c1", name="a.one", content={"r": 1})])
    parts = formatted[1].parts
    assert formatted[1].role == "model" and parts[0].text == "Để mình xem" and parts[1].function_call.name == "a__one"
