import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from agent_runtime.agent.model import FakeModel
from agent_runtime.api.internal.dependencies import RuntimeContainer
from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier, ServiceVerifier
from agent_runtime.main import create_app
from agent_runtime.sessions.schemas.common import RuntimePolicy
from agent_runtime.sessions.services.debug_runs import DebugRunService
from tests.helpers.chatflow import FLOW, chatflow_content
from tests.helpers.clock import FakeClock
from tests.helpers.signing import sign_request, sign_service_request

NOW = datetime(2026, 10, 28, tzinfo=UTC)
STUDENT_KEY = b"student-test-key-at-least-32-bytes!!"
STUDIO_KEY = b"studio-test-key-at-least-32-bytes!!"
TARGET = "/api/v1/internal/agent-debug-runs:run"
BODY = {"content": chatflow_content(FLOW), "request": {"message": "học phí", "llm_stubs": {"ask": "hoi_hoc_phi"}}}


def call(payload=BODY, *, purpose="agent.validate", student=False, stream=False, service=True, target=TARGET):
    runtime = RuntimeContainer(policy=RuntimePolicy(environment="demo"),
                               verifier=CallerVerifier({"s": STUDENT_KEY}, FakeClock(NOW)),
                               service_verifier=ServiceVerifier({"studio": STUDIO_KEY}, FakeClock(NOW)),
                               debug_runs=DebugRunService(models=lambda provider: FakeModel()) if service else None,
                               agent_validation=object())
    body = json.dumps(payload).encode()
    context = RawRequestContext("POST", target, body)
    if student:
        token = sign_request(context, owner_id="owner_" + "a" * 24, now=NOW, key=STUDENT_KEY, kid="s")
        caller = "sda-product-bff"
    else:
        token = sign_service_request(context, now=NOW, key=STUDIO_KEY, kid="studio", purpose=purpose)
        caller = "sda-studio-api"
    headers = {"X-Internal-Caller": caller, "X-Caller-Context": token, "Content-Type": "application/json"}
    if stream:
        headers["Accept"] = "text/event-stream"
    with TestClient(create_app(runtime)) as client:
        return client.post(target, content=body, headers=headers)


def frames(text):
    out = []
    for chunk in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in chunk.splitlines() if not line.startswith(":"))
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def test_a_debug_run_returns_its_result_as_json():
    response = call()
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["run_id"].startswith("dbg_") and data["path"] == ["start", "begin", "ask", "reply"]
    assert data["status"] == "completed"


def test_a_streamed_debug_run_sends_node_events_then_the_result():
    response = call(stream=True)
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/event-stream")
    events = frames(response.text)
    names = [name for name, _ in events]
    assert names[0] == "workflow.node_started" and names[-2:] == ["delta", "completed"]
    assert names.count("workflow.node_started") == names.count("workflow.node_finished") == 4
    assert all(data["event"] == name for name, data in events)
    assert events[-1][1]["result"]["path"] == ["start", "begin", "ask", "reply"]


def test_a_body_without_request_or_with_a_bad_request_is_a_422():
    assert call({"content": BODY["content"]}).status_code == 422
    assert call({**BODY, "request": {}}).status_code == 422
    assert call({**BODY, "extra": 1}).status_code == 422
    streamed = call({**BODY, "request": {"message": "a", "interaction": {"action": "x"}}}, stream=True)
    assert streamed.status_code == 422 and streamed.headers["content-type"].startswith("application/json")


def test_only_the_studio_validate_token_may_run_a_draft():
    assert call(student=True).status_code == 403
    assert call(purpose="knowledge.retrieval").status_code == 403


@pytest.mark.parametrize("target", ["/api/v1/internal/agent-debug-runs%3Arun", "/api/v1/internal/agent-debug-runs%3arun",
                                    "/api/v1/internal/agent-snapshots%3Avalidate"])
def test_a_percent_encoded_studio_route_is_still_a_studio_route(target):
    assert call(student=True, target=target).status_code == 403
    assert call(purpose="knowledge.retrieval", target=target).status_code == 403
    if "debug" in target:  # the Studio token still reaches it, under either spelling
        assert call(target=target).status_code == 200


def test_the_route_itself_refuses_a_caller_that_is_not_the_studio_validate_service(monkeypatch):
    from agent_runtime.api.internal import dependencies

    monkeypatch.setattr(dependencies, "SERVICE_ROUTES", {})  # the boundary table no longer guards the route
    assert call(student=True).status_code == 403
    assert call(student=True, target="/api/v1/internal/agent-snapshots:validate").status_code == 403
    assert call().status_code == 403  # the service token now fails the boundary: no purpose matches


def test_a_runtime_without_the_service_is_a_503():
    assert call(service=False).status_code == 503


def test_a_run_that_crashes_ends_the_stream_with_an_error_frame():
    import anyio

    from agent_runtime.api.internal.sse import stream_events

    def boom(emit, should_stop):
        emit("workflow.node_started", {"event": "workflow.node_started"})
        raise RuntimeError("x")

    async def read():
        return [chunk async for chunk in stream_events(boom, poll_seconds=0.001)]

    chunks = anyio.run(read)
    assert [name for name, _ in frames("".join(chunks))] == ["workflow.node_started", "error"]
