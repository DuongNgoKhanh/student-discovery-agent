"""Create is durable, owner scoped, pinned, and atomic on real PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import IntegrityError

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.infrastructure.db.tables import conversations, messages, operation_outcomes, release_snapshots
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import RuntimePolicy
from agent_runtime.sessions.schemas.conversation import CreateConversationInput
from agent_runtime.sessions.services.conversations import ConversationService
from tests.helpers.builders import adaptive_capabilities, agent_release
from tests.helpers.clock import FakeClock
from tests.helpers.product import FakeProductReleaseSource
from tests.unit.conftest import validator as pilot_validator_fixture

pytestmark = pytest.mark.integration
NOW = datetime(2026, 10, 20, tzinfo=timezone.utc)
validator = pilot_validator_fixture


@pytest.fixture
def rig(test_database, validator):
    upgrade_database(test_database.url)
    engine = build_engine(test_database.url)
    uow = RuntimeUnitOfWork(engine)
    clock = FakeClock(NOW)
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(seconds=60))
    source = FakeProductReleaseSource()
    source.agent = agent_release()
    service = ConversationService(uow, source, validator, policy=RuntimePolicy(environment="demo"), clock=clock)
    try:
        yield engine, uow, clock, caller, source, service
    finally:
        engine.dispose()


def counts(rig):
    with rig[1].begin() as session:
        return tuple(session.scalar(select(func.count()).select_from(table))
                     for table in (conversations, messages, operation_outcomes, release_snapshots))


def test_create_pins_agent_and_commits_greeting_once(rig):
    first = rig[5].create(rig[3], CreateConversationInput(idempotency_key="create"))
    replay = rig[5].create(rig[3], CreateConversationInput(idempotency_key="create"))
    assert first.status == 201
    assert replay.data == first.data and replay.replayed is True
    view = first.data["conversation"]
    assert view["revision"] == 0 and view["agent_release_id"] == "agent-x"
    assert view["active_activity"] is None and view["current_result"] is None
    assert datetime.fromisoformat(view["expires_at"].replace("Z", "+00:00")) - NOW == timedelta(seconds=3600)
    assert counts(rig) == (1, 1, 1, 1)
    with rig[1].begin() as session:
        parent = session.execute(select(conversations)).mappings().one()
        greeting = session.execute(select(messages)).mappings().one()
        assert parent["owner_id"] == "owner"
        assert parent["expires_at"] - parent["created_at"] == timedelta(seconds=3600)
        assert parent["content_retention_seconds"] == 86400
        assert greeting["message_id"] == first.data["message_id"]
        assert greeting["blocks"] == first.data["blocks"]
        assert greeting["blocks"][0]["content"] == "Hello"
        assert greeting["ordinal"] == 1 and greeting["committed_conversation_revision"] == 0
        assert set(first.data) == {"conversation", "message_id", "blocks"}
        assert "owner_id" not in view


def test_concurrent_create_same_key_has_one_conversation(rig):
    original = rig[4].resolve_active_agent
    barrier = Barrier(2)

    def resolve(environment):
        value = original(environment)
        barrier.wait(timeout=10)
        return value

    rig[4].resolve_active_agent = resolve
    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(rig[5].create, rig[3], CreateConversationInput(idempotency_key="same"))
                   for _ in range(2)]
        results = [future.result(timeout=15) for future in futures]
    assert results[0].data == results[1].data
    assert sorted(result.replayed for result in results) == [False, True]
    assert counts(rig) == (1, 1, 1, 1)


def test_retry_after_active_change_keeps_pin(rig):
    request = CreateConversationInput(idempotency_key="same")
    first = rig[5].create(rig[3], request)
    rig[4].agent = agent_release(release_id="agent-y", content={"greeting_text": "Changed",
                                                            "allowed_activity_profiles": []})
    fresh = rig[5].create(rig[3], CreateConversationInput(idempotency_key="new"))
    rig[4].unavailable = True
    replay = rig[5].create(rig[3], request)
    assert replay.data == first.data and replay.replayed
    assert replay.data["blocks"][0]["block_id"] == first.data["blocks"][0]["block_id"]
    assert fresh.data["conversation"]["agent_release_id"] == "agent-y"
    assert rig[4].resolve_calls == 2


@pytest.mark.parametrize("closed", ["ended", "expired"])
def test_closed_create_replay_does_not_leak_greeting(rig, closed):
    request = CreateConversationInput(idempotency_key="same")
    first = rig[5].create(rig[3], request)
    if closed == "ended":
        with rig[1].begin() as session:
            session.execute(conversations.update().values(status="ended", ended_at=NOW + timedelta(seconds=1)))
    else:
        rig[2].set(NOW + timedelta(seconds=3600))
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].create(rig[3], request)
    assert (error.value.status, error.value.code, error.value.details) == (
        410, f"CONVERSATION_{closed.upper()}", None)
    assert first.data["message_id"] and counts(rig) == (1, 1, 1, 1)


def test_same_key_different_normalized_input_collides(rig):
    rig[5].create(rig[3], CreateConversationInput(idempotency_key="same"))
    manifest = adaptive_capabilities()
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].create(rig[3], CreateConversationInput(idempotency_key="same",
            accepted_activity_profiles=manifest.accepted_activity_profiles, supported_blocks=manifest.supported_blocks))
    assert (error.value.status, error.value.code) == (409, "IDEMPOTENCY_KEY_COLLISION")
    assert counts(rig) == (1, 1, 1, 1)


def test_different_owners_with_same_key_get_distinct_conversations(rig):
    request = CreateConversationInput(idempotency_key="same")
    first = rig[5].create(rig[3], request)
    other = VerifiedCaller("other-owner", "sda-product-bff", NOW + timedelta(seconds=60))
    second = rig[5].create(other, request)
    assert first.data["conversation"]["id"] != second.data["conversation"]["id"]
    assert rig[5].create(other, request).data == second.data
    assert counts(rig) == (2, 2, 2, 1)


def test_failure_before_commit_rolls_back_snapshot_conversation_greeting_outcome(rig):
    attempted = []

    def fail_commit(connection):
        pending_counts = tuple(connection.scalar(select(func.count()).select_from(table))
                               for table in (conversations, messages, operation_outcomes, release_snapshots))
        if pending_counts[0]:
            attempted.append(pending_counts)
            raise RuntimeError("injected commit failure")

    event.listen(rig[0], "commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="injected commit failure"):
            rig[5].create(rig[3], CreateConversationInput(idempotency_key="same"))
    finally:
        event.remove(rig[0], "commit", fail_commit)
    assert attempted == [(1, 1, 1, 1)]
    assert counts(rig) == (0, 0, 0, 0)


def test_product_resolution_has_no_open_transaction_and_final_auth_guard(rig):
    original = rig[4].resolve_active_agent

    def resolve(environment):
        assert rig[0].pool.checkedout() == 0
        value = original(environment)
        rig[2].set(NOW + timedelta(seconds=60))
        return value

    rig[4].resolve_active_agent = resolve
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].create(rig[3], CreateConversationInput(idempotency_key="same"))
    assert (error.value.status, error.value.code) == (401, "AUTH_REQUIRED")
    assert counts(rig) == (0, 0, 0, 0)


def test_unrelated_unique_integrity_failure_is_not_replayed(rig):
    rig[5].create(rig[3], CreateConversationInput(idempotency_key="existing"))

    def fail_message(session, conversation_id, revision, items, committed_at):
        session.execute(messages.insert().from_select(list(messages.c.keys()), select(messages)))

    rig[5].messages.append = fail_message
    with pytest.raises(IntegrityError) as error:
        rig[5].create(rig[3], CreateConversationInput(idempotency_key="new"))
    assert error.value.orig.diag.constraint_name == "messages_pkey"
    assert counts(rig) == (1, 1, 1, 1)


@pytest.mark.parametrize("problem", ["outage", "missing", "hash"])
def test_failed_agent_resolution_or_validation_has_no_partial_rows(rig, problem):
    if problem == "outage":
        rig[4].unavailable = True
    elif problem == "missing":
        rig[4].agent = None
    else:
        rig[4].agent = agent_release(content_hash="sha256:" + "0" * 64)
    with pytest.raises(RuntimeSessionError):
        rig[5].create(rig[3], CreateConversationInput(idempotency_key="new"))
    assert counts(rig) == (0, 0, 0, 0)


def test_default_clock_pins_database_time(rig, validator):
    with rig[1].begin() as session:
        before = session.scalar(text("SELECT clock_timestamp()"))
    caller = VerifiedCaller("db-clock", "sda-product-bff", before + timedelta(seconds=60))
    service = ConversationService(rig[1], rig[4], validator, policy=RuntimePolicy(environment="demo"))
    result = service.create(caller, CreateConversationInput(idempotency_key="db-clock"))
    with rig[1].begin() as session:
        after = session.scalar(text("SELECT clock_timestamp()"))
        row = session.execute(select(conversations).where(
            conversations.c.id == result.data["conversation"]["id"])).mappings().one()
    assert before <= row["created_at"] <= after
    assert row["expires_at"] - row["created_at"] == timedelta(seconds=3600)


@pytest.mark.parametrize("after_loss,want", [("ended", (410, "CONVERSATION_ENDED")),
    ("expired", (410, "CONVERSATION_EXPIRED")), ("caller_expired", (401, "AUTH_REQUIRED"))])
def test_create_race_loser_rechecks_lifecycle_and_context_in_new_transaction(rig, after_loss, want):
    original_resolve = rig[4].resolve_active_agent
    barrier = Barrier(2)
    rolled_back = []

    def resolve(environment):
        value = original_resolve(environment)
        barrier.wait(timeout=10)
        return value

    class CloseAfterCollision:
        @contextmanager
        def begin(self):
            try:
                with rig[1].begin() as session:
                    yield session
            except IntegrityError:
                # Inject closure only AFTER the real losing transaction exits.
                # This separate transaction can see the committed winner and
                # verifies loser rollback rather than a savepoint/RAM replay.
                with rig[1].begin() as session:
                    assert session.scalar(select(func.count()).select_from(conversations)) == 1
                    assert session.scalar(select(func.count()).select_from(messages)) == 1
                    if after_loss == "ended":
                        session.execute(conversations.update().values(status="ended",
                                                                      ended_at=NOW + timedelta(seconds=1)))
                rolled_back.append(True)
                if after_loss == "expired":
                    rig[2].set(NOW + timedelta(seconds=3600))
                elif after_loss == "caller_expired":
                    rig[2].set(NOW + timedelta(seconds=60))
                raise

    rig[4].resolve_active_agent = resolve
    service = ConversationService(CloseAfterCollision(), rig[4], rig[5].validator,
                                   policy=RuntimePolicy(environment="demo"), clock=rig[2])

    def create():
        try:
            return service.create(rig[3], CreateConversationInput(idempotency_key="racing"))
        except RuntimeSessionError as error:
            return error.status, error.code

    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(create) for _ in range(2)]
        outcomes = [future.result(timeout=15) for future in futures]
    assert sum(getattr(outcome, "status", None) == 201 for outcome in outcomes) == 1
    assert want in outcomes
    assert rolled_back == [True]
    assert counts(rig) == (1, 1, 1, 1)


@pytest.mark.parametrize("existing,want", [(None, (422, "INCOMPATIBLE_SCHEMA")),
    ("active", (409, "IDEMPOTENCY_KEY_COLLISION")), ("ended", (410, "CONVERSATION_ENDED"))])
def test_explicit_manifest_without_text_v1_is_rejected_after_replay_guards(rig, existing, want):
    default = CreateConversationInput(idempotency_key="manifest")
    if existing:
        rig[5].create(rig[3], default)
        if existing == "ended":
            with rig[1].begin() as session:
                session.execute(conversations.update().values(status="ended", ended_at=NOW + timedelta(seconds=1)))
    request = CreateConversationInput(idempotency_key="manifest",
        supported_blocks=tuple(block for block in default.supported_blocks if block.type != "text"))
    resolved_before = rig[4].resolve_calls
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].create(rig[3], request)
    assert (error.value.status, error.value.code, error.value.details) == (*want, None)
    assert rig[4].resolve_calls == resolved_before
    assert counts(rig) == ((1, 1, 1, 1) if existing else (0, 0, 0, 0))
