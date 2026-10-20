"""Real signed HTTP requests composed with services and disposable PostgreSQL16."""
import asyncio
import base64
import json
import os
from datetime import timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import create_engine, event, text

from agent_runtime.api.internal.dependencies import RuntimeContainer, build_runtime
from agent_runtime.config.settings import Settings
from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork
from agent_runtime.main import create_app
from agent_runtime.sessions.repositories.messages import MessageRepository
from agent_runtime.sessions.schemas.activity import NewMessage, TextBlock
from agent_runtime.sessions.schemas.common import RuntimePolicy
from agent_runtime.sessions.services.history import HistoryCursorCodec, HistoryService
from agent_runtime.sessions.services.lifecycle import LifecycleService
from agent_runtime.sessions.services.results import ResultReadService
from tests.helpers.signing import sign_request
from tests.integration.test_conversation_create import rig as create_rig
from tests.integration.test_conversation_create import validator as create_validator
from tests.integration.test_conversation_end import populate
from tests.unit.conftest import valid_v1_doc as legacy_fixture

pytestmark = pytest.mark.integration
rig = create_rig
validator = create_validator
valid_v1_doc = legacy_fixture
KEY = b"test-only-http-signing-key-32bytes!"
PREFIX = "/api/v1/internal"


@pytest.fixture
def http(rig):
    runtime = RuntimeContainer(verifier=CallerVerifier({"http": KEY}, rig[2]),
        policy=RuntimePolicy(environment="demo"), conversations=rig[5],
        history=HistoryService(rig[1], HistoryCursorCodec(b"cursor-test-key" * 3), clock=rig[2]),
        lifecycle=LifecycleService(rig[1], clock=rig[2]), results=ResultReadService(rig[1], clock=rig[2]))
    with TestClient(create_app(runtime)) as client:
        yield client, runtime


def headers(rig, method, target, raw=b"", owner="owner"):
    return {"X-Caller-Context": sign_request(RawRequestContext(method, target, raw),
        owner_id=owner, now=rig[2].now(), key=KEY, kid="http"), "X-Internal-Caller": "sda-product-bff"}


def call(http, rig, method, path, data=None, *, owner="owner", raw=None):
    target = PREFIX + path
    raw = raw if raw is not None else (b"" if data is None else json.dumps(data).encode())
    return http[0].request(method, target, content=raw, headers=headers(rig, method, target, raw, owner))


def assert_error(response, status, code):
    assert response.status_code == status
    payload = response.json()
    assert payload["status"] == status and payload["success"] is False
    assert payload["data"] is None and payload["error"]["code"] == code
    assert payload["error"]["details"] is None
    assert response.headers["cache-control"] == "no-store"
    assert payload["meta"]["request_id"] and payload["meta"]["trace_id"]


def test_create_read_replay_and_fresh_metadata(http, rig):
    first = call(http, rig, "POST", "/conversations", {"idempotency_key": "create"})
    assert first.status_code == 201
    view = first.json()["data"]["conversation"]
    assert view["revision"] == 0 and view["agent_release_id"] == "agent-x"
    assert view["active_activity"] is None and view["expires_at"] == "2026-10-20T01:00:00Z"
    replay = call(http, rig, "POST", "/conversations", {"idempotency_key": "create"})
    assert replay.status_code == 201 and replay.json()["data"] == first.json()["data"]
    assert first.json()["meta"]["replayed"] is False and replay.json()["meta"]["replayed"] is True
    for name in ("request_id", "trace_id"):
        assert first.json()["meta"][name] != replay.json()["meta"][name]
    read = call(http, rig, "GET", "/conversations/" + view["id"])
    assert read.status_code == 200 and read.json()["data"] == view
    assert read.headers["cache-control"] == first.headers["cache-control"] == "no-store"


def test_end_replay_and_closed_content_precedence(http, rig, valid_v1_doc):
    parent, child = populate(rig, valid_v1_doc, completed=True)
    end = {"expected_revision": parent.revision, "idempotency_key": "end"}
    first = call(http, rig, "POST", f"/conversations/{parent.id}:end", end)
    assert first.status_code == 200
    assert set(first.json()["data"]) == {"conversation_id", "status", "revision", "closed_at", "expires_at"}
    replay = call(http, rig, "POST", f"/conversations/{parent.id}:end", end)
    assert replay.json()["data"] == first.json()["data"] and replay.json()["meta"]["replayed"]
    for path in (f"/conversations/{parent.id}", f"/conversations/{parent.id}/messages?cursor=bad&limit=bad",
                 f"/activities/{child.id}/result?expected_result_revision=999",
                 "/results/result-fixed/share-card?expected_result_revision=999"):
        assert_error(call(http, rig, "GET", path), 410, "CONVERSATION_ENDED")
        assert_error(call(http, rig, "GET", path, owner="other"), 404, "RESOURCE_NOT_FOUND")


@pytest.mark.parametrize("raw", [b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":1e400}', b'[]', b'{', b'"\xff"'])
def test_bad_json_safe_and_auth_first(http, rig, raw, caplog):
    assert_error(call(http, rig, "POST", "/conversations", raw=raw), 400, "INVALID_REQUEST")
    invalid = http[0].post(PREFIX + "/conversations", content=raw,
        headers={"X-Caller-Context": "not-a-token", "X-Internal-Caller": "sda-product-bff"})
    assert_error(invalid, 401, "AUTH_REQUIRED")
    assert not caplog.records


@pytest.mark.parametrize("version", [True, 1.0])
@pytest.mark.parametrize("path,extra", [("/conversations", {}),
    ("/conversations/missing:end", {"expected_revision": 0})])
def test_http_schema_version_safe_422(http, rig, version, path, extra):
    response = call(http, rig, "POST", path, {"idempotency_key": "key", "schema_version": version, **extra})
    assert_error(response, 422, "INVALID_INPUT")
    assert "input" not in response.json()["error"] and "ctx" not in response.text


def test_internal_raw_path_and_query_binding(http, rig):
    created = call(http, rig, "POST", "/conversations", {"idempotency_key": "key"}).json()["data"]
    cid = created["conversation"]["id"]
    encoded = PREFIX + "/conversations/%" + format(ord(cid[0]), "02X") + cid[1:]
    assert http[0].get(encoded, headers=headers(rig, "GET", encoded)).status_code == 200
    assert_error(http[0].get(encoded, headers=headers(rig, "GET", PREFIX + "/conversations/" + cid)),
                 401, "AUTH_REQUIRED")
    target = PREFIX + f"/conversations/{cid}/messages?limit=1&cursor=bad"
    changed = PREFIX + f"/conversations/{cid}/messages?cursor=bad&limit=1"
    assert_error(http[0].get(changed, headers=headers(rig, "GET", target)), 401, "AUTH_REQUIRED")
    raw = b'{"idempotency_key":"changed"}'
    assert_error(http[0].post(PREFIX + "/conversations", content=raw + b" ",
        headers=headers(rig, "POST", PREFIX + "/conversations", raw)), 401, "AUTH_REQUIRED")


def test_verifier_precedes_db_and_enforces_jwt_cap(http, rig):
    queries = []
    def record(*args):
        queries.append(True)
    event.listen(rig[0], "before_cursor_execute", record)
    try:
        response = http[0].get(PREFIX + "/conversations/missing", headers={
            "X-Internal-Caller": "sda-product-bff", "X-Caller-Context": "x" * 8193})
        assert_error(response, 401, "AUTH_REQUIRED")
        assert queries == []
    finally:
        event.remove(rig[0], "before_cursor_execute", record)


def test_source_outage_keeps_pinned_reads_and_replay(http, rig):
    created = call(http, rig, "POST", "/conversations", {"idempotency_key": "key"}).json()["data"]
    rig[4].unavailable = True
    assert_error(call(http, rig, "POST", "/conversations", {"idempotency_key": "new"}), 503, "SERVICE_UNAVAILABLE")
    assert call(http, rig, "GET", "/conversations/" + created["conversation"]["id"]).status_code == 200
    replay = call(http, rig, "POST", "/conversations", {"idempotency_key": "key"})
    assert replay.status_code == 201 and replay.json()["data"] == created


def test_exact_expiry_with_fresh_token(http, rig):
    created = call(http, rig, "POST", "/conversations", {"idempotency_key": "key"}).json()["data"]
    rig[2].set(rig[2].now() + timedelta(seconds=3600))
    assert_error(call(http, rig, "GET", "/conversations/" + created["conversation"]["id"]),
        410, "CONVERSATION_EXPIRED")
    assert_error(call(http, rig, "POST", "/conversations", {"idempotency_key": "key"}),
        410, "CONVERSATION_EXPIRED")


def test_no_public_product_routes_or_seed_routes(http, rig):
    paths = http[0].app.openapi()["paths"]
    assert set(paths) == {"/health", PREFIX + "/conversations", PREFIX + "/conversations/{conversation_id}",
        PREFIX + "/conversations/{conversation_id}/messages", PREFIX + "/conversations/{conversation_id}/turns",
        PREFIX + "/conversations/{conversation_id}:end",
        PREFIX + "/activities/{activity_id}/result", PREFIX + "/results/{result_id}/share-card"}
    for path in ("/api/v1/conversations", "/auth", "/users", PREFIX + "/seed", PREFIX + "/turns"):
        assert http[0].get(path, headers=headers(rig, "GET", path)).status_code == 404


def test_unknown_internal_operation_has_safe_envelope(http, rig):
    assert_error(call(http, rig, "GET", "/seed"), 404, "RESOURCE_NOT_FOUND")
    assert_error(call(http, rig, "DELETE", "/conversations"), 405, "METHOD_NOT_ALLOWED")


def test_sync_db_never_runs_on_asgi_event_loop(http, rig):
    loops = []
    def before_sql(*args):
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            loops.append(False)
        else:
            loops.append(True)
    event.listen(rig[0], "before_cursor_execute", before_sql)
    try:
        assert call(http, rig, "POST", "/conversations", {"idempotency_key": "key"}).status_code == 201
        assert loops and not any(loops)
    finally:
        event.remove(rig[0], "before_cursor_execute", before_sql)


def test_cursor_and_results_remain_guarded_after_real_http_end(http, rig, valid_v1_doc):
    parent, child = populate(rig, valid_v1_doc, completed=True)
    with rig[1].begin() as session:
        MessageRepository().append(session, parent.id, parent.revision, tuple(
            NewMessage(message_id=f"m-{index}", role="assistant", blocks=(
                TextBlock(block_id=f"b-{index}", type="text", schema_version=1, content="Fixture"),))
            for index in range(3)), rig[2].now())
    first = call(http, rig, "GET", f"/conversations/{parent.id}/messages?limit=1")
    assert first.status_code == 200
    cursor = first.json()["data"]["next_cursor"]
    assert cursor
    result = call(http, rig, "GET", f"/activities/{child.id}/result?expected_result_revision=2")
    share = call(http, rig, "GET", "/results/result-fixed/share-card?expected_result_revision=2")
    assert result.status_code == share.status_code == 200
    assert result.json()["data"]["result_revision"] == share.json()["data"]["result_revision"] == 2
    assert_error(call(http, rig, "GET", f"/activities/{child.id}/result?expected_result_revision=999"),
        409, "STALE_RESULT_REVISION")
    assert call(http, rig, "POST", f"/conversations/{parent.id}:end",
        {"expected_revision": parent.revision, "idempotency_key": "end"}).status_code == 200
    assert_error(call(http, rig, "GET", f"/conversations/{parent.id}/messages?cursor={cursor}&limit=1"),
        410, "CONVERSATION_ENDED")


def test_legacy_manifest_missing_text_preserves_replay_and_collision_order(http, rig):
    first = call(http, rig, "POST", "/conversations", {"idempotency_key": "key"})
    changed = {"idempotency_key": "new", "supported_blocks": [{"type": "personality_card", "schema_versions": [1]}]}
    rig[4].unavailable = True
    assert_error(call(http, rig, "POST", "/conversations", changed), 422, "INCOMPATIBLE_SCHEMA")
    changed["idempotency_key"] = "key"
    assert_error(call(http, rig, "POST", "/conversations", changed), 409, "IDEMPOTENCY_KEY_COLLISION")
    cid = first.json()["data"]["conversation"]["id"]
    call(http, rig, "POST", f"/conversations/{cid}:end", {"expected_revision": 0, "idempotency_key": "end"})
    assert_error(call(http, rig, "POST", "/conversations", changed), 410, "CONVERSATION_ENDED")


def test_production_builder_without_product_keeps_pinned_reads(rig, test_database, valid_v1_doc):
    parent, child = populate(rig, valid_v1_doc, completed=True)
    settings = Settings(_env_file=None, RUNTIME_ENVIRONMENT="demo", RUNTIME_DATABASE_URL=test_database.url,
        RUNTIME_INTERNAL_KEYRING=json.dumps({"http": base64.b64encode(KEY).decode()}),
        RUNTIME_CURSOR_SIGNING_KEY=base64.b64encode(b"separate-cursor-key" * 2).decode())
    runtime = build_runtime(settings)
    assert runtime is not None and runtime.product_ready is False
    # Shared controlled clock replaces wall/DB clock solely in this test fixture.
    runtime.verifier = CallerVerifier({"http": KEY}, rig[2])
    for service in (runtime.conversations, runtime.history, runtime.lifecycle, runtime.results):
        service.access.clock = rig[2]
    try:
        with TestClient(create_app(runtime)) as client:
            h = (client, runtime)
            for path in (f"/conversations/{parent.id}", f"/conversations/{parent.id}/messages",
                         f"/activities/{child.id}/result", "/results/result-fixed/share-card"):
                assert call(h, rig, "GET", path).status_code == 200
            assert_error(call(h, rig, "POST", "/conversations", {"idempotency_key": "key"}),
                503, "SERVICE_UNAVAILABLE")
    finally:
        runtime.engine.dispose()


def test_real_database_disconnect_returns_503_and_health_stays_live(http, rig, test_database):
    created = call(http, rig, "POST", "/conversations", {"idempotency_key": "key"}).json()["data"]
    name = rig[0].url.database
    assert name.startswith("sda_b01_test_")
    with psycopg.connect(os.environ["RUNTIME_TEST_ADMIN_DATABASE_URL"], autocommit=True) as admin:
        admin.execute(sql.SQL("ALTER DATABASE {} ALLOW_CONNECTIONS false").format(sql.Identifier(name)))
        try:
            admin.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s", (name,))
            assert_error(call(http, rig, "GET", "/conversations/" + created["conversation"]["id"]),
                503, "SERVICE_UNAVAILABLE")
            assert http[0].get("/health").json() == {"status": "healthy"}
        finally:
            admin.execute(sql.SQL("ALTER DATABASE {} ALLOW_CONNECTIONS true").format(sql.Identifier(name)))


def test_expired_and_wrong_method_tokens_never_reach_database(http, rig):
    target = PREFIX + "/conversations/missing"
    expired = headers(rig, "GET", target)
    rig[2].set(rig[2].now() + timedelta(seconds=60))
    queries = []
    def record(*args):
        queries.append(True)
    event.listen(rig[0], "before_cursor_execute", record)
    try:
        assert_error(http[0].get(target, headers=expired), 401, "AUTH_REQUIRED")
        assert_error(http[0].get(target, headers=headers(rig, "POST", target)), 401, "AUTH_REQUIRED")
        assert_error(http[0].get(target, headers={"X-Caller-Context": headers(rig, "GET", target)["X-Caller-Context"]}),
            403, "FORBIDDEN")
        assert_error(http[0].get(target, headers={"X-Internal-Caller": "sda-product-bff"}), 401, "AUTH_REQUIRED")
        assert queries == []
    finally:
        event.remove(rig[0], "before_cursor_execute", record)


def test_safe_validation_and_unclassified_failure_do_not_expose_input(http, rig, caplog):
    sentinel = "private-name-and-provider-output-sentinel"
    response = call(http, rig, "POST", "/conversations", {"idempotency_key": "key", "owner_id": sentinel})
    assert_error(response, 422, "INVALID_INPUT")
    assert sentinel not in response.text

    def unavailable(environment):
        raise RuntimeError(sentinel)
    rig[4].resolve_active_agent = unavailable
    response = call(http, rig, "POST", "/conversations", {"idempotency_key": "key"})
    assert_error(response, 500, "INTERNAL_ERROR")
    assert sentinel not in response.text + caplog.text


def test_missing_capabilities_fail_closed_individually(http, rig):
    http[1].history = None
    assert_error(call(http, rig, "GET", "/conversations/missing/messages"), 503, "SERVICE_UNAVAILABLE")
    http[1].verifier = None
    assert_error(call(http, rig, "GET", "/conversations/missing"), 503, "SERVICE_UNAVAILABLE")
    assert http[0].get("/health").status_code == 200


def test_internal_trailing_slash_is_not_redirected_to_a_different_signed_target(http, rig):
    target = PREFIX + "/conversations/"
    response = http[0].get(target, headers=headers(rig, "GET", target), follow_redirects=False)
    assert_error(response, 404, "RESOURCE_NOT_FOUND")


def test_database_pool_exhaustion_is_503(http, rig, test_database):
    engine = create_engine(test_database.url, pool_size=1, max_overflow=0, pool_timeout=0.01,
                           hide_parameters=True)
    original = rig[5].uow
    rig[5].uow = RuntimeUnitOfWork(engine)
    try:
        with engine.connect():
            assert_error(call(http, rig, "GET", "/conversations/missing"), 503, "SERVICE_UNAVAILABLE")
    finally:
        rig[5].uow = original
        engine.dispose()


def test_unclassified_database_error_is_safe_500(http, rig):
    def faulty_query(environment):
        with rig[1].begin() as session:
            session.execute(text("SELECT 1 / 0"))
    rig[4].resolve_active_agent = faulty_query
    assert_error(call(http, rig, "POST", "/conversations", {"idempotency_key": "key"}), 500, "INTERNAL_ERROR")
