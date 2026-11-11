from typing import Any

from pydantic import Field, ValidationError

from agent_runtime.agent.catalog import TOOL_DECLARATIONS, SuggestRepliesArguments
from agent_runtime.agent.loop import Handoff
from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.workflow.effects import ActivityChange
from agent_runtime.workflow.nodes.base import NodeContext, NodeError, NodeResult, NodeSpec
from agent_runtime.workflow.registry import register
from agent_runtime.workflow.templates import render


class ToolConfig(ContractModel):
    tool: str = Field(json_schema_extra={"x-widget": "tool_picker"})
    arguments: dict[str, Any] = {}


def _resolve(value: Any, ctx: NodeContext) -> Any:
    if isinstance(value, dict) and set(value) == {"var"} and isinstance(value["var"], str):
        return ctx.scope.get(value["var"])
    return render(value, ctx.scope.get) if isinstance(value, str) else value


def run(ctx: NodeContext, config: ToolConfig) -> NodeResult:
    binding = ctx.ports.agent.tool(config.tool)
    if binding is None or ctx.ports.tools is None:
        raise NodeError("tool_error")
    declaration = TOOL_DECLARATIONS[(binding.name, binding.version)]
    if declaration.arguments_model is SuggestRepliesArguments:
        raise NodeError("tool_error")  # suggestions are an answer block, not a tool call
    try:
        arguments = declaration.arguments_model.model_validate(
            {key: _resolve(value, ctx) for key, value in config.arguments.items()})
    except ValidationError:
        raise NodeError("invalid_output") from None
    result = dict(ctx.ports.tools.execute(binding.name, arguments))
    if "error" in result:
        raise NodeError("tool_error")
    if declaration.handoff:
        handoff = Handoff(binding.name, arguments, result)
        ctx.state.handoff = handoff
        return NodeResult("success", result, effects=(ActivityChange(handoff),), reason={"tool": binding.name})
    return NodeResult("success", result, reason={"tool": binding.name})


register(NodeSpec("tool", ToolConfig, lambda config: ("success", "error"),
                  {"type": "object", "additionalProperties": True}, run))
