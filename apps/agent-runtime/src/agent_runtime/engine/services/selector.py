"""Adaptive Question Selector Engine Service (M-ENG / Task C-02).

Authoritative implementation of:
- ADR-002: §7.6 (Stopping condition with provable bounds)
- ADR-002: §7.7 (Adaptive selector with widest bound gap)
- ADR-002: §7.9 (Contract & Progress v2)
- Seeded per-activity order (engine/services/ordering.py): baseline picks, adaptive items, house ties
- Anti-repeat question selection invariant
- Typed failure handling with exact error codes
- Backward compatibility for Definition 1.0 (Fixed 6 questions)
"""

from fractions import Fraction
from typing import Any, Dict, List, Optional, Set, Union

from pydantic import ValidationError

from agent_runtime.engine.error_codes import EngineErrorCode
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
    HouseStatistics,
    RationalScore,
    SelectionPhase,
    SelectionResult,
    SelectionStatus,
    StoppingReason,
)
from agent_runtime.engine.services.ordering import rank_houses, seeded_order, shuffle_key
from agent_runtime.evaluations.schemas.experience import (
    AssessmentDefinitionQuestion,
    ExperienceDefinitionDocument,
)
from agent_runtime.evaluations.services.compatibility import ALLOWED_RULE_SCHEMAS_BY_SLOT

SUPPORTED_SCHEMA_VERSIONS = {"1.0", "2.0"}
BASELINE_TOTAL = 12

RULE_SLOTS = ("selection_rules", "scoring_rules", "coverage_rules", "tie_policy")

# Coverage payload keys the v2 selector requires (no silent defaults).
V2_COVERAGE_KEYS = ("max_total", "items_per_house", "min_answers_per_house")
COVERAGE_KEY_ERROR_CODES = {"min_answers_per_house": EngineErrorCode.INVALID_MIN_ANSWERS}


class AdaptiveQuestionSelector:
    """Authoritative question selector, deterministic per activity seed."""

    def __init__(
        self,
        definition: Optional[Union[ExperienceDefinitionDocument, Dict[str, Any]]] = None,
    ):
        """Initialize selector, optionally binding an experience definition."""
        self._definition: Optional[ExperienceDefinitionDocument] = None
        if definition is not None:
            self._definition = self._coerce_definition(definition)

    @classmethod
    def _coerce_definition(
        cls, definition: Union[ExperienceDefinitionDocument, Dict[str, Any]]
    ) -> ExperienceDefinitionDocument:
        """Validate and coerce dict or model into ExperienceDefinitionDocument."""
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

    def select_next_question(
        self,
        answers: Optional[List[Union[AnswerInput, Dict[str, Any]]]] = None,
        definition: Optional[Union[ExperienceDefinitionDocument, Dict[str, Any]]] = None,
        validate_sequence: bool = True,
        *,
        seed: Optional[str] = None,
    ) -> SelectionResult:
        """Authoritative entry point for adaptive question selection.

        Args:
            answers: List of previously accepted answers (empty/None for initial start).
            definition: Experience definition (if not provided at instance creation).
            validate_sequence: If True, strictly verifies that previous answers match
                               the path emitted by the selector.
            seed: Activity id that fixes this activity's question order and tie-breaks;
                  required for Definition 2.0, ignored by 1.0.

        Returns:
            SelectionResult: Next question or completed assessment outcome.

        Raises:
            InvalidPrefixError: On duplicate questions, invalid IDs, bad ratings, or wrong path.
            BankExhaustedError: If bank has no more questions and stop condition not met.
            UnsupportedDefinitionError: If schema_version or rule schema is unsupported.
            MissingMappingError: If required metadata (rating, house_id) is missing.
        """
        active_def = self._definition
        if definition is not None:
            active_def = self._coerce_definition(definition)

        if active_def is None:
            raise UnsupportedDefinitionError(
                "Experience definition must be provided either at initialization or execution.",
                code=EngineErrorCode.MISSING_REQUIRED_FIELD,
            )

        # Validate schema version
        if active_def.schema_version not in SUPPORTED_SCHEMA_VERSIONS:
            raise UnsupportedDefinitionError(
                f"Unsupported schema_version '{active_def.schema_version}'. Supported: {SUPPORTED_SCHEMA_VERSIONS}",
                code=EngineErrorCode.INVALID_SCHEMA_VERSION,
            )

        self._validate_definition(active_def)

        # Coerce and validate answers prefix
        normalized_answers, seen_question_ids = self._normalize_and_validate_answers(
            answers, active_def
        )

        # Dispatch based on schema version
        if active_def.schema_version == "2.0":
            if not isinstance(seed, str) or not seed:
                raise EngineError(
                    "Definition 2.0 selection requires a non-empty seed (the activity id)",
                    code=EngineErrorCode.MISSING_REQUIRED_FIELD,
                )
            return self._select_adaptive_v2(
                active_def,
                normalized_answers,
                seen_question_ids,
                validate_sequence=validate_sequence,
                seed=seed,
            )
        else:
            return self._select_fixed_v1(
                active_def,
                normalized_answers,
                seen_question_ids,
                validate_sequence=validate_sequence,
            )

    # --------------------------------------------------------------------------
    # Definition Integrity Validation
    # --------------------------------------------------------------------------

    def _validate_definition(self, definition: ExperienceDefinitionDocument) -> None:
        """Reject structurally invalid definitions before any selection runs.

        The selector's bounds and fallbacks assume a well-formed bank; a malformed one
        would otherwise yield a silently wrong result or a raw KeyError/ZeroDivisionError.
        """
        allowed_by_slot = ALLOWED_RULE_SCHEMAS_BY_SLOT[definition.schema_version]
        for slot in RULE_SLOTS:
            ref = getattr(definition, slot).rule_schema_ref
            if ref not in allowed_by_slot[slot]:
                raise UnsupportedDefinitionError(
                    f"Unsupported {slot} schema '{ref}' for Definition {definition.schema_version}. "
                    f"Supported: {sorted(allowed_by_slot[slot])}",
                    code=EngineErrorCode.UNSUPPORTED_RULE_SCHEMA,
                )

        question_ids: Set[str] = set()
        for q in definition.questions:
            if q.question_id in question_ids:
                raise UnsupportedDefinitionError(
                    f"Duplicate question_id '{q.question_id}' in question bank",
                    code=EngineErrorCode.DUPLICATE_QUESTION_ID,
                )
            question_ids.add(q.question_id)
            option_ids = [c.option_id for c in q.choices]
            if len(set(option_ids)) != len(option_ids):
                raise UnsupportedDefinitionError(
                    f"Duplicate option_id in question '{q.question_id}'",
                    code=EngineErrorCode.DUPLICATE_OPTION_ID,
                )

        if definition.schema_version == "1.0":
            self._validate_v1_definition(definition, question_ids)
        else:
            self._validate_v2_definition(definition, question_ids)

    @staticmethod
    def _require_positive_int(payload: Dict[str, Any], key: str, slot: str) -> int:
        value = payload.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise UnsupportedDefinitionError(
                f"{slot}.payload.{key} must be a positive integer, got {value!r}",
                code=COVERAGE_KEY_ERROR_CODES.get(key, EngineErrorCode.INVALID_COVERAGE_CONFIG),
            )
        return value

    def _validate_v1_definition(
        self, definition: ExperienceDefinitionDocument, question_ids: Set[str]
    ) -> None:
        initial_q_id = definition.selection_rules.payload.get("initial_question_id")
        if initial_q_id is not None and initial_q_id not in question_ids:
            raise UnsupportedDefinitionError(
                f"initial_question_id '{initial_q_id}' does not exist in the question bank",
                code=EngineErrorCode.INVALID_INITIAL_QUESTION,
            )

        coverage_payload = definition.coverage_rules.payload
        if "required_question_count" in coverage_payload:
            required = self._require_positive_int(
                coverage_payload, "required_question_count", "coverage_rules"
            )
            if required > len(question_ids):
                raise UnsupportedDefinitionError(
                    f"required_question_count {required} exceeds bank size {len(question_ids)}",
                    code=EngineErrorCode.INVALID_COVERAGE_CONFIG,
                )

    def _validate_v2_definition(
        self, definition: ExperienceDefinitionDocument, question_ids: Set[str]
    ) -> None:
        house_ids = [h.house_id for h in definition.houses]

        coverage_payload = definition.coverage_rules.payload
        max_total, items_per_house, min_answers = (
            self._require_positive_int(coverage_payload, key, "coverage_rules")
            for key in V2_COVERAGE_KEYS
        )
        if not BASELINE_TOTAL <= max_total <= items_per_house * len(house_ids):
            raise UnsupportedDefinitionError(
                f"max_total must be within [{BASELINE_TOTAL}, {items_per_house * len(house_ids)}], got {max_total}",
                code=EngineErrorCode.INVALID_COVERAGE_CONFIG,
            )
        if min_answers > items_per_house:
            raise UnsupportedDefinitionError(
                f"min_answers_per_house {min_answers} exceeds items_per_house {items_per_house}",
                code=EngineErrorCode.INVALID_MIN_ANSWERS,
            )
        baseline_total = coverage_payload.get("baseline_total", BASELINE_TOTAL)
        if baseline_total != BASELINE_TOTAL:
            raise UnsupportedDefinitionError(
                f"baseline_total is fixed at {BASELINE_TOTAL} by ADR-002, got {baseline_total!r}",
                code=EngineErrorCode.INVALID_COVERAGE_CONFIG,
            )

        house_item_orders: Dict[str, List[int]] = {house_id: [] for house_id in house_ids}
        for q in definition.questions:
            if q.house_id not in house_item_orders:
                raise MissingMappingError(
                    f"Question '{q.question_id}' has missing or unknown house_id '{q.house_id}'",
                    code=EngineErrorCode.INVALID_HOUSE_REF,
                )
            if q.item_order is None:
                raise MissingMappingError(
                    f"Question '{q.question_id}' is missing item_order",
                    code=EngineErrorCode.INVALID_ITEM_ORDER,
                )
            house_item_orders[q.house_id].append(q.item_order)

        # Bounds assume exactly items_per_house askable items per house (ADR-002 §7.6).
        expected_orders = list(range(1, items_per_house + 1))
        for house_id, orders in house_item_orders.items():
            if len(orders) != items_per_house:
                raise MissingMappingError(
                    f"House '{house_id}' must have exactly {items_per_house} questions, found {len(orders)}",
                    code=EngineErrorCode.HOUSE_QUESTION_COUNT_MISMATCH,
                )
            if sorted(orders) != expected_orders:
                raise MissingMappingError(
                    f"House '{house_id}' must have item_order exactly {expected_orders}, got {sorted(orders)}",
                    code=EngineErrorCode.HOUSE_ITEM_ORDER_MISMATCH,
                )

    # --------------------------------------------------------------------------
    # Normalization & Anti-Repeat Validation
    # --------------------------------------------------------------------------

    def _normalize_and_validate_answers(
        self,
        raw_answers: Optional[List[Union[AnswerInput, Dict[str, Any]]]],
        definition: ExperienceDefinitionDocument,
    ) -> tuple[List[AnswerInput], Set[str]]:
        """Normalize answer items, verify question/option existence and anti-repeat."""
        if raw_answers is None:
            raw_answers = []
        elif not isinstance(raw_answers, (list, tuple)):
            raise InvalidPrefixError(
                f"Answers must be a list, got {type(raw_answers).__name__}",
                code=EngineErrorCode.INVALID_TYPE,
            )

        question_map: Dict[str, AssessmentDefinitionQuestion] = {
            q.question_id: q for q in definition.questions
        }
        normalized: List[AnswerInput] = []
        seen_question_ids: Set[str] = set()

        for idx, item in enumerate(raw_answers):
            if isinstance(item, dict) and isinstance(item.get("rating"), bool):
                raise InvalidPrefixError(
                    f"Answer rating at index {idx} must be an integer (booleans forbidden)",
                    code=EngineErrorCode.INVALID_TYPE,
                )
            if isinstance(item, AnswerInput):
                ans = item
            elif isinstance(item, dict):
                try:
                    ans = AnswerInput.model_validate(item)
                except ValidationError as e:
                    raise InvalidPrefixError(
                        f"Answer at index {idx} failed schema validation: {str(e)}",
                        code=EngineErrorCode.INVALID_FIELD,
                    ) from e
            else:
                raise InvalidPrefixError(
                    f"Answer at index {idx} has invalid type {type(item).__name__}",
                    code=EngineErrorCode.INVALID_TYPE,
                )

            # Anti-repeat check (Invariant: each question asked at most once)
            if ans.question_id in seen_question_ids:
                raise InvalidPrefixError(
                    f"Anti-repeat violation: duplicate question_id '{ans.question_id}' at index {idx}",
                    code=EngineErrorCode.QUESTION_ALREADY_ANSWERED,
                )

            # Question bank membership check
            if ans.question_id not in question_map:
                raise InvalidPrefixError(
                    f"Question ID '{ans.question_id}' does not exist in the question bank",
                    code=EngineErrorCode.UNKNOWN_QUESTION_ID,
                )

            question = question_map[ans.question_id]
            choice_map = {c.option_id: c for c in question.choices}

            # Option membership check
            if ans.option_id not in choice_map:
                raise InvalidPrefixError(
                    f"Option ID '{ans.option_id}' does not belong to question '{ans.question_id}'",
                    code=EngineErrorCode.INVALID_OPTION_ID,
                )

            choice = choice_map[ans.option_id]

            # In Definition 2.0, verify and assign rating
            if definition.schema_version == "2.0":
                if (
                    choice.rating is None
                    or isinstance(choice.rating, bool)
                    or not isinstance(choice.rating, int)
                    or not (1 <= choice.rating <= 5)
                ):
                    raise MissingMappingError(
                        f"Choice '{ans.option_id}' in question '{ans.question_id}' is missing a valid 1..5 rating",
                        code=EngineErrorCode.INVALID_RATING,
                    )
                if ans.rating is not None and ans.rating != choice.rating:
                    raise InvalidPrefixError(
                        f"Provided rating {ans.rating} does not match choice rating {choice.rating} for option '{ans.option_id}'",
                        code=EngineErrorCode.RATING_MISMATCH,
                    )
                # Assign authoritative rating
                ans = AnswerInput(
                    question_id=ans.question_id,
                    option_id=ans.option_id,
                    rating=choice.rating,
                )
            elif ans.rating is not None and ans.rating != choice.rating:
                # v1 choices are unrated; never pass a client-supplied rating downstream.
                raise InvalidPrefixError(
                    f"Provided rating {ans.rating} does not match choice rating {choice.rating} for option '{ans.option_id}'",
                    code=EngineErrorCode.RATING_MISMATCH,
                )

            seen_question_ids.add(ans.question_id)
            normalized.append(ans)

        return normalized, seen_question_ids

    # --------------------------------------------------------------------------
    # Definition 2.0: Adaptive Bounds Algorithm (ADR-002 §7.6 & §7.7)
    # --------------------------------------------------------------------------

    def _select_adaptive_v2(
        self,
        definition: ExperienceDefinitionDocument,
        answers: List[AnswerInput],
        seen_question_ids: Set[str],
        validate_sequence: bool = True,
        *,
        seed: str,
    ) -> SelectionResult:
        """Execute Definition 2.0 adaptive question selection for one activity seed."""
        decision_log: List[str] = []

        coverage_payload = definition.coverage_rules.payload
        max_total: int = coverage_payload["max_total"]
        items_per_house: int = coverage_payload["items_per_house"]
        min_answers_per_house: int = coverage_payload["min_answers_per_house"]

        question_map = {q.question_id: q for q in definition.questions}

        # Step 1: Sequence validation (if requested and answers > 0)
        if validate_sequence and len(answers) > 0:
            self._verify_sequence_path_v2(definition, answers, seed)
            decision_log.append("Answer prefix path validated against selector replay sequence.")

        # Step 2: Compute statistics for all 6 houses
        statistics = self._compute_house_statistics(
            definition, answers, question_map, items_per_house
        )

        total_answers = len(answers)

        # Step 3: Determine leading house w (shared seeded ranking: mean, top ratings, seed)
        ratings = self._ratings_by_house(definition, answers, question_map)
        leading_w = rank_houses(list(statistics), ratings, seed)[0]
        decision_log.append(f"Current leading house: {leading_w}")

        # Step 4: Check Stopping Conditions
        # 4A. Question Limit reached (ADR-002: reason question_limit evaluated before bounded_winner at limit)
        if total_answers >= max_total:
            winner, tie_applied = self._resolve_winner_at_limit(statistics, ratings, seed)
            decision_log.append(
                f"Reached maximum question limit ({max_total}). Primary house: {winner} (tie_applied={tie_applied})."
            )
            return SelectionResult(
                status=SelectionStatus.COMPLETED,
                next_question_id=None,
                next_question=None,
                stopping_reason=StoppingReason.QUESTION_LIMIT,
                primary_house_id=winner,
                tie_applied=tie_applied,
                phase=SelectionPhase.COMPLETED,
                progress=AssessmentProgressAdaptive(
                    completed=total_answers,
                    min_total=BASELINE_TOTAL,
                    max_total=max_total,
                    total=total_answers,
                    phase=SelectionPhase.COMPLETED,
                ),
                statistics=statistics,
                candidate_houses=[],
                decision_log=decision_log,
            )

        # 4B. Early Stop check: bounded_winner (strict bounds check: lower_w > max(upper_h for h != w))
        has_min_coverage = all(
            stats.count >= min_answers_per_house for stats in statistics.values()
        )
        if has_min_coverage and leading_w is not None:
            lower_w = statistics[leading_w].lower.to_fraction()
            max_other_upper = max(
                stats.upper.to_fraction()
                for h_id, stats in statistics.items()
                if h_id != leading_w
            )
            # Strict inequality required per ADR-002 §7.6
            if lower_w > max_other_upper:
                decision_log.append(
                    f"Early stop condition satisfied: lower_{leading_w} ({lower_w}) > max(upper_other) ({max_other_upper})."
                )
                return SelectionResult(
                    status=SelectionStatus.COMPLETED,
                    next_question_id=None,
                    next_question=None,
                    stopping_reason=StoppingReason.BOUNDED_WINNER,
                    primary_house_id=leading_w,
                    tie_applied=False,
                    phase=SelectionPhase.COMPLETED,
                    progress=AssessmentProgressAdaptive(
                        completed=total_answers,
                        min_total=BASELINE_TOTAL,
                        max_total=max_total,
                        total=total_answers,
                        phase=SelectionPhase.COMPLETED,
                    ),
                    statistics=statistics,
                    candidate_houses=[],
                    decision_log=decision_log,
                )

        # Step 5: Selection of Next Question (not stopped)
        # Phase 1: Seeded baseline (first 12 questions)
        if total_answers < BASELINE_TOTAL:
            unasked_baseline = [
                qid for qid in self._baseline_sequence(definition, seed) if qid not in seen_question_ids
            ]
            if not unasked_baseline:
                raise BankExhaustedError(
                    f"All baseline questions have been answered, but baseline count is under {BASELINE_TOTAL}.",
                    code=EngineErrorCode.BANK_EXHAUSTED,
                )
            next_q_id = unasked_baseline[0]
            decision_log.append(
                f"Baseline phase: selecting next unasked from the seeded baseline: {next_q_id}"
            )
            return SelectionResult(
                status=SelectionStatus.NEXT_QUESTION,
                next_question_id=next_q_id,
                next_question=question_map[next_q_id],
                stopping_reason=None,
                primary_house_id=None,
                tie_applied=False,
                phase=SelectionPhase.BASELINE,
                progress=AssessmentProgressAdaptive(
                    completed=total_answers,
                    min_total=BASELINE_TOTAL,
                    max_total=max_total,
                    total=None,
                    phase=SelectionPhase.BASELINE,
                ),
                statistics=statistics,
                candidate_houses=[question_map[next_q_id].house_id],
                decision_log=decision_log,
            )

        # Phase 2: Adaptive Selection (after baseline, total_answers >= 12)
        next_q, candidate_houses = self._pick_adaptive_next_question(
            definition,
            statistics,
            seen_question_ids,
            leading_w,
            seed,
            items_per_house,
            decision_log,
        )

        decision_log.append(
            f"Adaptive phase: selected question {next_q.question_id} (house={next_q.house_id}, item_order={next_q.item_order})."
        )

        return SelectionResult(
            status=SelectionStatus.NEXT_QUESTION,
            next_question_id=next_q.question_id,
            next_question=next_q,
            stopping_reason=None,
            primary_house_id=None,
            tie_applied=False,
            phase=SelectionPhase.ADAPTIVE,
            progress=AssessmentProgressAdaptive(
                completed=total_answers,
                min_total=BASELINE_TOTAL,
                max_total=max_total,
                total=None,
                phase=SelectionPhase.ADAPTIVE,
            ),
            statistics=statistics,
            candidate_houses=candidate_houses,
            decision_log=decision_log,
        )

    def _verify_sequence_path_v2(
        self,
        definition: ExperienceDefinitionDocument,
        answers: List[AnswerInput],
        seed: str,
    ) -> None:
        """Verify that answers prefix followed the exact sequence produced by the selector for this seed."""
        for step in range(len(answers)):
            actual_q_id = answers[step].question_id
            prefix = answers[:step]
            step_res = self.select_next_question(
                answers=prefix,
                definition=definition,
                validate_sequence=False,
                seed=seed,
            )
            if step_res.status == SelectionStatus.COMPLETED:
                raise InvalidPrefixError(
                    f"Assessment was already completed at step {step} with reason '{step_res.stopping_reason}'. "
                    f"Cannot accept further answer '{actual_q_id}'.",
                    code=EngineErrorCode.ASSESSMENT_ALREADY_COMPLETED,
                )
            expected_q_id = step_res.next_question_id
            if expected_q_id != actual_q_id:
                raise InvalidPrefixError(
                    f"Sequence replay mismatch at answer step {step}: expected question '{expected_q_id}', got '{actual_q_id}'",
                    code=EngineErrorCode.SEQUENCE_MISMATCH,
                )

    def _compute_house_statistics(
        self,
        definition: ExperienceDefinitionDocument,
        answers: List[AnswerInput],
        question_map: Dict[str, AssessmentDefinitionQuestion],
        items_per_house: int,
    ) -> Dict[str, HouseStatistics]:
        """Compute exact rational mean, lower and upper bounds for each house."""
        house_answers = self._ratings_by_house(definition, answers, question_map)

        stats_map: Dict[str, HouseStatistics] = {}
        for h in definition.houses:
            ratings = house_answers[h.house_id]
            s_h = sum(ratings)
            n_h = len(ratings)
            unasked = max(0, items_per_house - n_h)

            mean_frac = Fraction(s_h, n_h) if n_h > 0 else None
            lower_frac = Fraction(s_h + 1 * unasked, items_per_house)
            upper_frac = Fraction(s_h + 5 * unasked, items_per_house)
            gap_frac = upper_frac - lower_frac

            disp_score = None
            if mean_frac is not None:
                disp_score = round(100.0 * (float(mean_frac) - 1.0) / 4.0, 2)

            stats_map[h.house_id] = HouseStatistics(
                house_id=h.house_id,
                sum=s_h,
                count=n_h,
                mean=RationalScore.from_fraction(mean_frac) if mean_frac is not None else None,
                lower=RationalScore.from_fraction(lower_frac),
                upper=RationalScore.from_fraction(upper_frac),
                gap=RationalScore.from_fraction(gap_frac),
                display_score=disp_score,
            )

        return stats_map

    @staticmethod
    def _ratings_by_house(
        definition: ExperienceDefinitionDocument,
        answers: List[AnswerInput],
        question_map: Dict[str, AssessmentDefinitionQuestion],
    ) -> Dict[str, List[int]]:
        ratings: Dict[str, List[int]] = {h.house_id: [] for h in definition.houses}
        for ans in answers:
            ratings[question_map[ans.question_id].house_id].append(ans.rating)
        return ratings

    @staticmethod
    def _baseline_sequence(definition: ExperienceDefinitionDocument, seed: str) -> List[str]:
        """Two seeded items per house, asked in two rounds; each round visits every house once."""
        house_ids = [h.house_id for h in definition.houses]
        per_house = BASELINE_TOTAL // len(house_ids)
        picked = {
            h: seeded_order(
                seed, "baseline-item", [q.question_id for q in definition.questions if q.house_id == h]
            )[:per_house]
            for h in house_ids
        }
        return [
            picked[h][round_index]
            for round_index in range(per_house)
            for h in seeded_order(seed, f"baseline-round-{round_index + 1}", house_ids)
        ]

    @staticmethod
    def _resolve_winner_at_limit(
        statistics: Dict[str, HouseStatistics],
        ratings: Dict[str, List[int]],
        seed: str,
    ) -> tuple[str, bool]:
        """Shared house ranking picks the winner; tie_applied when the top mean is shared."""
        winner = rank_houses(list(statistics), ratings, seed)[0]
        means = [s.mean.to_fraction() for s in statistics.values() if s.mean is not None]
        return winner, bool(means) and means.count(max(means)) > 1

    def _pick_adaptive_next_question(
        self,
        definition: ExperienceDefinitionDocument,
        statistics: Dict[str, HouseStatistics],
        seen_question_ids: Set[str],
        leading_w: str,
        seed: str,
        items_per_house: int,
        decision_log: List[str],
    ) -> tuple[AssessmentDefinitionQuestion, List[str]]:
        """Select next adaptive item based on ADR-002 §7.7 widest bound gap."""
        lower_w = statistics[leading_w].lower.to_fraction()

        # Step 2: Build candidate set C
        candidate_houses: List[str] = []
        # Include w if w has remaining items
        if statistics[leading_w].count < items_per_house:
            candidate_houses.append(leading_w)

        # Include other houses h where count < 5 and upper_h >= lower_w
        for h_id, s in statistics.items():
            if h_id != leading_w:
                if s.count < items_per_house and s.upper.to_fraction() >= lower_w:
                    candidate_houses.append(h_id)

        decision_log.append(f"Candidate houses with upper >= lower_{leading_w}: {candidate_houses}")

        # Step 3 & 4: Pick house with widest gap upper_h - lower_h
        chosen_house: Optional[str] = None
        if candidate_houses:
            # Find maximum gap
            max_gap = max(statistics[h].gap.to_fraction() for h in candidate_houses)
            tied_gap = [
                h for h in candidate_houses if statistics[h].gap.to_fraction() == max_gap
            ]
            # Tie breaker: seeded key
            tied_gap.sort(key=lambda h: shuffle_key(seed, "house", h))
            chosen_house = tied_gap[0]
            decision_log.append(
                f"Selected house with widest gap ({max_gap}): {chosen_house} (tied: {tied_gap})"
            )

        # Step 5: Fallback if C is empty but budget not exhausted
        if chosen_house is None:
            # Find houses with remaining unasked questions
            remaining_houses = [
                h_id for h_id, s in statistics.items() if s.count < items_per_house
            ]
            if not remaining_houses:
                raise BankExhaustedError(
                    "All houses have exhausted their question items, but stopping condition was not reached.",
                    code=EngineErrorCode.BANK_EXHAUSTED,
                )
            remaining_houses.sort(key=lambda h: shuffle_key(seed, "house", h))
            chosen_house = remaining_houses[0]
            decision_log.append(
                f"Candidate set empty; fallback to house with remaining items: {chosen_house}"
            )

        # In chosen house, select the unasked item with the lowest seeded key
        house_unasked = [
            q
            for q in definition.questions
            if q.house_id == chosen_house and q.question_id not in seen_question_ids
        ]
        if not house_unasked:
            # Unreachable for a validated bank: count < items_per_house guarantees an unasked item.
            raise EngineError(
                f"House '{chosen_house}' has no unasked items despite count < {items_per_house}",
                code=EngineErrorCode.HOUSE_ITEMS_INVARIANT_VIOLATION,
            )
        house_unasked.sort(key=lambda q: shuffle_key(seed, "adaptive-item", q.question_id))
        next_q = house_unasked[0]

        # Final anti-repeat invariant assertion
        if next_q.question_id in seen_question_ids:
            raise EngineError(
                f"Anti-repeat invariant failure: selected already-answered question '{next_q.question_id}'",
                code=EngineErrorCode.ANTI_REPEAT_VIOLATION,
            )

        return next_q, candidate_houses

    # --------------------------------------------------------------------------
    # Definition 1.0: Fixed 6 Questions (Backward Compatibility)
    # --------------------------------------------------------------------------

    def _select_fixed_v1(
        self,
        definition: ExperienceDefinitionDocument,
        answers: List[AnswerInput],
        seen_question_ids: Set[str],
        validate_sequence: bool = True,
    ) -> SelectionResult:
        """Execute legacy Definition 1.0 question selection."""
        decision_log: List[str] = ["Definition 1.0 fixed selection path."]
        question_map = {q.question_id: q for q in definition.questions}

        # Sequence validation for v1
        if validate_sequence and len(answers) > 0:
            for step in range(len(answers)):
                actual_q_id = answers[step].question_id
                prefix = answers[:step]
                step_res = self._select_fixed_v1(
                    definition=definition,
                    answers=prefix,
                    seen_question_ids={a.question_id for a in prefix},
                    validate_sequence=False,
                )
                if step_res.status == SelectionStatus.COMPLETED:
                    raise InvalidPrefixError(
                        f"Assessment was already completed at step {step} with reason '{step_res.stopping_reason}'. "
                        f"Cannot accept further answer '{actual_q_id}'.",
                        code=EngineErrorCode.ASSESSMENT_ALREADY_COMPLETED,
                    )
                expected_q_id = step_res.next_question_id
                if expected_q_id != actual_q_id:
                    raise InvalidPrefixError(
                        f"Sequence replay mismatch at answer step {step}: expected question '{expected_q_id}', got '{actual_q_id}'",
                        code=EngineErrorCode.SEQUENCE_MISMATCH,
                    )
            decision_log.append("Definition 1.0 sequence replay validated.")

        required_count = definition.coverage_rules.payload.get("required_question_count", 6)
        total_answers = len(answers)

        if total_answers >= required_count:
            decision_log.append(f"Completed required questions count ({required_count}).")
            return SelectionResult(
                status=SelectionStatus.COMPLETED,
                next_question_id=None,
                next_question=None,
                stopping_reason=StoppingReason.FIXED_COVERAGE,
                primary_house_id=None,
                tie_applied=False,
                phase=SelectionPhase.COMPLETED,
                progress=AssessmentProgressAdaptive(
                    completed=total_answers,
                    min_total=required_count,
                    max_total=required_count,
                    total=total_answers,
                    phase=SelectionPhase.COMPLETED,
                ),
                statistics={},
                candidate_houses=[],
                decision_log=decision_log,
            )

        if total_answers == 0:
            initial_q_id = definition.selection_rules.payload.get(
                "initial_question_id", definition.questions[0].question_id
            )
            next_q_id = initial_q_id
        else:
            # Sequential next unasked question from bank
            unasked = [
                q for q in definition.questions if q.question_id not in seen_question_ids
            ]
            if not unasked:
                raise BankExhaustedError(
                    "Definition 1.0 question bank exhausted before reaching required count.",
                    code=EngineErrorCode.BANK_EXHAUSTED,
                )
            next_q_id = unasked[0].question_id

        decision_log.append(f"Selected question {next_q_id} for step {total_answers}.")

        return SelectionResult(
            status=SelectionStatus.NEXT_QUESTION,
            next_question_id=next_q_id,
            next_question=question_map[next_q_id],
            stopping_reason=None,
            primary_house_id=None,
            tie_applied=False,
            phase=SelectionPhase.FIXED,
            progress=AssessmentProgressAdaptive(
                completed=total_answers,
                min_total=required_count,
                max_total=required_count,
                total=None,
                phase=SelectionPhase.FIXED,
            ),
            statistics={},
            candidate_houses=[],
            decision_log=decision_log,
        )


def select_next_question(
    definition: Union[ExperienceDefinitionDocument, Dict[str, Any]],
    answers: Optional[List[Union[AnswerInput, Dict[str, Any]]]] = None,
    validate_sequence: bool = True,
    *,
    seed: Optional[str] = None,
) -> SelectionResult:
    """Convenience functional wrapper for AdaptiveQuestionSelector."""
    selector = AdaptiveQuestionSelector(definition)
    return selector.select_next_question(answers, validate_sequence=validate_sequence, seed=seed)
