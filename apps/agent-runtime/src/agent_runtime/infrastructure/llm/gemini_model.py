"""Gemini through agno's model adapter only: one model call per invoke, no agno Agent/memory/tool execution."""
import json
from collections.abc import Sequence

import httpx
from agno.models.google import Gemini
from agno.models.message import Message
from google.genai import types

from agent_runtime.agent.model import (
    AssistantMessage,
    ChatMessage,
    ModelReply,
    ModelSettings,
    ModelUnavailable,
    ModelUsage,
    SystemMessage,
    ToolCall,
    ToolDefinition,
    ToolResultMessage,
)
from agent_runtime.infrastructure.http.logging import logger


def wire_name(name: str) -> str:
    """Provider-safe function name; catalog names use dots."""
    return name.replace(".", "__")


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def to_agno_message(message: ChatMessage) -> Message:
    if isinstance(message, SystemMessage):
        return Message(role="system", content=message.text)
    if isinstance(message, AssistantMessage):
        calls = [call.provider_data or {"id": call.id, "type": "function", "function": {
            "name": wire_name(call.name), "arguments": _json(call.arguments or {})}} for call in message.tool_calls]
        return Message(role="assistant", content=message.text, tool_calls=calls or None)
    if isinstance(message, ToolResultMessage):
        content = _json(message.content)
        return Message(role="tool", content=[content], tool_calls=[
            {"tool_call_id": message.call_id, "tool_name": wire_name(message.name), "content": content}])
    return Message(role="user", content=message.text)


def _definition(tool: ToolDefinition) -> dict:
    return {"type": "function", "function": {
        "name": wire_name(tool.name), "description": tool.description, "parameters": tool.parameters}}


def _arguments(raw: str | None) -> dict | None:
    try:
        value = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _is_timeout(error: BaseException | None) -> bool:
    while error is not None:
        if isinstance(error, (httpx.TimeoutException, TimeoutError)):
            return True
        error = error.__cause__ or error.__context__
    return False


def _reply(response, names: dict[str, str]) -> ModelReply:
    calls = tuple(ToolCall(id=raw.get("id") or f"call_{index}",
                           name=names.get(raw["function"]["name"], raw["function"]["name"]),
                           arguments=_arguments(raw["function"].get("arguments")), provider_data=dict(raw))
                  for index, raw in enumerate(response.tool_calls or ()))
    usage = response.response_usage
    return ModelReply(text=response.content if isinstance(response.content, str) else "", tool_calls=calls,
                      usage=ModelUsage(input_tokens=getattr(usage, "input_tokens", 0) or 0,
                                       output_tokens=getattr(usage, "output_tokens", 0) or 0))


class GeminiChatModel:
    def __init__(self, api_key: str, *, proxy_url: str | None = None, model_factory=Gemini):
        self._api_key = api_key
        self._proxy_url = proxy_url
        self._factory = model_factory

    def _http_options(self, settings: ModelSettings) -> types.HttpOptions:
        client_args = {"proxy": self._proxy_url} if self._proxy_url else None
        return types.HttpOptions(timeout=settings.timeout_ms, client_args=client_args)

    def invoke(self, messages: Sequence[ChatMessage], tools: Sequence[ToolDefinition],
               settings: ModelSettings) -> ModelReply | ModelUnavailable:
        try:
            model = self._factory(id=settings.model_id, api_key=self._api_key, temperature=settings.temperature,
                                  max_output_tokens=settings.max_output_tokens,
                                  client_params={"http_options": self._http_options(settings)})
            payload = [to_agno_message(message) for message in messages]
            definitions = [_definition(tool) for tool in tools] or None
        except Exception as error:  # provider boundary: nothing may raise past the port
            logger.warning("model setup error: {}", type(error).__name__)
            return ModelUnavailable("provider_error", type(error).__name__)
        names = {wire_name(tool.name): tool.name for tool in tools}
        failure = ModelUnavailable("provider_error")
        for _ in range(settings.max_retries + 1):
            try:
                response = model.invoke(messages=payload, assistant_message=Message(role="assistant"),
                                        tools=definitions)
            except Exception as error:  # provider boundary: every failure becomes ModelUnavailable
                if _is_timeout(error):
                    logger.warning("model timeout: {}", type(error).__name__)
                    return ModelUnavailable("timeout", type(error).__name__)
                logger.warning("model provider error: {}", type(error).__name__)
                failure = ModelUnavailable("provider_error", type(error).__name__)
                continue
            try:
                return _reply(response, names)
            except Exception as error:  # malformed provider payload: not retryable
                logger.warning("model invalid response: {}", type(error).__name__)
                return ModelUnavailable("invalid_response", type(error).__name__)
        return failure
