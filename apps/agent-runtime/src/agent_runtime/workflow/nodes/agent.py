"""The agent loop as a node: the model may call the tools the node lists; a handoff tool ends it on ``handoff``."""
from datetime import date
from typing import Annotated

from pydantic import Field

from agent_runtime.agent.knowledge_tools import with_cards
from agent_runtime.agent.loop import ToolCallStarted, run_agent_turn
from agent_runtime.agent.prompt import AgentContext
from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.workflow.budget import BudgetExceeded
from agent_runtime.workflow.effects import ActivityChange
from agent_runtime.workflow.nodes.base import NodeCancelled, NodeContext, NodeError, NodeResult, NodeSpec
from agent_runtime.workflow.registry import register

ALL_TOOLS = ("*",)  # the implicit graph's agent sees every enabled tool; explicit nodes must list theirs
_UNAVAILABLE = {"not_configured", "rate_limited", "timeout", "provider_error", "invalid_response", "deadline"}


class AgentConfig(ContractModel):
    instructions: str = ""
    tools: tuple[str, ...] = Field(default=(), json_schema_extra={"x-widget": "tool_picker"})
    max_tool_steps: Annotated[int, Field(strict=True, ge=1, le=8)] | None = None


def _text_of(blocks) -> str:
    return "\n\n".join(block.content for block in blocks if block.type in {"text", "markdown"})


def _view(snapshot, config: AgentConfig):
    """The snapshot as this node's agent sees it: its own tools, step limit and extra instructions."""
    enabled = {binding.name for binding in snapshot.tools}
    names = enabled if config.tools == ALL_TOOLS else enabled & set(config.tools)
    steps = min(config.max_tool_steps or snapshot.limits.max_tool_steps, snapshot.limits.max_tool_steps)
    instructions = config.instructions.strip()
    if names == enabled and steps == snapshot.limits.max_tool_steps and not instructions:
        return snapshot  # the implicit graph: exactly what mode = agent has always run
    persona = snapshot.persona
    if instructions:
        persona = persona.model_copy(update={"system_prompt": f"{persona.system_prompt}\n\n{instructions}"})
    return snapshot.model_copy(update={
        "tools": tuple(binding for binding in snapshot.tools if binding.name in names), "persona": persona,
        "limits": snapshot.limits.model_copy(update={"max_tool_steps": steps})})


def run(ctx: NodeContext, config: AgentConfig) -> NodeResult:
    ports = ctx.ports
    live = ctx.node.id in ctx.state.live

    def forward(event) -> None:
        if live or isinstance(event, ToolCallStarted):
            ctx.emit(event)

    if live and ctx.streaming:
        ctx.state.streamed.add(ctx.node.id)
    calls_before = ctx.budget.llm_calls
    cards_of = getattr(ports.tools, "cards", lambda: ())
    # The executor's cards are per turn (the last knowledge.show's): an earlier agent node's are not this node's.
    cards_before = cards_of()
    try:
        turn = run_agent_turn(_view(ports.agent, config), ctx.model, ports.tools,
                              ports.agent_context or AgentContext(today=date.today()), ports.history,
                              ports.user_text, new_id=ctx.new_id, on_event=forward if ctx.streaming else None,
                              should_stop=ctx.should_stop, deadline=ctx.budget.deadline, clock=ctx.budget.clock,
                              tool_context=ports.tool_context)
    except BudgetExceeded:
        # The turn budget stopped the loop mid-step: every model call it made so far was one agent step.
        ctx.state.agent_steps += ctx.budget.llm_calls - calls_before
        raise
    ctx.state.agent_steps += turn.steps
    if turn.cancelled:
        raise NodeCancelled()
    if turn.fallback is not None:
        raise NodeError("model_unavailable" if turn.fallback in _UNAVAILABLE else "invalid_output",
                        cause=turn.fallback)
    cards = cards_of()
    blocks = with_cards(turn.blocks, () if cards is cards_before else cards)
    output = {"text": _text_of(blocks), "handoff": turn.handoff.name if turn.handoff else None}
    if turn.handoff is not None:
        ctx.state.handoff = turn.handoff
        return NodeResult("handoff", output, effects=(ActivityChange(turn.handoff),), blocks=blocks,
                          reason={"steps": turn.steps, "handoff": turn.handoff.name})
    return NodeResult("success", output, blocks=blocks, reason={"steps": turn.steps})


register(NodeSpec("agent", AgentConfig, lambda config: ("success", "handoff", "error"),
                  {"type": "object", "properties": {"text": {"type": "string"}, "handoff": {"type": "string"}}}, run))
