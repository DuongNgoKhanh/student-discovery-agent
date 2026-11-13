"""The web-ui tool picker is hand-written; this shared fixture is what keeps it in step with the runtime catalog."""
import json
from pathlib import Path

from agent_runtime.tools.kit import NoParams
from agent_runtime.tools.registry import TOOLS

FIXTURE = Path(__file__).resolve().parents[5] / "contracts/fixtures/agent-tool-catalog.json"


def test_fixture_lists_exactly_the_declared_tools():
    declared = [{"name": d.name, "version": d.version, "has_params": d.params is not NoParams}
                for d in TOOLS.values()]
    assert json.loads(FIXTURE.read_text(encoding="utf-8"))["tools"] == declared
