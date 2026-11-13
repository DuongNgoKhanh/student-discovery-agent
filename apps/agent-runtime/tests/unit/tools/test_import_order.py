"""Import cycles show up only for some entry points, so import each one first in a fresh interpreter."""
import subprocess
import sys
from pathlib import Path

import pytest

TOOLS_DIR = Path(__file__).resolve().parents[3] / "src/agent_runtime/tools"
ENTRY_POINTS = ["agent_runtime.tools.registry", "agent_runtime.tools.toolbox", "agent_runtime.workflow.trace",
                "agent_runtime.workflow.validator", "agent_runtime.sessions.services.message_turns",
                "agent_runtime.sessions.schemas.release", "agent_runtime.agent.validation",
                "agent_runtime.sessions.services.turns", "agent_runtime.main"]


@pytest.mark.parametrize("first", ENTRY_POINTS)
def test_every_entry_point_imports_first_without_a_cycle(first):
    subprocess.run([sys.executable, "-c", f"import {first}; import agent_runtime.tools.toolbox"], check=True)


def test_tool_modules_never_import_the_workflow_engine():
    offenders = [path.name for path in TOOLS_DIR.glob("*.py") if "agent_runtime.workflow" in path.read_text("utf-8")]
    assert offenders == []


@pytest.mark.parametrize("module", ["agent_runtime.sessions.schemas.release", "agent_runtime.workflow.trace",
                                    "agent_runtime.workflow.validator"])
def test_registry_is_looked_up_lazily(module):
    code = (f"import sys, {module}; "
            "assert 'agent_runtime.tools.registry' not in sys.modules, 'imported the registry at module level'")
    subprocess.run([sys.executable, "-c", code], check=True)


def test_the_old_catalog_modules_are_gone():
    import importlib.util
    assert importlib.util.find_spec("agent_runtime.agent.catalog") is None
    assert importlib.util.find_spec("agent_runtime.agent.knowledge_tools") is None
