"""Definition 2.0 selection seeded by the activity id: varied, reproducible, fair."""
import pytest

from agent_runtime.engine.error_codes import EngineErrorCode
from agent_runtime.engine.exceptions import EngineError, InvalidPrefixError
from agent_runtime.engine.services.selector import AdaptiveQuestionSelector

HOUSES = ["house_r", "house_i", "house_a", "house_s", "house_e", "house_c"]


def drive(doc, seed, rating_for_house, cap=None):
    if cap is not None:
        doc["coverage_rules"]["payload"]["max_total"] = cap
    selector = AdaptiveQuestionSelector()
    house_of = {q["question_id"]: q["house_id"] for q in doc["questions"]}
    answers = []
    while True:
        result = selector.select_next_question(answers, definition=doc, seed=seed)
        if result.status.value == "completed":
            return answers, result
        qid = result.next_question_id
        answers.append({"question_id": qid, "option_id": f"{qid}_opt_{rating_for_house(house_of[qid])}"})


def test_seed_is_required_for_v2(seeded_v2_doc):
    with pytest.raises(EngineError) as caught:
        AdaptiveQuestionSelector().select_next_question([], definition=seeded_v2_doc)
    assert caught.value.code == EngineErrorCode.MISSING_REQUIRED_FIELD


def test_same_seed_same_sequence(seeded_v2_doc):
    first, _ = drive(seeded_v2_doc, "act_1", lambda h: 3)
    second, _ = drive(seeded_v2_doc, "act_1", lambda h: 3)
    assert first == second


def test_different_seeds_vary_the_first_twelve(seeded_v2_doc):
    openings = {tuple(a["question_id"] for a in drive(seeded_v2_doc, f"act_{n}", lambda h: 3, cap=12)[0])
                for n in range(10)}
    assert len(openings) == 10


@pytest.mark.parametrize("seed", [f"act_{n}" for n in range(20)])
def test_baseline_rounds_cover_every_house_once(seeded_v2_doc, seed):
    answers, _ = drive(seeded_v2_doc, seed, lambda h: 3, cap=12)
    house_of = {q["question_id"]: q["house_id"] for q in seeded_v2_doc["questions"]}
    houses = [house_of[a["question_id"]] for a in answers]
    assert sorted(houses[:6]) == sorted(HOUSES) and sorted(houses[6:12]) == sorted(HOUSES)
    assert len({a["question_id"] for a in answers}) == 12


def test_stops_at_cap_with_highest_mean(seeded_v2_doc):
    answers, result = drive(seeded_v2_doc, "act_1", lambda h: 5 if h == "house_s" else 2, cap=15)
    assert len(answers) <= 15
    assert result.primary_house_id == "house_s"


def test_replay_rejects_another_seeds_sequence(seeded_v2_doc):
    answers, _ = drive(seeded_v2_doc, "act_1", lambda h: 3, cap=12)
    other = next(f"act_{n}" for n in range(2, 50)
                 if drive(seeded_v2_doc, f"act_{n}", lambda h: 3, cap=12)[0][0] != answers[0])
    with pytest.raises(InvalidPrefixError) as caught:
        AdaptiveQuestionSelector().select_next_question(answers[:2], definition=seeded_v2_doc, seed=other)
    assert caught.value.code == EngineErrorCode.SEQUENCE_MISMATCH


def test_full_tie_at_limit_is_not_biased_to_r(seeded_v2_doc):
    winners = {drive(seeded_v2_doc, f"act_{n}", lambda h: 3, cap=15)[1].primary_house_id for n in range(60)}
    assert len(winners) >= 4


def test_tie_applied_and_top_rating_tiebreak(seeded_v2_doc):
    # Every house answers 3 except house_e: one 5 and one 1, so the same mean but more top ratings.
    seen = {"house_e": 0}

    def rating(h):
        if h != "house_e":
            return 3
        seen["house_e"] += 1
        return 5 if seen["house_e"] == 1 else 1

    _, result = drive(seeded_v2_doc, "act_7", rating, cap=12)
    assert result.tie_applied is True
    assert result.primary_house_id == "house_e"
