"""Provider-neutral, synchronous chat model port.

Adapters normalise every provider failure into ModelUnavailable; callers never see provider exceptions.
"""
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

UnavailableReason = Literal["disabled", "not_configured", "timeout", "provider_error", "invalid_response"]


@dataclass(frozen=True)
class SystemMessage:
    text: str


@dataclass(frozen=True)
class UserMessage:
    text: str


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any] | None  # None when the provider sent unparseable arguments
    provider_data: dict[str, Any] = field(default_factory=dict, compare=False)  # opaque, e.g. thought signatures


@dataclass(frozen=True)
class AssistantMessage:
    text: str | None
    tool_calls: tuple[ToolCall, ...] = ()


@dataclass(frozen=True)
class ToolResultMessage:
    call_id: str
    name: str
    content: dict[str, Any]


ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]  # JSON schema object


@dataclass(frozen=True)
class ModelSettings:
    model_id: str
    temperature: float = 0.4
    max_output_tokens: int = 800
    timeout_ms: int = 8000
    max_retries: int = 1


@dataclass(frozen=True)
class ModelUsage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass(frozen=True)
class ModelReply:
    text: str
    tool_calls: tuple[ToolCall, ...] = ()
    usage: ModelUsage = ModelUsage()


@dataclass(frozen=True)
class ModelUnavailable:
    reason: UnavailableReason
    detail: str = ""


class ModelPort(Protocol):
    def invoke(self, messages: Sequence[ChatMessage], tools: Sequence[ToolDefinition],
               settings: ModelSettings) -> ModelReply | ModelUnavailable: ...


class UnconfiguredModel:
    """Provider referenced by a snapshot but not configured in this runtime: callers fall back to templates."""

    def invoke(self, messages, tools, settings) -> ModelUnavailable:
        return ModelUnavailable("not_configured")
