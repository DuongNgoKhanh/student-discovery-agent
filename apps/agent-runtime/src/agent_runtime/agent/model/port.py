"""Provider-neutral, synchronous chat model port.

Adapters normalise every provider failure into ModelUnavailable; callers never see provider exceptions.
Bugs in the caller's own messages (e.g. a non-JSON tool result) still raise.
"""
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

UnavailableReason = Literal["not_configured", "rate_limited", "timeout", "provider_error", "invalid_response"]


RETRY_BACKOFF_MS = 500  # before retry n (1-based): RETRY_BACKOFF_MS * 2 ** (n - 1)


def worst_case_ms(timeout_ms: int, max_retries: int) -> int:
    """Upper bound of one invoke: every attempt times out and every backoff is slept."""
    return timeout_ms * (max_retries + 1) + RETRY_BACKOFF_MS * (2 ** max_retries - 1)


@dataclass(frozen=True)
class SystemMessage:
    text: str


@dataclass(frozen=True)
class UserMessage:
    text: str


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str  # catalog name; may be one the caller never offered, so callers must check it
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
    """Per-call settings; bounds and defaults live in AgentModelConfig (see its settings())."""
    model_id: str
    temperature: float
    max_output_tokens: int
    timeout_ms: int
    max_retries: int


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
    """Provider referenced by a snapshot but not configured here; callers are expected to fall back to templates."""

    def invoke(self, messages, tools, settings) -> ModelUnavailable:
        return ModelUnavailable("not_configured")
