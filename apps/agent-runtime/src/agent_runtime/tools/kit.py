"""What a tool module declares and what one Toolbox call returns.

Tools are code-owned (QT-14): a release only binds a declared tool, fills its params and may override its
description. Nothing here touches the database or imports the workflow engine.
"""
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal, Protocol

from pydantic import BaseModel

from agent_runtime.knowledge.schemas import MetadataField
from agent_runtime.sessions.schemas.common import ContractModel

if TYPE_CHECKING:  # activity imports release; release lazily imports the tool modules, which import this one
    from agent_runtime.sessions.schemas.activity import TypedBlock
    from agent_runtime.sessions.schemas.release import AgentSnapshotV1

Kind = Literal["query", "handoff", "reply"]


class NoParams(ContractModel):
    pass


class ToolError(Exception):
    """Raised by a tool to refuse a call; the model sees ``{"error": code, **detail}`` and may recover."""

    def __init__(self, code: str, **detail: Any):
        super().__init__(code)
        self.result: dict[str, Any] = {"error": code, **detail}


@dataclass(frozen=True)
class Handoff:
    name: str
    arguments: ContractModel
    result: Mapping[str, Any]


@dataclass(frozen=True)
class Answered:
    result: Mapping[str, Any]
    blocks: "tuple[TypedBlock, ...]" = ()  # server-built blocks of this call, e.g. knowledge cards
    effects: tuple[Any, ...] = ()  # workflow.effects.Effect values; no tool emits one yet


@dataclass(frozen=True)
class HandedOff:
    handoff: Handoff
    effects: tuple[Any, ...] = ()


@dataclass(frozen=True)
class Replied:
    arguments: ContractModel  # a reply tool is never run: its arguments become an answer block


@dataclass(frozen=True)
class Refused:
    error: Mapping[str, Any]
    invalid_arguments: bool = False


Outcome = Answered | HandedOff | Replied | Refused


class ToolView(Protocol):
    """What a tool reads of the turn. MessageSnapshot satisfies it; debug runs pass a duck-typed stand-in."""

    @property
    def agent(self) -> "AgentSnapshotV1": ...

    @property
    def activity(self) -> Any: ...

    @property
    def result_card(self) -> Mapping[str, Any] | None: ...


@dataclass(frozen=True)
class TurnWorld:
    view: ToolView
    knowledge: Any = None  # tools.knowledge.KnowledgePort; only the knowledge group reads it
    # Metadata fields per knowledge base, read once per turn outside any transaction.
    knowledge_fields: Mapping[str, tuple[MetadataField, ...]] = field(default_factory=dict)


@dataclass(frozen=True)
class Call:
    params: Any  # the binding's params, parsed with the tool's params model
    arguments: Any  # validated with the tool's arguments model before the tool runs
    view: ToolView
    state: Any  # the tool group's per-turn state, or None


@dataclass(frozen=True)
class Group:
    """Tools whose results relate within one turn share one state, opened on first use (refs: QT-13)."""
    name: str
    open: Callable[[TurnWorld], Any]
    unavailable: str = "tool_unavailable"  # error code when one of the group's tools raises unexpectedly


@dataclass(frozen=True)
class Ref:
    path: str  # relative to the binding's params; check() prefixes tools[i].params
    code: str
    message: str


class RefPorts(Protocol):
    def experience_exists(self, experience_id: str, algorithm_profile: str | None) -> bool:
        """False when not configured; raises on a release-source outage."""

    def kb_fields(self, kb_id: str) -> frozenset[str] | None:
        """Field names of a knowledge base; None when it does not exist."""


@dataclass(frozen=True)
class Settle:
    """Everything a handoff tool needs to render the next server block; runs outside any transaction."""
    handoff: Handoff
    params: Any
    snapshot: Any  # sessions.services.message_turns.MessageSnapshot
    blocks: "tuple[TypedBlock, ...]"  # the agent's own blocks, rendered before the handoff block
    request: Any  # MessageTurnInput
    handler: Any  # TurnHandler
    persistence: Any  # ActivityPersistence


@dataclass(frozen=True)
class Tool:
    name: str
    version: int
    kind: Kind
    label: str  # Studio tool picker
    summary: str  # Studio tool picker
    description: str  # what the model reads unless the binding overrides it
    params: type[BaseModel] = NoParams  # what Studio fills
    arguments: type[ContractModel] = NoParams  # what the model fills
    run: Callable[[Call], Mapping[str, Any] | Answered] | None = None
    detail: Callable[[Any, Any], str] | None = None  # (params, group state) -> extra description
    schema: Callable[[Any, Any], dict] | None = None  # (params, group state) -> arguments JSON schema
    settle: Callable[[Settle], Any] | None = None  # handoff only -> MessagePlan
    refs: Callable[[Any, RefPorts, Any], Iterable[Ref]] | None = None  # (params, ports, agent snapshot)
    group: Group | None = None
    editor: str | None = None  # Studio params editor; None: "none" without params, else "json"

    def __post_init__(self):
        if (self.kind == "reply") != (self.run is None):
            raise ValueError(f"{self.name}: a reply tool has no run; every other tool has one")
        if (self.kind == "handoff") != (self.settle is not None):
            raise ValueError(f"{self.name}: settle is required for a handoff tool and only for one")


def json_schema(model: type[BaseModel]) -> dict:
    """Provider-safe JSON schema: $refs inlined; title, default and additionalProperties dropped (Gemini rejects them)."""
    raw = model.model_json_schema()
    definitions = raw.pop("$defs", {})

    def clean(node):
        if isinstance(node, list):
            return [clean(item) for item in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            return clean(definitions[node["$ref"].rsplit("/", 1)[-1]])
        return {key: clean(value) for key, value in node.items()
                if key not in {"title", "default", "additionalProperties"}}

    return clean(raw)
