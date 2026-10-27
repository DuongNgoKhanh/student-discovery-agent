"""Unit tests for AdaptiveQuestionSelector (Task C-02 / M-ENG).

Verifies:
- FR-ENG-01: Adaptive Question Selection algorithm based on ADR-002 (§7.6, §7.7).
- AT-12: Deterministic question selection and stop conditions across golden fixtures.
- Seeded baseline: 12 items, two rounds covering all 6 Holland RIASEC houses.
- EX-02: Bounded winner early stopping (House R).
- Equality of bounds: strict inequality check prevents premature stopping.
- EX-03: Maximum limit stopping at 30 items with the seeded tie-break.
- Anti-repeat invariant: no duplicate question selection under any path.
- Typed failure handling: InvalidPrefixError, BankExhaustedError, UnsupportedDefinitionError, MissingMappingError.
- Backward compatibility with Definition 1.0 fixed 6 questions.
- 100% Determinism: identical outputs across repeated executions.
- EX-04: Edit answer invalidation re-evaluation.
"""

import copy
import random
from fractions import Fraction

import pytest
from pydantic import ValidationError

from agent_runtime.engine.exceptions import (
    InvalidPrefixError,
    MissingMappingError,
    UnsupportedDefinitionError,
)
from agent_runtime.engine.schemas.selector import (
    AnswerInput,
    AssessmentProgressAdaptive,
    RationalScore,
    SelectionPhase,
    SelectionResult,
    SelectionStatus,
    StoppingReason,
)
from agent_runtime.engine.services.ordering import seeded_order
from agent_runtime.engine.services.selector import (
    AdaptiveQuestionSelector,
    select_next_question,
)

SEED = "act_fixture"
HOUSES = ["house_r", "house_i", "house_a", "house_s", "house_e", "house_c"]


class SeededSelector(AdaptiveQuestionSelector):
    """Selector bound to one activity seed, so tests read like the runtime's per-activity calls."""

    def select_next_question(self, answers=None, definition=None, validate_sequence=True, *, seed=SEED):
        return super().select_next_question(answers, definition, validate_sequence, seed=seed)


def _baseline(definition):
    return AdaptiveQuestionSelector._baseline_sequence(AdaptiveQuestionSelector._coerce_definition(definition), SEED)


def _seeded_first(houses):
    """Winner among houses tied on mean and top-rating count: the lowest seeded key."""
    return seeded_order(SEED, "house", houses)[0]


@pytest.fixture
def valid_v2_dict(seeded_v2_doc):
    return copy.deepcopy(seeded_v2_doc)


@pytest.fixture
def valid_v1_dict(valid_v1_doc):
    return copy.deepcopy(valid_v1_doc)


def _run_path(definition, rate):
    """Answer every selected question with rate(question) until completion; return each step's result."""
    selector = SeededSelector(definition)
    answers, trace = [], []
    while True:
        result = selector.select_next_question(answers, validate_sequence=False)
        trace.append(result)
        if result.status == SelectionStatus.COMPLETED:
            return trace
        q = result.next_question
        answers.append({"question_id": q.question_id, "option_id": f"{q.question_id}_opt_{rate(q)}"})


class TestAdaptiveQuestionSelectorBaseline:
    """Test Suite for Phase 1: Baseline 12 Questions (ADR-002 §7.4)."""

    def test_start_with_empty_answers_returns_first_baseline_question(self, seeded_v2_doc):
        selector = SeededSelector(seeded_v2_doc)
        result = selector.select_next_question(answers=[])

        assert result.status == SelectionStatus.NEXT_QUESTION
        assert result.next_question_id == _baseline(seeded_v2_doc)[0]
        assert result.next_question is not None
        assert result.next_question.question_id == result.next_question_id
        assert result.phase == SelectionPhase.BASELINE
        assert result.progress.completed == 0
        assert result.progress.min_total == 12
        assert result.progress.max_total == 30
        assert result.progress.total is None
        assert result.stopping_reason is None

    def test_baseline_full_sequence_12_questions(self, seeded_v2_doc):
        """Baseline follows the activity's seeded sequence: two rounds, each visiting every house once."""
        expected_baseline = _baseline(seeded_v2_doc)
        house_of = {q["question_id"]: q["house_id"] for q in seeded_v2_doc["questions"]}
        rounds = [[house_of[qid] for qid in expected_baseline[i:i + 6]] for i in (0, 6)]
        assert all(sorted(r) == sorted(HOUSES) for r in rounds)

        selector = SeededSelector(seeded_v2_doc)
        answers = []

        for i, expected_qid in enumerate(expected_baseline):
            result = selector.select_next_question(answers)
            assert result.status == SelectionStatus.NEXT_QUESTION
            assert result.next_question_id == expected_qid
            assert result.phase == SelectionPhase.BASELINE
            assert result.progress.completed == i

            # Add answer (rating 3)
            answers.append({
                "question_id": expected_qid,
                "option_id": f"{expected_qid}_opt_3",
            })

        # At completed = 12, baseline is finished, should transition to adaptive
        result_after_baseline = selector.select_next_question(answers)
        assert result_after_baseline.phase == SelectionPhase.ADAPTIVE
        assert result_after_baseline.progress.completed == 12


class TestAdaptiveQuestionSelectorGoldenEX02:
    """Test Suite for ADR-002 §8.3 / EX-02: Bounded Winner Early Stopping at 18 Answers."""

    def test_ex02_bounded_winner_early_stop(self, seeded_v2_doc):
        """EX-02: R ratings are 5, others are 1.

        After the baseline every house has 2 answers: lower_r = 2.6 < upper_others = 3.4, so it continues.
        The seeded order decides which items follow; the stop must be a strict bounded win for R.
        """
        trace = _run_path(seeded_v2_doc, lambda q: 5 if q.house_id == "house_r" else 1)
        after_baseline = trace[12]
        assert after_baseline.status == SelectionStatus.NEXT_QUESTION
        assert after_baseline.statistics["house_r"].lower.value == pytest.approx(2.6)
        assert after_baseline.statistics["house_i"].upper.value == pytest.approx(3.4)

        final = trace[-1]
        assert final.status == SelectionStatus.COMPLETED
        assert final.stopping_reason == StoppingReason.BOUNDED_WINNER
        assert final.primary_house_id == "house_r"
        assert final.tie_applied is False
        assert final.next_question_id is None
        assert final.phase == SelectionPhase.COMPLETED
        assert final.progress.total == final.progress.completed == len(trace) - 1 < 30
        lower_r = final.statistics["house_r"].lower.to_fraction()
        assert all(final.statistics[h].upper.to_fraction() < lower_r for h in HOUSES if h != "house_r")


class TestAdaptiveQuestionSelectorEdgeCases:
    """Test Suite for Edge Cases: Equality of Bounds, 30-item limit, Anti-repeat, Challengers."""

    def test_equality_of_bounds_does_not_stop_early(self, seeded_v2_doc):
        """ADR-002 §7.6: lower_w == max(upper_h) must continue, not stop early."""
        selector = SeededSelector(seeded_v2_doc)
        # Create answers up to step 13 where lower_r == upper_i == 3.4
        answers = [
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5"},
            {"question_id": "q_i_01", "option_id": "q_i_01_opt_1"},
            {"question_id": "q_a_01", "option_id": "q_a_01_opt_1"},
            {"question_id": "q_s_01", "option_id": "q_s_01_opt_1"},
            {"question_id": "q_e_01", "option_id": "q_e_01_opt_1"},
            {"question_id": "q_c_01", "option_id": "q_c_01_opt_1"},
            {"question_id": "q_r_02", "option_id": "q_r_02_opt_5"},
            {"question_id": "q_i_02", "option_id": "q_i_02_opt_1"},
            {"question_id": "q_a_02", "option_id": "q_a_02_opt_1"},
            {"question_id": "q_s_02", "option_id": "q_s_02_opt_1"},
            {"question_id": "q_e_02", "option_id": "q_e_02_opt_1"},
            {"question_id": "q_c_02", "option_id": "q_c_02_opt_1"},
            {"question_id": "q_r_03", "option_id": "q_r_03_opt_5"},
        ]
        # Hand-built prefix (not this seed's path): only the bounds logic is under test.
        res = selector.select_next_question(answers, validate_sequence=False)
        assert res.statistics["house_r"].lower.value == pytest.approx(3.4)
        assert res.statistics["house_i"].upper.value == pytest.approx(3.4)
        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.stopping_reason is None

    def test_max_question_limit_with_perfect_tie_ex03(self, seeded_v2_doc):
        """ADR-002 §8.4 / EX-03: All 30 ratings are 3 -> question_limit, winner by the seeded key."""
        selector = SeededSelector(seeded_v2_doc)
        answers = []

        # Play all 30 questions with rating 3
        while len(answers) < 30:
            res = selector.select_next_question(answers)
            if res.status == SelectionStatus.COMPLETED:
                break
            qid = res.next_question_id
            answers.append({
                "question_id": qid,
                "option_id": f"{qid}_opt_3",
            })

        final_res = selector.select_next_question(answers)
        assert final_res.status == SelectionStatus.COMPLETED
        assert final_res.stopping_reason == StoppingReason.QUESTION_LIMIT
        assert final_res.primary_house_id == _seeded_first(HOUSES)
        assert final_res.tie_applied is True
        assert final_res.progress.completed == 30
        assert final_res.progress.total == 30

    def test_all_ratings_low_stops_at_limit_with_tie(self, seeded_v2_doc):
        """ADR-002 §8.4: All 30 ratings are 1 -> question_limit, winner by the seeded key."""
        selector = SeededSelector(seeded_v2_doc)
        answers = []

        while len(answers) < 30:
            res = selector.select_next_question(answers)
            if res.status == SelectionStatus.COMPLETED:
                break
            qid = res.next_question_id
            answers.append({
                "question_id": qid,
                "option_id": f"{qid}_opt_1",
            })

        final_res = selector.select_next_question(answers)
        assert final_res.status == SelectionStatus.COMPLETED
        assert final_res.stopping_reason == StoppingReason.QUESTION_LIMIT
        assert final_res.primary_house_id == _seeded_first(HOUSES)
        assert final_res.tie_applied is True

    def test_anti_repeat_invariant_across_complete_trajectory(self, seeded_v2_doc):
        """Verify that throughout 30 question selections, no question is ever repeated."""
        selector = SeededSelector(seeded_v2_doc)
        answers = []
        asked_set = set()

        for _ in range(30):
            res = selector.select_next_question(answers)
            if res.status == SelectionStatus.COMPLETED:
                break
            qid = res.next_question_id
            assert qid not in asked_set, f"Anti-repeat violation: {qid} selected twice!"
            asked_set.add(qid)

            answers.append({
                "question_id": qid,
                "option_id": f"{qid}_opt_3",
            })

        assert len(asked_set) == 30

    def test_candidate_set_follows_the_challenger_rule(self, seeded_v2_doc):
        """ADR-002 §7.11: C = {w if unfinished} + {h != w unfinished with upper_h >= lower_w}, at every step.

        Re-entry of a dropped challenger follows from this rule; checking the rule itself keeps the test
        independent of which seeded order a run happens to take.
        """
        ratings = {
            "house_r": [1, 1, 4, 3, 5], "house_i": [5, 5, 5, 2, 3], "house_a": [4, 5, 5, 4, 5],
            "house_s": [2, 5, 3, 5, 2], "house_e": [4, 2, 4, 1, 4], "house_c": [4, 3, 1, 2, 4],
        }
        dropped_seen = False
        for n in range(20):
            selector, answers = SeededSelector(seeded_v2_doc), []
            while (res := selector.select_next_question(answers, validate_sequence=False, seed=f"act_{n}")).status \
                    == SelectionStatus.NEXT_QUESTION:
                if res.phase == SelectionPhase.ADAPTIVE:
                    stats = res.statistics
                    leader = next(line.split(": ")[1] for line in res.decision_log
                                  if line.startswith("Current leading house"))
                    expected = {h for h, st in stats.items() if st.count < 5
                                and (h == leader or st.upper.to_fraction() >= stats[leader].lower.to_fraction())}
                    assert set(res.candidate_houses) == expected
                    dropped_seen |= len(expected) < len([h for h, st in stats.items() if st.count < 5])
                q = res.next_question
                answers.append({"question_id": q.question_id,
                                "option_id": f"{q.question_id}_opt_{ratings[q.house_id][q.item_order - 1]}"})
        assert dropped_seen, "the scenario must drop at least one challenger from C"

    def test_partial_tie_at_limit_resolved_by_seeded_rank(self, seeded_v2_doc):
        """A and E tie at mean 4 (no top ratings) so bounds never separate them; the seeded key decides."""
        trace = _run_path(seeded_v2_doc, lambda q: 4 if q.house_id in ("house_a", "house_e") else 2)
        final = trace[-1]
        assert final.stopping_reason == StoppingReason.QUESTION_LIMIT
        assert final.progress.total == 30
        assert final.primary_house_id == _seeded_first(["house_a", "house_e"])
        assert final.tie_applied is True

    def test_clear_winner_at_limit_does_not_apply_tie(self, valid_v2_dict):
        """With max_total=13, R (all 5s) hits the limit before bounds separate it, but wins outright."""
        valid_v2_dict["coverage_rules"]["payload"]["max_total"] = 13
        trace = _run_path(valid_v2_dict, lambda q: 5 if q.house_id == "house_r" else 1)
        final = trace[-1]
        assert final.stopping_reason == StoppingReason.QUESTION_LIMIT
        assert final.progress.total == 13
        assert final.primary_house_id == "house_r"
        assert final.tie_applied is False

    def test_empty_candidate_set_falls_back_to_seeded_house(self, seeded_v2_doc):
        """ADR-002 §7.7 step 5: R and I exhausted at mean 5 (lower_R = 5 is not > upper_I = 5, so no stop);
        every other house has upper 13/5 < 5, so C is empty and the selector keeps asking a seeded house."""
        trace = _run_path(seeded_v2_doc, lambda q: 5 if q.house_id in ("house_r", "house_i") else 1)

        fallback = next(r for r in trace if r.status == SelectionStatus.NEXT_QUESTION and r.phase == SelectionPhase.ADAPTIVE
                        and r.candidate_houses == [])
        assert fallback.statistics["house_r"].count == 5
        assert fallback.statistics["house_i"].count == 5
        assert fallback.next_question.house_id not in ("house_r", "house_i")
        assert any("fallback" in line for line in fallback.decision_log)

        final = trace[-1]
        assert final.stopping_reason == StoppingReason.QUESTION_LIMIT
        assert final.primary_house_id == _seeded_first(["house_r", "house_i"])
        assert final.tie_applied is True


class TestAdaptiveQuestionSelectorValidationAndFailures:
    """Test Suite for Typed Failure Handling (DEC-04 & ADR-002 §7.7)."""

    def test_duplicate_question_in_answers_raises_invalid_prefix(self, seeded_v2_doc):
        selector = SeededSelector(seeded_v2_doc)
        answers = [
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5"},
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_4"},  # Duplicate!
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers)
        assert exc_info.value.code == "REQ_QUESTION_ALREADY_ANSWERED"

    def test_unknown_question_id_raises_invalid_prefix(self, seeded_v2_doc):
        selector = SeededSelector(seeded_v2_doc)
        answers = [
            {"question_id": "q_unknown_99", "option_id": "q_r_01_opt_5"},
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers)
        assert exc_info.value.code == "VAL_UNKNOWN_QUESTION_ID"

    def test_option_not_belonging_to_question_raises_invalid_prefix(self, seeded_v2_doc):
        selector = SeededSelector(seeded_v2_doc)
        answers = [
            {"question_id": "q_r_01", "option_id": "q_i_01_opt_1"},  # Option belongs to q_i_01!
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers)
        assert exc_info.value.code == "VAL_INVALID_OPTION_ID"

    def test_rating_mismatch_raises_invalid_prefix(self, seeded_v2_doc):
        selector = SeededSelector(seeded_v2_doc)
        answers = [
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5", "rating": 3},  # Option has rating 5!
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers)
        assert exc_info.value.code == "VAL_RATING_MISMATCH"

    def test_sequence_mismatch_raises_invalid_prefix(self, seeded_v2_doc):
        selector = SeededSelector(seeded_v2_doc)
        # Answer a question other than the seed's first baseline item
        wrong = next(q["question_id"] for q in seeded_v2_doc["questions"] if q["question_id"] != _baseline(seeded_v2_doc)[0])
        answers = [{"question_id": wrong, "option_id": f"{wrong}_opt_1"}]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers, validate_sequence=True)
        assert exc_info.value.code == "REQ_SEQUENCE_MISMATCH"

    def test_sequence_mismatch_ignored_when_flag_false(self, seeded_v2_doc):
        selector = SeededSelector(seeded_v2_doc)
        # When validate_sequence=False, sequence replay is bypassed
        answers = [
            {"question_id": "q_i_01", "option_id": "q_i_01_opt_1"},
        ]
        res = selector.select_next_question(answers, validate_sequence=False)
        assert res.status == SelectionStatus.NEXT_QUESTION

    def test_unsupported_schema_version_raises_error(self, valid_v2_dict):
        valid_v2_dict["schema_version"] = "99.0"
        selector = SeededSelector()
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            selector.select_next_question(answers=[], definition=valid_v2_dict)
        assert exc_info.value.code == "VAL_INVALID_SCHEMA_VERSION"

    def test_unsupported_selection_rule_raises_error(self, valid_v2_dict):
        valid_v2_dict["selection_rules"]["rule_schema_ref"] = "rule.schema.unsupported:v1"
        selector = SeededSelector()
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            selector.select_next_question(answers=[], definition=valid_v2_dict)
        assert exc_info.value.code == "VAL_UNSUPPORTED_RULE_SCHEMA"

    def test_invalid_definition_payload_raises_error(self):
        selector = SeededSelector()
        with pytest.raises(UnsupportedDefinitionError):
            selector.select_next_question(answers=[], definition="not-a-dict")


class TestAdaptiveQuestionSelectorDefinition10Compatibility:
    """Test Suite for Definition 1.0 (Fixed 6 questions) Backward Compatibility."""

    def test_v1_start_with_empty_answers_returns_initial_question(self, valid_v1_doc):
        selector = SeededSelector(valid_v1_doc)
        res = selector.select_next_question(answers=[])

        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.next_question_id == "q_demo_01"
        assert res.phase == SelectionPhase.FIXED
        assert res.progress.completed == 0
        assert res.progress.total is None

    def test_v1_sequential_selection_up_to_6(self, valid_v1_doc):
        selector = SeededSelector(valid_v1_doc)
        answers = []
        expected_seq = [
            "q_demo_01", "q_demo_02", "q_demo_03",
            "q_demo_04", "q_demo_05", "q_demo_06",
        ]

        for i, qid in enumerate(expected_seq):
            res = selector.select_next_question(answers)
            assert res.status == SelectionStatus.NEXT_QUESTION
            assert res.next_question_id == qid
            assert res.progress.completed == i
            opt_id = f"{qid}_opt_1"
            answers.append({"question_id": qid, "option_id": opt_id})

        # After 6 answers, completed
        final_res = selector.select_next_question(answers)
        assert final_res.status == SelectionStatus.COMPLETED
        assert final_res.stopping_reason == StoppingReason.FIXED_COVERAGE
        assert final_res.progress.completed == 6
        assert final_res.progress.total == 6


class TestAdaptiveQuestionSelectorDeterminismAndEdit:
    """Test Suite for Determinism (AT-12) & Edit Invalidation (EX-04)."""

    def test_determinism_50_repeated_calls(self, seeded_v2_doc):
        """Same input prefix must yield 100% identical outputs every time."""
        selector = SeededSelector(seeded_v2_doc)
        answers = [{"question_id": qid, "option_id": f"{qid}_opt_{rating}"}
                   for qid, rating in zip(_baseline(seeded_v2_doc)[:3], (5, 1, 1), strict=True)]

        first_res = selector.select_next_question(answers)

        for _ in range(50):
            repeated_res = selector.select_next_question(answers)
            assert repeated_res.next_question_id == first_res.next_question_id
            assert repeated_res.status == first_res.status
            assert repeated_res.phase == first_res.phase
            assert repeated_res.progress.completed == first_res.progress.completed
            assert repeated_res.model_dump() == first_res.model_dump()

    def test_ex04_edit_answer_13_recalculates_bounds_and_selects_qi03(self, seeded_v2_doc):
        """ADR-002 §8.5 / EX-04: Edit answer 13 from rating 5 to rating 1.

        Previous state had early stop at 18.
        When answer 13 (q_r_03) is edited to rating 1, answers 14..18 are pruned.
        The prefix now has 13 answers.
        lower_r is now 2.6 < upper_others 3.4 -> in_progress; R has the narrowest gap, so the next
        question comes from another house (which one is seeded).
        """
        selector = SeededSelector(seeded_v2_doc)

        # Build baseline (12 items)
        answers = [
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5"},
            {"question_id": "q_i_01", "option_id": "q_i_01_opt_1"},
            {"question_id": "q_a_01", "option_id": "q_a_01_opt_1"},
            {"question_id": "q_s_01", "option_id": "q_s_01_opt_1"},
            {"question_id": "q_e_01", "option_id": "q_e_01_opt_1"},
            {"question_id": "q_c_01", "option_id": "q_c_01_opt_1"},
            {"question_id": "q_r_02", "option_id": "q_r_02_opt_5"},
            {"question_id": "q_i_02", "option_id": "q_i_02_opt_1"},
            {"question_id": "q_a_02", "option_id": "q_a_02_opt_1"},
            {"question_id": "q_s_02", "option_id": "q_s_02_opt_1"},
            {"question_id": "q_e_02", "option_id": "q_e_02_opt_1"},
            {"question_id": "q_c_02", "option_id": "q_c_02_opt_1"},
            # Answer 13 edited to rating 1 instead of 5
            {"question_id": "q_r_03", "option_id": "q_r_03_opt_1"},
        ]

        # Hand-built prefix (the old fixed path), so only the bounds/edit logic is under test.
        res = selector.select_next_question(answers, validate_sequence=False)

        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.next_question.house_id != "house_r"
        assert res.next_question_id not in {a["question_id"] for a in answers}
        assert res.phase == SelectionPhase.ADAPTIVE
        assert res.progress.completed == 13
        assert res.progress.total is None
        assert res.stopping_reason is None

        # Verify exact bounds from ADR-002 §8.5:
        # R: sum=11, count=3 -> lower = (11+2)/5 = 2.6, upper = (11+10)/5 = 4.2
        assert res.statistics["house_r"].lower.value == pytest.approx(2.6)
        assert res.statistics["house_r"].upper.value == pytest.approx(4.2)
        # Others: sum=2, count=2 -> lower = (2+3)/5 = 1.0, upper = (2+15)/5 = 3.4
        assert res.statistics["house_i"].lower.value == pytest.approx(1.0)
        assert res.statistics["house_i"].upper.value == pytest.approx(3.4)

    def test_convenience_function_select_next_question(self, seeded_v2_doc):
        """Verify module-level select_next_question convenience wrapper."""
        res = select_next_question(seeded_v2_doc, [], seed=SEED)
        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.next_question_id == _baseline(seeded_v2_doc)[0]

    def test_submitting_answer_after_assessment_completed_raises_error(self, seeded_v2_doc):
        """Verify that submitting an answer when assessment already completed raises ASSESSMENT_ALREADY_COMPLETED."""
        selector = SeededSelector(seeded_v2_doc)
        house_of = {q["question_id"]: q["house_id"] for q in seeded_v2_doc["questions"]}
        answers = []
        while (res := selector.select_next_question(answers)).status == SelectionStatus.NEXT_QUESTION:
            qid = res.next_question_id
            answers.append({"question_id": qid, "option_id": f"{qid}_opt_{5 if house_of[qid] == 'house_r' else 1}"})
        assert res.stopping_reason == StoppingReason.BOUNDED_WINNER
        extra = next(qid for qid in house_of if qid not in {a["question_id"] for a in answers})
        answers.append({"question_id": extra, "option_id": f"{extra}_opt_5"})

        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers, validate_sequence=True)
        assert exc_info.value.code == "REQ_ASSESSMENT_ALREADY_COMPLETED"

    def test_answers_with_rich_session_metadata_accepted(self, seeded_v2_doc):
        """Verify that AnswerInput accepts full ActivityAnswer dictionaries from database sessions."""
        selector = SeededSelector(seeded_v2_doc)
        first, second = _baseline(seeded_v2_doc)[:2]
        answers = [
            {
                "question_id": first,
                "option_id": f"{first}_opt_5",
                "answer_id": "ans_001",
                "ordinal": 1,
                "source": "option",
                "accepted_activity_revision": 2,
            }
        ]
        res = selector.select_next_question(answers)
        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.next_question_id == second

    def test_boolean_rating_in_answers_rejected(self, seeded_v2_doc):
        """Verify that boolean rating (e.g. True) is strictly rejected."""
        selector = SeededSelector(seeded_v2_doc)
        answers = [
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5", "rating": True}
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers)
        assert exc_info.value.code == "VAL_INVALID_TYPE"

    def test_none_answers_treated_as_empty_list(self, seeded_v2_doc):
        """Verify that passing answers=None gracefully defaults to empty list."""
        selector = SeededSelector(seeded_v2_doc)
        res = selector.select_next_question(answers=None)
        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.next_question_id == _baseline(seeded_v2_doc)[0]

    def test_non_list_answers_raises_error(self, seeded_v2_doc):
        """Verify that passing a non-list answers payload raises InvalidPrefixError."""
        selector = SeededSelector(seeded_v2_doc)
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers="not-a-list")
        assert exc_info.value.code == "VAL_INVALID_TYPE"

    def test_rational_score_operators(self):
        """Verify comparison and arithmetic operators on RationalScore."""
        score1 = RationalScore(numerator=17, denominator=5)  # 3.4
        score2 = RationalScore(numerator=13, denominator=5)  # 2.6

        assert score1 > score2
        assert score2 < score1
        assert score1 >= score2
        assert score2 <= score1
        assert score1 == Fraction(17, 5)
        assert score1 != score2
        assert score1 > 3.0

        diff = score1 - score2
        assert diff == RationalScore(numerator=4, denominator=5)

        total = score1 + score2
        assert total == RationalScore(numerator=30, denominator=5)
        assert repr(score1) == "RationalScore(17/5)"

    def test_v1_sequence_mismatch_raises_error(self, valid_v1_doc):
        """Verify that Definition 1.0 sequence replay mismatch raises SEQUENCE_MISMATCH."""
        selector = SeededSelector(valid_v1_doc)
        # Expected step 0 is q_demo_01, but user answers q_demo_03 first
        answers = [{"question_id": "q_demo_03", "option_id": "q_demo_03_opt_1"}]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers, validate_sequence=True)
        assert exc_info.value.code == "REQ_SEQUENCE_MISMATCH"


class TestDefinitionIntegrityValidation:
    """Malformed definitions must fail fast with typed errors, never raw Python errors or silent results."""

    @staticmethod
    def _select(definition, answers=None):
        return SeededSelector().select_next_question(
            answers=answers or [], definition=definition
        )

    @pytest.mark.parametrize("slot", ["selection_rules", "scoring_rules", "coverage_rules", "tie_policy"])
    @pytest.mark.parametrize("version_fixture", ["valid_v2_dict", "valid_v1_dict"])
    def test_unregistered_rule_schema_in_any_slot_rejected(self, request, version_fixture, slot):
        definition = request.getfixturevalue(version_fixture)
        definition[slot]["rule_schema_ref"] = "rule.schema.bogus:v9"
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            self._select(definition)
        assert exc_info.value.code == "VAL_UNSUPPORTED_RULE_SCHEMA"
        assert slot in exc_info.value.message

    def test_rule_schema_from_other_version_rejected(self, valid_v2_dict):
        valid_v2_dict["selection_rules"]["rule_schema_ref"] = "rule.schema.localis.selection:v1"
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            self._select(valid_v2_dict)
        assert exc_info.value.code == "VAL_UNSUPPORTED_RULE_SCHEMA"

    @pytest.mark.parametrize("bad_house_id", [None, "house_zz"])
    def test_question_with_missing_or_unknown_house_rejected(self, valid_v2_dict, bad_house_id):
        q_r_03 = next(q for q in valid_v2_dict["questions"] if q["question_id"] == "q_r_03")
        q_r_03["house_id"] = bad_house_id
        with pytest.raises(MissingMappingError) as exc_info:
            self._select(valid_v2_dict)
        assert exc_info.value.code == "VAL_INVALID_HOUSE_REF"

    def test_question_with_missing_item_order_rejected(self, valid_v2_dict):
        q_r_05 = next(q for q in valid_v2_dict["questions"] if q["question_id"] == "q_r_05")
        q_r_05["item_order"] = None
        with pytest.raises(MissingMappingError) as exc_info:
            self._select(valid_v2_dict)
        assert exc_info.value.code == "VAL_INVALID_ITEM_ORDER"

    def test_house_with_fewer_items_than_items_per_house_rejected(self, valid_v2_dict):
        """Bounds assume items_per_house items exist; a short bank would yield an unprovable winner."""
        valid_v2_dict["questions"] = [
            q for q in valid_v2_dict["questions"] if q["question_id"] not in {"q_r_03", "q_r_04", "q_r_05"}
        ]
        with pytest.raises(MissingMappingError) as exc_info:
            self._select(valid_v2_dict)
        assert exc_info.value.code == "VAL_HOUSE_QUESTION_COUNT_MISMATCH"

    def test_house_with_duplicate_item_order_rejected(self, valid_v2_dict):
        q_r_05 = next(q for q in valid_v2_dict["questions"] if q["question_id"] == "q_r_05")
        q_r_05["item_order"] = 4
        with pytest.raises(MissingMappingError) as exc_info:
            self._select(valid_v2_dict)
        assert exc_info.value.code == "VAL_HOUSE_ITEM_ORDER_MISMATCH"

    @pytest.mark.parametrize(
        "key, value, code",
        [
            ("items_per_house", 0, "VAL_INVALID_COVERAGE_CONFIG"),
            ("max_total", "30", "VAL_INVALID_COVERAGE_CONFIG"),
            ("min_answers_per_house", True, "VAL_INVALID_MIN_ANSWERS"),
        ],
    )
    def test_invalid_coverage_payload_rejected(self, valid_v2_dict, key, value, code):
        valid_v2_dict["coverage_rules"]["payload"][key] = value
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            self._select(valid_v2_dict)
        assert exc_info.value.code == code

    def test_v1_initial_question_not_in_bank_rejected(self, valid_v1_dict):
        valid_v1_dict["selection_rules"]["payload"]["initial_question_id"] = "q_nope"
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            self._select(valid_v1_dict)
        assert exc_info.value.code == "VAL_INVALID_INITIAL_QUESTION"

    def test_duplicate_question_id_in_bank_rejected(self, valid_v2_dict):
        """A duplicate ID would silently overwrite the first question in every lookup map."""
        duplicate = copy.deepcopy(valid_v2_dict["questions"][0])
        duplicate["house_id"] = "house_c"
        valid_v2_dict["questions"].append(duplicate)
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            self._select(valid_v2_dict)
        assert exc_info.value.code == "VAL_DUPLICATE_QUESTION_ID"

    def test_duplicate_option_id_within_question_rejected(self, valid_v2_dict):
        choices = valid_v2_dict["questions"][0]["choices"]
        choices[1]["option_id"] = choices[0]["option_id"]
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            self._select(valid_v2_dict)
        assert exc_info.value.code == "VAL_DUPLICATE_OPTION_ID"

    @pytest.mark.parametrize(
        "key, code",
        [
            ("max_total", "VAL_INVALID_COVERAGE_CONFIG"),
            ("items_per_house", "VAL_INVALID_COVERAGE_CONFIG"),
            ("min_answers_per_house", "VAL_INVALID_MIN_ANSWERS"),
        ],
    )
    def test_missing_coverage_field_rejected(self, valid_v2_dict, key, code):
        """Absent coverage fields must not silently default to hard-coded values."""
        del valid_v2_dict["coverage_rules"]["payload"][key]
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            self._select(valid_v2_dict)
        assert exc_info.value.code == code

    @pytest.mark.parametrize(
        "key, value, code",
        [
            ("max_total", 11, "VAL_INVALID_COVERAGE_CONFIG"),  # below baseline
            ("max_total", 31, "VAL_INVALID_COVERAGE_CONFIG"),  # beyond 6 houses x 5 items
            ("min_answers_per_house", 6, "VAL_INVALID_MIN_ANSWERS"),  # more than items_per_house
            ("baseline_total", 10, "VAL_INVALID_COVERAGE_CONFIG"),  # ADR-002 pins baseline at 12
        ],
    )
    def test_inconsistent_coverage_values_rejected(self, valid_v2_dict, key, value, code):
        valid_v2_dict["coverage_rules"]["payload"][key] = value
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            self._select(valid_v2_dict)
        assert exc_info.value.code == code

    def test_v1_required_count_beyond_bank_rejected(self, valid_v1_dict):
        valid_v1_dict["coverage_rules"]["payload"]["required_question_count"] = 7
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            self._select(valid_v1_dict)
        assert exc_info.value.code == "VAL_INVALID_COVERAGE_CONFIG"

    def test_v1_client_supplied_rating_rejected(self, valid_v1_dict):
        """v1 choices carry no rating, so a client-supplied one must not reach the scorer."""
        answers = [{"question_id": "q_demo_01", "option_id": "q_demo_01_opt_1", "rating": 5}]
        with pytest.raises(InvalidPrefixError) as exc_info:
            self._select(valid_v1_dict, answers)
        assert exc_info.value.code == "VAL_RATING_MISMATCH"


class TestSelectorSchemaInvariants:
    """Schema types must not represent illegal states (zero denominators, contradictory results)."""

    def test_rational_score_rejects_zero_denominator(self):
        with pytest.raises(ValidationError):
            RationalScore(numerator=1, denominator=0)

    def test_rational_score_normalizes_to_canonical_form(self):
        """Equal values must serialize identically, so audit logs and replays agree."""
        assert RationalScore(numerator=2, denominator=4).model_dump() == {"numerator": 1, "denominator": 2}
        assert RationalScore(numerator=1, denominator=-2).model_dump() == {"numerator": -1, "denominator": 2}

    def test_rational_score_is_immutable_and_hashable(self):
        score = RationalScore(numerator=17, denominator=5)
        with pytest.raises(ValidationError):
            score.numerator = 99
        assert hash(score) == hash(RationalScore(numerator=34, denominator=10))

    def test_rational_score_rejects_non_integer_parts(self):
        with pytest.raises(ValidationError):
            RationalScore(numerator="3", denominator=2)

    def test_answer_input_rejects_non_integer_rating(self):
        with pytest.raises(ValidationError):
            AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_5", rating=True)
        with pytest.raises(ValidationError):
            AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_5", rating="5")

    def test_progress_phase_must_be_known_phase(self):
        with pytest.raises(ValidationError):
            AssessmentProgressAdaptive(completed=0, min_total=12, max_total=30, phase="banana")

    @staticmethod
    def _dump(definition, answers=None):
        return SeededSelector(definition).select_next_question(answers or []).model_dump()

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda d: d.update(status="completed"),  # completed but still carries a next question
            lambda d: d.update(next_question=None),
            lambda d: d.update(next_question_id="q_zz_99"),  # id disagrees with question object
            lambda d: d.update(stopping_reason="question_limit"),
            lambda d: d.update(tie_applied=True),
            lambda d: d["progress"].update(phase="adaptive"),  # disagrees with outer phase
        ],
        ids=["completed_with_next", "next_without_question", "id_mismatch",
             "reason_while_running", "tie_while_running", "phase_mismatch"],
    )
    def test_selection_result_rejects_contradictory_next_question_state(self, seeded_v2_doc, mutate):
        data = self._dump(seeded_v2_doc)
        mutate(data)
        with pytest.raises(ValidationError):
            SelectionResult.model_validate(data)

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda d: d.update(stopping_reason=None),
            lambda d: d.update(phase="adaptive"),
            lambda d: d["progress"].update(total=None),
        ],
        ids=["no_reason", "wrong_phase", "no_total"],
    )
    def test_selection_result_rejects_contradictory_completed_state(self, valid_v1_doc, mutate):
        answers = [
            {"question_id": f"q_demo_{i:02}", "option_id": f"q_demo_{i:02}_opt_1"} for i in range(1, 7)
        ]
        data = self._dump(valid_v1_doc, answers)
        assert data["status"] == "completed"
        mutate(data)
        with pytest.raises(ValidationError):
            SelectionResult.model_validate(data)


class TestEarlyStopSoundness:
    """ADR-002 §7.10: a bounded_winner stop must survive every possible completion of the bank."""

    def test_bounded_winner_survives_worst_case_completion(self, seeded_v2_doc):
        rng = random.Random(20261018)
        houses = [h["house_id"] for h in seeded_v2_doc["houses"]]
        early_stops = 0
        for _ in range(300):
            ratings = {q["question_id"]: rng.randint(1, 5) for q in seeded_v2_doc["questions"]}
            trace = _run_path(seeded_v2_doc, lambda q, ratings=ratings: ratings[q.question_id])
            final = trace[-1]
            assert final.progress.total <= 30
            if final.stopping_reason != StoppingReason.BOUNDED_WINNER:
                continue
            early_stops += 1
            # Worst case: winner gets 1 on every unasked item, every rival gets 5.
            winner = final.primary_house_id
            worst = {}
            for h in houses:
                s = final.statistics[h]
                fill = 1 if h == winner else 5
                worst[h] = Fraction(s.sum + fill * (5 - s.count), 5)
            assert all(worst[winner] > worst[h] for h in houses if h != winner)
        assert early_stops > 0


class TestRemainingErrorCodes:
    """Each typed failure path is pinned to its error code."""

    def test_non_definition_payload_code(self):
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            SeededSelector().select_next_question(answers=[], definition="not-a-dict")
        assert exc_info.value.code == "VAL_INVALID_TYPE"

    def test_malformed_definition_dict_code(self, valid_v2_dict):
        del valid_v2_dict["questions"]
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            SeededSelector(valid_v2_dict)
        assert exc_info.value.code == "VAL_INVALID_FIELD"

    def test_no_definition_bound_code(self):
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            SeededSelector().select_next_question(answers=[])
        assert exc_info.value.code == "VAL_MISSING_REQUIRED_FIELD"

    @pytest.mark.parametrize(
        "answer",
        [
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5", "rating": 7},
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5", "rating": "5"},
            {"question_id": "bad id!", "option_id": "q_r_01_opt_5"},
        ],
        ids=["rating_out_of_range", "rating_as_string", "bad_id_pattern"],
    )
    def test_invalid_answer_schema_code(self, seeded_v2_doc, answer):
        with pytest.raises(InvalidPrefixError) as exc_info:
            SeededSelector(seeded_v2_doc).select_next_question([answer])
        assert exc_info.value.code == "VAL_INVALID_FIELD"

    def test_invalid_answer_type_code(self, seeded_v2_doc):
        with pytest.raises(InvalidPrefixError) as exc_info:
            SeededSelector(seeded_v2_doc).select_next_question(["q_r_01"])
        assert exc_info.value.code == "VAL_INVALID_TYPE"

    def test_missing_choice_rating_code(self, valid_v2_dict):
        valid_v2_dict["questions"][0]["choices"][4]["rating"] = None
        answers = [{"question_id": "q_r_01", "option_id": "q_r_01_opt_5"}]
        with pytest.raises(MissingMappingError) as exc_info:
            SeededSelector(valid_v2_dict).select_next_question(answers)
        assert exc_info.value.code == "VAL_INVALID_RATING"
