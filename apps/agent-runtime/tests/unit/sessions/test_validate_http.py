import json
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from agent_runtime.agent.validation import AgentValidationResult, Issue
from agent_runtime.api.internal.dependencies import RuntimeContainer
from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier, ServiceVerifier
from agent_runtime.main import create_app
from agent_runtime.sessions.schemas.common import RuntimePolicy
from tests.helpers.clock import FakeClock
from tests.helpers.signing import sign_service_request

NOW = datetime(2026, 10, 28, tzinfo=UTC)
STUDENT_KEY = b"student-test-key-at-least-32-bytes!!"
STUDIO_KEY = b"studio-test-key-at-least-32-bytes!!"
TARGET = "/api/v1/internal/agent-snapshots:validate"


class StubValidator:
    def validate(self, content):
        return AgentValidationResult(valid=False, content_hash="sha256:x",
                                     issues=(Issue(path="greeting_text", code="missing", message="Thiếu"),))


STUB = StubValidator()


def call(purpose="agent.validate", target=TARGET, validator=STUB):
    runtime = RuntimeContainer(policy=RuntimePolicy(environment="demo"),
                               verifier=CallerVerifier({"s": STUDENT_KEY}, FakeClock(NOW)),
                               service_verifier=ServiceVerifier({"studio": STUDIO_KEY}, FakeClock(NOW)),
                               agent_validation=validator)
    body = json.dumps({"content": {"greeting_text": "x"}}).encode()
    token = sign_service_request(RawRequestContext("POST", target, body), now=NOW, key=STUDIO_KEY, kid="studio",
                                 purpose=purpose)
    with TestClient(create_app(runtime)) as client:
        return client.post(target, content=body, headers={
            "X-Internal-Caller": "sda-studio-api", "X-Caller-Context": token, "Content-Type": "application/json"})


def test_validation_result_is_returned_with_200():
    response = call()
    assert response.status_code == 200
    assert response.json()["data"] == {"valid": False, "content_hash": "sha256:x",
                                       "issues": [{"path": "greeting_text", "code": "missing", "message": "Thiếu"}]}


def test_a_retrieval_token_cannot_call_validate():
    assert call(purpose="knowledge.retrieval").status_code == 403


def test_validate_token_cannot_call_retrieval():
    assert call(target="/api/v1/internal/knowledge/retrieval").status_code == 403


def test_missing_validator_is_503():
    assert call(validator=None).json()["error"]["code"] == "SYS_UNAVAILABLE"
