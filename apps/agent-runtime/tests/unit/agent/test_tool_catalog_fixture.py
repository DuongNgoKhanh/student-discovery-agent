"""The web-ui tool picker is hand-written; this shared fixture is what keeps it in step with the runtime catalog."""
import json
from pathlib import Path

from agent_runtime.agent.catalog import TOOL_DECLARATIONS, NoParams

FIXTURE = Path(__file__).resolve().parents[5] / "contracts/fixtures/agent-tool-catalog.json"


def test_fixture_lists_exactly_the_declared_tools():
    declared = [{"name": d.name, "version": d.version, "has_params": d.params_model is not NoParams}
                for d in TOOL_DECLARATIONS.values()]
    assert json.loads(FIXTURE.read_text(encoding="utf-8"))["tools"] == declared
