from typing import Any

from pydantic import field_validator

from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.workflow.expressions import ExpressionError, evaluate, parse
from agent_runtime.workflow.nodes.base import NodeContext, NodeResult, NodeSpec
from agent_runtime.workflow.registry import register


class IfElseConfig(ContractModel):
    condition: dict[str, Any]

    @field_validator("condition")
    @classmethod
    def safe(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            parse(value)
        except ExpressionError as error:
            raise ValueError(f"{error.code}: {error}") from None
        return value


def run(ctx: NodeContext, config: IfElseConfig) -> NodeResult:
    evaluation = evaluate(parse(config.condition), ctx.scope.get)
    return NodeResult("true" if evaluation.matched else "false", {"matched": evaluation.matched},
                      reason={"parts": evaluation.parts})


register(NodeSpec("if_else", IfElseConfig, lambda config: ("true", "false"),
                  {"type": "object", "properties": {"matched": {"type": "boolean"}}}, run))
