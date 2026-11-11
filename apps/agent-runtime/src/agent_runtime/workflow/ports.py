"""Everything a node may call. Nothing here touches the database."""
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from agent_runtime.agent.catalog import NO_CONTEXT, KnowledgeShowParams, ToolContext
from agent_runtime.agent.knowledge_tools import KnowledgePort
from agent_runtime.agent.loop import ToolExecutor
from agent_runtime.agent.model import ChatMessage, ModelPort, UnconfiguredModel
from agent_runtime.agent.prompt import AgentContext
from agent_runtime.knowledge.schemas import MetadataField
from agent_runtime.sessions.schemas.release import AgentSnapshotV1


class ProfilePort(Protocol):
    def snapshot(self) -> Mapping[str, Any]:
        """The Student Profile as captured at preflight; fields not set are absent."""

    def accept(self, fields: Mapping[str, Any]) -> Mapping[str, Any]:
        """The subset of model-extracted values that are valid profile values (at most two)."""


class NullProfilePort:
    """No Student Profile exists in the runtime yet: nothing is known and nothing is accepted."""

    def snapshot(self) -> Mapping[str, Any]:
        return {}

    def accept(self, fields: Mapping[str, Any]) -> Mapping[str, Any]:
        return {}


@dataclass(frozen=True)
class Ports:
    agent: AgentSnapshotV1
    model: ModelPort = UnconfiguredModel()
    model_for: Callable[[str], ModelPort] | None = None  # per node id; debug runs stub model nodes here
    tools: ToolExecutor | None = None
    tool_context: ToolContext = NO_CONTEXT
    knowledge: KnowledgePort | None = None
    knowledge_fields: Mapping[str, tuple[MetadataField, ...]] = field(default_factory=dict)
    show_params: KnowledgeShowParams | None = None
    profile: ProfilePort = NullProfilePort()
    agent_context: AgentContext | None = None
    history: Sequence[ChatMessage] = ()
    user_text: str = ""

    def model_of(self, node_id: str) -> ModelPort:
        return self.model_for(node_id) if self.model_for else self.model
