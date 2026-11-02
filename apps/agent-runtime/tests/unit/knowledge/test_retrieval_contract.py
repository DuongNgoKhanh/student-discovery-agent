import json
from pathlib import Path

from agent_runtime.knowledge.schemas import RetrievalRequest, RetrievalResult

ROOT = Path(__file__).resolve().parents[5]


def test_contract_fixture_matches_the_models():
    fixture = json.loads((ROOT / "contracts/fixtures/knowledge-retrieval.json").read_text(encoding="utf-8"))
    request = RetrievalRequest.model_validate(fixture["request"])
    result = RetrievalResult.model_validate(fixture["response_data"])
    assert request.metadata_condition.conditions[0].comparison_operator == "contains"
    assert result.model_dump(mode="json") == fixture["response_data"]
