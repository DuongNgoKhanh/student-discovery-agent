"""Publish Gate & Report Verification Service (Task C-05 / M-EVL).

Conforms to:
- contracts/openapi/public/experience-validation-api.yaml
- ADR-001 §2.3 (Publish Gate & Immutable Release verification)
- apps/studio-api/src/modules/experiences/experiences.reports.ts (PublishReportInput)

Reports live in a bounded, in-memory, process-local store: they do not survive a restart and are not
shared between workers or replicas, so a verify after either fails closed ("not found") and Studio
has to re-run validation and evaluation. Durable report storage is a follow-up.
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Generic, TypeVar

from agent_runtime.evaluations.schemas.validation import (
    EvaluationReport,
    ExperienceSnapshotCommand,
    PublishReportInput,
    ValidationReport,
    ValidationStatus,
)
from agent_runtime.evaluations.services.runner import EvaluationRunner, SnapshotHashMismatch
from agent_runtime.evaluations.services.validator import (
    ExperienceValidator,
    calculate_content_hash,
)

logger = logging.getLogger(__name__)

DEFAULT_CAPACITY = 512

R = TypeVar("R", ValidationReport, EvaluationReport)


class IdempotencyConflict(ValueError):
    """An idempotency key was reused for a different snapshot (content_hash or revision)."""


class _Reports(Generic[R]):
    """LRU-bounded reports plus the idempotency index that points at them."""

    def __init__(self, capacity: int) -> None:
        self._capacity = capacity
        self._reports: OrderedDict[str, R] = OrderedDict()
        # (experience_id, idempotency_key) -> ((content_hash, expected_revision), report_id)
        self._keys: OrderedDict[tuple[str, str], tuple[tuple[str, int], str]] = OrderedDict()

    def get(self, report_id: str) -> R | None:
        return self._reports.get(report_id)

    def replay(self, command: ExperienceSnapshotCommand) -> R | None:
        entry = self._keys.get((command.experience_id, command.idempotency_key))
        if entry is None:
            return None
        fingerprint, report_id = entry
        if fingerprint != (command.content_hash, command.expected_revision):
            raise IdempotencyConflict(command.idempotency_key)
        return self._reports.get(report_id)

    def put(self, command: ExperienceSnapshotCommand, report: R) -> None:
        self._reports[report.id] = report
        self._keys[(command.experience_id, command.idempotency_key)] = (
            (command.content_hash, command.expected_revision), report.id)
        for index in (self._reports, self._keys):
            while len(index) > self._capacity:
                index.popitem(last=False)


class ReportStore:
    """In-memory report store; one lock covers each check-run-put so replays are atomic."""

    def __init__(self, capacity: int = DEFAULT_CAPACITY) -> None:
        self.lock = threading.Lock()
        self.validations: _Reports[ValidationReport] = _Reports(capacity)
        self.evaluations: _Reports[EvaluationReport] = _Reports(capacity)


@dataclass(frozen=True)
class GateVerdict:
    verified: bool
    reason: str | None = None


class PublishGateService:
    """Runs validation and evaluation for Studio and verifies a report pair before publish."""

    def __init__(
        self,
        store: ReportStore | None = None,
        validator: ExperienceValidator | None = None,
        runner: EvaluationRunner | None = None,
    ) -> None:
        self._store = store or ReportStore()
        self._validator = validator or ExperienceValidator()
        self._runner = runner or EvaluationRunner(validator=self._validator)

    def validate_and_store(self, command: ExperienceSnapshotCommand) -> ValidationReport:
        _check_hash(command)
        with self._store.lock:
            cached = self._store.validations.replay(command)
            if cached is not None:
                return cached
            report = self._validator.validate(
                doc_input=command.definition,
                experience_id=command.experience_id,
                draft_revision=command.expected_revision,
            )
            self._store.validations.put(command, report)
            return report

    def evaluate_and_store(self, command: ExperienceSnapshotCommand) -> EvaluationReport:
        _check_hash(command)
        with self._store.lock:
            cached = self._store.evaluations.replay(command)
            if cached is not None:
                return cached
            report = self._runner.run_evaluation(
                command.definition,
                experience_id=command.experience_id,
                expected_revision=command.expected_revision,
                expected_hash=command.content_hash,
            )
            self._store.evaluations.put(command, report)
            return report

    def verify_publish_gate(self, inp: PublishReportInput) -> GateVerdict:
        """Fail closed unless both reports exist, passed, and match this experience/hash/schema/engine.

        The validation report must have status passed; the evaluation report must have
        mandatory_passed (non-mandatory case failures do not block publish).
        """
        with self._store.lock:
            validation = self._store.validations.get(inp.validation_id)
            evaluation = self._store.evaluations.get(inp.evaluation_id)
        verdict = (
            _check_report("Validation", inp.validation_id, validation, inp,
                          passed=validation is not None and validation.status == ValidationStatus.PASSED
                          and validation.mandatory_passed)
            or _check_report("Evaluation", inp.evaluation_id, evaluation, inp,
                             passed=evaluation is not None and evaluation.mandatory_passed)
            or GateVerdict(True)
        )
        if not verdict.verified:
            logger.warning("publish gate denied: experience=%s reason=%s", inp.experience_id, verdict.reason)
        return verdict


def _check_hash(command: ExperienceSnapshotCommand) -> None:
    actual = calculate_content_hash(command.definition)
    if actual != command.content_hash:
        raise SnapshotHashMismatch(command.content_hash, actual)


def _check_report(kind: str, report_id: str, report: ValidationReport | EvaluationReport | None,
                  inp: PublishReportInput, *, passed: bool) -> GateVerdict | None:
    if report is None:
        return GateVerdict(False, f"{kind} report '{report_id}' not found")
    if not passed:
        return GateVerdict(False, f"{kind} report '{report_id}' did not pass")
    for field, actual, expected in (
        ("experience ID", report.experience_id, inp.experience_id),
        ("content hash", report.content_hash, inp.definition_hash),
        ("schema version", report.definition_schema_version, inp.definition_schema_version),
        ("engine version", report.engine_version, inp.engine_version),
    ):
        if actual != expected:
            return GateVerdict(False, f"{kind} report {field} '{actual}' does not match '{expected}'")
    return None
