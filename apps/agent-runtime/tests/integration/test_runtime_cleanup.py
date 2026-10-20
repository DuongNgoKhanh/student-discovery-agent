"""Retention deletes every content copy atomically on disposable PostgreSQL 16."""
import base64
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Event
from time import monotonic
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import event, select, text

from agent_runtime.api.internal.dependencies import build_runtime
from agent_runtime.config.settings import Settings
from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.auth.verifier import CallerVerifier
from agent_runtime.infrastructure.db.grants import grant_execution_roles
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.infrastructure.db.tables import (
    activities,
    conversations,
    messages,
    operation_outcomes,
    release_snapshots,
    result_snapshots,
    runtime_traces,
)
from agent_runtime.infrastructure.db.trace import DatabaseTraceSink
from agent_runtime.main import create_app
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.schemas.activity import CommitPatch
from agent_runtime.sessions.schemas.conversation import CreateConversationInput
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.cleanup import CleanupService
from tests.helpers.builders import seed_activity, seed_conversation, seed_result
from tests.integration.test_conversation_create import NOW
from tests.integration.test_conversation_create import rig as create_rig
from tests.integration.test_conversation_create import validator as create_validator
from tests.integration.test_session_http import KEY, call
from tests.unit.conftest import valid_v1_doc as legacy_fixture

pytestmark = pytest.mark.integration
rig = create_rig
validator = create_validator
valid_v1_doc = legacy_fixture
CONTENT = (conversations, activities, messages, result_snapshots, operation_outcomes)
MARKER = "synthetic-private-marker-Task10"


def cleanup(rig):
    return CleanupService(rig[1], clock=rig[2])


def rows(rig, tables=CONTENT):
    with rig[1].begin() as session:
        return {table.name: [dict(row) for row in session.execute(select(table)).mappings()] for table in tables}


def populate(rig, definition, *, completed=True):
    response = rig[5].create(rig[3], CreateConversationInput(idempotency_key="create"))
    with rig[1].begin() as session:
        parent = ConversationRepository().get(session, response.data["conversation"]["id"], "owner", lock="write")
        child = seed_activity(session, parent, definition, completed=completed, pending=not completed)
        child = child.model_copy(update={"state": child.state.model_copy(update={"display_name": MARKER})})
        original = seed_result(session, parent, child, display_name=MARKER)
        state = child.state.model_dump(mode="json")
        state["answers"][0]["question"]["title"] = MARKER
        if state["clarification"]:
            state["clarification"]["title"] = MARKER
            state["clarification"]["candidates"][0]["label"] = MARKER
            state["current_question"]["title"] = MARKER
        session.execute(activities.update().values(state=state))
        session.execute(conversations.update().values(display_name=MARKER))
        session.execute(messages.update().values(text=MARKER, blocks=[{
            "block_id": "block", "type": "text", "schema_version": 1, "content": MARKER}, {
            "block_id": "card", "type": "personality_card", "schema_version": 1,
            "activity_id": child.id, "result_id": original.result_id,
            "result_revision": 2, "data": original.card_projection.model_dump(mode="json")}],
            interaction={"activity_id": child.id, "action": "submit_answer", "question_id": MARKER, "option_id": None}))
        session.execute(operation_outcomes.update().values(response_data={"stored_create_copy": MARKER}))
    return parent


@pytest.mark.parametrize("offset,purged", [(89999.999999, 0), (90000, 1), (90001, 1)])
@pytest.mark.parametrize("completed", [True, False])
def test_purge_uses_effective_close_not_worker_start(rig, valid_v1_doc, offset, purged, completed):
    service = cleanup(rig)
    parent = populate(rig, valid_v1_doc, completed=completed)
    before = rows(rig)
    assert all(MARKER in json.dumps(value, default=str) for value in before.values())
    rig[2].set(NOW + timedelta(seconds=offset))
    report = service.run_once()
    assert (report.expired, report.purged, report.failed_batches) == (1, purged, 0)
    after = rows(rig)
    if purged:
        assert all(value == [] for value in after.values())
    else:
        assert after["activities"][0]["closed_at"] == parent.expires_at
        assert after["conversations"][0]["status"] == "expired"
        assert all(MARKER in json.dumps(value, default=str) for value in after.values())
    with rig[1].begin() as session:
        assert len(session.execute(select(release_snapshots)).all()) == 2
        assert session.scalar(text("SELECT value FROM product.sentinel")) == "preserve me"


def test_cleanup_drops_outcome_copies_and_keeps_release(rig, valid_v1_doc):
    service = cleanup(rig)
    parent = populate(rig, valid_v1_doc)
    with rig[1].begin() as session:
        session.execute(conversations.update().values(status="ended", ended_at=NOW + timedelta(seconds=5)))
        for key, stamp in (("old", NOW), ("fresh", NOW + timedelta(seconds=86406))):
            session.execute(runtime_traces.insert().values(event_id=key, request_id=key,
                conversation_id=parent.id, action="conversation.end", step="complete", outcome="success", timestamp=stamp))
    rig[2].set(NOW + timedelta(seconds=86404.999999))
    assert service.run_once().purged == 0
    assert rows(rig)["conversations"][0]["status"] == "ended"
    rig[2].set(NOW + timedelta(seconds=86405))
    assert service.run_once().purged == 1
    assert all(value == [] for value in rows(rig).values())
    assert [row["event_id"] for row in rows(rig, (runtime_traces,))["runtime_traces"]] == ["fresh"]
    rig[2].set(NOW + timedelta(seconds=172805.999999))
    assert service.run_once().traces_purged == 0
    rig[2].set(NOW + timedelta(seconds=172806))
    assert service.run_once().traces_purged == 1


def test_cleanup_repeat_concurrent_and_fault_are_safe(rig, valid_v1_doc):
    service = cleanup(rig)
    populate(rig, valid_v1_doc)
    before = rows(rig)
    rig[2].set(NOW + timedelta(seconds=90000))

    def fault(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("DELETE FROM execution.runtime_traces"):
            raise RuntimeError(MARKER)

    event.listen(rig[0], "before_cursor_execute", fault)
    try:
        report = service.run_once()
        assert (report.expired, report.purged, report.failed_batches) == (0, 0, 1)
        assert rows(rig) == before
    finally:
        event.remove(rig[0], "before_cursor_execute", fault)
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: service.run_once(), range(2)))
    assert sum(value.purged for value in results) == 1
    assert sum(value.failed_batches for value in results) == 0
    assert service.run_once().purged == 0
    assert all(value == [] for value in rows(rig).values())


def test_locked_parent_skipped_and_batch_is_bounded(rig):
    service = cleanup(rig)
    with rig[1].begin() as session:
        for index in range(3):
            seed_conversation(session, created_at=NOW, conversation_id=f"parent-{index}")
    rig[2].set(NOW + timedelta(seconds=90000))
    with rig[1].begin() as locked:
        locked.execute(select(conversations).where(conversations.c.id == "parent-0").with_for_update())
        with ThreadPoolExecutor(1) as pool:
            assert pool.submit(service.run_once, 1).result(timeout=5).purged == 1
        assert len(rows(rig)["conversations"]) == 2
    assert service.run_once(1).purged == 1
    assert service.run_once(1).purged == 1
    for invalid in (0, 101, -1, True, 1.5):
        with pytest.raises(ValueError):
            service.run_once(invalid)


def test_trace_sink_failure_does_not_repeat_committed_create(rig, caplog):
    cleanup(rig)
    rig[5].trace_sink = DatabaseTraceSink(rig[1])

    def fault(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO execution.runtime_traces"):
            raise RuntimeError(MARKER)

    event.listen(rig[0], "before_cursor_execute", fault)
    try:
        result = rig[5].create(rig[3], CreateConversationInput(idempotency_key="traced"))
    finally:
        event.remove(rig[0], "before_cursor_execute", fault)
    assert result.status == 201 and not result.replayed
    data = rows(rig)
    assert len(data["conversations"]) == len(data["messages"]) == len(data["operation_outcomes"]) == 1
    assert "TRACE_SINK_FAILURE" in caplog.text and MARKER not in caplog.text
    replay = rig[5].create(rig[3], CreateConversationInput(idempotency_key="traced"))
    assert replay.replayed and replay.data == result.data
    trace = rows(rig, (runtime_traces,))["runtime_traces"]
    assert len(trace) == 1 and trace[0]["outcome"] == "replayed"


def test_cleanup_cli_once_uses_cleanup_role_and_never_logs_dsn(rig, test_database, valid_v1_doc):
    cleanup(rig)
    password = uuid4().hex
    with rig[0].begin() as connection:
        grant_execution_roles(connection, test_database.runtime_role, test_database.cleanup_role)
        connection.connection.driver_connection.execute(sql.SQL("ALTER ROLE {} LOGIN PASSWORD {}").format(
            sql.Identifier(test_database.cleanup_role), sql.Literal(password)))
    # Login as the fixture-owned cleanup role, including the separate CLI process.
    from sqlalchemy.engine import make_url
    parsed = make_url(test_database.url)
    url = parsed.set(username=test_database.cleanup_role, password=password).render_as_string(hide_password=False)
    engine = build_engine(url)
    try:
        with RuntimeUnitOfWork(engine).begin() as session:
            assert session.scalar(text("SELECT current_user")) == test_database.cleanup_role
    finally:
        engine.dispose()
    rig[2].set(NOW - timedelta(days=4))
    populate(rig, valid_v1_doc, completed=False)
    with rig[1].begin() as session:
        seed_conversation(session, created_at=NOW - timedelta(days=3), conversation_id="cli-remaining")
    environment = dict(os.environ, RUNTIME_CLEANUP_DATABASE_URL=url)
    with rig[1].begin() as session:
        before_db_time = session.scalar(text("SELECT clock_timestamp()"))
    result = subprocess.run([sys.executable, "-m", "agent_runtime.cli.cleanup", "--once", "--batch-size", "1"],
                            env=environment, capture_output=True, text=True, timeout=20)
    with rig[1].begin() as session:
        after_db_time = session.scalar(text("SELECT clock_timestamp()"))
    assert result.returncode == 0
    assert len(rows(rig)["conversations"]) == 1
    assert MARKER not in json.dumps(rows(rig), default=str)
    assert "purged=1" in result.stdout
    assert url not in result.stdout + result.stderr and MARKER not in result.stdout + result.stderr
    assert password not in result.stdout + result.stderr
    metadata = [line for line in (result.stdout + result.stderr).splitlines()
                if line.startswith("CLEANUP_BATCH_COMMITTED ")]
    assert len(metadata) == 1
    fields = dict(item.split("=", 1) for item in metadata[0].split()[1:])
    for field in ("candidate_checked_at", "content_checked_from", "content_checked_through", "trace_checked_at"):
        timestamp = datetime.fromisoformat(fields[field])
        assert timestamp.utcoffset() == timedelta(0)
        assert before_db_time <= timestamp <= after_db_time
    assert fields["content_cutoff_policy"] == "effective_closed_at_plus_pinned_retention"
    assert fields["trace_retention_seconds"] == "86400"
    assert datetime.fromisoformat(fields["trace_timestamp_cutoff"]) == (
        datetime.fromisoformat(fields["trace_checked_at"]) - timedelta(seconds=86400))
    with rig[0].begin() as connection:
        quote = connection.dialect.identifier_preparer.quote_identifier
        connection.exec_driver_sql(f"REVOKE DELETE ON execution.runtime_traces FROM {quote(test_database.cleanup_role)}")
    before = rows(rig)
    failed = subprocess.run([sys.executable, "-m", "agent_runtime.cli.cleanup", "--once"],
                           env=environment, capture_output=True, text=True, timeout=20)
    assert failed.returncode == 1 and "failed_batches=1" in failed.stdout
    assert rows(rig) == before
    assert password not in failed.stdout + failed.stderr and url not in failed.stdout + failed.stderr
    assert "Traceback" not in failed.stdout + failed.stderr
    assert "CLEANUP_BATCH_COMMITTED" not in failed.stdout + failed.stderr


def test_cleanup_metadata_uses_clock_values_actually_applied_to_batch(rig, caplog):
    with rig[1].begin() as session:
        seed_conversation(session, created_at=NOW)
        for identity, stamp in (("due", NOW + timedelta(seconds=3601)),
                                ("retained", NOW + timedelta(seconds=3601, microseconds=1))):
            session.execute(runtime_traces.insert().values(event_id=identity, request_id=identity,
                action="conversation.read", step="complete", outcome="success", timestamp=stamp))

    class BatchClock:
        def __init__(self):
            self.values = iter(NOW + timedelta(seconds=offset) for offset in (89999, 90000, 90001))

        def now(self, session):
            return next(self.values)

    with caplog.at_level("INFO", logger="agent_runtime.sessions.services.cleanup"):
        report = CleanupService(rig[1], clock=BatchClock()).run_once()
    assert (report.expired, report.purged, report.traces_purged, report.failed_batches) == (1, 1, 1, 0)
    assert [row["event_id"] for row in rows(rig, (runtime_traces,))["runtime_traces"]] == ["retained"]
    assert "candidate_checked_at=2026-10-21T00:59:59+00:00" in caplog.text
    assert "content_checked_from=2026-10-21T01:00:00+00:00" in caplog.text
    assert "content_checked_through=2026-10-21T01:00:00+00:00" in caplog.text
    assert "content_cutoff_policy=effective_closed_at_plus_pinned_retention" in caplog.text
    assert "trace_checked_at=2026-10-21T01:00:01+00:00" in caplog.text
    assert "trace_timestamp_cutoff=2026-10-20T01:00:01+00:00" in caplog.text
    assert "trace_retention_seconds=86400" in caplog.text


def test_cleanup_rechecks_fresh_clock_after_lock_and_preserves_active(rig):
    service = cleanup(rig)
    with rig[1].begin() as session:
        seed_conversation(session, created_at=NOW)
    rig[2].set(NOW + timedelta(seconds=3600))
    def clock_changed(connection, cursor, statement, parameters, context, many):
        if "SKIP LOCKED" in statement and "execution.conversations" in statement:
            rig[2].set(NOW + timedelta(seconds=3599))
    event.listen(rig[0], "after_cursor_execute", clock_changed)
    try:
        assert service.run_once().expired == 0
    finally:
        event.remove(rig[0], "after_cursor_execute", clock_changed)
    assert rows(rig)["conversations"][0]["status"] == "active"
    rig[2].set(NOW + timedelta(seconds=3600))
    assert service.run_once().expired == 1
    assert service.run_once().expired == 0


def test_cleanup_holds_parent_against_late_patch_and_other_cleanup(rig, valid_v1_doc):
    service = cleanup(rig)
    with rig[1].begin() as session:
        parent = seed_conversation(session, created_at=NOW)
        child = seed_activity(session, parent, valid_v1_doc, pending=True)
        parent = ConversationRepository().get(session, parent.id, "owner", lock="write")
    patch = CommitPatch(request_input={"action": "confirm_answer"}, activity_id=child.id,
        expected_activity_revision=child.revision, next_state=child.state, response_data={},
        append_messages=(), new_result=None, invalidate_result_ids=())
    persistence = ActivityPersistence(rig[1], rig[4], None, clock=rig[2])
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(days=2))
    locked, proceed = Event(), Event()
    pid = []
    def hold_first(connection, cursor, statement, parameters, context, many):
        if "SKIP LOCKED" in statement and "execution.conversations" in statement and not locked.is_set():
            pid.append(connection.scalar(text("SELECT pg_backend_pid()")))
            locked.set()
            assert proceed.wait(timeout=10)
    event.listen(rig[0], "after_cursor_execute", hold_first)
    rig[2].set(NOW + timedelta(seconds=3600))
    try:
        with ThreadPoolExecutor(3) as pool:
            first = pool.submit(service.run_once)
            try:
                assert locked.wait(timeout=5)
                second = pool.submit(service.run_once)
                assert second.result(timeout=5).expired == 0
                late = pool.submit(persistence.commit, caller, parent.id, parent.revision, "late", patch)
                with rig[1].begin() as observer:
                    deadline = monotonic() + 5
                    while not observer.scalar(text("SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                        "WHERE :pid = ANY(pg_blocking_pids(pid)))"), {"pid": pid[0]}):
                        observer.execute(text("SELECT pg_stat_clear_snapshot()"))
                        if late.done():
                            late.result()
                        assert monotonic() < deadline, "late patch did not wait for cleanup parent lock"
            finally:
                proceed.set()
            assert first.result(timeout=10).expired == 1
            with pytest.raises(RuntimeSessionError) as caught:
                late.result(timeout=10)
            assert caught.value.code == "CONVERSATION_EXPIRED"
    finally:
        event.remove(rig[0], "after_cursor_execute", hold_first)
    data = rows(rig)
    assert data["activities"][0]["revision"] == child.revision + 1
    assert data["messages"] == data["operation_outcomes"] == []


def test_business_commit_failure_rolls_back_without_success_trace(rig):
    rig[5].trace_sink = DatabaseTraceSink(rig[1])
    def fault(connection):
        # Fault the real business COMMIT; independent trace transaction remains available.
        if connection.info.pop("fail_business", False):
            raise RuntimeError(MARKER)
    def mark(connection, cursor, statement, parameters, context, many):
        if statement.startswith("INSERT INTO execution.operation_outcomes"):
            connection.info["fail_business"] = True
    event.listen(rig[0], "commit", fault)
    event.listen(rig[0], "before_cursor_execute", mark)
    try:
        with pytest.raises(RuntimeError):
            rig[5].create(rig[3], CreateConversationInput(idempotency_key="commit-fault"))
    finally:
        event.remove(rig[0], "commit", fault)
        event.remove(rig[0], "before_cursor_execute", mark)
    assert all(value == [] for value in rows(rig).values())
    traces = rows(rig, (runtime_traces,))["runtime_traces"]
    assert len(traces) == 1 and traces[0]["outcome"] == "failure"
    assert traces[0]["error_code"] == "SERVICE_FAILURE"
    assert MARKER not in json.dumps(traces, default=str)


def test_runtime_wiring_persists_safe_correlated_events(rig, test_database, valid_v1_doc, caplog):
    parent = populate(rig, valid_v1_doc)
    runtime = build_runtime(Settings(_env_file=None, RUNTIME_ENVIRONMENT="demo", RUNTIME_DATABASE_URL=test_database.url,
        RUNTIME_INTERNAL_KEYRING=json.dumps({"http": base64.b64encode(KEY).decode()}),
        RUNTIME_CURSOR_SIGNING_KEY=base64.b64encode(b"separate-cursor-key" * 2).decode()))
    assert runtime is not None
    runtime.verifier = CallerVerifier({"http": KEY}, rig[2])
    for service in (runtime.conversations, runtime.history, runtime.lifecycle, runtime.results):
        service.access.clock = rig[2]
    try:
        with TestClient(create_app(runtime)) as client:
            response = call((client, runtime), rig, "GET", f"/conversations/{parent.id}")
            assert response.status_code == 200
            missing = call((client, runtime), rig, "GET", f"/conversations/{MARKER}")
            assert missing.status_code == 404
    finally:
        runtime.engine.dispose()
    traces = rows(rig, (runtime_traces,))["runtime_traces"]
    assert len(traces) == 2
    meta = response.json()["meta"]
    found = [entry for entry in traces if entry["request_id"] == meta["request_id"]]
    assert len(found) == 1 and found[0]["trace_id"] == meta["trace_id"]
    assert found[0]["outcome"] == "success"
    assert MARKER not in json.dumps(traces, default=str)
    assert MARKER not in caplog.text
