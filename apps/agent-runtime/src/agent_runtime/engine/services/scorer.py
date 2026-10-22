"""Authoritative Scoring, Contributions and RIASEC Classification Engine (Task C-03 / M-ENG).

Conforms to:
- ADR-002: §7.4 (Holland RIASEC 30-item assessment structure & Likert 1..5 scale)
- ADR-002: §7.5 (Exact Rational Scoring, Mean Ratings & Display Score 0..100)
- ADR-002: §7.5 (Answer Contributions Invariants: sum(contrib) == score)
- ADR-002: §7.6 (Stopping condition with provable bounds: bounded_winner, question_limit)
- DEC-04: Holland Hexagonal Tie-Breaking Order (R -> I -> A -> S -> E -> C)
- 100% Deterministic First (No LLM, no unseeded randomness, full version reproducibility)
"""

from typing import Any, Dict, List, Optional, Set, Tuple, Union

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
    RationalScore,
    StoppingReason,
)
from agent_runtime.evaluations.schemas.experience import (
    AssessmentDefinitionQuestion,
    ExperienceDefinitionDocument,
)

DEFAULT_HOLLAND_ORDER = [
    "house_r",
    "house_i",
    "house_a",
    "house_s",
    "house_e",
    "house_c",
]

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
    ) -> AssessmentScoringResult:
        """Calculate exact rational scores, linear display scores, contributions and rankings.

        Args:
            answers: List of answered questions (empty/None for unstarted assessment).
            definition: Experience definition document (if not bound at initialization).

        Returns:
            AssessmentScoringResult: Fully resolved score reports, contributions, Holland code.

        Raises:
            InvalidPrefixError: If an answer refers to an unknown question or illegal option.
            MissingMappingError: If a question lacks a house_id or choice rating mapping.
            UnsupportedDefinitionError: If definition structure is invalid or unsupported.
        """
        active_def = self._definition if definition is None else self._coerce_definition(definition)
        if active_def is None:
            raise UnsupportedDefinitionError(
                "No ExperienceDefinitionDocument provided to ScoringEngine",
                code=EngineErrorCode.INVALID_FIELD,
            )

        schema_version = str(active_def.schema_version)
        normalized_answers = self._normalize_answers(active_def, answers)

        if schema_version == "2.0":
            return self._score_v2(active_def, normalized_answers)
        elif schema_version == "1.0":
            return self._score_v1(active_def, normalized_answers)
        else:
            raise UnsupportedDefinitionError(
                f"Unsupported schema_version '{schema_version}' for scoring",
                code=EngineErrorCode.UNSUPPORTED_VERSION,
            )

    def _normalize_answers(
        self,
        definition: ExperienceDefinitionDocument,
        raw_answers: Optional[List[Union[AnswerInput, Dict[str, Any]]]],
    ) -> List[AnswerInput]:
        """Validate and normalize answer inputs against the definition question bank."""
        if not raw_answers:
            return []

        question_map: Dict[str, AssessmentDefinitionQuestion] = {
            q.question_id: q for q in definition.questions
        }
        normalized: List[AnswerInput] = []
        seen_question_ids: Set[str] = set()

        for idx, item in enumerate(raw_answers):
            if isinstance(item, AnswerInput):
                ans = item
            elif isinstance(item, dict):
                try:
                    ans = AnswerInput.model_validate(item)
                except ValidationError as e:
                    raise InvalidPrefixError(
                        f"Answer at index {idx} failed validation: {str(e)}",
                        code=EngineErrorCode.INVALID_ANSWER_PAYLOAD,
                    ) from e
            else:
                raise InvalidPrefixError(
                    f"Answer at index {idx} must be AnswerInput or dict, got {type(item).__name__}",
                    code=EngineErrorCode.INVALID_ANSWER_PAYLOAD,
                )

            if ans.question_id in seen_question_ids:
                raise InvalidPrefixError(
                    f"Duplicate answer for question '{ans.question_id}' at index {idx}",
                    code=EngineErrorCode.DUPLICATE_QUESTION_SELECTION,
                )

            if ans.question_id not in question_map:
                raise InvalidPrefixError(
                    f"Question '{ans.question_id}' at index {idx} not found in definition question bank",
                    code=EngineErrorCode.QUESTION_NOT_IN_BANK,
                )

            question = question_map[ans.question_id]
            choice = next((c for c in question.choices if c.option_id == ans.option_id), None)
            if choice is None:
                raise InvalidPrefixError(
                    f"Option '{ans.option_id}' is not a valid choice for question '{ans.question_id}'",
                    code=EngineErrorCode.OPTION_NOT_FOUND,
                )

            # Cross-check explicit rating if provided
            if ans.rating is not None and choice.rating is not None and ans.rating != choice.rating:
                raise InvalidPrefixError(
                    f"Provided rating {ans.rating} does not match choice rating {choice.rating} for '{ans.option_id}'",
                    code=EngineErrorCode.RATING_MISMATCH,
                )

            # Assign resolved rating from definition if not set
            resolved_rating = choice.rating if choice.rating is not None else ans.rating
            ans_with_rating = AnswerInput(
                question_id=ans.question_id,
                option_id=ans.option_id,
                rating=resolved_rating,
            )

            seen_question_ids.add(ans.question_id)
            normalized.append(ans_with_rating)

        return normalized

    # --------------------------------------------------------------------------
    # Definition 2.0 Scoring Implementation (ADR-002)
    # --------------------------------------------------------------------------

    def _score_v2(
        self,
        definition: ExperienceDefinitionDocument,
        answers: List[AnswerInput],
    ) -> AssessmentScoringResult:
        """Execute scoring, contributions and classification for Definition 2.0."""
        question_map: Dict[str, AssessmentDefinitionQuestion] = {
            q.question_id: q for q in definition.questions
        }
        house_name_map: Dict[str, str] = {h.house_id: h.name for h in definition.houses}

        # Tie breaking order from policy or standard Holland hexagonal order
        tie_order: List[str] = (
            definition.tie_policy.payload.get("order", DEFAULT_HOLLAND_ORDER)
            if definition.tie_policy and definition.tie_policy.payload
            else DEFAULT_HOLLAND_ORDER
        )

        coverage_payload = definition.coverage_rules.payload if definition.coverage_rules else {}
        items_per_house: int = coverage_payload.get("items_per_house", 5)
        max_total: int = coverage_payload.get("max_total", 30)
        min_answers_per_house: int = coverage_payload.get("min_answers_per_house", 2)

        # Step 1: Group answers by House while recording 1-based sequence ordinal
        answers_by_house: Dict[str, List[Tuple[int, AnswerInput]]] = {
            h_id: [] for h_id in DEFAULT_HOLLAND_ORDER
        }
        for ordinal, ans in enumerate(answers, start=1):
            q_def = question_map[ans.question_id]
            if not q_def.house_id:
                raise MissingMappingError(
                    f"Question '{ans.question_id}' is missing house_id mapping in definition",
                    code=EngineErrorCode.MISSING_HOUSE_MAPPING,
                )
            if q_def.house_id not in answers_by_house:
                answers_by_house[q_def.house_id] = []
            answers_by_house[q_def.house_id].append((ordinal, ans))

        # Step 2: Compute statistics, exact rational means and bounds for all houses
        house_scores: Dict[str, HouseScoreDetail] = {}
        all_contributions: List[AnswerContribution] = []

        for house_id in DEFAULT_HOLLAND_ORDER:
            h_answers = answers_by_house.get(house_id, [])
            n_h = len(h_answers)
            s_h = sum(item[1].rating or 0 for item in h_answers)

            if n_h == 0:
                mean = None
                display_score = None
                lower = RationalScore(numerator=1 * items_per_house, denominator=items_per_house)
                upper = RationalScore(numerator=5 * items_per_house, denominator=items_per_house)
                gap = upper - lower
                contributions = []
            else:
                mean = RationalScore(numerator=s_h, denominator=n_h)
                display_score = 25.0 * (mean.value - 1.0)
                lower = RationalScore(numerator=s_h + 1 * (items_per_house - n_h), denominator=items_per_house)
                upper = RationalScore(numerator=s_h + 5 * (items_per_house - n_h), denominator=items_per_house)
                gap = upper - lower

                # Compute individual answer contributions (ADR-002 §7.5)
                contributions = []
                for ordinal, ans in h_answers:
                    rating = ans.rating or 0
                    mean_contrib = RationalScore(numerator=rating, denominator=n_h)
                    disp_contrib = 25.0 * (rating - 1.0) / n_h
                    contrib = AnswerContribution(
                        question_id=ans.question_id,
                        option_id=ans.option_id,
                        house_id=house_id,
                        rating=rating,
                        ordinal=ordinal,
                        mean_contribution=mean_contrib,
                        display_contribution=round(disp_contrib, 6),
                    )
                    contributions.append(contrib)
                    all_contributions.append(contrib)

            house_scores[house_id] = HouseScoreDetail(
                house_id=house_id,
                house_name=house_name_map.get(house_id),
                sum=s_h,
                count=n_h,
                mean=mean,
                display_score=round(display_score, 4) if display_score is not None else None,
                lower=lower,
                upper=upper,
                gap=gap,
                contributions=contributions,
            )

        # Sort all_contributions by question sequence ordinal
        all_contributions.sort(key=lambda c: c.ordinal)

        # Step 3: Rank houses with active responses
        # Active houses have n_h > 0. Ties broken by index in tie_order.
        active_houses = [h_id for h_id in DEFAULT_HOLLAND_ORDER if house_scores[h_id].count > 0]
        empty_houses = [h_id for h_id in DEFAULT_HOLLAND_ORDER if house_scores[h_id].count == 0]

        def house_sort_key(h_id: str):
            mean_val = house_scores[h_id].mean
            frac = mean_val.to_fraction() if mean_val is not None else -1
            # Primary sort: negative fraction for descending order
            # Secondary sort: tie_order index ascending
            tie_idx = tie_order.index(h_id) if h_id in tie_order else 99
            return (-frac, tie_idx)

        active_houses.sort(key=house_sort_key)
        # Empty houses sorted purely by tie order
        empty_houses.sort(key=lambda h_id: tie_order.index(h_id) if h_id in tie_order else 99)

        ranked_houses = active_houses + empty_houses

        # Step 4: Calculate relative share percentage of total interest profile
        total_display_score = sum(
            house_scores[h_id].display_score or 0.0 for h_id in DEFAULT_HOLLAND_ORDER
        )
        for rank_idx, h_id in enumerate(ranked_houses, start=1):
            detail = house_scores[h_id]
            detail.rank = rank_idx
            if detail.display_score is not None and total_display_score > 0.0:
                detail.share_percentage = round(
                    (detail.display_score / total_display_score) * 100.0, 2
                )
            else:
                detail.share_percentage = 0.0 if detail.display_score is not None else None

        # Step 5: Classify primary, secondary, tertiary houses and Holland Code
        total_answers = len(answers)
        primary_house_id = ranked_houses[0] if active_houses else None
        secondary_house_id = ranked_houses[1] if len(active_houses) >= 2 else None
        tertiary_house_id = ranked_houses[2] if len(active_houses) >= 3 else None

        holland_code = None
        if active_houses:
            top_houses = active_houses[:3]
            holland_code = "".join(HOLLAND_CODE_LETTER_MAP.get(h, "") for h in top_houses)

        # Step 6: Determine if tie-breaker policy was applied for primary winner
        tie_applied = False
        if len(active_houses) >= 2:
            m1 = house_scores[active_houses[0]].mean
            m2 = house_scores[active_houses[1]].mean
            if m1 is not None and m2 is not None and m1 == m2:
                tie_applied = True

        # Step 7: Evaluate Completion and Stopping Reason (ADR-002 §7.6)
        is_complete = False
        stopping_reason: Optional[StoppingReason] = None

        if total_answers >= max_total:
            is_complete = True
            stopping_reason = StoppingReason.QUESTION_LIMIT
        else:
            has_min_coverage = all(
                house_scores[h_id].count >= min_answers_per_house for h_id in DEFAULT_HOLLAND_ORDER
            )
            if has_min_coverage and primary_house_id is not None:
                lower_w = house_scores[primary_house_id].lower.to_fraction()
                max_other_upper = max(
                    house_scores[h_id].upper.to_fraction()
                    for h_id in DEFAULT_HOLLAND_ORDER
                    if h_id != primary_house_id
                )
                if lower_w > max_other_upper:
                    is_complete = True
                    stopping_reason = StoppingReason.BOUNDED_WINNER
                    tie_applied = False  # Bounded winner mathematically guarantees no tie

        return AssessmentScoringResult(
            schema_version="2.0",
            primary_house_id=primary_house_id,
            secondary_house_id=secondary_house_id,
            tertiary_house_id=tertiary_house_id,
            holland_code=holland_code,
            tie_applied=tie_applied,
            house_scores=house_scores,
            ranked_houses=ranked_houses,
            all_contributions=all_contributions,
            is_complete=is_complete,
            stopping_reason=stopping_reason,
            total_answers=total_answers,
        )

    # --------------------------------------------------------------------------
    # Definition 1.0 Legacy Scoring Implementation
    # --------------------------------------------------------------------------

    def _score_v1(
        self,
        definition: ExperienceDefinitionDocument,
        answers: List[AnswerInput],
    ) -> AssessmentScoringResult:
        """Execute legacy fixed 6-question scoring for Definition 1.0."""
        house_name_map = {h.house_id: h.name for h in definition.houses}
        total_answers = len(answers)
        is_complete = total_answers >= 6
        stopping_reason = StoppingReason.FIXED_COVERAGE if is_complete else None

        # Build basic score structures for v1
        house_scores: Dict[str, HouseScoreDetail] = {
            h_id: HouseScoreDetail(
                house_id=h_id,
                house_name=house_name_map.get(h_id),
                sum=0,
                count=0,
                display_score=0.0,
                rank=idx + 1,
                share_percentage=0.0,
            )
            for idx, h_id in enumerate(DEFAULT_HOLLAND_ORDER)
        }

        primary_house = DEFAULT_HOLLAND_ORDER[0] if is_complete else None
        return AssessmentScoringResult(
            schema_version="1.0",
            primary_house_id=primary_house,
            secondary_house_id=DEFAULT_HOLLAND_ORDER[1] if is_complete else None,
            tertiary_house_id=DEFAULT_HOLLAND_ORDER[2] if is_complete else None,
            holland_code="RIA" if is_complete else None,
            tie_applied=False,
            house_scores=house_scores,
            ranked_houses=list(DEFAULT_HOLLAND_ORDER),
            all_contributions=[],
            is_complete=is_complete,
            stopping_reason=stopping_reason,
            total_answers=total_answers,
        )


def calculate_scores(
    answers: Optional[List[Union[AnswerInput, Dict[str, Any]]]] = None,
    definition: Optional[Union[ExperienceDefinitionDocument, Dict[str, Any]]] = None,
) -> AssessmentScoringResult:
    """Convenience module-level entry point to calculate assessment scores and contributions."""
    engine = ScoringEngine(definition)
    return engine.calculate_scores(answers)
