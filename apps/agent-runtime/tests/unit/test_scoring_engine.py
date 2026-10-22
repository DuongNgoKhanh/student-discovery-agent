"""Unit tests for ScoringEngine, Contributions & RIASEC Classification (Task C-03 / M-ENG).

Verifies:
- FR-ENG-02, FR-ENG-03, FR-ENG-04: Deterministic scoring, exact mean ratings, linear display scores
- AT-13: Full version reproducibility of scores, contributions, and classifications
- 6 Independent Golden Winners (R, I, A, S, E, C)
- Unequal answer counts: exact mean comparison vs sum comparison (R=[4,4] vs I=[5,4,3,4])
- Mathematical Invariants: sum of contributions strictly equals house score and mean
- DEC-04: Holland Hexagonal Tie-Breaking Order (R -> I -> A -> S -> E -> C)
- Bounded winner early stopping vs question limit stopping
- Answer invalidation & recompute idempotency
- Typed failure handling: QUESTION_NOT_IN_BANK, OPTION_NOT_FOUND, DUPLICATE_QUESTION, RATING_MISMATCH
- Trial simulations across diverse Holland Career Pool 60 personas
- Backward compatibility for Definition 1.0
"""

import pytest

from agent_runtime.engine.error_codes import EngineErrorCode
from agent_runtime.engine.exceptions import (
    InvalidPrefixError,
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
from agent_runtime.engine.services.scorer import (
    ScoringEngine,
)


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
        Mean comparison recognises equal mean=4.0 and uses tie policy (R before I).
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

        result = engine.calculate_scores(answers)

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

        # House R wins due to Holland tie order (R before I)
        assert result.primary_house_id == "house_r"
        assert result.secondary_house_id == "house_i"
        assert result.tie_applied is True

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

        result = engine.calculate_scores(answers)

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

            # Invariant 2: Sum of display score contributions equals house display score
            total_display_contrib = sum(c.display_contribution for c in detail.contributions)
            assert pytest.approx(detail.display_score, abs=1e-4) == total_display_contrib

        # Flat all_contributions must match total answer count and sequence order
        assert len(result.all_contributions) == len(answers)
        for i, contrib in enumerate(result.all_contributions):
            assert contrib.ordinal == i + 1


class TestScoringTiePolicyAndClassification:
    """Verifies DEC-04 Holland Hexagonal Tie Policy and Full Classification."""

    def test_all_neutral_answers_tie_resolved_to_house_r(self, default_v2_def):
        """All 30 answers rating 3: all houses have mean=3.0, resolves to house_r with tie_applied=True."""
        engine = ScoringEngine(default_v2_def)

        answers = [
            AnswerInput(question_id=q.question_id, option_id=f"{q.question_id}_opt_3", rating=3)
            for q in default_v2_def.questions
        ]

        result = engine.calculate_scores(answers)

        assert result.total_answers == 30
        assert result.is_complete is True
        assert result.stopping_reason == StoppingReason.QUESTION_LIMIT
        assert result.primary_house_id == "house_r"
        assert result.secondary_house_id == "house_i"
        assert result.tertiary_house_id == "house_a"
        assert result.holland_code == "RIA"
        assert result.tie_applied is True

        # Ranked houses must match tie order exactly
        assert result.ranked_houses == [
            "house_r", "house_i", "house_a", "house_s", "house_e", "house_c"
        ]

        for h_id in HOUSE_IDS:
            assert result.house_scores[h_id].display_score == 50.0
            assert pytest.approx(result.house_scores[h_id].share_percentage, abs=0.1) == 16.67

    def test_holland_code_3_letters(self, default_v2_def):
        """House A = 5.0, House S = 4.0, House I = 3.0 -> Holland Code 'ASI'."""
        engine = ScoringEngine(default_v2_def)

        answers = [
            AnswerInput(question_id="q_a_01", option_id="q_a_01_opt_5", rating=5),
            AnswerInput(question_id="q_s_01", option_id="q_s_01_opt_4", rating=4),
            AnswerInput(question_id="q_i_01", option_id="q_i_01_opt_3", rating=3),
        ]

        result = engine.calculate_scores(answers)

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

        # Step 1: Initial answers with R rating 1
        initial_answers = [
            AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_1", rating=1),
            AnswerInput(question_id="q_i_01", option_id="q_i_01_opt_5", rating=5),
        ]
        res1 = engine.calculate_scores(initial_answers)
        assert res1.primary_house_id == "house_i"
        assert res1.house_scores["house_r"].mean.value == 1.0

        # Step 2: Edit q_r_01 from rating 1 to rating 5
        edited_answers = [
            AnswerInput(question_id="q_r_01", option_id="q_r_01_opt_5", rating=5),
            AnswerInput(question_id="q_i_01", option_id="q_i_01_opt_5", rating=5),
        ]
        res2 = engine.calculate_scores(edited_answers)

        # House R now ties House I at mean=5.0, so R wins by tie policy
        assert res2.primary_house_id == "house_r"
        assert res2.house_scores["house_r"].mean.value == 5.0
        assert res2.tie_applied is True
        assert res2.house_scores["house_r"].contributions[0].mean_value == 5.0

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
    """Simulated student profiles across diverse Holland Career Pool 60 samples."""

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
    """Verifies Definition 1.0 backward compatibility."""

    def test_definition_v1_legacy_scoring(self, valid_v1_doc):
        engine = ScoringEngine(valid_v1_doc)
        answers = [
            {"question_id": f"q_demo_{i:02}", "option_id": f"q_demo_{i:02}_opt_1"}
            for i in range(1, 7)
        ]
        res = engine.calculate_scores(answers)
        assert res.schema_version == "1.0"
        assert res.is_complete is True
        assert res.stopping_reason == StoppingReason.FIXED_COVERAGE
        assert res.primary_house_id == "house_r"
