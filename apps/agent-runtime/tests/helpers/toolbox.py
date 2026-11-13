"""A real Toolbox whose tools return scripted results: validation, kinds and the handoff latch stay real."""
from dataclasses import replace
from types import SimpleNamespace

from agent_runtime.tools.kit import TurnWorld
from agent_runtime.tools.registry import TOOLS
from agent_runtime.tools.toolbox import Toolbox


def scripted_toolbox(agent, results=None, *, view=None):
    """``results`` maps a tool name to a mapping, an Answered, or a callable taking the Call (to raise or compute).

    Returns the Toolbox and the list of (name, arguments) calls it ran, in order.
    """
    calls = []
    script = results or {}

    def runner(name):
        def run(call):
            calls.append((name, call.arguments))
            value = script.get(name, {"ok": True})
            return value(call) if callable(value) else value
        return run

    declared = {key: tool if tool.kind == "reply" else replace(tool, run=runner(tool.name))
                for key, tool in TOOLS.items()}
    world = TurnWorld(view or SimpleNamespace(agent=agent, activity=None, result_card=None))
    return Toolbox(world, declared=declared), calls
