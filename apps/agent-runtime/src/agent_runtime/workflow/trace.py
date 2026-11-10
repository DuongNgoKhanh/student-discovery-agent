"""NodeRun / WorkflowTrace and the redaction policy that decides what a trace may keep (FR-WFL-12, AT-97).

Production traces never keep what the student typed, a rendered prompt or a ``profile.*`` value: node inputs are
dropped, text-bearing outputs keep only their size and condition operands keep only whether a value was present
(enum and boolean conversation variables and a few system values excepted). ``full`` keeps everything and is
only for the Admin's own debug run.
"""
from collections.abc import Mapping
from typing import Annotated, Any, Literal, get_args

from pydantic import Field

from agent_runtime.agent.catalog import TOOL_DECLARATIONS
from agent_runtime.sessions.schemas.common import ContractModel, JsonSafeInt
from agent_runtime.sessions.schemas.workflow import ConvVariable
from agent_runtime.workflow.budget import Budget
from agent_runtime.workflow.executor import NodeRecord, WorkflowRun
from agent_runtime.workflow.nodes.base import ErrorType


class NodeRunTrace(ContractModel):
    node_id: str
    type: str
    order: JsonSafeInt
    handle: str | None
    duration_ms: JsonSafeInt
    reason: dict[str, Any]
    input: Any = None
    output: Any = None
    llm_calls: JsonSafeInt
    tokens: dict[str, JsonSafeInt]
    refs: tuple[str, ...] = ()
    error: str | None = None


class WorkflowTrace(ContractModel):
    mode: Literal["agent", "chatflow"]
    agent_release_id: str | None
    content_hash: str | None
    budget: dict[str, JsonSafeInt]
    fallback_reason: str | None
    last_node: str | None
    node_runs: Annotated[tuple[NodeRunTrace, ...], Field(max_length=50)]
    activity_conflict: bool = False  # an interaction's graph asked for a handoff; the fixed handler won


# Output keys whose values are workflow config or ids, never student text.
_KEEP = {("if_else", "matched"), ("intent_classifier", "label"), ("knowledge_retrieval", "refs"),
         ("profile_propose", "fields"), ("profile_propose", "proposal_id")}
# Values a model or a tool result could also put under these keys: kept only when they are what the engine wrote.
_ERROR_TYPES = frozenset({"", *get_args(ErrorType)})
_HANDOFFS = frozenset(declaration.name for declaration in TOOL_DECLARATIONS.values() if declaration.handoff)
_REASON_KEYS = {"label", "steps", "handoff", "assigned", "tool", "fields", "degraded"}
_SAFE_SYS = {"sys.interaction_outcome", "sys.turn_index", "sys.activity_status"}


class Redaction:
    def __init__(self, mode: Literal["production", "full"], variables: Mapping[str, ConvVariable]):
        if mode not in {"production", "full"}:
            raise ValueError("redaction mode must be production or full")
        self.mode, self._variables = mode, variables

    @property
    def full(self) -> bool:
        return self.mode == "full"

    def _operand(self, path: str | None, value: Any) -> dict[str, Any]:
        if path is None:
            return {"path": None, "value": _plain(value)}  # a literal from the workflow's own config
        if self.full:
            return {"path": path, "value": _plain(value)}
        if path.startswith("conv.") and isinstance(value, bool):
            return {"path": path, "value": value}  # numbers are not kept: a profile or model number may be copied in
        variable = self._variables.get(path.removeprefix("conv.")) if path.startswith("conv.") else None
        if (variable is not None and variable.type == "enum") or path in _SAFE_SYS:
            return {"path": path, "value": _plain(value)}
        return {"path": path, "present": value is not None}

    def reason(self, record: NodeRecord) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, value in record.reason.items():
            if key == "parts":
                out["parts"] = [{"operator": part.operator, "matched": part.matched,
                                 "operands": [self._operand(path, operand) for path, operand in part.operands]}
                                for part in value]
            elif key in _REASON_KEYS or self.full:
                out[key] = _plain(value)
        return out

    def input(self, value: Any) -> Any:
        # Inputs are rendered student text (queries, classifier/extractor messages): never kept in production.
        return _plain(value) if self.full else None

    def io(self, node_type: str, value: Any) -> Any:
        if value is None or self.full:
            return _plain(value)
        if isinstance(value, Mapping):
            return {str(key): (_plain(item) if _kept(node_type, key, item) else _shrink(item))
                    for key, item in value.items()}
        return _shrink(value)


def _kept(node_type: str, key: Any, value: Any) -> bool:
    if (node_type, key) in _KEEP:
        return True
    if key == "error_type":
        return isinstance(value, str) and value in _ERROR_TYPES
    if key == "handoff" and node_type == "agent":
        return value is None or (isinstance(value, str) and value in _HANDOFFS)
    return False


def _plain(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_plain(item) for item in value]
    return value


def _shrink(value: Any) -> Any:
    if isinstance(value, str):
        return {"chars": len(value)}
    if isinstance(value, list | tuple):
        return {"items": len(value)}
    if isinstance(value, Mapping):
        return {"keys": len(value)}
    return None if value is None else {"kind": type(value).__name__}


def build_trace(run: WorkflowRun, *, redaction: Redaction, agent_release_id: str | None, content_hash: str | None,
                mode: Literal["agent", "chatflow"], budget: Budget, activity_conflict: bool = False) -> WorkflowTrace:
    """``budget`` must be the Budget the run used, so its counters are this turn's."""
    runs = tuple(NodeRunTrace(
        node_id=record.node_id, type=record.type, order=record.order, handle=record.handle,
        duration_ms=record.duration_ms, reason=redaction.reason(record), input=redaction.input(record.input),
        output=redaction.io(record.type, record.output), llm_calls=record.llm_calls,
        tokens={"input": record.tokens[0], "output": record.tokens[1]}, refs=record.refs, error=record.error)
        for record in run.records)
    return WorkflowTrace(mode=mode, agent_release_id=agent_release_id, content_hash=content_hash,
                         budget={"nodes": budget.nodes, "llm_calls": budget.llm_calls, "max_nodes": budget.max_nodes,
                                 "max_llm_calls": budget.max_llm_calls},
                         fallback_reason=run.fallback, last_node=run.last_node, node_runs=runs,
                         activity_conflict=activity_conflict)
