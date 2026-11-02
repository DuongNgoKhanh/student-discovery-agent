import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from agent_runtime.api.internal.dependencies import RuntimeContainer
from agent_runtime.evaluations.services.publish_gate import PublishGateService
from agent_runtime.evaluations.services.validator import calculate_content_hash
from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier, ServiceVerifier
from agent_runtime.main import create_app
from agent_runtime.sessions.schemas.common import RuntimePolicy
from tests.helpers.clock import FakeClock
from tests.helpers.signing import sign_request, sign_service_request

NOW = datetime(2026, 10, 29, tzinfo=UTC)
STUDENT_KEY = b"student-test-key-at-least-32-bytes!!"
STUDIO_KEY = b"studio-test-key-at-least-32-bytes!!"
BASE = "/api/v1/internal"
VALIDATE, EVALUATE, VERIFY = (BASE + "/experience-validations:run", BASE + "/experience-evaluations:run",
                              BASE + "/experience-reports:verify")
PURPOSE = {VALIDATE: "experience.validate", EVALUATE: "experience.evaluate", VERIFY: "experience.verify"}


@pytest.fixture
def client():
    runtime = RuntimeContainer(policy=RuntimePolicy(environment="demo"),
                               verifier=CallerVerifier({"s": STUDENT_KEY}, FakeClock(NOW)),
                               service_verifier=ServiceVerifier({"studio": STUDIO_KEY}, FakeClock(NOW)),
                               evaluations=PublishGateService())
    with TestClient(create_app(runtime)) as test_client:
        yield test_client


def post(client, target, payload, purpose=None, student=False):
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    context = RawRequestContext("POST", target, body)
    if student:
        token = sign_request(context, owner_id="own_x", now=NOW, key=STUDENT_KEY, kid="s")
        caller = "sda-product-bff"
    else:
        token = sign_service_request(context, now=NOW, key=STUDIO_KEY, kid="studio",
                                     purpose=purpose or PURPOSE[target])
        caller = "sda-studio-api"
    return client.post(target, content=body, headers={
        "X-Internal-Caller": caller, "X-Caller-Context": token, "Content-Type": "application/json"})


def snapshot(doc, key="key_1", **overrides):
    return {"experience_id": "exp_test", "definition": doc, "expected_revision": 1,
            "content_hash": calculate_content_hash(doc), "idempotency_key": key} | overrides


def test_studio_can_validate_evaluate_and_verify_over_http(client, valid_v2_doc):
    validation = post(client, VALIDATE, snapshot(valid_v2_doc, key="v"))
    evaluation = post(client, EVALUATE, snapshot(valid_v2_doc, key="e"))
    assert validation.status_code == evaluation.status_code == 200
    val, ev = validation.json()["data"], evaluation.json()["data"]
    assert (val["status"], ev["status"]) == ("passed", "passed")

    verdict = post(client, VERIFY, {
        "experience_id": "exp_test", "definition_hash": val["content_hash"],
        "definition_schema_version": val["definition_schema_version"], "engine_version": val["engine_version"],
        "validation_id": val["id"], "evaluation_id": ev["id"]})
    assert verdict.status_code == 200
    assert verdict.json()["data"] == {"verified": True, "reason": None}


@pytest.mark.parametrize("target", [VALIDATE, EVALUATE, VERIFY])
def test_a_student_token_cannot_call_service_routes(client, valid_v2_doc, target):
    assert post(client, target, snapshot(valid_v2_doc), student=True).status_code == 403


@pytest.mark.parametrize("target,purpose", [
    (EVALUATE, "experience.validate"), (VALIDATE, "experience.evaluate"), (VERIFY, "experience.evaluate"),
    (EVALUATE, "agent.validate"), (BASE + "/agent-snapshots:validate", "experience.evaluate"),
])
def test_each_route_takes_only_its_own_purpose(client, valid_v2_doc, target, purpose):
    assert post(client, target, snapshot(valid_v2_doc), purpose=purpose).status_code == 403


@pytest.mark.parametrize("overrides", [
    {"experience_id": "bad id!"}, {"experience_id": 5}, {"expected_revision": -1}, {"expected_revision": "1"},
    {"expected_revision": None}, {"idempotency_key": ["a"]}, {"content_hash": "sha256:x"}, {"definition": []},
    {"unknown": 1},
])
def test_malformed_snapshot_commands_are_422(client, valid_v2_doc, overrides):
    response = post(client, EVALUATE, snapshot(valid_v2_doc) | overrides)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VAL_INVALID_INPUT"


@pytest.mark.parametrize("missing", ["experience_id", "definition", "expected_revision", "content_hash",
                                     "idempotency_key"])
def test_every_snapshot_field_is_required(client, valid_v2_doc, missing):
    payload = snapshot(valid_v2_doc)
    del payload[missing]
    assert post(client, VALIDATE, payload).status_code == 422


def test_a_stale_hash_is_a_revision_conflict(client, valid_v2_doc):
    response = post(client, EVALUATE, snapshot(valid_v2_doc, content_hash="sha256:" + "0" * 64))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CONFLICT_REVISION"


def test_reusing_an_idempotency_key_for_another_revision_conflicts(client, valid_v2_doc):
    assert post(client, EVALUATE, snapshot(valid_v2_doc)).status_code == 200
    response = post(client, EVALUATE, snapshot(valid_v2_doc, expected_revision=2))
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CONFLICT_IDEMPOTENCY_KEY"


def test_verify_rejects_unknown_fields(client):
    assert post(client, VERIFY, {"experience_id": "exp_test", "extra": 1}).status_code == 422


def test_missing_service_is_503(valid_v2_doc):
    runtime = RuntimeContainer(policy=RuntimePolicy(environment="demo"),
                               verifier=CallerVerifier({"s": STUDENT_KEY}, FakeClock(NOW)),
                               service_verifier=ServiceVerifier({"studio": STUDIO_KEY}, FakeClock(NOW)))
    with TestClient(create_app(runtime)) as unconfigured:
        assert post(unconfigured, EVALUATE, snapshot(valid_v2_doc)).json()["error"]["code"] == "SYS_UNAVAILABLE"
