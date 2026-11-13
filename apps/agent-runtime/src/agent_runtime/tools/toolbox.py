"""The tools one turn may use, plus the release-level reference check."""
import logging
from collections.abc import Callable, Collection, Mapping
from typing import Any, Literal

from pydantic import ValidationError

from agent_runtime.agent.model import ToolDefinition
from agent_runtime.sessions.services.message_turns import MessagePlan
from agent_runtime.tools.kit import (
    Answered,
    Call,
    HandedOff,
    Handoff,
    Kind,
    Outcome,
    Ref,
    RefPorts,
    Refused,
    Replied,
    Settle,
    Tool,
    ToolError,
    TurnWorld,
    json_schema,
)
from agent_runtime.tools.registry import TOOLS

logger = logging.getLogger(__name__)

Declared = Mapping[tuple[str, int], Tool]


def problems(error: ValidationError) -> str:
    return "; ".join(f"{'.'.join(map(str, item['loc'])) or '<root>'}: {item['msg']}" for item in error.errors())


class Toolbox:
    """Exactly the pinned release's bindings; nothing else is reachable. One Toolbox per turn."""

    def __init__(self, world: TurnWorld, declared: Declared = TOOLS):
        self._world = world
        self._bound = {binding.name: (declared[(binding.name, binding.version)], binding)
                       for binding in world.view.agent.tools}
        self._params: dict[str, Any] = {}
        self._states: dict[str, Any] = {}
        self._handoff: Handoff | None = None

    def kind(self, name: str) -> Kind | None:
        entry = self._bound.get(name)
        return entry[0].kind if entry else None

    def offer(self, only: Collection[str] | None = None) -> tuple[ToolDefinition, ...]:
        definitions = []
        for name, (tool, binding) in self._bound.items():
            if only is not None and name not in only:
                continue
            params, state = self._parsed(name), self._state(tool)
            text = binding.description or tool.description
            extra = tool.detail(params, state) if tool.detail else ""
            parameters = tool.schema(params, state) if tool.schema else json_schema(tool.arguments)
            definitions.append(ToolDefinition(name=name, description=f"{text} {extra}" if extra else text,
                                              parameters=parameters))
        return tuple(definitions)

    def call(self, name: str, arguments: Mapping[str, Any] | None, *, via: Literal["model", "node"] = "model",
             offered: Collection[str] | None = None, announce: Callable[[str], None] | None = None) -> Outcome:
        entry = self._bound.get(name)
        if entry is None or (offered is not None and name not in offered):
            return Refused({"error": "unknown_tool"})
        tool = entry[0]
        if self._handoff is not None:
            return Refused({"error": "turn_ended"})
        if tool.kind == "reply" and via == "node":
            return Refused({"error": "not_callable_here"})
        if arguments is None:
            return Refused({"error": "invalid_arguments: not a JSON object"}, invalid_arguments=True)
        try:
            parsed = tool.arguments.model_validate(arguments)
        except ValidationError as error:
            return Refused({"error": f"invalid_arguments: {problems(error)}"}, invalid_arguments=True)
        if announce is not None and tool.kind != "handoff":
            announce(name)
        if tool.kind == "reply":
            return Replied(parsed)
        try:
            out = tool.run(Call(self._parsed(name), parsed, self._world.view, self._state(tool)))
        except ToolError as refusal:
            return Refused(refusal.result)
        except Exception as error:  # a tool never fails the turn: the model sees an error result instead
            logger.warning("tool %s failed: %s", name, type(error).__name__)
            return Refused({"error": tool.group.unavailable if tool.group else "tool_unavailable"})
        answered = out if isinstance(out, Answered) else Answered(dict(out))
        if "error" in answered.result:
            return Refused(dict(answered.result))
        if tool.kind == "handoff":
            self._handoff = Handoff(name, parsed, dict(answered.result))
            return HandedOff(self._handoff, answered.effects)
        return answered

    def trace(self) -> tuple[dict[str, Any], ...]:
        return tuple(entry for state in self._states.values() if hasattr(state, "trace") for entry in state.trace())

    def _parsed(self, name: str) -> Any:
        if name not in self._params:
            tool, binding = self._bound[name]
            self._params[name] = tool.params.model_validate(binding.params)
        return self._params[name]

    def _state(self, tool: Tool) -> Any:
        if tool.group is None:
            return None
        if tool.group.name not in self._states:
            self._states[tool.group.name] = tool.group.open(self._world)
        return self._states[tool.group.name]


def open_turn(world: TurnWorld) -> Toolbox:
    return Toolbox(world)


def check(agent: Any, ports: RefPorts, declared: Declared = TOOLS) -> tuple[Ref, ...]:
    """Reference issues of every binding whose tool has a ``refs`` hook, in binding order."""
    issues: list[Ref] = []
    for index, binding in enumerate(agent.tools):
        tool = declared[(binding.name, binding.version)]
        if tool.refs is None:
            continue
        params = tool.params.model_validate(binding.params)
        issues.extend(Ref(f"tools[{index}].params.{ref.path}", ref.code, ref.message)
                      for ref in tool.refs(params, ports, agent))
    return tuple(issues)


def settle(snapshot: Any, handoff: Handoff | None, blocks: tuple, request: Any, *, handler: Any, persistence: Any,
           declared: Declared = TOOLS) -> MessagePlan:
    """The activity change a handoff asks for, rendered after the agent's own blocks; outside any transaction."""
    if handoff is None:
        return MessagePlan(blocks)
    binding = snapshot.agent.tool(handoff.name)
    tool = declared[(binding.name, binding.version)]
    return tool.settle(Settle(handoff, tool.params.model_validate(binding.params), snapshot, blocks, request,
                              handler, persistence))
