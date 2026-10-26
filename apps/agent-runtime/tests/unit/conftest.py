"""Minimal definition data built in memory for validator tests."""

import pytest

from agent_runtime.evaluations.services.compatibility import (
    PILOT_ENGINE_REGISTRY,
    CompatibilityChecker,
)
from agent_runtime.evaluations.services.validator import ExperienceValidator

HOUSE_CODES = ("r", "i", "a", "s", "e", "c")
HOUSE_IDS = [f"house_{code}" for code in HOUSE_CODES]
ENGINE_VERSION = "career-assessment-v1"


def rule(schema, payload):
    return {
        "rule_schema_ref": f"rule.schema.localis.{schema}:v1",
        "engine_version": ENGINE_VERSION,
        "payload": payload,
    }


def document(version, questions, rules, question_ids, scores):
    return {
        "schema_version": version,
        "definition_id": "definition_test",
        "definition_version": "1.0.0",
        "engine_version": ENGINE_VERSION,
        "is_demo": True,
        "questions": questions,
        "houses": [
            {
                "house_id": house_id,
                "name": house_id,
                "theme_ref": f"theme_{house_id}",
                "mascot_ref": f"mascot_{house_id}",
                "strengths": ["Test strength"],
                "tendencies": ["Test tendency"],
                "suggested_fields": ["Test field"],
                "quote": "Test quote",
            }
            for house_id in HOUSE_IDS
        ],
        **rules,
        "templates": {
            "intro_prompt": "Explore your interests.",
            "clarification_prompt": "Choose the closest option.",
            "completion_message": "Assessment complete.",
        },
        "evaluation_cases": [{
            "case_id": "case_test",
            "mandatory": True,
            "answers": [
                {"question_id": qid, "option_id": f"{qid}_opt_3"}
                for qid in question_ids
            ],
            "expected": {
                "question_ids": question_ids,
                "house_id": "house_r",
                "scores": scores,
            },
        }],
        "approval_refs": ["approval_test"],
    }


def with_engine(doc, engine_version):
    """Same definition pinned to another engine version (root and every rule document)."""
    doc = {**doc, "engine_version": engine_version}
    for slot in ("selection_rules", "scoring_rules", "coverage_rules", "tie_policy"):
        doc[slot] = {**doc[slot], "engine_version": engine_version}
    return doc


@pytest.fixture
def valid_v2_doc():
    questions = [
        {
            "question_id": f"q_{code}_{order:02}",
            "house_id": f"house_{code}",
            "item_order": order,
            "prompt": "Test question",
            "choices": [
                {
                    "option_id": f"q_{code}_{order:02}_opt_{rating}",
                    "label": f"Rating {rating}",
                    "rating": rating,
                }
                for rating in range(1, 6)
            ],
        }
        for code in HOUSE_CODES
        for order in range(1, 6)
    ]
    question_ids = [f"q_{code}_{order:02}" for order in range(1, 6) for code in HOUSE_CODES]
    rules = {
        "selection_rules": rule("selection.adaptive_bounds", {
            "baseline_order": question_ids[:12],
            "selector": "widest_bound_gap",
            "fallback": "tie_order_then_item_order",
        }),
        "scoring_rules": rule("scoring.mean_rating", {"rating_scale": [1, 5], "algorithm": "mean_rating"}),
        "coverage_rules": rule("coverage.bounded_stop", {
            "items_per_house": 5, "baseline_total": 12,
            "min_answers_per_house": 2, "max_total": 30, "stop": "strict_bounds",
        }),
        "tie_policy": rule("tie.fixed_order", {"order": list(HOUSE_IDS), "apply_at": "question_limit"}),
    }
    doc = document("2.0", questions, rules, question_ids, {house_id: 3.0 for house_id in HOUSE_IDS})
    doc["evaluation_cases"][0]["expected"].update(stopping_reason="question_limit", tie_applied=True)
    return doc


@pytest.fixture
def valid_v1_doc():
    question_ids = [f"q_demo_{order:02}" for order in range(1, 7)]
    questions = [
        {
            "question_id": qid,
            "prompt": "Test legacy question",
            "choices": [
                {"option_id": f"{qid}_opt_{option}", "label": f"Option {option}"}
                for option in (1, 3)
            ],
        }
        for qid in question_ids
    ]
    rules = {
        "selection_rules": rule("selection", {"initial_question_id": question_ids[0]}),
        "scoring_rules": rule("scoring", {"type": "cross_weights"}),
        "coverage_rules": rule("coverage.fixed", {"required_question_count": 6}),
        "tie_policy": rule("tie.hexagonal", {"order": list(HOUSE_IDS)}),
    }
    return document("1.0", questions, rules, question_ids, {house_id: 0.0 for house_id in HOUSE_IDS})


@pytest.fixture
def definition(valid_v2_doc):
    return valid_v2_doc


@pytest.fixture
def validator():
    return ExperienceValidator(CompatibilityChecker(PILOT_ENGINE_REGISTRY))
