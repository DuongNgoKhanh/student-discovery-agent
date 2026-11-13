from typing import Any

from pydantic import Field

from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.tools.kit import Answered, HandedOff, Refused
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
    toolbox = ctx.ports.tools
    if toolbox is None:
        raise NodeError("tool_error")
    outcome = toolbox.call(config.tool, {key: _resolve(value, ctx) for key, value in config.arguments.items()},
                           via="node")
    if isinstance(outcome, Refused):
        raise NodeError("invalid_output" if outcome.invalid_arguments else "tool_error")
    if isinstance(outcome, HandedOff):  # outcome.effects are not applied yet: no tool emits one; wiring comes with the effect-commit work
        ctx.state.handoff = outcome.handoff
        return NodeResult("success", dict(outcome.handoff.result), effects=(ActivityChange(outcome.handoff),),
                          reason={"tool": config.tool})
    assert isinstance(outcome, Answered)  # a reply tool is refused for via="node"
    return NodeResult("success", dict(outcome.result), reason={"tool": config.tool})


register(NodeSpec("tool", ToolConfig, lambda config: ("success", "error"),
                  {"type": "object", "additionalProperties": True}, run))
