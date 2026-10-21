from datetime import UTC, datetime
from uuid import UUID

from fastapi.testclient import TestClient

from agent_runtime.api.internal.dependencies import RuntimeContainer
from agent_runtime.main import create_app
from agent_runtime.sessions.schemas.common import RuntimePolicy


def test_liveness_uses_the_shared_ok_vocabulary():
    with TestClient(create_app(RuntimeContainer(policy=RuntimePolicy(environment="demo")))) as client:
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/healthz").json() == {"status": "ok"}


def test_readiness_returns_public_check_summary_and_status_code():
    async def ready(_runtime):
        return {"status": "degraded", "checks": {"db": "down", "product": "degraded", "engine": "ok"}}

    with TestClient(create_app(RuntimeContainer(policy=RuntimePolicy(environment="demo")), readiness_probe=ready)) as client:
        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {
            "status": "degraded", "checks": {"db": "down", "product": "degraded", "engine": "ok"},
        }


def test_runtime_error_envelope_has_uuid_correlation_and_millisecond_timestamp():
    with TestClient(create_app(RuntimeContainer(policy=RuntimePolicy(environment="demo")))) as client:
        response = client.get("/api/v1/internal/conversations/missing")
    body = response.json()
    UUID(body["meta"]["request_id"])
    UUID(body["meta"]["trace_id"])
    assert body["message"] == "Authentication context is required."
    assert body["error"]["message"] == "Authentication context is required."
    parsed = datetime.fromisoformat(body["meta"]["timestamp"].replace("Z", "+00:00"))
    assert parsed.tzinfo == UTC
    assert len(body["meta"]["timestamp"].split(".")[1].rstrip("Z")) == 3
