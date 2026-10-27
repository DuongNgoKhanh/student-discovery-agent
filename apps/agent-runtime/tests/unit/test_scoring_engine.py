"""Unit tests for ScoringEngine, Contributions & RIASEC Classification (Task C-03 / M-ENG).

Verifies:
- FR-ENG-02, FR-ENG-03, FR-ENG-04: Deterministic scoring, exact mean ratings, linear display scores
- AT-13: Repeated runs yield identical scores, contributions, and classifications
- 6 Independent Golden Winners (R, I, A, S, E, C)
- Unequal answer counts: exact mean comparison vs sum comparison (R=[4,4] vs I=[5,4,3,4])
- Mathematical Invariants: mean contributions sum exactly to the house mean; display
  contributions sum to the display score within its 2-decimal rounding
- Ties: exact mean, then count of top ratings, then the activity seed (shared with the selector)
- Bounded winner early stopping vs question limit stopping
- Answer invalidation & recompute idempotency
- Typed failure handling for answers and definitions (shared with the selector)
- Simulated profiles on definitions sampled from the 60-question Holland Career Pool
- Definition 1.0 reports completion only (no scoring)
"""

import functools

import pytest

from agent_runtime.engine.error_codes import EngineErrorCode
from agent_runtime.engine.exceptions import (
    EngineError,
    InvalidPrefixError,
    MissingMappingError,
    UnsupportedDefinitionError,
)
from agent_runtime.engine.fixtures import (
    HOUSE_IDS,
    sample_experience_definition,
)
from agent_runtime.engine.schemas.selector import (
    AnswerInput,
    RationalScore,
    StoppingReason,
)
from agent_runtime.engine.services.ordering import rank_houses, seeded_order
from agent_runtime.engine.services.scorer import ScoringEngine as _ScoringEngine
from agent_runtime.engine.services.scorer import calculate_scores as _calculate_scores
from agent_runtime.engine.services.selector import AdaptiveQuestionSelector

SEED = "act_fixture"
LETTER = {"house_r": "R", "house_i": "I", "house_a": "A", "house_s": "S", "house_e": "E", "house_c": "C"}
calculate_scores = functools.partial(_calculate_scores, seed=SEED)


class ScoringEngine(_ScoringEngine):
    """Scoring engine bound to one activity seed, as the completion port calls it."""

    def calculate_scores(self, answers=None, definition=None, *, seed=SEED):
        return super().calculate_scores(answers, definition, seed=seed)


def _with_coverage(definition, answers, rating=1):
    """Append rating-`rating` answers until every house has its 2 baseline answers."""
    answered = {a.question_id for a in answers}
    counts = {}
    for q in definition.questions:
        if q.question_id in answered:
            counts[q.house_id] = counts.get(q.house_id, 0) + 1
    filled = list(answers)
    for q in definition.questions:
        if q.question_id not in answered and counts.get(q.house_id, 0) < 2:
            filled.append(AnswerInput(question_id=q.question_id, option_id=f"{q.question_id}_opt_{rating}"))
            counts[q.house_id] = counts.get(q.house_id, 0) + 1
    return filled


@pytest.fixture
def default_v2_def():
    """Default valid Definition 2.0 generated from Holland Career Pool."""
    return sample_experience_definition(seed=42)


class TestScoringEngineGoldenWinners:
    """Test suite proving each of the 6 RIASEC houses can independently win with exact math."""

    @pytest.mark.parametrize("target_house", HOUSE_IDS)
    def test_golden_winner_for_each_house(self, default_v2_def, target_house):
        """Each house must cleanly win when its items receive rating 5 and others receive rating 1."""
        engine = ScoringEngine(default_v2_def)

        # Build baseline 12 answers: rating 5 for target_house, rating 1 for other houses
        answers = []
        for q in default_v2_def.questions[:12]:
            rating = 5 if q.house_id == target_house else 1
            answers.append(
                AnswerInput(
                    question_id=q.question_id,
                    option_id=f"{q.question_id}_opt_{rating}",
                    rating=rating,
                )
            )

        result = engine.calculate_scores(answers)

        assert result.primary_house_id == target_house
        target_score = result.house_scores[target_house]
        assert target_score.count == 2
        assert target_score.sum == 10
        assert target_score.mean == RationalScore(numerator=5, denominator=1)
        assert target_score.display_score == 100.0
        assert target_score.rank == 1

        # Verify other houses have mean=1.0, display_score=0.0
        for h_id in HOUSE_IDS:
            if h_id != target_house:
                score = result.house_scores[h_id]
                assert score.count == 2
                assert score.sum == 2
                assert score.mean == RationalScore(numerator=1, denominator=1)
                assert score.display_score == 0.0
                assert score.rank > 1


class TestScoringEngineUnequalCounts:
    """Verifies ADR-002 §7.5: Mean resolves item count differences; sum is never used as winner."""

    def test_unequal_counts_same_mean_tie_breaker(self, default_v2_def):
        """R has ratings [4, 4] (sum=8, n=2) and I has [5, 4, 3, 4] (sum=16, n=4). Both mean=4.0.

        Sum comparison would erroneously pick I (16 > 8).
        Mean comparison recognises equal mean=4.0; the next tier is the count of top ratings, where I
        (one 5) beats R (none). The sum never decides.
        """
        engine = ScoringEngine(default_v2_def)

        answers = [
            # House R: 2 answers with ratings 4, 4
            AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_4", rating=4),
            AnswerInput(question_id="q_r_02", option_id="q_r_02_opt_4", rating=4),
            # House I: 4 answers with ratings 5, 4, 3, 4
            AnswerInput(question_id="q_i_01", option_id="q_i_01_opt_5", rating=5),
            AnswerInput(question_id="q_i_02", option_id="q_i_02_opt_4", rating=4),
            AnswerInput(question_id="q_i_03", option_id="q_i_03_opt_3", rating=3),
            AnswerInput(question_id="q_i_04", option_id="q_i_04_opt_4", rating=4),
        ]

        result = engine.calculate_scores(_with_coverage(default_v2_def, answers))

        r_score = result.house_scores["house_r"]
        i_score = result.house_scores["house_i"]

        assert r_score.sum == 8
        assert r_score.count == 2
        assert r_score.mean == RationalScore(numerator=4, denominator=1)

        assert i_score.sum == 16
        assert i_score.count == 4
        assert i_score.mean == RationalScore(numerator=4, denominator=1)

        # Equal exact mean ratings
        assert r_score.mean == i_score.mean

        # I ranks first on top ratings (5 vs none); the tie policy is only reported as applied at
        # question_limit.
        assert result.primary_house_id == "house_i"
        assert result.secondary_house_id == "house_r"
        assert result.is_complete is False
        assert result.tie_applied is False

    def test_higher_mean_wins_despite_smaller_sum(self, default_v2_def):
        """House R has ratings [5, 5] (sum=10, n=2, mean=5.0).
        House I has ratings [4, 4, 4, 4] (sum=16, n=4, mean=4.0).
        House R must win because 5.0 > 4.0, despite 10 < 16.
        """
        engine = ScoringEngine(default_v2_def)

        answers = [
            AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_5", rating=5),
            AnswerInput(question_id="q_r_02", option_id="q_r_02_opt_5", rating=5),
            AnswerInput(question_id="q_i_01", option_id="q_i_01_opt_4", rating=4),
            AnswerInput(question_id="q_i_02", option_id="q_i_02_opt_4", rating=4),
            AnswerInput(question_id="q_i_03", option_id="q_i_03_opt_4", rating=4),
            AnswerInput(question_id="q_i_04", option_id="q_i_04_opt_4", rating=4),
        ]

        result = engine.calculate_scores(_with_coverage(default_v2_def, answers))

        assert result.primary_house_id == "house_r"
        assert result.secondary_house_id == "house_i"
        assert result.tie_applied is False
        assert result.house_scores["house_r"].mean > result.house_scores["house_i"].mean


class TestScoringContributionsInvariants:
    """Verifies ADR-002 §7.5: Answer contributions sum strictly equals house score and mean."""

    def test_contributions_sum_invariants_across_varied_ratings(self, default_v2_def):
        """Mathematical invariant test: sum(contrib_mean) == mean and sum(contrib_display) == display_score."""
        engine = ScoringEngine(default_v2_def)

        # Complex rating mix across houses
        ratings_pattern = [
            ("q_r_01", 5), ("q_r_02", 3), ("q_r_03", 4),
            ("q_i_01", 2), ("q_i_02", 4),
            ("q_a_01", 1), ("q_a_02", 5), ("q_a_03", 5), ("q_a_04", 2),
            ("q_s_01", 3),
        ]

        answers = [
            AnswerInput(question_id=qid, option_id=f"{qid}_opt_{r}", rating=r)
            for qid, r in ratings_pattern
        ]

        result = engine.calculate_scores(answers)

        for house_id in ["house_r", "house_i", "house_a", "house_s"]:
            detail = result.house_scores[house_id]
            assert detail.count > 0
            assert len(detail.contributions) == detail.count

            # Invariant 1: Exact sum of rational mean contributions equals house mean
            total_rational_contrib = sum(
                c.mean_contribution.to_fraction() for c in detail.contributions
            )
            assert total_rational_contrib == detail.mean.to_fraction()

            # Invariant 2: display contributions sum to the 2-decimal display score
            total_display_contrib = sum(c.display_contribution for c in detail.contributions)
            assert pytest.approx(detail.display_score, abs=0.005) == total_display_contrib

        # Flat all_contributions must match total answer count and sequence order
        assert len(result.all_contributions) == len(answers)
        for i, contrib in enumerate(result.all_contributions):
            assert contrib.ordinal == i + 1


class TestScoringTiePolicyAndClassification:
    """Verifies the seeded tie policy and full classification."""

    def test_all_neutral_answers_tie_resolved_by_seed(self, default_v2_def):
        """All 30 answers rating 3: every house has mean 3.0 and no top ratings, so the seed ranks them."""
        engine = ScoringEngine(default_v2_def)

        answers = [
            AnswerInput(question_id=q.question_id, option_id=f"{q.question_id}_opt_3", rating=3)
            for q in default_v2_def.questions
        ]

        result = engine.calculate_scores(answers)

        assert result.total_answers == 30
        assert result.is_complete is True
        assert result.stopping_reason == StoppingReason.QUESTION_LIMIT
        expected = seeded_order(SEED, "house", HOUSE_IDS)
        assert result.ranked_houses == expected
        assert [result.primary_house_id, result.secondary_house_id, result.tertiary_house_id] == expected[:3]
        assert result.holland_code == "".join(LETTER[h] for h in expected[:3])
        assert result.tie_applied is True

        for h_id in HOUSE_IDS:
            assert result.house_scores[h_id].display_score == 50.0

    def test_holland_code_3_letters(self, default_v2_def):
        """House A = 5.0, House S = 4.0, House I = 3.0, others 1.0 -> Holland Code 'ASI'."""
        engine = ScoringEngine(default_v2_def)

        answers = [
            _answer(qid, rating)
            for qid, rating in [("q_a_01", 5), ("q_a_02", 5), ("q_s_01", 4), ("q_s_02", 4),
                                ("q_i_01", 3), ("q_i_02", 3)]
        ]

        result = engine.calculate_scores(_with_coverage(default_v2_def, answers))

        assert result.primary_house_id == "house_a"
        assert result.secondary_house_id == "house_s"
        assert result.tertiary_house_id == "house_i"
        assert result.holland_code == "ASI"
        assert result.ranked_houses[:3] == ["house_a", "house_s", "house_i"]


class TestScoringStoppingBounds:
    """Verifies ADR-002 §7.6: Provable stopping conditions (bounded_winner vs question_limit)."""

    def test_bounded_winner_at_18_answers(self, default_v2_def):
        """House R has 3 ratings of 5 (lower=3.4). All other 5 houses have 3 ratings of 1 (upper=2.6).

        3.4 > 2.6 -> satisfies bounded_winner early stop.
        """
        engine = ScoringEngine(default_v2_def)

        answers = []
        # House R: 3 answers rating 5
        for order in [1, 2, 3]:
            answers.append(AnswerInput(question_id=f"q_r_{order:02}", option_id=f"q_r_{order:02}_opt_5", rating=5))

        # Other 5 houses: 3 answers rating 1
        for code in ["i", "a", "s", "e", "c"]:
            for order in [1, 2, 3]:
                answers.append(
                    AnswerInput(
                        question_id=f"q_{code}_{order:02}",
                        option_id=f"q_{code}_{order:02}_opt_1",
                        rating=1,
                    )
                )

        assert len(answers) == 18
        result = engine.calculate_scores(answers)

        assert result.is_complete is True
        assert result.stopping_reason == StoppingReason.BOUNDED_WINNER
        assert result.primary_house_id == "house_r"
        assert result.tie_applied is False
        assert result.house_scores["house_r"].lower.value == 3.4
        assert result.house_scores["house_i"].upper.value == 2.6

    def test_no_early_stop_at_baseline_with_overlap(self, default_v2_def):
        """At 12 baseline answers: R has 2 ratings of 5 (lower=2.6), others have 2 ratings of 1 (upper=3.4).

        2.6 < 3.4 -> Must continue, no early stop.
        """
        engine = ScoringEngine(default_v2_def)

        answers = []
        for q in default_v2_def.questions[:12]:
            rating = 5 if q.house_id == "house_r" else 1
            answers.append(AnswerInput(question_id=q.question_id, option_id=f"{q.question_id}_opt_{rating}", rating=rating))

        assert len(answers) == 12
        result = engine.calculate_scores(answers)

        assert result.is_complete is False
        assert result.stopping_reason is None
        assert result.primary_house_id == "house_r"


class TestScoringInvalidationAndDeterminism:
    """Verifies answer editing invalidation safety and 100% determinism."""

    def test_invalidation_recompute_fresh_from_prefix(self, default_v2_def):
        """Modifying an earlier answer completely recalculates scores and contributions."""
        engine = ScoringEngine(default_v2_def)

        # Step 1: R=[1, 1] (mean 1), I=[5, 1] (mean 3), other houses rating 1
        initial_answers = _with_coverage(default_v2_def, [
            AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_1", rating=1),
            AnswerInput(question_id="q_i_01", option_id="q_i_01_opt_5", rating=5),
        ])
        res1 = engine.calculate_scores(initial_answers)
        assert res1.primary_house_id == "house_i"
        assert res1.house_scores["house_r"].mean.value == 1.0

        # Step 2: Edit q_r_01 from rating 1 to rating 5 -> R=[5, 1] (mean 3)
        edited_answers = [
            AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_5", rating=5),
            *initial_answers[1:],
        ]
        res2 = engine.calculate_scores(edited_answers)

        # House R now ties House I at mean=3.0, so R ranks first by tie order
        assert res2.primary_house_id == "house_r"
        assert res2.house_scores["house_r"].mean.value == 3.0
        assert res2.tie_applied is False
        assert res2.house_scores["house_r"].contributions[0].mean_value == 2.5

    def test_reproducibility_10_runs(self, default_v2_def):
        """10 repeated runs with identical answers yield identical outputs."""
        answers = [
            AnswerInput(question_id=q.question_id, option_id=f"{q.question_id}_opt_4", rating=4)
            for q in default_v2_def.questions[:15]
        ]
        engine = ScoringEngine(default_v2_def)

        runs = [engine.calculate_scores(answers) for _ in range(10)]
        first_dump = runs[0].model_dump(mode="json")

        for run in runs[1:]:
            assert run.model_dump(mode="json") == first_dump


class TestScoringErrorHandling:
    """Verifies typed exceptions and error codes."""

    def test_unknown_question_rejected(self, default_v2_def):
        engine = ScoringEngine(default_v2_def)
        with pytest.raises(InvalidPrefixError) as exc:
            engine.calculate_scores([AnswerInput(question_id="q_unknown_99", option_id="opt_1", rating=1)])
        assert exc.value.code == EngineErrorCode.UNKNOWN_QUESTION_ID

    def test_unknown_option_rejected(self, default_v2_def):
        engine = ScoringEngine(default_v2_def)
        with pytest.raises(InvalidPrefixError) as exc:
            engine.calculate_scores([AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_unknown", rating=1)])
        assert exc.value.code == EngineErrorCode.INVALID_OPTION_ID

    def test_duplicate_question_rejected(self, default_v2_def):
        engine = ScoringEngine(default_v2_def)
        with pytest.raises(InvalidPrefixError) as exc:
            engine.calculate_scores([
                AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_1", rating=1),
                AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_2", rating=2),
            ])
        assert exc.value.code == EngineErrorCode.QUESTION_ALREADY_ANSWERED

    def test_rating_mismatch_rejected(self, default_v2_def):
        engine = ScoringEngine(default_v2_def)
        with pytest.raises(InvalidPrefixError) as exc:
            engine.calculate_scores([
                AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_1", rating=5)  # opt_1 has rating 1
            ])
        assert exc.value.code == EngineErrorCode.RATING_MISMATCH


class TestScoringHollandPoolSimulations:
    """Simulated student profiles on definitions sampled with different seeds."""

    @pytest.mark.parametrize("seed,expected_primary", [
        (10, "house_r"),
        (20, "house_i"),
        (30, "house_a"),
    ])
    def test_career_pool_persona_simulations(self, seed, expected_primary):
        """Demonstrates that definitions generated from the 60-question career pool score correctly."""
        doc = sample_experience_definition(seed=seed)
        engine = ScoringEngine(doc)

        # Simulate a student favoring expected_primary
        answers = []
        for q in doc.questions:
            rating = 5 if q.house_id == expected_primary else 2
            answers.append(
                AnswerInput(question_id=q.question_id, option_id=f"{q.question_id}_opt_{rating}", rating=rating)
            )

        res = engine.calculate_scores(answers)
        assert res.primary_house_id == expected_primary
        assert res.is_complete is True
        assert res.stopping_reason == StoppingReason.QUESTION_LIMIT
        assert res.house_scores[expected_primary].display_score == 100.0


class TestScoringBackwardCompatibilityV1:
    """Definition 1.0 choices are unrated: completion is reported, nothing is classified."""

    def test_definition_v1_reports_completion_without_classification(self, valid_v1_doc):
        engine = ScoringEngine(valid_v1_doc)
        answers = [
            {"question_id": f"q_demo_{i:02}", "option_id": f"q_demo_{i:02}_opt_1"}
            for i in range(1, 7)
        ]
        res = engine.calculate_scores(answers)
        assert res.schema_version == "1.0"
        assert res.is_complete is True
        assert res.stopping_reason == StoppingReason.FIXED_COVERAGE
        assert res.primary_house_id is None
        assert res.holland_code is None
        assert res.house_scores == {}

    def test_definition_v1_incomplete(self, valid_v1_doc):
        answers = [{"question_id": "q_demo_01", "option_id": "q_demo_01_opt_1"}]
        res = ScoringEngine(valid_v1_doc).calculate_scores(answers)
        assert res.is_complete is False
        assert res.stopping_reason is None
        assert res.total_answers == 1


def _answer(question_id: str, rating: int) -> AnswerInput:
    return AnswerInput(question_id=question_id, option_id=f"{question_id}_opt_{rating}", rating=rating)


@pytest.fixture
def v2_dict():
    """Raw Definition 2.0 dict, for building malformed variants."""
    return sample_experience_definition(seed=42, return_dict=True)


class TestScoringErrorPaths:
    """Every failure surfaces as a typed engine error with an existing code."""

    @pytest.mark.parametrize("answer", [{"question_id": "q_r_01"}, 42])
    def test_malformed_answer_payload(self, default_v2_def, answer):
        with pytest.raises(InvalidPrefixError) as exc:
            ScoringEngine(default_v2_def).calculate_scores([answer])
        assert exc.value.code in (EngineErrorCode.INVALID_FIELD, EngineErrorCode.INVALID_TYPE)

    def test_unsupported_schema_version(self, v2_dict):
        v2_dict["schema_version"] = "3.0"
        with pytest.raises(UnsupportedDefinitionError) as exc:
            ScoringEngine(v2_dict).calculate_scores([])
        assert exc.value.code in (EngineErrorCode.INVALID_SCHEMA_VERSION, EngineErrorCode.INVALID_FIELD)

    def test_missing_definition(self):
        with pytest.raises(UnsupportedDefinitionError) as exc:
            ScoringEngine().calculate_scores([])
        assert exc.value.code == EngineErrorCode.MISSING_REQUIRED_FIELD

    def test_choice_without_rating_is_rejected_not_trusted_from_client(self, v2_dict):
        for choice in v2_dict["questions"][0]["choices"]:
            choice.pop("rating")
        qid = v2_dict["questions"][0]["question_id"]
        with pytest.raises(MissingMappingError) as exc:
            ScoringEngine(v2_dict).calculate_scores([{"question_id": qid, "option_id": f"{qid}_opt_1", "rating": 5}])
        assert exc.value.code == EngineErrorCode.INVALID_RATING

    def test_rating_resolved_from_definition_when_omitted(self, default_v2_def):
        res = ScoringEngine(default_v2_def).calculate_scores(
            [AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_4")]
        )
        assert res.house_scores["house_r"].sum == 4

    def test_unknown_house_in_question_rejected(self, v2_dict):
        v2_dict["questions"][0]["house_id"] = "house_x"
        with pytest.raises(MissingMappingError) as exc:
            ScoringEngine(v2_dict).calculate_scores([])
        assert exc.value.code == EngineErrorCode.INVALID_HOUSE_REF

    def test_non_riasec_houses_rejected(self, v2_dict):
        old, new = "house_r", "house_z"
        v2_dict["houses"][0]["house_id"] = new
        for q in v2_dict["questions"]:
            if q["house_id"] == old:
                q["house_id"] = new
        order = v2_dict["tie_policy"]["payload"].get("order")
        if order:
            order[order.index(old)] = new
        with pytest.raises(MissingMappingError) as exc:
            ScoringEngine(v2_dict).calculate_scores([])
        assert exc.value.code == EngineErrorCode.INVALID_HOUSE_REF

    @pytest.mark.parametrize("payload_update", [
        {"items_per_house": 0},
        {"items_per_house": 2},
        {"max_total": "30"},
    ])
    def test_invalid_coverage_config(self, v2_dict, payload_update):
        v2_dict["coverage_rules"]["payload"].update(payload_update)
        with pytest.raises((UnsupportedDefinitionError, MissingMappingError)):
            ScoringEngine(v2_dict).calculate_scores([])

    def test_missing_coverage_keys_rejected(self, v2_dict):
        del v2_dict["coverage_rules"]["payload"]["items_per_house"]
        with pytest.raises(UnsupportedDefinitionError) as exc:
            ScoringEngine(v2_dict).calculate_scores([])
        assert exc.value.code == EngineErrorCode.INVALID_COVERAGE_CONFIG


class TestScoringEdgeCases:
    """Boundary behaviour of ranking, coverage, stopping and tie policy."""

    def test_no_answers(self, default_v2_def):
        res = calculate_scores([], default_v2_def)
        assert res.primary_house_id is None
        assert res.holland_code is None
        assert res.ranked_houses == []
        assert res.is_complete is False
        assert res.all_contributions == []

    def test_classification_withheld_before_baseline_coverage(self, default_v2_def):
        """ADR-002 §7.5: no result before every house has its baseline answers."""
        answers = [_answer(q.question_id, 5) for q in default_v2_def.questions[:11]]
        res = calculate_scores(answers, default_v2_def)
        assert res.house_scores["house_r"].display_score == 100.0
        assert res.house_scores["house_c"].count == 1
        assert (res.primary_house_id, res.holland_code, res.ranked_houses) == (None, None, [])
        assert all(d.rank is None for d in res.house_scores.values())

    def test_all_ratings_one_still_ranks_by_seed(self, default_v2_def):
        answers = [_answer(q.question_id, 1) for q in default_v2_def.questions[:12]]
        res = calculate_scores(answers, default_v2_def)
        assert all(d.display_score == 0.0 for d in res.house_scores.values())
        assert res.holland_code == "".join(LETTER[h] for h in seeded_order(SEED, "house", HOUSE_IDS)[:3])
        assert res.is_complete is False

    def test_question_limit_without_coverage_rejected(self, v2_dict):
        v2_dict["coverage_rules"]["payload"]["max_total"] = 12
        doc = ScoringEngine._coerce_definition(v2_dict)
        answers = [_answer(q.question_id, 3) for q in doc.questions if q.house_id != "house_c"][:12]
        with pytest.raises(InvalidPrefixError) as exc:
            calculate_scores(answers, doc)
        assert exc.value.code == EngineErrorCode.SEQUENCE_MISMATCH

    def test_bounded_lead_without_min_coverage_does_not_stop(self, default_v2_def):
        answers = [_answer(f"q_r_{i:02}", 5) for i in range(1, 6)]
        res = calculate_scores(answers, default_v2_def)
        assert res.is_complete is False

    def test_display_contributions_within_rounding(self, default_v2_def):
        answers = [_answer("q_r_01", 2), _answer("q_r_02", 3), _answer("q_r_03", 3)]
        detail = calculate_scores(answers, default_v2_def).house_scores["house_r"]
        assert detail.display_score == 41.67
        assert pytest.approx(detail.display_score, abs=0.005) == sum(
            c.display_contribution for c in detail.contributions
        )


class TestScoringMatchesSelector:
    """Scorer and selector must agree on statistics and completion for the same prefix."""

    @pytest.mark.parametrize("profile", [
        {"house_r": 5, "house_i": 4},
        {"house_s": 4, "house_e": 4},
        {},
    ])
    def test_agrees_along_selector_path(self, default_v2_def, profile):
        selector = AdaptiveQuestionSelector(default_v2_def)
        question_house = {q.question_id: q.house_id for q in default_v2_def.questions}
        answers = []
        while True:
            sel = selector.select_next_question(answers, seed=SEED)
            res = calculate_scores(answers, default_v2_def)
            assert res.is_complete == (sel.next_question_id is None)
            for h_id, stats in sel.statistics.items():
                assert res.house_scores[h_id].display_score == stats.display_score
                assert res.house_scores[h_id].mean == stats.mean
            if sel.next_question_id is None:
                assert res.stopping_reason == sel.stopping_reason
                assert res.primary_house_id == sel.primary_house_id
                assert res.tie_applied == sel.tie_applied
                break
            assert res.tie_applied is False
            qid = sel.next_question_id
            answers.append(_answer(qid, profile.get(question_house[qid], 2)))


class TestSeededScoring:
    """The scorer ranks with the same seeded rule as the selector, so completion never disagrees."""

    def test_scorer_requires_seed_for_v2(self, default_v2_def):
        with pytest.raises(EngineError) as caught:
            _ScoringEngine(default_v2_def).calculate_scores([])
        assert caught.value.code == EngineErrorCode.MISSING_REQUIRED_FIELD

    @pytest.mark.parametrize("n", range(30))
    def test_scorer_and_selector_agree_on_winner(self, default_v2_def, n):
        seed = f"act_{n}"
        prefs = {h: 1 + (n + i) % 5 for i, h in enumerate(HOUSE_IDS)}
        selector, answers = AdaptiveQuestionSelector(default_v2_def), []
        house_of = {q.question_id: q.house_id for q in default_v2_def.questions}
        while (sel := selector.select_next_question(answers, seed=seed)).next_question_id is not None:
            answers.append(_answer(sel.next_question_id, prefs[house_of[sel.next_question_id]]))
        res = _ScoringEngine(default_v2_def).calculate_scores(answers, seed=seed)
        assert (res.primary_house_id, res.tie_applied) == (sel.primary_house_id, sel.tie_applied)
        ratings = {h: [] for h in HOUSE_IDS}
        for a in answers:
            ratings[house_of[a.question_id]].append(a.rating)
        assert res.ranked_houses == rank_houses(HOUSE_IDS, ratings, seed)
