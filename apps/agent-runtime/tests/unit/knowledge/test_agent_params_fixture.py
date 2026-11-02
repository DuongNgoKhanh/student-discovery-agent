"""The Studio agent-params output (contracts/fixtures/knowledge-agent-params.json) must satisfy the runtime's tool params."""

import json
from pathlib import Path

from agent_runtime.agent.catalog import KnowledgeSearchParams, KnowledgeShowParams

FIXTURE = Path(__file__).resolve().parents[5] / "contracts" / "fixtures" / "knowledge-agent-params.json"


def test_studio_agent_params_fixture_is_accepted_by_the_runtime() -> None:
    params = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert set(params) == {"knowledge.search", "knowledge.show"}
    search = KnowledgeSearchParams.model_validate(params["knowledge.search"])
    show = KnowledgeShowParams.model_validate(params["knowledge.show"])
    assert len(search.auto_filter_fields) == 10
    assert len(show.display) == 8
