import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from agent_runtime.api.internal.dependencies import RuntimeContainer
from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier, ServiceVerifier
from agent_runtime.knowledge.filters import FilterError
from agent_runtime.knowledge.schemas import KnowledgeUnavailable, Record, RetrievalResult
from agent_runtime.main import create_app
from agent_runtime.sessions.schemas.common import RuntimePolicy
from tests.helpers.clock import FakeClock
from tests.helpers.signing import sign_request, sign_service_request

KEY = b"knowledge-test-key-at-least-32-bytes!"
NOW = datetime(2026, 10, 27, tzinfo=UTC)
TARGET = "/api/v1/internal/knowledge/retrieval"


class StubKnowledge:
    def __init__(self, outcome):
        self.outcome = outcome
        self.requests = []

    def retrieve(self, request):
        self.requests.append(request)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def call(knowledge, payload):
    runtime = RuntimeContainer(policy=RuntimePolicy(environment="demo"),
                               verifier=CallerVerifier({"active": KEY}, FakeClock(NOW)), knowledge=knowledge)
    body = json.dumps(payload).encode()
    token = sign_request(RawRequestContext("POST", TARGET, body), owner_id="studio", now=NOW, key=KEY, kid="active")
    with TestClient(create_app(runtime)) as client:
        return client.post(TARGET, content=body, headers={
            "X-Internal-Caller": "sda-product-bff", "X-Caller-Context": token, "Content-Type": "application/json"})


def test_records_are_returned_in_the_runtime_envelope():
    knowledge = StubKnowledge(RetrievalResult(records=(
        Record(content="Học phí", score=0.8, title="Trường A", metadata={"document_id": "d1"}),)))
    response = call(knowledge, {"knowledge_id": "kb1", "query": "học phí",
                                "retrieval_setting": {"top_k": 2, "score_threshold": 0.5}})
    assert response.status_code == 200 and response.json()["success"] is True
    assert response.json()["data"] == {"records": [
        {"content": "Học phí", "score": 0.8, "title": "Trường A", "metadata": {"document_id": "d1"}}],
        "degraded": False}
    assert knowledge.requests[0].retrieval_setting.top_k == 2


@pytest.mark.parametrize("knowledge,payload,status,code", [
    (StubKnowledge(RetrievalResult(records=())), {"knowledge_id": "kb1"}, 422, "VAL_INVALID_INPUT"),
    (StubKnowledge(FilterError("bad")), {"knowledge_id": "kb1", "query": "x"}, 422, "VAL_INVALID_INPUT"),
    (StubKnowledge(KnowledgeUnavailable("not_found")), {"knowledge_id": "kb1", "query": "x"}, 404, "RES_NOT_FOUND"),
    (StubKnowledge(KnowledgeUnavailable("timeout")), {"knowledge_id": "kb1", "query": "x"}, 503, "SYS_UNAVAILABLE"),
    (None, {"knowledge_id": "kb1", "query": "x"}, 503, "SYS_UNAVAILABLE"),
])
def test_errors_map_to_typed_envelopes(knowledge, payload, status, code):
    response = call(knowledge, payload)
    assert response.status_code == status and response.json()["error"]["code"] == code


STUDIO_KEY = b"studio-test-key-at-least-32-bytes!!"


def studio_call(knowledge, payload, *, target=TARGET, key=STUDIO_KEY, issuer="sda-studio-api", service=True):
    runtime = RuntimeContainer(policy=RuntimePolicy(environment="demo"),
                               verifier=CallerVerifier({"active": KEY}, FakeClock(NOW)), knowledge=knowledge,
                               service_verifier=ServiceVerifier({"studio": STUDIO_KEY}, FakeClock(NOW))
                               if service else None)
    body = json.dumps(payload).encode()
    token = sign_service_request(RawRequestContext("POST", target, body), now=NOW, key=key, kid="studio")
    with TestClient(create_app(runtime)) as client:
        return client.post(target, content=body, headers={
            "X-Internal-Caller": issuer, "X-Caller-Context": token, "Content-Type": "application/json"})


def test_studio_service_may_search():
    knowledge = StubKnowledge(RetrievalResult(records=()))
    response = studio_call(knowledge, {"knowledge_id": "kb1", "query": "học phí"})
    assert response.status_code == 200 and response.json()["data"]["records"] == []


def test_studio_service_is_limited_to_retrieval():
    response = studio_call(StubKnowledge(RetrievalResult(records=())), {"x": 1},
                           target="/api/v1/internal/conversations")
    assert response.status_code == 403


@pytest.mark.parametrize("kwargs", [
    {"key": b"wrong-studio-key-at-least-32-bytes!!"},
    {"issuer": "sda-product-bff"},
    {"service": False},
])
def test_studio_tokens_need_the_studio_keyring_and_issuer(kwargs):
    response = studio_call(StubKnowledge(RetrievalResult(records=())), {"knowledge_id": "kb1", "query": "x"},
                           **kwargs)
    assert response.status_code == 401
