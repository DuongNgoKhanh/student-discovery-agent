"""Authoritative Scoring, Contributions and RIASEC Classification Engine (Task C-03 / M-ENG).

Conforms to:
- ADR-002: §7.4 (Holland RIASEC 30-item assessment structure & Likert 1..5 scale)
- ADR-002: §7.5 (Exact Rational Scoring, Mean Ratings & Display Score 0..100)
- ADR-002: §7.5 (Answer Contributions Invariants: sum(mean contrib) == mean exactly)
- ADR-002: §7.6 (Stopping condition with provable bounds: bounded_winner, question_limit)
- Ties: exact mean, then count of top ratings, then a per-activity seeded key (engine/services/ordering.py)
- 100% Deterministic First (No LLM, no unseeded randomness)

Definition validation, answer normalization and house statistics are shared with
AdaptiveQuestionSelector so both engines agree on the same answer prefix.
"""

from typing import Any, Dict, List, Optional, Union

from pydantic import ValidationError

from agent_runtime.engine.error_codes import EngineErrorCode
from agent_runtime.engine.exceptions import (
    EngineError,
    InvalidPrefixError,
    MissingMappingError,
    UnsupportedDefinitionError,
)
from agent_runtime.engine.schemas.scoring import (
    AnswerContribution,
    AssessmentScoringResult,
    HouseScoreDetail,
)
from agent_runtime.engine.schemas.selector import (
    AnswerInput,
    HouseStatistics,
    RationalScore,
    StoppingReason,
)
from agent_runtime.engine.services.ordering import rank_houses
from agent_runtime.engine.services.selector import (
    SUPPORTED_SCHEMA_VERSIONS,
    AdaptiveQuestionSelector,
)
from agent_runtime.evaluations.schemas.experience import ExperienceDefinitionDocument

HOLLAND_CODE_LETTER_MAP = {
    "house_r": "R",
    "house_i": "I",
    "house_a": "A",
    "house_s": "S",
    "house_e": "E",
    "house_c": "C",
}


class ScoringEngine:
    """Authoritative deterministic scoring, contributions & classification engine."""

    def __init__(
        self,
        definition: Optional[Union[ExperienceDefinitionDocument, Dict[str, Any]]] = None,
    ):
        """Initialize the scoring engine with an optional bound experience definition."""
        # Source of the shared definition validation, answer normalization and statistics.
        self._selector = AdaptiveQuestionSelector()
        self._definition: Optional[ExperienceDefinitionDocument] = None
        if definition is not None:
            self._definition = self._coerce_definition(definition)

    @classmethod
    def _coerce_definition(
        cls, definition: Union[ExperienceDefinitionDocument, Dict[str, Any]]
    ) -> ExperienceDefinitionDocument:
        """Validate and coerce raw dict or model into an ExperienceDefinitionDocument."""
        if isinstance(definition, ExperienceDefinitionDocument):
            return definition
        if isinstance(definition, dict):
            try:
                return ExperienceDefinitionDocument.model_validate(definition)
            except ValidationError as e:
                raise UnsupportedDefinitionError(
                    f"Malformed ExperienceDefinitionDocument: {str(e)}",
                    code=EngineErrorCode.INVALID_FIELD,
                ) from e
        raise UnsupportedDefinitionError(
            f"Expected ExperienceDefinitionDocument or dict, got {type(definition).__name__}",
            code=EngineErrorCode.INVALID_TYPE,
        )

    def calculate_scores(
        self,
        answers: Optional[List[Union[AnswerInput, Dict[str, Any]]]] = None,
        definition: Optional[Union[ExperienceDefinitionDocument, Dict[str, Any]]] = None,
        *,
        seed: Optional[str] = None,
    ) -> AssessmentScoringResult:
        """Calculate exact rational scores, linear display scores, contributions and rankings.

        The answer sequence itself is not replayed against the selector; callers accept
        answers through the selector first.

        Args:
            answers: List of answered questions (empty/None for unstarted assessment).
            definition: Experience definition document; overrides the one bound at initialization.
            seed: Activity id the selector used; required for Definition 2.0 so ties rank the same way.

        Returns:
            AssessmentScoringResult: Fully resolved score reports, contributions, Holland code.

        Raises:
            InvalidPrefixError: On malformed, duplicate or unknown answers, or a rating mismatch.
            MissingMappingError: If a question or choice lacks its house_id, item_order or rating.
            UnsupportedDefinitionError: If definition structure is invalid or unsupported.
        """
        active_def = self._definition if definition is None else self._coerce_definition(definition)
        if active_def is None:
            raise UnsupportedDefinitionError(
                "No ExperienceDefinitionDocument provided to ScoringEngine",
                code=EngineErrorCode.MISSING_REQUIRED_FIELD,
            )
        if active_def.schema_version not in SUPPORTED_SCHEMA_VERSIONS:
            raise UnsupportedDefinitionError(
                f"Unsupported schema_version '{active_def.schema_version}'. Supported: {SUPPORTED_SCHEMA_VERSIONS}",
                code=EngineErrorCode.INVALID_SCHEMA_VERSION,
            )

        self._selector._validate_definition(active_def)
        normalized_answers, _ = self._selector._normalize_and_validate_answers(answers, active_def)

        if active_def.schema_version == "2.0":
            if not isinstance(seed, str) or not seed:
                raise EngineError(
                    "Definition 2.0 scoring requires a non-empty seed (the activity id)",
                    code=EngineErrorCode.MISSING_REQUIRED_FIELD,
                )
            return self._score_v2(active_def, normalized_answers, seed)
        return self._score_v1(active_def, normalized_answers)

    # --------------------------------------------------------------------------
    # Definition 2.0 Scoring Implementation (ADR-002)
    # --------------------------------------------------------------------------

    def _score_v2(
        self,
        definition: ExperienceDefinitionDocument,
        answers: List[AnswerInput],
        seed: str,
    ) -> AssessmentScoringResult:
        """Execute scoring, contributions and classification for Definition 2.0."""
        house_ids = [h.house_id for h in definition.houses]
        unknown_houses = [h_id for h_id in house_ids if h_id not in HOLLAND_CODE_LETTER_MAP]
        if unknown_houses:
            raise MissingMappingError(
                f"Houses {unknown_houses} have no Holland RIASEC letter",
                code=EngineErrorCode.INVALID_HOUSE_REF,
            )

        question_map = {q.question_id: q for q in definition.questions}
        house_name_map = {h.house_id: h.name for h in definition.houses}
        # Presence and shape of these keys is enforced by _validate_definition.
        coverage_payload = definition.coverage_rules.payload
        items_per_house: int = coverage_payload["items_per_house"]
        max_total: int = coverage_payload["max_total"]
        min_answers_per_house: int = coverage_payload["min_answers_per_house"]

        stats: Dict[str, HouseStatistics] = self._selector._compute_house_statistics(
            definition, answers, question_map, items_per_house
        )
        ratings = self._selector._ratings_by_house(definition, answers, question_map)

        # Step 1: Per-answer contributions, keeping the 1-based answer ordinal (ADR-002 §7.5)
        contributions_by_house: Dict[str, List[AnswerContribution]] = {h_id: [] for h_id in house_ids}
        for ordinal, ans in enumerate(answers, start=1):
            house_id = question_map[ans.question_id].house_id
            n_h = stats[house_id].count
            contributions_by_house[house_id].append(
                AnswerContribution(
                    question_id=ans.question_id,
                    option_id=ans.option_id,
                    house_id=house_id,
                    rating=ans.rating,
                    ordinal=ordinal,
                    mean_contribution=RationalScore(numerator=ans.rating, denominator=n_h),
                    display_contribution=round(25.0 * (ans.rating - 1) / n_h, 6),
                )
            )

        # Step 2: No ranking or classification before every house reaches baseline
        # coverage (ADR-002 §7.5). Once covered, rank with the shared seeded ranking (mean, top ratings, seed).
        total_answers = len(answers)
        covered = all(s.count >= min_answers_per_house for s in stats.values())
        if total_answers >= max_total and not covered:
            raise InvalidPrefixError(
                f"{total_answers} answers reach the question limit without baseline coverage",
                code=EngineErrorCode.SEQUENCE_MISMATCH,
            )
        ranked_houses: List[str] = []
        if covered:
            ranked_houses = rank_houses(house_ids, ratings, seed)
        rank_of = {h_id: rank for rank, h_id in enumerate(ranked_houses, start=1)}

        # Step 3: Build house details; display_score is a per-house rescale, never a share.
        house_scores: Dict[str, HouseScoreDetail] = {
            h_id: HouseScoreDetail(
                **stats[h_id].model_dump(),
                house_name=house_name_map[h_id],
                rank=rank_of.get(h_id),
                contributions=contributions_by_house[h_id],
            )
            for h_id in house_ids
        }

        # Step 4: Classify primary, secondary, tertiary houses and Holland Code
        top_houses: List[Optional[str]] = list(ranked_houses[:3]) or [None, None, None]
        holland_code = "".join(HOLLAND_CODE_LETTER_MAP[h] for h in ranked_houses[:3]) or None

        # Step 5: Evaluate Completion and Stopping Reason (ADR-002 §7.6)
        stopping_reason: Optional[StoppingReason] = None
        tie_applied = False

        if total_answers >= max_total:
            stopping_reason = StoppingReason.QUESTION_LIMIT
            winner, tie_applied = self._selector._resolve_winner_at_limit(stats, ratings, seed)
            if winner != ranked_houses[0]:
                raise EngineError(
                    f"Scorer winner '{ranked_houses[0]}' disagrees with selector winner '{winner}'",
                )
        elif covered:
            leader = ranked_houses[0]
            max_other_upper = max(
                s.upper.to_fraction() for h_id, s in stats.items() if h_id != leader
            )
            if stats[leader].lower.to_fraction() > max_other_upper:
                stopping_reason = StoppingReason.BOUNDED_WINNER

        return AssessmentScoringResult(
            schema_version="2.0",
            primary_house_id=top_houses[0],
            secondary_house_id=top_houses[1],
            tertiary_house_id=top_houses[2],
            holland_code=holland_code,
            tie_applied=tie_applied,
            house_scores=house_scores,
            ranked_houses=ranked_houses,
            all_contributions=sorted(
                (c for cs in contributions_by_house.values() for c in cs), key=lambda c: c.ordinal
            ),
            is_complete=stopping_reason is not None,
            stopping_reason=stopping_reason,
            total_answers=total_answers,
        )

    # --------------------------------------------------------------------------
    # Definition 1.0 Legacy Implementation
    # --------------------------------------------------------------------------

    def _score_v1(
        self,
        definition: ExperienceDefinitionDocument,
        answers: List[AnswerInput],
    ) -> AssessmentScoringResult:
        """Report Definition 1.0 completion only.

        v1 choices carry no ratings, so there is nothing to score: no house scores,
        ranking or Holland code are produced (matching the selector's v1 result).
        """
        required_count = definition.coverage_rules.payload.get("required_question_count", 6)
        is_complete = len(answers) >= required_count
        return AssessmentScoringResult(
            schema_version="1.0",
            is_complete=is_complete,
            stopping_reason=StoppingReason.FIXED_COVERAGE if is_complete else None,
            total_answers=len(answers),
        )


def calculate_scores(
    answers: Optional[List[Union[AnswerInput, Dict[str, Any]]]] = None,
    definition: Optional[Union[ExperienceDefinitionDocument, Dict[str, Any]]] = None,
    *,
    seed: Optional[str] = None,
) -> AssessmentScoringResult:
    """Convenience module-level entry point to calculate assessment scores and contributions."""
    engine = ScoringEngine(definition)
    return engine.calculate_scores(answers, seed=seed)
