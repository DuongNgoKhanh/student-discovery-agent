import hashlib

import httpx
import jwt
import pytest

from agent_runtime.evaluations.services.validator import calculate_content_hash
from agent_runtime.infrastructure.product.delivery import CompositeReleaseSource, HttpProductReleaseSource
from agent_runtime.sessions.errors import RuntimeSessionError

KEY = b"k" * 32
CONTENT = {"greeting_text": "Chào", "allowed_activity_profiles": ["riasec.mean.bounds.v2"]}
TARGET = "/api/v1/internal/releases/active?kind=agent&environment=demo"


def source(handler):
    client = httpx.Client(transport=httpx.MockTransport(handler), base_url="http://studio-api:3001")
    return HttpProductReleaseSource("http://studio-api:3001", KEY, "runtime", client=client, clock=lambda: 1_800_000_000)


def envelope(data, status=200, success=True):
    return httpx.Response(status, json={"status": status, "success": success, "data": data if success else None,
                                        "error": None if success else {"code": data}})


def descriptor(**overrides):
    return {"environment": "demo", "kind": "agent", "release_id": "agr_" + "a" * 24,
            "content_hash": calculate_content_hash(CONTENT), "delivery_schema_version": "agent.snapshot.v1",
            "content": CONTENT, "is_demo": True, **overrides}


def test_signed_request_returns_the_descriptor():
    seen = {}

    def handler(request):
        seen["request"] = request
        return envelope(descriptor())

    result = source(handler).resolve_active_agent("demo")
    assert result.release_id.startswith("agr_") and result.content == CONTENT
    request = seen["request"]
    assert request.headers["x-internal-caller"] == "sda-agent-runtime"
    claims = jwt.decode(request.headers["x-caller-context"], KEY, algorithms=["HS256"], audience="sda-studio-api",
                        issuer="sda-agent-runtime", options={"verify_exp": False, "verify_iat": False})
    assert claims["request_target"] == TARGET and claims["purpose"] == "release.delivery"
    assert claims["body_sha256"] == hashlib.sha256(b"").hexdigest()
    assert jwt.get_unverified_header(request.headers["x-caller-context"])["kid"] == "runtime"


@pytest.mark.parametrize("response,status", [
    (lambda r: envelope(descriptor(content_hash="sha256:" + "0" * 64)), 503),
    (lambda r: envelope(descriptor(kind="experience")), 503),
    (lambda r: envelope("RES_EXPERIENCE_NOT_CONFIGURED", status=422, success=False), 422),
    (lambda r: httpx.Response(500, text="boom"), 503),
])
def test_bad_or_missing_releases_fail_closed(response, status):
    with pytest.raises(RuntimeSessionError) as error:
        source(response).resolve_active_agent("demo")
    assert error.value.status == status


def test_network_errors_fail_closed():
    def handler(request):
        raise httpx.ConnectError("down")
    with pytest.raises(RuntimeSessionError) as error:
        source(handler).resolve_active_agent("demo")
    assert error.value.status == 503


def test_composite_routes_agent_and_experience_to_their_sources():
    class Agent:
        def resolve_active_agent(self, environment):
            return "agent"

    class Experience:
        def resolve_active_experience(self, environment, experience_id, profile):
            return "experience"

    composite = CompositeReleaseSource(agent=Agent(), experience=Experience())
    assert composite.resolve_active_agent("demo") == "agent"
    assert composite.resolve_active_experience("demo", "exp", None) == "experience"
