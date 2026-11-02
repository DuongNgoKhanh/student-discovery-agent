"""The sampled fixture and the local demo release are seeded, capped at 15 and replay their golden case."""
import json
from pathlib import Path

import pytest

from agent_runtime.engine.fixtures.holland_career_pool import sample_experience_definition
from agent_runtime.engine.services.selector import AdaptiveQuestionSelector
from agent_runtime.evaluations.schemas.validation import ValidationStatus
from agent_runtime.evaluations.services.compatibility import PILOT_ENGINE_REGISTRY, CompatibilityChecker
from agent_runtime.evaluations.services.validator import ExperienceValidator

RELEASE = Path(__file__).resolve().parents[4] / "infra/local-releases/experiences/exp_riasec.json"


@pytest.mark.parametrize("load", [
    lambda: sample_experience_definition(seed=7, return_dict=True),
    lambda: json.loads(RELEASE.read_text(encoding="utf-8")),
], ids=["fixture", "demo_release"])
def test_definition_is_seeded_capped_and_its_case_replays(load):
    doc = load()
    assert doc["coverage_rules"]["payload"]["max_total"] == 15
    assert "baseline_order" not in doc["selection_rules"]["payload"]
    assert "order" not in doc["tie_policy"]["payload"]
    report = ExperienceValidator(CompatibilityChecker(PILOT_ENGINE_REGISTRY)).validate(doc)
    assert report.status == ValidationStatus.PASSED, report.issues
    for case in doc["evaluation_cases"]:
        result = AdaptiveQuestionSelector().select_next_question(case["answers"], definition=doc, seed=case["seed"])
        assert result.status.value == "completed"
        assert [a["question_id"] for a in case["answers"]] == case["expected"]["question_ids"]
        assert result.primary_house_id == case["expected"]["house_id"]
        assert result.tie_applied == case["expected"]["tie_applied"]
