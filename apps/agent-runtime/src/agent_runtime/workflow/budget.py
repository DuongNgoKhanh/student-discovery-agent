"""Per-turn limits (DEC-24): requested by the workflow, clamped by a hard ceiling no snapshot can raise."""
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from agent_runtime.agent.model import (
    ChatMessage,
    ModelPort,
    ModelReply,
    ModelSettings,
    ModelUnavailable,
    ModelUsage,
    TextDeltaSink,
    ToolDefinition,
)
from agent_runtime.sessions.schemas.workflow import WorkflowBudget


@dataclass(frozen=True)
class Ceiling:
    max_nodes: int
    max_llm_calls: int
    turn_timeout_ms: int


HARD_CEILING = Ceiling(max_nodes=40, max_llm_calls=8, turn_timeout_ms=30000)


class BudgetExceeded(Exception):
    def __init__(self, kind: Literal["nodes", "llm_calls", "deadline"]):
        super().__init__(kind)
        self.kind = kind


class Budget:
    def __init__(self, requested: WorkflowBudget, *, clock: Callable[[], float] = time.monotonic,
                 deadline: float | None = None, ceiling: Ceiling = HARD_CEILING):
        self.max_nodes = min(requested.max_nodes, ceiling.max_nodes)
        self.max_llm_calls = min(requested.max_llm_calls, ceiling.max_llm_calls)
        self.clock = clock
        own = clock() + min(requested.turn_timeout_ms, ceiling.turn_timeout_ms) / 1000
        self.deadline = own if deadline is None else min(deadline, own)
        self.nodes = 0
        self.llm_calls = 0
        self.usage = ModelUsage()

    def _check_deadline(self) -> None:
        if self.clock() >= self.deadline:
            raise BudgetExceeded("deadline")

    def start_node(self) -> None:
        self._check_deadline()
        if self.nodes >= self.max_nodes:
            raise BudgetExceeded("nodes")
        self.nodes += 1

    def start_llm_call(self) -> None:
        self._check_deadline()
        if self.llm_calls >= self.max_llm_calls:
            raise BudgetExceeded("llm_calls")
        self.llm_calls += 1

    def add_usage(self, usage: ModelUsage) -> None:
        self.usage = ModelUsage(self.usage.input_tokens + usage.input_tokens,
                                self.usage.output_tokens + usage.output_tokens)

    def counters(self) -> tuple[int, int, int]:
        return self.llm_calls, self.usage.input_tokens, self.usage.output_tokens

    def delta(self, before: tuple[int, int, int]) -> tuple[int, int, int]:
        return tuple(now - was for now, was in zip(self.counters(), before, strict=True))


class BudgetedModel:
    """Every model call of the turn goes through here, whichever node makes it (agent steps included)."""

    def __init__(self, inner: ModelPort, budget: Budget):
        self._inner, self._budget = inner, budget

    def invoke(self, messages: Sequence[ChatMessage], tools: Sequence[ToolDefinition], settings: ModelSettings,
               on_text_delta: TextDeltaSink | None = None) -> ModelReply | ModelUnavailable:
        self._budget.start_llm_call()
        reply = self._inner.invoke(messages, tools, settings, on_text_delta)
        if isinstance(reply, ModelReply):
            self._budget.add_usage(reply.usage)
        return reply
