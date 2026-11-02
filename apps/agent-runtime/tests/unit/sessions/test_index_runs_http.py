import base64
import json
import logging
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from agent_runtime.api.internal.dependencies import RuntimeContainer, build_runtime
from agent_runtime.config.settings import Settings
from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier, ServiceVerifier
from agent_runtime.main import create_app
from agent_runtime.sessions.schemas.common import RuntimePolicy
from tests.helpers.clock import FakeClock
from tests.helpers.signing import sign_request, sign_service_request

NOW = datetime(2026, 10, 28, tzinfo=UTC)
STUDENT_KEY = b"student-test-key-at-least-32-bytes!!"
STUDIO_KEY = b"studio-test-key-at-least-32-bytes!!"
TARGET = "/api/v1/internal/knowledge/index-runs"


class FakeRunner:
    def __init__(self, answer="started"):
        self.answer, self.requests = answer, 0

    def request(self):
        self.requests += 1
        return self.answer


def runtime_with(runner):
    return RuntimeContainer(policy=RuntimePolicy(environment="demo"),
                            verifier=CallerVerifier({"s": STUDENT_KEY}, FakeClock(NOW)),
                            service_verifier=ServiceVerifier({"studio": STUDIO_KEY}, FakeClock(NOW)),
                            knowledge_indexer=runner)


def call(purpose="knowledge.index", runner=None, body=b"{}", target=TARGET, student=False):
    if student:
        token = sign_request(RawRequestContext("POST", target, body), owner_id="student-1", now=NOW,
                             key=STUDENT_KEY, kid="s")
    else:
        token = sign_service_request(RawRequestContext("POST", target, body), now=NOW, key=STUDIO_KEY,
                                     kid="studio", purpose=purpose)
    with TestClient(create_app(runtime_with(runner))) as client:
        if runner is not None:
            runner.requests = 0  # the startup run is covered by its own test
        return client.post(target, content=body, headers={
            "X-Internal-Caller": "sda-product-bff" if student else "sda-studio-api", "X-Caller-Context": token,
            "Content-Type": "application/json"})


def test_startup_requests_one_run_so_a_wake_up_drains_the_queue():
    runner = FakeRunner()
    with TestClient(create_app(runtime_with(runner))):
        assert runner.requests == 1
    assert runner.requests == 1


def test_a_failing_startup_request_does_not_stop_the_app(caplog):
    class Broken:
        def request(self):
            raise RuntimeError("secret postgresql://u:p@h/db")

    with TestClient(create_app(runtime_with(Broken()))) as client:
        assert client.get("/health").status_code in (200, 503)
    assert "secret" not in caplog.text and "RuntimeError" in caplog.text


def test_index_token_gets_202_started():
    runner = FakeRunner()
    response = call(runner=runner)
    assert response.status_code == 202
    assert response.json()["data"] == {"status": "started"}
    assert runner.requests == 1


def test_already_running_is_reported():
    assert call(runner=FakeRunner("already_running")).json()["data"] == {"status": "already_running"}


def test_other_purposes_are_forbidden():
    for purpose in ("knowledge.retrieval", "agent.validate"):
        runner = FakeRunner()
        assert call(purpose=purpose, runner=runner).status_code == 403
        assert runner.requests == 0


def test_index_token_cannot_retrieve_or_validate():
    for target in ("/api/v1/internal/knowledge/retrieval", "/api/v1/internal/agent-snapshots:validate"):
        assert call(purpose="knowledge.index", runner=FakeRunner(), target=target).status_code == 403


def test_student_callers_are_refused_on_every_service_route():
    for target in (TARGET, "/api/v1/internal/knowledge/retrieval", "/api/v1/internal/agent-snapshots:validate"):
        runner = FakeRunner()
        response = call(runner=runner, target=target, student=True)
        assert response.status_code == 403
        assert runner.requests == 0


def test_not_configured_is_503():
    response = call(runner=None)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SYS_UNAVAILABLE"
    assert response.json()["error"]["details"] == {"kind": "not_configured"}


def test_body_must_be_an_empty_object():
    runner = FakeRunner()
    assert call(runner=runner, body=b'{"x":1}').status_code == 422
    assert runner.requests == 0


KEYRING = json.dumps({"s": base64.b64encode(STUDENT_KEY).decode()})
URL = "postgresql+psycopg://u:p@127.0.0.1:1/none"


def test_runner_is_built_only_when_the_indexer_url_is_set():
    assert build_runtime(Settings(RUNTIME_INTERNAL_KEYRING=None, _env_file=None)) is None  # unchanged behaviour
    no_url = build_runtime(Settings(RUNTIME_INTERNAL_KEYRING=KEYRING, _env_file=None))
    assert no_url.knowledge_indexer is None
    with_url = build_runtime(Settings(RUNTIME_INTERNAL_KEYRING=KEYRING, RUNTIME_KNOWLEDGE_FAKE_EMBEDDING=True,
        RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL=URL, _env_file=None))
    assert with_url.knowledge_indexer is not None
    with_url.knowledge_indexer_engine.dispose()


def test_fake_embedding_is_derived_from_the_configured_models_and_holds_no_idle_connection():
    from sqlalchemy.pool import NullPool
    runtime = build_runtime(Settings(RUNTIME_INTERNAL_KEYRING=KEYRING, KNOWLEDGE_EMBEDDING_MODELS="fake-embedding",
        RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL=URL, GOOGLE_API_KEY="", _env_file=None))
    assert runtime.knowledge_indexer is not None
    assert isinstance(runtime.knowledge_indexer_engine.pool, NullPool)
    runtime.knowledge_indexer_engine.dispose()


def test_one_warning_names_why_the_indexer_is_disabled(caplog):
    caplog.set_level(logging.WARNING, logger="agent_runtime.api.internal.dependencies")
    build_runtime(Settings(RUNTIME_INTERNAL_KEYRING=KEYRING, _env_file=None))
    build_runtime(Settings(RUNTIME_INTERNAL_KEYRING=KEYRING, RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL=URL,
                           KNOWLEDGE_EMBEDDING_MODELS="gemini-embedding-2", GOOGLE_API_KEY="", _env_file=None))
    build_runtime(Settings(RUNTIME_INTERNAL_KEYRING=KEYRING, RUNTIME_KNOWLEDGE_FAKE_EMBEDDING=True,
                           RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL="mysql://u:p@h/db", _env_file=None))
    messages = [record.getMessage() for record in caplog.records if "knowledge indexing disabled" in record.getMessage()]
    assert len(messages) == 3
    assert "RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL" in messages[0]
    assert "embedding" in messages[1]
    assert "engine" in messages[2]
    assert "u:p@" not in caplog.text and "127.0.0.1" not in caplog.text
