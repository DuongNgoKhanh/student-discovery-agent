"""ModelPort over agno's model adapters only, no agno Agent/memory/tool execution.

One logical turn per invoke: 5xx and connection failures are retried up to settings.max_retries with
exponential backoff; timeouts, 429 (rate_limited) and other 4xx are not, so callers fall back quickly.
Providers subclass AgnoChatModel and supply the agno model and wire dialect.
"""
import json
import time
from collections.abc import Callable, Sequence

import httpx
from agno.models.base import Model
from agno.models.message import Message

from agent_runtime.agent.model import (
    RETRY_BACKOFF_MS,
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
    UserMessage,
)
from agent_runtime.infrastructure.http.logging import logger


def wire_name(name: str) -> str:
    """Provider-safe function name; catalog names use dots."""
    return name.replace(".", "__")


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False)


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


def _status(error: BaseException) -> int | None:
    status = getattr(error, "status_code", None)
    return status if isinstance(status, int) else None


def _is_deterministic(error: BaseException) -> bool:
    """4xx (bad request, auth, quota) will fail again on an immediate retry."""
    status = _status(error)
    return status is not None and 400 <= status < 500


def _detail(error: BaseException) -> str:
    status = _status(error)
    return f"{type(error).__name__}:{status}" if status is not None else type(error).__name__


class AgnoChatModel:
    default_factory: type[Model]
    replay_keys: tuple[str, ...] = ()  # provider_data keys sent back when a tool call is replayed
    merge_tool_results = False  # True: consecutive tool results travel as one tool turn

    def __init__(self, api_key: str, *, proxy_url: str | None = None, model_factory=None,
                 sleep: Callable[[float], None] = time.sleep):
        self._api_key = api_key
        self._proxy_url = proxy_url
        self._factory = model_factory or self.default_factory
        self._sleep = sleep

    def build(self, settings: ModelSettings) -> Model:
        raise NotImplementedError

    def _function_call(self, call: ToolCall) -> dict:
        """Canonical replay shape; only this provider's replay_keys are carried over from provider data."""
        raw = {"id": call.id, "type": "function",
               "function": {"name": wire_name(call.name), "arguments": _json(call.arguments or {})}}
        raw.update({key: call.provider_data[key] for key in self.replay_keys if call.provider_data.get(key)})
        return raw

    def _message(self, message: UserMessage | AssistantMessage) -> Message | None:
        """One user or assistant message; None when it carries nothing to send."""
        if isinstance(message, AssistantMessage):
            calls = [self._function_call(call) for call in message.tool_calls]
            if not message.text and not calls:
                return None
            return Message(role="assistant", content=message.text, tool_calls=calls or None)
        return Message(role="user", content=message.text)

    def _tool_turns(self, results: list[ToolResultMessage]) -> list[Message]:
        contents = [_json(result.content) for result in results]
        if not self.merge_tool_results:
            return [Message(role="tool", tool_call_id=result.call_id, content=content)
                    for result, content in zip(results, contents, strict=True)]
        return [Message(role="tool", content=contents, tool_calls=[
            {"tool_call_id": result.call_id, "tool_name": wire_name(result.name), "content": content}
            for result, content in zip(results, contents, strict=True)])]

    def to_agno_messages(self, messages: Sequence[ChatMessage]) -> list[Message]:
        """System texts merge into one leading message; tool results follow the provider's turn shape."""
        system = [m.text for m in messages if isinstance(m, SystemMessage)]
        converted = [Message(role="system", content="\n\n".join(system))] if system else []
        pending: list[ToolResultMessage] = []
        for message in messages:
            if isinstance(message, ToolResultMessage):
                pending.append(message)
                continue
            if pending:
                converted.extend(self._tool_turns(pending))
                pending = []
            if isinstance(message, SystemMessage):
                continue
            if (item := self._message(message)) is not None:
                converted.append(item)
        if pending:
            converted.extend(self._tool_turns(pending))
        return converted

    def _reply(self, response, names: dict[str, str]) -> ModelReply | ModelUnavailable:
        calls = []
        for index, raw in enumerate(response.tool_calls or ()):
            name = names.get(raw["function"]["name"], raw["function"]["name"])
            arguments = _arguments(raw["function"].get("arguments"))
            if arguments is None:
                logger.warning("model sent unparseable arguments for tool {}", name)
            calls.append(ToolCall(id=raw.get("id") or f"call_{index}", name=name, arguments=arguments,
                                  provider_data=dict(raw)))
        text = response.content if isinstance(response.content, str) else ""
        if not text.strip() and not calls:
            logger.warning("model returned an empty response")
            return ModelUnavailable("invalid_response", "empty response")
        usage = response.response_usage
        return ModelReply(text=text, tool_calls=tuple(calls),
                          usage=ModelUsage(input_tokens=getattr(usage, "input_tokens", 0) or 0,
                                           output_tokens=getattr(usage, "output_tokens", 0) or 0))

    def invoke(self, messages: Sequence[ChatMessage], tools: Sequence[ToolDefinition],
               settings: ModelSettings) -> ModelReply | ModelUnavailable:
        # Conversion is our own code: a bug here must surface, not masquerade as a provider outage.
        payload = self.to_agno_messages(messages)
        definitions = [_definition(tool) for tool in tools] or None
        names = {wire_name(tool.name): tool.name for tool in tools}
        try:
            model = self.build(settings)
        except Exception as error:  # provider client setup: nothing may raise past the port
            logger.warning("model setup error ({}): {}", settings.model_id, _detail(error))
            return ModelUnavailable("provider_error", _detail(error))
        failure = ModelUnavailable("provider_error")
        for attempt in range(settings.max_retries + 1):
            if attempt:
                self._sleep(RETRY_BACKOFF_MS * 2 ** (attempt - 1) / 1000)
            try:
                response = model.invoke(messages=payload, assistant_message=Message(role="assistant"),
                                        tools=definitions)
            except Exception as error:  # provider boundary: every failure becomes ModelUnavailable
                if _is_timeout(error):
                    logger.warning("model timeout ({}): {}", settings.model_id, _detail(error))
                    return ModelUnavailable("timeout", _detail(error))
                logger.warning("model provider error ({}): {} {}", settings.model_id, _detail(error),
                               str(error)[:200])
                if _status(error) == 429:
                    return ModelUnavailable("rate_limited", _detail(error))
                failure = ModelUnavailable("provider_error", _detail(error))
                if _is_deterministic(error):
                    return failure
                continue
            try:
                return self._reply(response, names)
            except Exception as error:  # malformed provider payload: not retryable
                logger.warning("model invalid response ({}): {}", settings.model_id, type(error).__name__)
                return ModelUnavailable("invalid_response", type(error).__name__)
        return failure
