from datetime import UTC, datetime

from fastapi.testclient import TestClient

from agent_runtime.api.internal.dependencies import RuntimeContainer
from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier, ServiceVerifier
from agent_runtime.main import create_app
from agent_runtime.sessions.schemas.common import RuntimePolicy
from tests.helpers.clock import FakeClock
from tests.helpers.signing import sign_request, sign_service_request

NOW = datetime(2026, 10, 28, tzinfo=UTC)
STUDENT_KEY = b"student-test-key-at-least-32-bytes!!"
STUDIO_KEY = b"studio-test-key-at-least-32-bytes!!"
TARGET = "/api/v1/internal/workflow/node-types"


def get(purpose="agent.validate", student=False):
    runtime = RuntimeContainer(policy=RuntimePolicy(environment="demo"),
                               verifier=CallerVerifier({"s": STUDENT_KEY}, FakeClock(NOW)),
                               service_verifier=ServiceVerifier({"studio": STUDIO_KEY}, FakeClock(NOW)))
    context = RawRequestContext("GET", TARGET, b"")
    if student:
        token = sign_request(context, owner_id="owner_" + "a" * 24, now=NOW, key=STUDENT_KEY, kid="s")
        caller = "sda-product-bff"
    else:
        token = sign_service_request(context, now=NOW, key=STUDIO_KEY, kid="studio", purpose=purpose)
        caller = "sda-studio-api"
    with TestClient(create_app(runtime)) as client:
        return client.get(TARGET, headers={"X-Internal-Caller": caller, "X-Caller-Context": token})


def test_catalog_is_served_to_a_validate_token():
    response = get()
    assert response.status_code == 200
    assert response.json()["data"]["catalog_version"] == "chatflow.catalog.v1"


def test_a_student_token_cannot_read_the_catalog():
    assert get(student=True).status_code == 403


def test_a_retrieval_token_cannot_read_the_catalog():
    assert get(purpose="knowledge.retrieval").status_code == 403
