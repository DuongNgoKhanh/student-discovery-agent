"""Deterministic Evaluation Runner Engine Service (Task C-05 / M-EVL).

Conforms to:
- contracts/openapi/public/experience-validation-api.yaml (EvaluationReport, EvaluationCaseResult)
- ADR-001 & ADR-002: evaluation replays golden cases on the AdaptiveQuestionSelector and ScoringEngine
  classes the runtime uses, and applies the runtime's completion check (sessions/services/completion.py).
- RFC 8785 canonical JSON hashing (via ExperienceValidator canonical hashing).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Mapping
from uuid import uuid4

from pydantic import ValidationError

from agent_runtime.evaluations.schemas.experience import (
    AssessmentGoldenCase,
    ExperienceDefinitionDocument,
)
from agent_runtime.evaluations.schemas.validation import (
    EvaluationCaseResult,
    EvaluationReport,
    ValidationIssue,
    ValidationStatus,
)
from agent_runtime.evaluations.services.validator import ExperienceValidator

if TYPE_CHECKING:
    from agent_runtime.engine.schemas.scoring import AssessmentScoringResult
    from agent_runtime.engine.services.scorer import ScoringEngine
    from agent_runtime.engine.services.selector import AdaptiveQuestionSelector

logger = logging.getLogger(__name__)


class SnapshotHashMismatch(ValueError):
    """The definition sent does not hash to the content_hash the caller captured."""

    def __init__(self, expected: str, actual: str) -> None:
        super().__init__(f"expected {expected}, computed {actual}")
        self.expected = expected
        self.actual = actual


class EvaluationRunner:
    """Replays golden cases on the runtime's selector and scorer."""

    def __init__(
        self,
        validator: ExperienceValidator | None = None,
        selector: AdaptiveQuestionSelector | None = None,
        scorer: ScoringEngine | None = None,
    ) -> None:
        from agent_runtime.engine.services.scorer import ScoringEngine
        from agent_runtime.engine.services.selector import AdaptiveQuestionSelector

        # The validator defaults to the production engine registry, as the wired service does.
        self._validator = validator or ExperienceValidator()
        self._selector = selector or AdaptiveQuestionSelector()
        self._scorer = scorer or ScoringEngine()

    def run_evaluation(
        self,
        definition: ExperienceDefinitionDocument | Mapping[str, Any],
        *,
        experience_id: str,
        expected_revision: int,
        expected_hash: str | None = None,
    ) -> EvaluationReport:
        """Run every golden case of `definition` and aggregate an EvaluationReport.

        1. Validates the definition with ExperienceValidator, which also computes the RFC 8785 hash.
        2. Raises SnapshotHashMismatch before any replay when `expected_hash` is given and differs.
        3. Replays each case with its seed, checking the selector order and the runtime completion check.
        4. Smoke-checks that the summary.v1 projection succeeds; its output is not compared to anything.

        The runtime keeps no drafts, so `expected_revision` is recorded on the report, not checked.
        """
        raw_dict = (
            definition.model_dump(mode="json", exclude_unset=True)
            if isinstance(definition, ExperienceDefinitionDocument)
            else dict(definition)
        )

        val_report = self._validator.validate(
            doc_input=raw_dict,
            experience_id=experience_id,
            draft_revision=expected_revision,
        )
        if expected_hash is not None and val_report.content_hash != expected_hash:
            raise SnapshotHashMismatch(expected_hash, val_report.content_hash)

        def report(status: ValidationStatus, cases: list[EvaluationCaseResult],
                   issues: list[ValidationIssue], mandatory_passed: bool = False) -> EvaluationReport:
            # Sanitized by the validator, so building the report cannot fail on caller input.
            return EvaluationReport(
                id=f"eval_{uuid4().hex[:16]}",
                experience_id=val_report.experience_id,
                draft_revision=val_report.draft_revision,
                content_hash=val_report.content_hash,
                definition_schema_version=val_report.definition_schema_version,
                engine_version=val_report.engine_version,
                status=status,
                mandatory_passed=mandatory_passed,
                cases=cases,
                issues=issues,
                created_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            )

        if val_report.status == ValidationStatus.UNSUPPORTED:
            return report(ValidationStatus.UNSUPPORTED, [], list(val_report.issues))

        try:
            def_doc = ExperienceDefinitionDocument.model_validate(raw_dict)
        except ValidationError as parse_err:
            issues = [
                ValidationIssue(
                    path=f"definition.{'.'.join(str(p) for p in err.get('loc', []))}",
                    code="EVAL_MALFORMED_DEFINITION",
                    message=err.get("msg", "Malformed definition"),
                    rule_id="EVALUATION_DOCUMENT_PARSE",
                )
                for err in parse_err.errors()
            ]
            return report(ValidationStatus.FAILED, [], list(val_report.issues) + issues)

        case_ids = [case.case_id for case in def_doc.evaluation_cases]
        if len(set(case_ids)) != len(case_ids):
            duplicate = ValidationIssue(
                path="evaluation_cases",
                code="EVAL_DUPLICATE_CASE_ID",
                message="Evaluation case ids must be unique.",
                rule_id="EVALUATION_DOCUMENT_PARSE",
            )
            return report(ValidationStatus.FAILED, [], list(val_report.issues) + [duplicate])

        cases = [self._evaluate_case(case, def_doc, raw_dict) for case in def_doc.evaluation_cases]
        issues = list(val_report.issues) if val_report.status != ValidationStatus.PASSED else []
        mandatory = [case for case in cases if case.mandatory]
        if not mandatory:
            issues.append(
                ValidationIssue(
                    path="evaluation_cases",
                    code="EVAL_NO_MANDATORY_CASE",
                    message="At least one evaluation case must be mandatory for the publish gate.",
                    rule_id="EVALUATION_OUTCOME_ACCURACY",
                )
            )
        mandatory_passed = (
            val_report.status == ValidationStatus.PASSED
            and bool(mandatory)
            and all(case.passed for case in mandatory)
        )
        all_passed = mandatory_passed and all(case.passed for case in cases)
        return report(ValidationStatus.PASSED if all_passed else ValidationStatus.FAILED, cases, issues,
                      mandatory_passed)

    def _evaluate_case(
        self,
        case: AssessmentGoldenCase,
        def_doc: ExperienceDefinitionDocument,
        raw_dict: Mapping[str, Any],
    ) -> EvaluationCaseResult:
        """Evaluate a single golden case against question selector, scoring engine and card projector."""
        from agent_runtime.engine.projection.summary_v1 import project_summary_from_result

        issues: list[ValidationIssue] = []
        case_id = case.case_id
        seed = case.seed
        expected = case.expected

        actual_question_ids: list[str] = []
        actual_primary_house_id: str | None = None
        actual_scores: dict[str, float] = {}
        actual_display_scores: dict[str, int] = {}
        actual_stopping_reason: str | None = None
        actual_tie_applied: bool = False
        actual_holland_code: str | None = None
        selector_house_id: str | None = None

        ans_payloads = [
            {"question_id": a.question_id, "option_id": a.option_id}
            for a in case.answers
        ]

        try:
            for step_idx in range(len(ans_payloads)):
                prefix = ans_payloads[:step_idx]
                step_res = self._selector.select_next_question(
                    answers=prefix,
                    definition=raw_dict,
                    validate_sequence=False,
                    seed=seed,
                )
                if not step_res.next_question_id:
                    issues.append(
                        ValidationIssue(
                            path=f"evaluation_cases[{case_id}].answers[{step_idx}]",
                            code="EVAL_ANSWERS_AFTER_STOP",
                            message=(
                                f"The engine stopped after {step_idx} answers; the remaining golden answers "
                                "would never be collected at runtime."
                            ),
                            rule_id="EVALUATION_SEQUENCE_INTEGRITY",
                        )
                    )
                    break
                actual_question_ids.append(step_res.next_question_id)
                if step_res.next_question_id != ans_payloads[step_idx]["question_id"]:
                    issues.append(
                        ValidationIssue(
                            path=f"evaluation_cases[{case_id}].answers[{step_idx}].question_id",
                            code="EVAL_UNEXPECTED_QUESTION_IN_SEQUENCE",
                            message=(
                                f"At step {step_idx + 1}, engine selected question "
                                f"'{step_res.next_question_id}' but golden answer provided was for "
                                f"'{ans_payloads[step_idx]['question_id']}'."
                            ),
                            rule_id="EVALUATION_SEQUENCE_INTEGRITY",
                        )
                    )

            final_sel = self._selector.select_next_question(
                answers=ans_payloads,
                definition=raw_dict,
                validate_sequence=False,
                seed=seed,
            )
            if final_sel.stopping_reason:
                actual_stopping_reason = (
                    final_sel.stopping_reason.value
                    if hasattr(final_sel.stopping_reason, "value")
                    else str(final_sel.stopping_reason)
                )
            selector_house_id = final_sel.primary_house_id
        except Exception as sel_err:
            issues.append(_replay_issue(case_id, "selector", "EVAL_SELECTOR_EXECUTION_ERROR", sel_err))

        scoring_res: AssessmentScoringResult | None = None
        try:
            scoring_res = self._scorer.calculate_scores(
                answers=ans_payloads,
                definition=raw_dict,
                seed=seed,
            )
            actual_primary_house_id = scoring_res.primary_house_id
            actual_tie_applied = bool(scoring_res.tie_applied)
            actual_holland_code = scoring_res.holland_code
            if scoring_res.stopping_reason:
                actual_stopping_reason = (
                    scoring_res.stopping_reason.value
                    if hasattr(scoring_res.stopping_reason, "value")
                    else str(scoring_res.stopping_reason)
                )

            actual_scores = {
                house_id: (
                    float(detail.mean.value)
                    if hasattr(detail.mean, "value")
                    else float(detail.mean)
                )
                for house_id, detail in scoring_res.house_scores.items()
            }
            actual_display_scores = {
                house_id: detail.display_score
                for house_id, detail in scoring_res.house_scores.items()
            }

        except Exception as scr_err:
            scoring_res = None
            issues.append(_replay_issue(case_id, "scorer", "EVAL_SCORING_EXECUTION_ERROR", scr_err))

        # The runtime refuses to complete when these disagree (EngineCompletionPort.prepare).
        if scoring_res is not None and (
            not scoring_res.is_complete or scoring_res.primary_house_id != selector_house_id
        ):
            issues.append(
                ValidationIssue(
                    path=f"evaluation_cases[{case_id}]",
                    code="EVAL_COMPLETION_MISMATCH",
                    message=(
                        f"Scorer (complete={scoring_res.is_complete}, house '{scoring_res.primary_house_id}') "
                        f"and selector (house '{selector_house_id}') disagree; the runtime would not "
                        "complete this case."
                    ),
                    rule_id="EVALUATION_ENGINE_REPLAY",
                )
            )

        if scoring_res is not None:
            try:
                project_summary_from_result(
                    scoring=scoring_res,
                    definition=raw_dict,
                    display_name="Học sinh thử nghiệm",  # placeholder: the card only needs a name
                    is_demo=def_doc.is_demo,
                    result_id=f"res_eval_{case_id}",
                    result_revision=1,
                    activity_id=f"act_eval_{case_id}",
                )
            except Exception as prj_err:
                issues.append(_replay_issue(case_id, "projection", "EVAL_CARD_PROJECTION_FAILED", prj_err))

        if expected.house_id != actual_primary_house_id:
            issues.append(
                ValidationIssue(
                    path=f"evaluation_cases[{case_id}].expected.house_id",
                    code="EVAL_HOUSE_MISMATCH",
                    message=(
                        f"Expected primary winning house '{expected.house_id}', "
                        f"but engine produced '{actual_primary_house_id}'."
                    ),
                    rule_id="EVALUATION_OUTCOME_ACCURACY",
                )
            )

        if expected.question_ids is not None and expected.question_ids != actual_question_ids:
            issues.append(
                ValidationIssue(
                    path=f"evaluation_cases[{case_id}].expected.question_ids",
                    code="EVAL_QUESTION_SEQUENCE_MISMATCH",
                    message=(
                        f"Expected question sequence {expected.question_ids}, "
                        f"but actual sequence was {actual_question_ids}."
                    ),
                    rule_id="EVALUATION_OUTCOME_ACCURACY",
                )
            )

        if expected.stopping_reason is not None and expected.stopping_reason != actual_stopping_reason:
            issues.append(
                ValidationIssue(
                    path=f"evaluation_cases[{case_id}].expected.stopping_reason",
                    code="EVAL_STOPPING_REASON_MISMATCH",
                    message=(
                        f"Expected stopping reason '{expected.stopping_reason}', "
                        f"but actual was '{actual_stopping_reason}'."
                    ),
                    rule_id="EVALUATION_OUTCOME_ACCURACY",
                )
            )

        if expected.tie_applied is not None and expected.tie_applied != actual_tie_applied:
            issues.append(
                ValidationIssue(
                    path=f"evaluation_cases[{case_id}].expected.tie_applied",
                    code="EVAL_TIE_APPLIED_MISMATCH",
                    message=(
                        f"Expected tie_applied={expected.tie_applied}, "
                        f"but actual was {actual_tie_applied}."
                    ),
                    rule_id="EVALUATION_OUTCOME_ACCURACY",
                )
            )

        if expected.scores is not None:
            for exp_house, exp_score in expected.scores.items():
                if exp_house not in actual_scores:
                    issues.append(
                        ValidationIssue(
                            path=f"evaluation_cases[{case_id}].expected.scores.{exp_house}",
                            code="EVAL_MISSING_HOUSE_SCORE",
                            message=f"Expected score for house '{exp_house}' was not computed.",
                            rule_id="EVALUATION_OUTCOME_ACCURACY",
                        )
                    )
                else:
                    act_score = actual_scores[exp_house]
                    if abs(act_score - float(exp_score)) > 1e-4:
                        issues.append(
                            ValidationIssue(
                                path=f"evaluation_cases[{case_id}].expected.scores.{exp_house}",
                                code="EVAL_SCORE_MISMATCH",
                                message=(
                                    f"Expected score for house '{exp_house}' to be {exp_score}, "
                                    f"but engine computed {act_score}."
                                ),
                                rule_id="EVALUATION_OUTCOME_ACCURACY",
                            )
                        )

        passed = len(issues) == 0
        expected_dict = {
            k: v for k, v in expected.model_dump().items() if v is not None
        }
        actual_dict = {
            "question_ids": actual_question_ids,
            "house_id": actual_primary_house_id,
            "scores": actual_scores,
            "display_scores": actual_display_scores,
            "stopping_reason": actual_stopping_reason,
            "tie_applied": actual_tie_applied,
            "holland_code": actual_holland_code,
        }

        return EvaluationCaseResult(
            case_id=case_id,
            mandatory=case.mandatory,
            passed=passed,
            expected=expected_dict,
            actual=actual_dict,
            issues=issues,
        )


def _replay_issue(case_id: str, stage: str, code: str, error: Exception) -> ValidationIssue:
    """Engine errors are expected golden-case failures; anything else is a runtime bug, so log it.

    Both fail the case (fail closed); the code tells the author which side is at fault.
    """
    from agent_runtime.engine.exceptions import EngineError

    if not isinstance(error, (EngineError, ValidationError)):
        logger.error("evaluation replay crashed: case=%s stage=%s", case_id, stage, exc_info=error)
        return ValidationIssue(
            path=f"evaluation_cases[{case_id}].{stage}",
            code="EVAL_ENGINE_INTERNAL_ERROR",
            message=f"The {stage} crashed ({type(error).__name__}); this is a runtime defect, not a case error.",
            rule_id="EVALUATION_ENGINE_REPLAY",
        )
    return ValidationIssue(
        path=f"evaluation_cases[{case_id}].{stage}",
        code=code,
        message=f"The {stage} rejected the golden case: {error}",
        rule_id="EVALUATION_ENGINE_REPLAY",
    )
