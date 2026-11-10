"""One turn of a workflow: node by node along the edges, effects gathered, nothing committed here (QT-05, QT-17)."""
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal
from uuid import uuid4

from pydantic import ValidationError

from agent_runtime.agent.loop import Fallback, Handoff, fallback_blocks
from agent_runtime.agent.model import ModelUsage
from agent_runtime.sessions.schemas.activity import TypedBlock
from agent_runtime.sessions.schemas.workflow import Workflow
from agent_runtime.workflow import nodes as _nodes  # noqa: F401  (registers the node types)
from agent_runtime.workflow.budget import Budget, BudgetedModel, BudgetExceeded
from agent_runtime.workflow.effects import Effect
from agent_runtime.workflow.events import NodeFinished, NodeStarted
from agent_runtime.workflow.nodes.base import NodeCancelled, NodeContext, NodeError, RunState
from agent_runtime.workflow.ports import Ports
from agent_runtime.workflow.registry import get as get_spec
from agent_runtime.workflow.scope import Scope

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class NodeRecord:
    """Raw, unredacted record of one node run; ``trace.py`` decides what may be stored."""
    node_id: str
    type: str
    order: int
    handle: str | None
    duration_ms: int
    reason: dict[str, Any]
    input: Any
    output: Any
    llm_calls: int
    tokens: tuple[int, int]
    refs: tuple[str, ...]
    error: str | None


@dataclass(frozen=True)
class WorkflowRun:
    status: Literal["completed", "fallback", "cancelled"]
    records: tuple[NodeRecord, ...]
    blocks: tuple[TypedBlock, ...]
    effects: tuple[Effect, ...]
    conv: dict[str, Any]
    handoff: Handoff | None = None
    fallback: Fallback | None = None
    agent_steps: int = 0
    llm_calls: int = 0
    usage: ModelUsage = ModelUsage()

    @property
    def path(self) -> tuple[str, ...]:
        return tuple(record.node_id for record in self.records)

    @property
    def last_node(self) -> str | None:
        return self.records[-1].node_id if self.records else None


class _Fallback(Exception):
    def __init__(self, cause: str | None):
        super().__init__(cause)
        self.cause = cause


def _passes_through(answer, source: str) -> bool:
    if answer is None or answer.type != "answer":
        return False
    text = re.sub(r"\s+", "", str(answer.config.get("text", "")))
    kinds = [block.get("type") for block in answer.config.get("blocks", [])]
    return (text == "" and kinds == ["upstream"]) or (text == "{{" + source + ".text}}" and not kinds)


def _live_nodes(workflow: Workflow) -> set[str]:
    """agent/llm nodes whose every non-error edge leads to an answer that only repeats their text."""
    by_id = {node.id: node for node in workflow.nodes}
    live = set()
    for node in workflow.nodes:
        if node.type not in {"agent", "llm"}:
            continue
        targets = [edge.target for edge in workflow.edges if edge.source == node.id and edge.source_handle != "error"]
        if targets and all(_passes_through(by_id.get(target), node.id) for target in targets):
            live.add(node.id)
    return live


def run_workflow(workflow: Workflow, scope: Scope, ports: Ports, *, budget: Budget,
                 new_id: Callable[[], str] = lambda: uuid4().hex, on_event: Callable[[Any], None] | None = None,
                 should_stop: Callable[[], bool] | None = None, implicit: bool = False) -> WorkflowRun:
    emit = on_event or (lambda event: None)
    stop = should_stop or (lambda: False)
    nodes = {node.id: node for node in workflow.nodes}
    edges = {(edge.source, edge.source_handle): edge.target for edge in workflow.edges}
    state = RunState(live={"agent"} if implicit else _live_nodes(workflow))
    initial_conv = scope.conv_values()
    records: list[NodeRecord] = []
    effects: list[Effect] = []
    final: tuple[TypedBlock, ...] = ()
    reason: Fallback | None = None
    current: str | None = workflow.entry
    try:
        while current is not None:
            if stop():
                raise NodeCancelled()
            node = nodes[current]
            budget.start_node()
            spec = get_spec(node.type)
            order = len(records) + 1
            emit(NodeStarted(node.id, node.type, order))
            started, before = budget.clock(), budget.counters()
            config = result = error = None
            try:
                config = spec.config_model.model_validate(node.config)
                ctx = NodeContext(node=node, scope=scope, ports=ports,
                                  model=BudgetedModel(ports.model_of(node.id), budget), budget=budget, state=state,
                                  new_id=new_id, emit=emit, should_stop=stop, streaming=on_event is not None)
                result = spec.run(ctx, config)
            except NodeError as caught:
                error = caught
            except ValidationError:
                error = NodeError("invalid_output", cause="invalid_config")
            except (BudgetExceeded, NodeCancelled, Exception) as interrupted:
                # Keep the node that was running in the trace, then let the outer handlers decide the outcome.
                code = ("budget" if isinstance(interrupted, BudgetExceeded)
                        else "cancelled" if isinstance(interrupted, NodeCancelled) else "unexpected")
                calls, tokens_in, tokens_out = budget.delta(before)
                duration = int((budget.clock() - started) * 1000)
                records.append(NodeRecord(node.id, node.type, order, None, duration, {}, None, None, calls,
                                          (tokens_in, tokens_out), (), code))
                emit(NodeFinished(node.id, None, duration, calls, tokens_in, tokens_out, code))
                raise
            calls, tokens_in, tokens_out = budget.delta(before)
            duration = int((budget.clock() - started) * 1000)
            handles = spec.handles(config) if config is not None else ()
            if error is not None:
                target = edges.get((node.id, "error")) if "error" in handles else None
                handle = "error" if target else None
                records.append(NodeRecord(node.id, node.type, order, handle, duration, {}, None, None, calls,
                                          (tokens_in, tokens_out), (), error.error_type))
                emit(NodeFinished(node.id, handle, duration, calls, tokens_in, tokens_out, error.error_type))
                if target is None:
                    raise _Fallback(error.cause)
                scope.set_output(node.id, {"error_type": error.error_type})
                current = target
                continue
            output = dict(result.output)
            if "error" in handles:
                output.setdefault("error_type", "")
            scope.set_output(node.id, output)
            effects.extend(result.effects)
            if result.blocks:
                state.blocks_by_node.append((node.id, result.blocks))
            records.append(NodeRecord(node.id, node.type, order, result.handle, duration, dict(result.reason),
                                      result.input, output, calls, (tokens_in, tokens_out), result.refs, None))
            emit(NodeFinished(node.id, result.handle, duration, calls, tokens_in, tokens_out))
            if result.handle is None:
                final, current = result.blocks, None
            else:
                current = edges.get((node.id, result.handle))
                if current is None:
                    raise _Fallback(None)
    except NodeCancelled:
        return WorkflowRun("cancelled", tuple(records), (), (), initial_conv, None, None, state.agent_steps,
                           budget.llm_calls, budget.usage)
    except BudgetExceeded as exceeded:
        reason = "deadline" if implicit and exceeded.kind == "deadline" else "workflow_budget"
    except _Fallback as caught:
        reason = caught.cause if implicit and caught.cause else "workflow_node_error"
    except Exception as unexpected:
        # The traceback may name the node and exception type; never log scope values or student text here.
        logger.exception("workflow turn failed at node %s (%s)", current, type(unexpected).__name__)
        reason = "workflow_node_error"
    if reason is not None:
        return WorkflowRun("fallback", tuple(records), fallback_blocks(ports.agent, reason, new_id), (), initial_conv,
                           None, reason, state.agent_steps, budget.llm_calls, budget.usage)
    return WorkflowRun("completed", tuple(records), final, tuple(effects), scope.conv_values(), state.handoff, None,
                       state.agent_steps, budget.llm_calls, budget.usage)
