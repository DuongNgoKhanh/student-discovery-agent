"""Unit tests for EvaluationRunner and PublishGateService (Task C-05 / M-EVL).

Covers golden-case replay and each mismatch detector, mandatory vs non-mandatory cases, unsupported
engines, hash rejection before work, idempotent replay and conflicts, and every publish-gate check.
"""

import copy
import threading

import pytest
from pydantic import ValidationError

from agent_runtime.evaluations.schemas.validation import (
    EvaluationCaseResult,
    EvaluationReport,
    ExperienceSnapshotCommand,
    PublishReportInput,
    ValidationStatus,
)
from agent_runtime.evaluations.services.publish_gate import (
    IdempotencyConflict,
    PublishGateService,
    ReportStore,
)
from agent_runtime.evaluations.services.runner import EvaluationRunner, SnapshotHashMismatch
from agent_runtime.evaluations.services.validator import calculate_content_hash

WRONG_HASH = "sha256:" + "0" * 64


def run(doc, **kwargs):
    return EvaluationRunner().run_evaluation(doc, experience_id="exp_test", expected_revision=1, **kwargs)


def command(doc, key="key_1", revision=1, experience_id="exp_test", content_hash=None):
    return ExperienceSnapshotCommand(experience_id=experience_id, definition=doc, expected_revision=revision,
                                     content_hash=content_hash or calculate_content_hash(doc), idempotency_key=key)


def gate_input(val, ev, **overrides):
    fields = dict(experience_id=val.experience_id, definition_hash=val.content_hash,
                  definition_schema_version=val.definition_schema_version, engine_version=val.engine_version,
                  validation_id=val.id, evaluation_id=ev.id)
    return PublishReportInput(**(fields | overrides))


def failing(doc):
    bad = copy.deepcopy(doc)
    bad["evaluation_cases"][0]["expected"]["house_id"] = "house_r"
    return bad


def test_evaluation_runner_valid_v2_success(valid_v2_doc):
    report = run(valid_v2_doc)
    assert report.status == ValidationStatus.PASSED
    assert report.mandatory_passed is True
    assert report.draft_revision == 1
    assert report.experience_id == "exp_test"
    assert report.definition_schema_version == "2.0"
    assert report.engine_version == "career-assessment-v1"
    assert report.content_hash == calculate_content_hash(valid_v2_doc)
    assert report.created_at.endswith("Z")
    assert report.issues == []

    (case_res,) = report.cases
    assert case_res.case_id == "case_test"
    assert case_res.mandatory is True
    assert case_res.passed is True
    assert case_res.issues == []
    assert case_res.actual["house_id"] == "house_s"
    assert case_res.actual["stopping_reason"] == "question_limit"
    assert case_res.actual["tie_applied"] is True
    expected_scores = valid_v2_doc["evaluation_cases"][0]["expected"]["scores"]
    assert case_res.actual["scores"] == pytest.approx(expected_scores)


def test_a_wrong_expected_hash_is_rejected_before_any_replay(valid_v2_doc):
    with pytest.raises(SnapshotHashMismatch):
        run(valid_v2_doc, expected_hash=WRONG_HASH)


@pytest.mark.parametrize("mutate,code", [
    (lambda e: e.update(house_id="house_r"), "EVAL_HOUSE_MISMATCH"),
    (lambda e: e.update(question_ids=["q_r_01", "q_r_02"]), "EVAL_QUESTION_SEQUENCE_MISMATCH"),
    (lambda e: e.update(stopping_reason="bounded_winner"), "EVAL_STOPPING_REASON_MISMATCH"),
    (lambda e: e.update(tie_applied=False), "EVAL_TIE_APPLIED_MISMATCH"),
    (lambda e: e["scores"].update(house_r=4.5), "EVAL_SCORE_MISMATCH"),
    (lambda e: e["scores"].update(house_unknown=3.0), "EVAL_MISSING_HOUSE_SCORE"),
])
def test_each_mismatch_fails_the_mandatory_case(valid_v2_doc, mutate, code):
    doc = copy.deepcopy(valid_v2_doc)
    mutate(doc["evaluation_cases"][0]["expected"])
    report = run(doc)
    assert report.status == ValidationStatus.FAILED
    assert report.mandatory_passed is False
    assert report.cases[0].passed is False
    assert code in {i.code for i in report.cases[0].issues}


def test_a_golden_case_id_with_a_colon_is_reported(valid_v2_doc):
    doc = copy.deepcopy(valid_v2_doc)
    doc["evaluation_cases"][0]["case_id"] = "case:1"
    assert run(doc).cases[0].case_id == "case:1"


def test_duplicate_case_ids_fail_the_report_instead_of_crashing(valid_v2_doc):
    doc = copy.deepcopy(valid_v2_doc)
    doc["evaluation_cases"].append(copy.deepcopy(doc["evaluation_cases"][0]))
    report = run(doc)
    assert report.status == ValidationStatus.FAILED
    assert "EVAL_DUPLICATE_CASE_ID" in {i.code for i in report.issues}


def test_a_non_mandatory_failure_fails_status_but_keeps_mandatory_passed(valid_v2_doc):
    doc = copy.deepcopy(valid_v2_doc)
    extra = copy.deepcopy(doc["evaluation_cases"][0])
    extra.update(case_id="case_non_mandatory", mandatory=False)
    extra["expected"]["house_id"] = "house_r"
    doc["evaluation_cases"].append(extra)

    report = run(doc)
    assert report.mandatory_passed is True
    assert report.status == ValidationStatus.FAILED
    assert [c.passed for c in report.cases] == [True, False]


def test_without_a_mandatory_case_the_report_says_why(valid_v2_doc):
    doc = copy.deepcopy(valid_v2_doc)
    doc["evaluation_cases"][0]["mandatory"] = False
    report = run(doc)
    assert report.mandatory_passed is False
    assert report.status == ValidationStatus.FAILED
    assert [i.code for i in report.issues] == ["EVAL_NO_MANDATORY_CASE"]


def test_unsupported_engine_carries_the_validator_issues(valid_v2_doc):
    doc = copy.deepcopy(valid_v2_doc)
    doc["engine_version"] = "unsupported-engine-999"
    for slot in ("selection_rules", "scoring_rules", "coverage_rules", "tie_policy"):
        doc[slot]["engine_version"] = "unsupported-engine-999"

    report = run(doc)
    assert report.status == ValidationStatus.UNSUPPORTED
    assert report.mandatory_passed is False
    assert report.engine_version == "unsupported-engine-999"
    assert report.issues


def test_answers_after_the_engine_stopped_fail_the_case(valid_v2_doc):
    doc = copy.deepcopy(valid_v2_doc)
    answers = doc["evaluation_cases"][0]["answers"]
    answers.append(copy.deepcopy(answers[-1]))
    report = run(doc)
    assert "EVAL_ANSWERS_AFTER_STOP" in {i.code for i in report.cases[0].issues}


class _BrokenScorer:
    def calculate_scores(self, **_):
        raise AttributeError("'NoneType' object has no attribute 'mean'")


def test_a_runtime_crash_is_logged_and_not_blamed_on_the_case(valid_v2_doc, caplog):
    report = EvaluationRunner(scorer=_BrokenScorer()).run_evaluation(
        valid_v2_doc, experience_id="exp_test", expected_revision=1)
    codes = {i.code for i in report.cases[0].issues}
    assert "EVAL_ENGINE_INTERNAL_ERROR" in codes
    assert "EVAL_SCORING_EXECUTION_ERROR" not in codes
    assert "evaluation replay crashed" in caplog.text


def test_reports_reject_inconsistent_flags():
    case = EvaluationCaseResult(case_id="c", mandatory=True, passed=True, expected={}, actual={})
    base = dict(id="eval_x", experience_id="exp", draft_revision=1, content_hash=WRONG_HASH,
                definition_schema_version="2.0", engine_version="e", created_at="2026-10-29T00:00:00Z")
    with pytest.raises(ValidationError):
        EvaluationReport(**base, status="passed", mandatory_passed=True, cases=[])
    with pytest.raises(ValidationError):
        EvaluationReport(**base, status="passed", mandatory_passed=False, cases=[case])
    with pytest.raises(ValidationError):
        EvaluationCaseResult(case_id="c", mandatory=True, passed=False, expected={}, actual={})
    with pytest.raises(ValidationError):
        EvaluationReport(**base, status="failed", mandatory_passed=False, cases=[case, case])


def test_publish_gate_full_flow_with_idempotent_replay(valid_v2_doc):
    service = PublishGateService()
    val = service.validate_and_store(command(valid_v2_doc, key="val_1"))
    assert val.status == ValidationStatus.PASSED
    assert service.validate_and_store(command(valid_v2_doc, key="val_1")).id == val.id

    ev = service.evaluate_and_store(command(valid_v2_doc, key="eval_1"))
    assert ev.status == ValidationStatus.PASSED
    assert service.evaluate_and_store(command(valid_v2_doc, key="eval_1")).id == ev.id

    verdict = service.verify_publish_gate(gate_input(val, ev))
    assert verdict.verified is True
    assert verdict.reason is None


@pytest.mark.parametrize("store", ["validate_and_store", "evaluate_and_store"])
def test_a_command_whose_hash_does_not_match_its_definition_is_rejected(valid_v2_doc, store):
    with pytest.raises(SnapshotHashMismatch):
        getattr(PublishGateService(), store)(command(valid_v2_doc, content_hash=WRONG_HASH))


@pytest.mark.parametrize("change", [{"revision": 2}, {"doc": "other"}])
def test_reusing_a_key_for_another_snapshot_is_a_conflict(valid_v2_doc, change):
    service = PublishGateService()
    service.evaluate_and_store(command(valid_v2_doc))
    doc = failing(valid_v2_doc) if change.get("doc") else valid_v2_doc
    with pytest.raises(IdempotencyConflict):
        service.evaluate_and_store(command(doc, revision=change.get("revision", 1)))


def test_concurrent_retries_with_one_key_share_one_report(valid_v2_doc):
    service = PublishGateService()
    barrier, ids = threading.Barrier(4), []

    def retry():
        barrier.wait()
        ids.append(service.evaluate_and_store(command(valid_v2_doc)).id)

    threads = [threading.Thread(target=retry) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert len(set(ids)) == 1


def test_the_store_evicts_the_oldest_reports(valid_v2_doc):
    service = PublishGateService(store=ReportStore(capacity=2))
    first = service.validate_and_store(command(valid_v2_doc, key="k1"))
    service.validate_and_store(command(valid_v2_doc, key="k2"))
    service.validate_and_store(command(valid_v2_doc, key="k3"))
    other = service.evaluate_and_store(command(valid_v2_doc))
    assert service.verify_publish_gate(gate_input(first, other)).reason == f"Validation report '{first.id}' not found"


@pytest.fixture
def passing_pair(valid_v2_doc):
    service = PublishGateService()
    return (service, service.validate_and_store(command(valid_v2_doc, key="v")),
            service.evaluate_and_store(command(valid_v2_doc, key="e")))


@pytest.mark.parametrize("overrides,reason", [
    ({"validation_id": "val_missing"}, "Validation report 'val_missing' not found"),
    ({"evaluation_id": "eval_missing"}, "Evaluation report 'eval_missing' not found"),
    ({"experience_id": "exp_other"}, "Validation report experience ID 'exp_test' does not match 'exp_other'"),
    ({"definition_hash": WRONG_HASH}, "Validation report content hash"),
    ({"definition_schema_version": "1.0"}, "Validation report schema version '2.0' does not match '1.0'"),
    ({"engine_version": "career-assessment-v2"}, "Validation report engine version"),
])
def test_the_gate_names_the_failed_check(passing_pair, overrides, reason):
    service, val, ev = passing_pair
    verdict = service.verify_publish_gate(gate_input(val, ev, **overrides))
    assert verdict.verified is False
    assert verdict.reason.startswith(reason)


def test_the_gate_rejects_an_evaluation_of_another_definition(valid_v2_doc):
    service = PublishGateService()
    doc_b = copy.deepcopy(valid_v2_doc)
    doc_b["definition_version"] = doc_b.get("definition_version", "1") + "-b"
    val = service.validate_and_store(command(valid_v2_doc, key="v"))
    ev_b = service.evaluate_and_store(command(doc_b, key="e"))
    verdict = service.verify_publish_gate(gate_input(val, ev_b))
    assert verdict.reason.startswith("Evaluation report content hash")


def test_the_gate_rejects_failed_reports(valid_v2_doc):
    service = PublishGateService()
    val = service.validate_and_store(command(valid_v2_doc, key="v"))
    ev = service.evaluate_and_store(command(failing(valid_v2_doc), key="e"))
    assert service.verify_publish_gate(gate_input(val, ev)).reason == f"Evaluation report '{ev.id}' did not pass"

    bad = copy.deepcopy(valid_v2_doc)
    bad["approval_refs"] = [""]
    failed_val = service.validate_and_store(command(bad, key="v2"))
    assert failed_val.status == ValidationStatus.FAILED
    assert service.verify_publish_gate(gate_input(failed_val, ev)).reason == (
        f"Validation report '{failed_val.id}' did not pass")


def test_a_non_mandatory_failure_does_not_block_publish(valid_v2_doc):
    service = PublishGateService()
    doc = copy.deepcopy(valid_v2_doc)
    extra = copy.deepcopy(doc["evaluation_cases"][0])
    extra.update(case_id="case_optional", mandatory=False)
    extra["expected"]["house_id"] = "house_r"
    doc["evaluation_cases"].append(extra)
    val = service.validate_and_store(command(doc, key="v"))
    ev = service.evaluate_and_store(command(doc, key="e"))
    assert service.verify_publish_gate(gate_input(val, ev)).verified is True
