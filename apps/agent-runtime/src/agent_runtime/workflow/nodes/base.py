"""Node contract: a node reads the scope, calls ports, and returns a result; it never writes anywhere."""
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from agent_runtime.agent.loop import Handoff
from agent_runtime.agent.model import ModelPort
from agent_runtime.sessions.schemas.activity import TypedBlock
from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.sessions.schemas.workflow import WorkflowNode
from agent_runtime.tools.knowledge import KnowledgeTools
from agent_runtime.workflow.budget import Budget
from agent_runtime.workflow.effects import Effect
from agent_runtime.workflow.scope import Scope

if TYPE_CHECKING:
    from agent_runtime.workflow.ports import Ports

ErrorType = Literal["model_unavailable", "invalid_output", "tool_error", "kb_unavailable"]


class NodeError(Exception):
    """A typed node failure. ``cause`` carries the agent loop's own fallback reason when there is one."""

    def __init__(self, error_type: ErrorType, *, cause: str | None = None):
        super().__init__(error_type)
        self.error_type = error_type
        self.cause = cause


class NodeCancelled(Exception):
    """The student or the server abandoned the turn; nothing is committed."""


@dataclass
class RunState:
    blocks_by_node: list[tuple[str, tuple[TypedBlock, ...]]] = field(default_factory=list)
    knowledge: dict[str, KnowledgeTools] = field(default_factory=dict)
    handoff: Handoff | None = None
    live: set[str] = field(default_factory=set)  # nodes whose tokens may stream straight to the student
    streamed: set[str] = field(default_factory=set)
    agent_steps: int = 0


@dataclass(frozen=True)
class NodeContext:
    node: WorkflowNode
    scope: Scope
    ports: "Ports"
    model: ModelPort | None  # budgeted; None in unit tests of nodes that never call a model
    budget: Budget
    state: RunState
    new_id: Callable[[], str]
    emit: Callable[[Any], None]
    should_stop: Callable[[], bool]
    streaming: bool = False


@dataclass(frozen=True)
class NodeResult:
    handle: str | None  # None ends the branch (answer)
    output: Mapping[str, Any] = field(default_factory=dict)
    effects: tuple[Effect, ...] = ()
    reason: Mapping[str, Any] = field(default_factory=dict)
    blocks: tuple[TypedBlock, ...] = ()
    refs: tuple[str, ...] = ()
    input: Any = None


@dataclass(frozen=True)
class NodeSpec:
    type: str
    config_model: type[ContractModel]
    handles: Callable[[Any], tuple[str, ...]]
    output_schema: Mapping[str, Any]
    run: Callable[[NodeContext, Any], NodeResult]
