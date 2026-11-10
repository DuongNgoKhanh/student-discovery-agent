"""Hook events of the executor. Student streams ignore them; debug runs turn them into workflow.* SSE events."""
from dataclasses import dataclass


@dataclass(frozen=True)
class NodeStarted:
    node_id: str
    type: str
    order: int


@dataclass(frozen=True)
class NodeFinished:
    node_id: str
    handle: str | None
    duration_ms: int
    llm_calls: int
    input_tokens: int
    output_tokens: int
    error: str | None = None
