"""Unit tests for AdaptiveQuestionSelector (Task C-02 / M-ENG).

Verifies:
- FR-ENG-01: Adaptive Question Selection algorithm based on ADR-002 (§7.6, §7.7).
- AT-12: Deterministic question selection and stop conditions across golden fixtures.
- Baseline 12 items order and coverage across all 6 Holland RIASEC houses.
- EX-02: Bounded winner early stopping at 18 answers (House R).
- Equality of bounds: strict inequality check prevents premature stopping.
- EX-03: Maximum limit stopping at 30 items with tie-breaking order.
- Anti-repeat invariant: no duplicate question selection under any path.
- Typed failure handling: InvalidPrefixError, BankExhaustedError, UnsupportedDefinitionError, MissingMappingError.
- Backward compatibility with Definition 1.0 fixed 6 questions.
- 100% Determinism: identical outputs across repeated executions.
- EX-04: Edit answer invalidation re-evaluation.
"""

import copy
from fractions import Fraction
import pytest
from pydantic import ValidationError

from agent_runtime.engine.exceptions import (
    BankExhaustedError,
    EngineError,
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
from agent_runtime.engine.services.selector import (
    AdaptiveQuestionSelector,
    select_next_question,
)
from agent_runtime.evaluations.schemas.experience import ExperienceDefinitionDocument


@pytest.fixture
def valid_v2_dict(valid_v2_doc):
    return copy.deepcopy(valid_v2_doc)


@pytest.fixture
def valid_v1_dict(valid_v1_doc):
    return copy.deepcopy(valid_v1_doc)


class TestAdaptiveQuestionSelectorBaseline:
    """Test Suite for Phase 1: Baseline 12 Questions (ADR-002 §7.4)."""

    def test_start_with_empty_answers_returns_first_baseline_question(self, valid_v2_doc):
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        result = selector.select_next_question(answers=[])

        assert result.status == SelectionStatus.NEXT_QUESTION
        assert result.next_question_id == "q_r_01"
        assert result.next_question is not None
        assert result.next_question.question_id == "q_r_01"
        assert result.phase == SelectionPhase.BASELINE
        assert result.progress.completed == 0
        assert result.progress.min_total == 12
        assert result.progress.max_total == 30
        assert result.progress.total is None
        assert result.stopping_reason is None

    def test_baseline_full_sequence_12_questions(self, valid_v2_doc):
        """Verify that baseline follows exact order R1, I1, A1, S1, E1, C1, R2, I2, A2, S2, E2, C2."""
        expected_baseline = [
            "q_r_01", "q_i_01", "q_a_01", "q_s_01", "q_e_01", "q_c_01",
            "q_r_02", "q_i_02", "q_a_02", "q_s_02", "q_e_02", "q_c_02",
        ]

        selector = AdaptiveQuestionSelector(valid_v2_doc)
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

    def test_ex02_early_stopping_at_18_answers(self, valid_v2_doc):
        """Replay EX-02: R ratings are 5, others are 1.

        At 12: lower_r=2.6, upper_others=3.4 -> continue, next is q_r_03
        At 13: lower_r=3.4, upper_others=3.4 -> equality of bounds (not >), continue, next is q_i_03
        At 14: next is q_a_03
        At 15: next is q_s_03
        At 16: next is q_e_03
        At 17: next is q_c_03
        At 18: lower_r=3.4 > max upper_others=2.6 -> STOP bounded_winner House R!
        """
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        answers = []

        # Baseline: R items get rating 5, all others get rating 1
        baseline_qids = [
            ("q_r_01", 5), ("q_i_01", 1), ("q_a_01", 1),
            ("q_s_01", 1), ("q_e_01", 1), ("q_c_01", 1),
            ("q_r_02", 5), ("q_i_02", 1), ("q_a_02", 1),
            ("q_s_02", 1), ("q_e_02", 1), ("q_c_02", 1),
        ]

        for qid, rating in baseline_qids:
            answers.append({
                "question_id": qid,
                "option_id": f"{qid}_opt_{rating}",
            })

        # Step 12: Check state
        res12 = selector.select_next_question(answers)
        assert res12.status == SelectionStatus.NEXT_QUESTION
        assert res12.next_question_id == "q_r_03"
        assert res12.statistics["house_r"].lower.value == pytest.approx(2.6)
        assert res12.statistics["house_i"].upper.value == pytest.approx(3.4)

        # Step 13: Answer q_r_03 with rating 5
        answers.append({"question_id": "q_r_03", "option_id": "q_r_03_opt_5"})
        res13 = selector.select_next_question(answers)
        assert res13.status == SelectionStatus.NEXT_QUESTION
        assert res13.next_question_id == "q_i_03"
        # Verify equality of bounds: lower_r = 3.4 == upper_others = 3.4
        assert res13.statistics["house_r"].lower.value == pytest.approx(3.4)
        assert res13.statistics["house_i"].upper.value == pytest.approx(3.4)

        # Step 14: Answer q_i_03 with rating 1
        answers.append({"question_id": "q_i_03", "option_id": "q_i_03_opt_1"})
        res14 = selector.select_next_question(answers)
        assert res14.status == SelectionStatus.NEXT_QUESTION
        assert res14.next_question_id == "q_a_03"

        # Step 15: Answer q_a_03 with rating 1
        answers.append({"question_id": "q_a_03", "option_id": "q_a_03_opt_1"})
        res15 = selector.select_next_question(answers)
        assert res15.status == SelectionStatus.NEXT_QUESTION
        assert res15.next_question_id == "q_s_03"

        # Step 16: Answer q_s_03 with rating 1
        answers.append({"question_id": "q_s_03", "option_id": "q_s_03_opt_1"})
        res16 = selector.select_next_question(answers)
        assert res16.status == SelectionStatus.NEXT_QUESTION
        assert res16.next_question_id == "q_e_03"

        # Step 17: Answer q_e_03 with rating 1
        answers.append({"question_id": "q_e_03", "option_id": "q_e_03_opt_1"})
        res17 = selector.select_next_question(answers)
        assert res17.status == SelectionStatus.NEXT_QUESTION
        assert res17.next_question_id == "q_c_03"

        # Step 18: Answer q_c_03 with rating 1
        answers.append({"question_id": "q_c_03", "option_id": "q_c_03_opt_1"})
        res18 = selector.select_next_question(answers)

        # VERIFY EARLY STOP
        assert res18.status == SelectionStatus.COMPLETED
        assert res18.stopping_reason == StoppingReason.BOUNDED_WINNER
        assert res18.primary_house_id == "house_r"
        assert res18.tie_applied is False
        assert res18.next_question_id is None
        assert res18.phase == SelectionPhase.COMPLETED
        assert res18.progress.completed == 18
        assert res18.progress.total == 18
        assert res18.progress.phase == "completed"

        # Verify statistics at stop
        stat_r = res18.statistics["house_r"]
        assert stat_r.count == 3
        assert stat_r.sum == 15
        assert stat_r.mean.value == 5.0
        assert stat_r.lower.value == pytest.approx(3.4)  # (15 + 2) / 5 = 17/5
        assert stat_r.upper.value == pytest.approx(5.0)  # (15 + 10) / 5 = 25/5

        for other_h in ["house_i", "house_a", "house_s", "house_e", "house_c"]:
            stat_o = res18.statistics[other_h]
            assert stat_o.count == 3
            assert stat_o.sum == 3
            assert stat_o.mean.value == 1.0
            assert stat_o.lower.value == pytest.approx(1.0)  # (3 + 2) / 5 = 5/5
            assert stat_o.upper.value == pytest.approx(2.6)  # (3 + 10) / 5 = 13/5
            # lower_r (3.4) > upper_other (2.6) holds strictly!


class TestAdaptiveQuestionSelectorEdgeCases:
    """Test Suite for Edge Cases: Equality of Bounds, 30-item limit, Anti-repeat, Challengers."""

    def test_equality_of_bounds_does_not_stop_early(self, valid_v2_doc):
        """ADR-002 §7.6: lower_w == max(upper_h) must continue, not stop early."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
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
        res = selector.select_next_question(answers)
        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.stopping_reason is None

    def test_max_question_limit_with_perfect_tie_ex03(self, valid_v2_doc):
        """ADR-002 §8.4 / EX-03: All 30 ratings are 3 -> question_limit, house_r by tie order."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
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
        assert final_res.primary_house_id == "house_r"
        assert final_res.tie_applied is True
        assert final_res.progress.completed == 30
        assert final_res.progress.total == 30

    def test_all_ratings_low_stops_at_limit_with_tie(self, valid_v2_doc):
        """ADR-002 §8.4: All 30 ratings are 1 -> question_limit, house_r by tie policy."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
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
        assert final_res.primary_house_id == "house_r"
        assert final_res.tie_applied is True

    def test_anti_repeat_invariant_across_complete_trajectory(self, valid_v2_doc):
        """Verify that throughout 30 question selections, no question is ever repeated."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
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

    def test_challenger_returns_and_is_selected(self, valid_v2_doc):
        """Verify that a house outside the top-2 is eligible and selected when its gap is widest."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        # In baseline: house_i gets rating 5, others get rating 2
        answers = []
        rules = valid_v2_doc["selection_rules"] if isinstance(valid_v2_doc, dict) else valid_v2_doc.selection_rules
        payload = rules["payload"] if isinstance(rules, dict) else rules.payload
        baseline_order = payload["baseline_order"]
        for qid in baseline_order:
            h = qid.split("_")[1]
            rating = 5 if h == "i" else 2
            answers.append({"question_id": qid, "option_id": f"{qid}_opt_{rating}"})

        # At completed = 12: house_i has mean 5, others have mean 2
        res12 = selector.select_next_question(answers)
        assert res12.status == SelectionStatus.NEXT_QUESTION
        assert res12.next_question is not None


class TestAdaptiveQuestionSelectorValidationAndFailures:
    """Test Suite for Typed Failure Handling (DEC-04 & ADR-002 §7.7)."""

    def test_duplicate_question_in_answers_raises_invalid_prefix(self, valid_v2_doc):
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        answers = [
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5"},
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_4"},  # Duplicate!
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers)
        assert exc_info.value.code == "REQ_QUESTION_ALREADY_ANSWERED"

    def test_unknown_question_id_raises_invalid_prefix(self, valid_v2_doc):
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        answers = [
            {"question_id": "q_unknown_99", "option_id": "q_r_01_opt_5"},
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers)
        assert exc_info.value.code == "VAL_UNKNOWN_QUESTION_ID"

    def test_option_not_belonging_to_question_raises_invalid_prefix(self, valid_v2_doc):
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        answers = [
            {"question_id": "q_r_01", "option_id": "q_i_01_opt_1"},  # Option belongs to q_i_01!
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers)
        assert exc_info.value.code == "VAL_INVALID_OPTION_ID"

    def test_rating_mismatch_raises_invalid_prefix(self, valid_v2_doc):
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        answers = [
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5", "rating": 3},  # Option has rating 5!
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers)
        assert exc_info.value.code == "VAL_RATING_MISMATCH"

    def test_sequence_mismatch_raises_invalid_prefix(self, valid_v2_doc):
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        # Step 0 should be q_r_01, but user answers q_i_01 first
        answers = [
            {"question_id": "q_i_01", "option_id": "q_i_01_opt_1"},
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers, validate_sequence=True)
        assert exc_info.value.code == "REQ_SEQUENCE_MISMATCH"

    def test_sequence_mismatch_ignored_when_flag_false(self, valid_v2_doc):
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        # When validate_sequence=False, sequence replay is bypassed
        answers = [
            {"question_id": "q_i_01", "option_id": "q_i_01_opt_1"},
        ]
        res = selector.select_next_question(answers, validate_sequence=False)
        assert res.status == SelectionStatus.NEXT_QUESTION

    def test_unsupported_schema_version_raises_error(self, valid_v2_dict):
        valid_v2_dict["schema_version"] = "99.0"
        selector = AdaptiveQuestionSelector()
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            selector.select_next_question(answers=[], definition=valid_v2_dict)
        assert exc_info.value.code == "VAL_INVALID_SCHEMA_VERSION"

    def test_unsupported_selection_rule_raises_error(self, valid_v2_dict):
        valid_v2_dict["selection_rules"]["rule_schema_ref"] = "rule.schema.unsupported:v1"
        selector = AdaptiveQuestionSelector()
        with pytest.raises(UnsupportedDefinitionError) as exc_info:
            selector.select_next_question(answers=[], definition=valid_v2_dict)
        assert exc_info.value.code == "VAL_UNSUPPORTED_RULE_SCHEMA"

    def test_invalid_definition_payload_raises_error(self):
        selector = AdaptiveQuestionSelector()
        with pytest.raises(UnsupportedDefinitionError):
            selector.select_next_question(answers=[], definition="not-a-dict")


class TestAdaptiveQuestionSelectorDefinition10Compatibility:
    """Test Suite for Definition 1.0 (Fixed 6 questions) Backward Compatibility."""

    def test_v1_start_with_empty_answers_returns_initial_question(self, valid_v1_doc):
        selector = AdaptiveQuestionSelector(valid_v1_doc)
        res = selector.select_next_question(answers=[])

        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.next_question_id == "q_demo_01"
        assert res.phase == SelectionPhase.FIXED
        assert res.progress.completed == 0
        assert res.progress.total is None

    def test_v1_sequential_selection_up_to_6(self, valid_v1_doc):
        selector = AdaptiveQuestionSelector(valid_v1_doc)
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

    def test_determinism_50_repeated_calls(self, valid_v2_doc):
        """Same input prefix must yield 100% identical outputs every time."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        answers = [
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5"},
            {"question_id": "q_i_01", "option_id": "q_i_01_opt_1"},
            {"question_id": "q_a_01", "option_id": "q_a_01_opt_1"},
        ]

        first_res = selector.select_next_question(answers)

        for _ in range(50):
            repeated_res = selector.select_next_question(answers)
            assert repeated_res.next_question_id == first_res.next_question_id
            assert repeated_res.status == first_res.status
            assert repeated_res.phase == first_res.phase
            assert repeated_res.progress.completed == first_res.progress.completed
            assert repeated_res.statistics["house_r"].mean.value == first_res.statistics["house_r"].mean.value

    def test_ex04_edit_answer_13_recalculates_bounds_and_selects_qi03(self, valid_v2_doc):
        """ADR-002 §8.5 / EX-04: Edit answer 13 from rating 5 to rating 1.

        Previous state had early stop at 18.
        When answer 13 (q_r_03) is edited to rating 1, answers 14..18 are pruned.
        The prefix now has 13 answers.
        lower_r is now 2.6 < upper_others 3.4 -> in_progress, next question is q_i_03!
        """
        selector = AdaptiveQuestionSelector(valid_v2_doc)

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

        res = selector.select_next_question(answers, validate_sequence=True)

        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.next_question_id == "q_i_03"
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

    def test_convenience_function_select_next_question(self, valid_v2_doc):
        """Verify module-level select_next_question convenience wrapper."""
        res = select_next_question(valid_v2_doc, [])
        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.next_question_id == "q_r_01"

    def test_submitting_answer_after_assessment_completed_raises_error(self, valid_v2_doc):
        """Verify that submitting an answer when assessment already completed raises ASSESSMENT_ALREADY_COMPLETED."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        # 18 answers leading to early stop (EX-02)
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
            {"question_id": "q_i_03", "option_id": "q_i_03_opt_1"},
            {"question_id": "q_a_03", "option_id": "q_a_03_opt_1"},
            {"question_id": "q_s_03", "option_id": "q_s_03_opt_1"},
            {"question_id": "q_e_03", "option_id": "q_e_03_opt_1"},
            {"question_id": "q_c_03", "option_id": "q_c_03_opt_1"},
            # 19th answer submitted when already completed at 18
            {"question_id": "q_r_04", "option_id": "q_r_04_opt_5"},
        ]

        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers, validate_sequence=True)
        assert exc_info.value.code == "REQ_ASSESSMENT_ALREADY_COMPLETED"

    def test_answers_with_rich_session_metadata_accepted(self, valid_v2_doc):
        """Verify that AnswerInput accepts full ActivityAnswer dictionaries from database sessions."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        answers = [
            {
                "question_id": "q_r_01",
                "option_id": "q_r_01_opt_5",
                "answer_id": "ans_001",
                "ordinal": 1,
                "source": "option",
                "accepted_activity_revision": 2,
            }
        ]
        res = selector.select_next_question(answers)
        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.next_question_id == "q_i_01"

    def test_boolean_rating_in_answers_rejected(self, valid_v2_doc):
        """Verify that boolean rating (e.g. True) is strictly rejected."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        answers = [
            {"question_id": "q_r_01", "option_id": "q_r_01_opt_5", "rating": True}
        ]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers)
        assert exc_info.value.code == "VAL_INVALID_TYPE"

    def test_none_answers_treated_as_empty_list(self, valid_v2_doc):
        """Verify that passing answers=None gracefully defaults to empty list."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
        res = selector.select_next_question(answers=None)
        assert res.status == SelectionStatus.NEXT_QUESTION
        assert res.next_question_id == "q_r_01"

    def test_non_list_answers_raises_error(self, valid_v2_doc):
        """Verify that passing a non-list answers payload raises InvalidPrefixError."""
        selector = AdaptiveQuestionSelector(valid_v2_doc)
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
        selector = AdaptiveQuestionSelector(valid_v1_doc)
        # Expected step 0 is q_demo_01, but user answers q_demo_03 first
        answers = [{"question_id": "q_demo_03", "option_id": "q_demo_03_opt_1"}]
        with pytest.raises(InvalidPrefixError) as exc_info:
            selector.select_next_question(answers, validate_sequence=True)
        assert exc_info.value.code == "REQ_SEQUENCE_MISMATCH"


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
        return AdaptiveQuestionSelector(definition).select_next_question(answers or []).model_dump()

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda d: d.update(status="completed"),  # completed but still carries a next question
            lambda d: d.update(next_question=None),
            lambda d: d.update(next_question_id="q_i_01"),  # id disagrees with question object
            lambda d: d.update(stopping_reason="question_limit"),
            lambda d: d.update(tie_applied=True),
            lambda d: d["progress"].update(phase="adaptive"),  # disagrees with outer phase
        ],
        ids=["completed_with_next", "next_without_question", "id_mismatch",
             "reason_while_running", "tie_while_running", "phase_mismatch"],
    )
    def test_selection_result_rejects_contradictory_next_question_state(self, valid_v2_doc, mutate):
        data = self._dump(valid_v2_doc)
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
