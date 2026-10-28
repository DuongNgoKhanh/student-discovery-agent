"""Authenticate the real HTTP boundary before exposing dependency readiness, without DB I/O."""
import base64
import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from agent_runtime.api.internal.dependencies import RuntimeContainer, build_runtime
from agent_runtime.config.settings import Settings
from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier
from agent_runtime.infrastructure.product.releases import ProductUnavailable
from agent_runtime.main import create_app
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import RuntimePolicy, ServiceResponse
from tests.helpers.clock import FakeClock
from tests.helpers.signing import sign_request

KEY = b"boundary-test-key-at-least-32-bytes"
TARGET = "/api/v1/internal/conversations/missing"
NOW = datetime(2026, 10, 21, tzinfo=UTC)


def headers(*, key=KEY, target=TARGET, body=b"", method="GET"):
    return {"X-Internal-Caller": "sda-product-bff", "X-Caller-Context": sign_request(
        RawRequestContext(method, target, body), owner_id="owner", now=NOW, key=key, kid="active")}


def settings(**changes):
    values = {"RUNTIME_ENVIRONMENT": "demo", "RUNTIME_DATABASE_URL": None,
        "RUNTIME_INTERNAL_KEYRING": json.dumps({"active": base64.b64encode(KEY).decode()})}
    return Settings(_env_file=None, **(values | changes))


def assert_auth(response, code):
    assert response.status_code == 401
    message = {
        "AUTH_CALLER_CONTEXT_MISSING": "Authentication context is required.",
        "AUTH_CALLER_CONTEXT_INVALID": "Authentication context is invalid.",
    }[code]
    assert response.json()["message"] == message
    assert response.json()["error"] == {
        "code": code, "message": message, "retryable": False, "details": None}
    assert "retry-after" not in response.headers
    assert response.headers["cache-control"] == "no-store"


def assert_unavailable(response, kind):
    assert response.status_code == 503
    assert response.json()["error"]["retryable"] is True
    assert response.json()["error"]["details"] == {"kind": kind}
    assert int(response.headers["retry-after"]) > 0
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("provided,code", [
    ({}, "AUTH_CALLER_CONTEXT_MISSING"),
    ({"X-Internal-Caller": "sda-product-bff"}, "AUTH_CALLER_CONTEXT_MISSING"),
    ({"X-Caller-Context": "broken"}, "AUTH_CALLER_CONTEXT_MISSING"),
    ({"X-Internal-Caller": "wrong", "X-Caller-Context": "broken"}, "AUTH_CALLER_CONTEXT_INVALID"),
    ({"X-Internal-Caller": "sda-product-bff", "X-Caller-Context": "broken"}, "AUTH_CALLER_CONTEXT_INVALID"),
    ({"X-Internal-Caller": "sda-product-bff", "X-Caller-Context": ""}, "AUTH_CALLER_CONTEXT_INVALID"),
])
def test_unconfigured_runtime_authenticates_before_revealing_readiness(provided, code):
    runtime = RuntimeContainer(policy=RuntimePolicy(environment="demo"))
    with TestClient(create_app(runtime)) as client:
        assert_auth(client.get(TARGET, headers=provided), code)
        assert client.get("/health").json() == {"status": "ok"}


def test_unconfigured_verifier_never_exposes_runtime_readiness():
    with TestClient(create_app(RuntimeContainer(policy=RuntimePolicy(environment="demo")))) as client:
        assert_auth(client.get(TARGET, headers=headers()), "AUTH_CALLER_CONTEXT_INVALID")


@pytest.mark.parametrize("missing_config", ["RUNTIME_DATABASE_URL", "RUNTIME_ENVIRONMENT"])
def test_verifier_survives_missing_service_config(missing_config):
    configured = settings().model_copy(update={missing_config: None})
    if missing_config == "RUNTIME_ENVIRONMENT":
        configured = settings(RUNTIME_ENVIRONMENT=None, RUNTIME_DATABASE_URL="postgresql://unused@localhost:1/runtime")
    runtime = build_runtime(configured)
    assert runtime is not None and runtime.verifier is not None
    runtime.verifier = CallerVerifier({"active": KEY}, FakeClock(NOW))
    with TestClient(create_app(runtime)) as client:
        assert_auth(client.get(TARGET, headers=headers(key=b"wrong-signature-test-key" * 2)),
                    "AUTH_CALLER_CONTEXT_INVALID")
        assert_unavailable(client.get(TARGET, headers=headers()), "not_configured")


def test_verifier_survives_engine_configuration_failure(monkeypatch):
    def invalid_engine(url):
        raise ValueError("private-config-sentinel")
    monkeypatch.setattr("agent_runtime.api.internal.dependencies.build_engine", invalid_engine)
    runtime = build_runtime(settings(RUNTIME_DATABASE_URL="bad-engine-url"))
    assert runtime is not None and runtime.verifier is not None
    runtime.verifier = CallerVerifier({"active": KEY}, FakeClock(NOW))
    with TestClient(create_app(runtime)) as client:
        response = client.get(TARGET, headers=headers())
        assert_unavailable(response, "not_configured")
        assert "private-config-sentinel" not in response.text


def test_signed_missing_capability_is_not_configured():
    runtime = RuntimeContainer(policy=RuntimePolicy(environment="demo"),
        verifier=CallerVerifier({"active": KEY}, FakeClock(NOW)))
    with TestClient(create_app(runtime)) as client:
        assert_unavailable(client.get(TARGET, headers=headers()), "not_configured")


def test_database_failure_is_dependency_down_and_next_request_can_recover():
    class Conversations:
        down = True

        def read(self, caller, conversation_id):
            if self.down:
                raise OperationalError("SELECT private-sentinel", {}, Exception("db-secret"))
            return ServiceResponse(status=200, data={"id": conversation_id, "owner_id": caller.owner_id})

    service = Conversations()
    runtime = RuntimeContainer(policy=RuntimePolicy(environment="demo"),
        verifier=CallerVerifier({"active": KEY}, FakeClock(NOW)), conversations=service)
    with TestClient(create_app(runtime)) as client:
        assert_auth(client.get(TARGET, headers=headers(key=b"wrong-signature-test-key" * 2)),
                    "AUTH_CALLER_CONTEXT_INVALID")
        response = client.get(TARGET, headers=headers())
        assert_unavailable(response, "dependency_down")
        assert "private-sentinel" not in response.text and "db-secret" not in response.text
        assert client.get("/health").status_code == 200
        service.down = False
        recovered = client.get(TARGET, headers=headers())
        assert recovered.status_code == 200
        assert recovered.json()["data"] == {"id": "missing", "owner_id": "owner"}
        assert "retry-after" not in recovered.headers


@pytest.mark.parametrize("name", ["X-Caller-Context", "X-Internal-Caller"])
def test_duplicate_caller_headers_are_invalid_before_readiness(name):
    supplied = list(headers().items()) + [(name, headers()[name])]
    with TestClient(create_app(RuntimeContainer(policy=RuntimePolicy(environment="demo")))) as client:
        assert_auth(client.get(TARGET, headers=supplied), "AUTH_CALLER_CONTEXT_INVALID")


@pytest.mark.parametrize("operation,args", [
    ("resolve_active_agent", ("demo",)),
    ("resolve_active_experience", ("demo", "experience", None)),
])
def test_unconfigured_product_adapter_reports_not_configured(operation, args):
    with pytest.raises(RuntimeSessionError) as caught:
        getattr(ProductUnavailable(), operation)(*args)
    assert (caught.value.status, caught.value.code) == (503, "SERVICE_UNAVAILABLE")
    assert caught.value.details == {"kind": "not_configured"}


STUDIO_KEY = b"studio-boundary-key-at-least-32-bytes"


def studio_keyring(key=STUDIO_KEY, kid="studio"):
    return json.dumps({kid: base64.b64encode(key).decode()})


def test_valid_studio_keyring_enables_the_service_verifier():
    runtime = build_runtime(settings(RUNTIME_STUDIO_KEYRING=studio_keyring()))
    assert runtime.verifier is not None and runtime.service_verifier is not None


def test_no_studio_keyring_leaves_the_service_verifier_off():
    runtime = build_runtime(settings())
    assert runtime.verifier is not None and runtime.service_verifier is None


@pytest.mark.parametrize("keyring", [
    studio_keyring(KEY, kid="other"),
    "not json",
    studio_keyring(b"short"),
    json.dumps({"studio": base64.b64encode(STUDIO_KEY).decode().rstrip("=") + "=" * 3}),
    json.dumps({"studio": base64.urlsafe_b64encode(b"\xfb" * 40).decode()}),
])
def test_bad_studio_keyring_disables_only_the_studio_path(keyring):
    runtime = build_runtime(settings(RUNTIME_STUDIO_KEYRING=keyring))
    assert runtime is not None and runtime.verifier is not None and runtime.service_verifier is None
