"""Input boundary must reject ambiguous JSON and coercible schema versions."""
import asyncio
import base64
import json
import os
import subprocess
import sys

import pytest
from pydantic import SecretStr, ValidationError

from agent_runtime.api.internal.dependencies import build_runtime
from agent_runtime.config.settings import Settings
from agent_runtime.infrastructure.http.strict_json import read_strict_json as strict_json
from agent_runtime.main import create_app
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.conversation import CreateConversationInput, EndConversationInput


@pytest.mark.parametrize("raw", [b'{"a":1,"a":2}', b'{"a":{"x":1,"x":2}}',
    b'{"a":NaN}', b'{"a":Infinity}', b'{"a":-Infinity}', b'{"a":1e400}',
    b'{"a":-1e400}', b'{"a":"\xff"}', b'[]', b'null', b'1', b'{', b''])
def test_duplicate_keys_nan_and_bad_json_are_400(raw):
    with pytest.raises(RuntimeSessionError) as caught:
        strict_json(raw)
    assert (caught.value.status, caught.value.code, caught.value.details) == (400, "INVALID_REQUEST", None)


def test_strict_json_preserves_values():
    assert strict_json(b'{ "name": "Student", "nested": [true, null, 1.25] }') == {
        "name": "Student", "nested": [True, None, 1.25]}


@pytest.mark.parametrize("model,extra", [(CreateConversationInput, {}),
    (EndConversationInput, {"expected_revision": 0})])
@pytest.mark.parametrize("version", [True, 1.0, "1", False, 2])
def test_input_version_requires_integer_one(model, extra, version):
    with pytest.raises(ValidationError):
        model.model_validate({"idempotency_key": "key", "schema_version": version, **extra})


@pytest.mark.parametrize("length", [None, b"1", b"999999"])
def test_oversize_stream_stops_without_trusting_content_length(length):
    app = create_app()
    chunks = iter([b"x" * 32768, b"y" * 32768, b"z", b"must-not-be-read"])
    received = []
    sent = []

    async def receive():
        chunk = next(chunks)
        received.append(len(chunk))
        return {"type": "http.request", "body": chunk, "more_body": True}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "POST", "scheme": "http", "path": "/api/v1/internal/conversations",
        "raw_path": b"/api/v1/internal/conversations", "query_string": b"",
        "headers": [] if length is None else [(b"content-length", length)],
        "client": ("127.0.0.1", 123), "server": ("test", 80)}
    asyncio.run(app(scope, receive, send))
    assert sent[0]["status"] == 413
    assert received == [32768, 32768, 1]


def test_missing_runtime_config_preserves_health_and_requires_caller_context(monkeypatch):
    from fastapi.testclient import TestClient
    for key in ("RUNTIME_DATABASE_URL", "RUNTIME_INTERNAL_KEYRING", "RUNTIME_ENVIRONMENT"):
        monkeypatch.delenv(key, raising=False)
    with TestClient(create_app()) as client:
        assert client.get("/health").json() == {"status": "ok"}
        response = client.get("/api/v1/internal/conversations/missing")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_CALLER_CONTEXT_MISSING"
    assert response.json()["error"]["retryable"] is False


def configured_settings(**changes):
    return Settings(_env_file=None, RUNTIME_ENVIRONMENT="demo",
        RUNTIME_DATABASE_URL="postgresql://user:sentinel-config-password@localhost:1/runtime",
        RUNTIME_INTERNAL_KEYRING=json.dumps({"active": base64.b64encode(b"internal-test-key" * 2).decode()}),
        RUNTIME_CURSOR_SIGNING_KEY=base64.b64encode(b"cursor-test-key" * 3).decode(), **changes)


def test_keyring_configuration_is_explicit_and_secret_safe():
    settings = configured_settings()
    runtime = build_runtime(settings)
    assert runtime is not None and runtime.product_ready is False
    assert runtime.verifier is not None and runtime.history is not None
    assert "sentinel-config-password" not in repr(settings) + repr(runtime)
    runtime.engine.dispose()
    for key, value in (("RUNTIME_INTERNAL_KEYRING", SecretStr('{"active":"not-base64-sentinel"}')),
                       ("RUNTIME_INTERNAL_KEYRING", SecretStr('{}')), ("RUNTIME_INTERNAL_KEYRING", None)):
        changed = settings.model_copy(update={key: value})
        assert build_runtime(changed) is None
    no_cursor = build_runtime(settings.model_copy(update={"RUNTIME_CURSOR_SIGNING_KEY": None}))
    assert no_cursor is not None and no_cursor.history is None and no_cursor.results is not None
    no_cursor.engine.dispose()
    same_key = SecretStr(base64.b64encode(b"internal-test-key" * 2).decode())
    for key, value in (("RUNTIME_DATABASE_URL", None), ("RUNTIME_ENVIRONMENT", None),
                       ("RUNTIME_CURSOR_SIGNING_KEY", same_key)):
        unavailable = build_runtime(settings.model_copy(update={key: value}))
        assert unavailable is not None and unavailable.verifier is not None
        assert unavailable.conversations is None and unavailable.history is None


def test_malformed_runtime_environment_does_not_break_health_import():
    result = subprocess.run([sys.executable, "-c",
        "from agent_runtime.main import create_app; from fastapi.testclient import TestClient; "
        "c=TestClient(create_app()); assert c.get('/health').status_code == 200; "
        "assert c.get('/api/v1/internal/conversations/x').status_code == 401"],
        env={**os.environ, "RUNTIME_SESSION_TTL_SECONDS": "secret-config-sentinel"},
        capture_output=True, text=True)
    assert result.returncode == 0, "health import must survive invalid runtime settings without exposing config"


@pytest.mark.parametrize("raw_path,query", [(b"/api/v1/internal/conversations/%zz", b""),
    (b"/api/v1/internal/conversations/x", b"cursor=\xff"),
    (b"/api/v1/internal/conversations/x", b"cursor=a#b")])
def test_malformed_raw_target_is_safe_400(raw_path, query):
    app = create_app()
    sent = []
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}
    async def send(message):
        sent.append(message)
    asyncio.run(app({"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "GET", "scheme": "http", "path": "/api/v1/internal/conversations/x",
        "raw_path": raw_path, "query_string": query, "headers": [],
        "client": ("127.0.0.1", 1), "server": ("test", 80)}, receive, send))
    assert sent[0]["status"] == 400
    body = json.loads(sent[1]["body"])
    assert body["error"]["code"] == "VAL_INVALID_REQUEST" and body["error"]["details"] is None
