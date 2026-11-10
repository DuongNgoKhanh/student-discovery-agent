from typing import Annotated, Any, Literal

from pydantic import Field, StringConstraints, model_validator

from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.sessions.schemas.workflow import value_fits
from agent_runtime.workflow.effects import AssignConv
from agent_runtime.workflow.nodes.base import NodeContext, NodeError, NodeResult, NodeSpec
from agent_runtime.workflow.registry import register
from agent_runtime.workflow.templates import render


class Assignment(ContractModel):
    variable: Annotated[str, StringConstraints(pattern=r"^conv\.[a-z][a-z0-9_]{0,39}$")]
    operation: Literal["set", "append", "clear", "add"] = "set"
    value: Any = None

    @model_validator(mode="after")
    def needs_value(self) -> "Assignment":
        if self.operation != "clear" and "value" not in self.model_fields_set:
            raise ValueError("value is required unless the operation is clear")
        return self


class AssignConfig(ContractModel):
    assignments: Annotated[tuple[Assignment, ...], Field(min_length=1)]


def _resolve(value: Any, ctx: NodeContext) -> Any:
    if isinstance(value, dict) and set(value) == {"var"} and isinstance(value["var"], str):
        return ctx.scope.get(value["var"])
    if isinstance(value, str):
        return render(value, ctx.scope.get)
    return value


def _number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _new_value(item: Assignment, variable, current: Any, resolved: Any) -> Any:
    if item.operation == "clear":
        return variable.default
    if item.operation == "append":
        if variable.type != "string_list" or not isinstance(resolved, str) or not isinstance(current, list):
            raise NodeError("invalid_output")
        return current if resolved in current else [*current, resolved]
    if item.operation == "add":
        if variable.type != "number" or not _number(resolved) or not _number(current):
            raise NodeError("invalid_output")
        return current + resolved
    return resolved


def run(ctx: NodeContext, config: AssignConfig) -> NodeResult:
    pending: dict[str, Any] = {}  # computed first and applied together, so a failing item leaves the scope untouched
    effects = []
    for item in config.assignments:
        name = item.variable.removeprefix("conv.")
        variable = ctx.scope.variable(name)
        if variable is None:
            raise NodeError("invalid_output")
        current = pending[name] if name in pending else ctx.scope.get(item.variable)
        new = _new_value(item, variable, current, _resolve(item.value, ctx))
        if not value_fits(variable.type, new, variable.values):
            raise NodeError("invalid_output")
        pending[name] = new
        effects.append(AssignConv(name, new, item.operation))
    for name, value in pending.items():
        ctx.scope.assign(name, value)
    return NodeResult("next", effects=tuple(effects), reason={"assigned": [effect.variable for effect in effects]})


register(NodeSpec("assign", AssignConfig, lambda config: ("next",), {"type": "object", "properties": {}}, run))
