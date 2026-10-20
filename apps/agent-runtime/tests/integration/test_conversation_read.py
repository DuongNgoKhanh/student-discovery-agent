"""Stored views survive new Engines without selector/scoring or Product lookup."""
from datetime import timedelta

import pytest
from sqlalchemy import event, select

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.infrastructure.db.tables import activities, conversations, result_snapshots
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import RuntimePolicy
from agent_runtime.sessions.schemas.conversation import CreateConversationInput
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.conversations import ConversationService
from tests.helpers.builders import (
    adaptive_capabilities,
    agent_release,
    experience_release,
    seed_activity,
    seed_conversation,
    seed_result,
)
from tests.integration.test_conversation_create import NOW, counts
from tests.integration.test_conversation_create import rig as create_rig
from tests.integration.test_conversation_create import validator as create_validator
from tests.unit.conftest import valid_v1_doc as legacy_definition_fixture
from tests.unit.conftest import valid_v2_doc as adaptive_definition_fixture

pytestmark = pytest.mark.integration
valid_v1_doc = legacy_definition_fixture
valid_v2_doc = adaptive_definition_fixture
rig = create_rig
validator = create_validator


@pytest.mark.parametrize("adaptive,completed,pending,expected_revision,question_id,answer_count", [
    (False, False, False, 4, "q_demo_04", 3),
    (False, False, True, 5, "q_demo_04", 3),
    (False, True, False, 7, None, 6),
    (True, False, False, 15, "q_a_03", 14),
    (True, True, False, 19, None, 18),
])
def test_restart_restores_pending_and_completed(rig, test_database, validator, valid_v1_doc, valid_v2_doc,
        adaptive, completed, pending, expected_revision, question_id, answer_count):
    with rig[1].begin() as session:
        parent = seed_conversation(session, created_at=NOW,
                                   capabilities=adaptive_capabilities() if adaptive else None)
        activity = seed_activity(session, parent, valid_v2_doc if adaptive else valid_v1_doc,
                                 completed=completed, pending=pending)
        if completed:
            seed_result(session, parent, activity)
    before = rig[5].read(rig[3], parent.id)
    initial_counts = counts(rig)
    rig[0].dispose()
    fresh_engine = build_engine(test_database.url)
    fresh_uow = RuntimeUnitOfWork(fresh_engine)
    rig[4].unavailable = True
    fresh_service = ConversationService(fresh_uow, rig[4], validator,
                                        policy=RuntimePolicy(environment="demo"), clock=rig[2])
    try:
        after = fresh_service.read(rig[3], parent.id)
        assert after == before and after.status == 200
        view = after.data
        child = view["active_activity"]
        assert view["id"] == "conversation-fixed" and child["id"] == "activity-fixed"
        assert child["revision"] == expected_revision and view["revision"] == expected_revision + 1
        assert child["schema_version"] == (2 if adaptive else 1)
        assert child["progress"]["completed"] == answer_count
        assert len(child["answers"]) == answer_count
        assert child["answers"][0]["answer_id"] == "answer-01"
        assert child["answers"][-1]["answer_id"] == f"answer-{answer_count:02}"
        assert child["answers"][-1]["accepted_activity_revision"] == answer_count + 1
        assert (child["current_question"]["question_id"] if child["current_question"] else None) == question_id
        assert child["experience_release_id"] == "experience-x"
        assert child["expires_at"] is None
        if adaptive:
            assert child["algorithm_profile"] == "riasec.mean.bounds.v2"
            assert child["progress"] == {"completed": answer_count, "min_total": 12, "max_total": 30,
                "total": 18 if completed else None, "phase": "completed" if completed else "adaptive"}
        if pending:
            assert child["clarification"]["proposal_id"] == "proposal-question-4"
            assert child["clarification"]["activity_revision"] == 5
            assert child["clarification"]["candidates"][0]["id"] == "candidate-one"
        if completed:
            assert child["result"] == {"result_id": "result-fixed", "result_revision": 2, "validity": "valid"}
            assert view["current_result"] == child["result"]
        else:
            assert child["result"] is None and view["current_result"] is None
        with fresh_uow.begin() as session:
            stored = session.execute(select(conversations)).mappings().one()
            assert stored["capability_snapshot"]["legacy_enabled"] is (not adaptive)
            assert stored["expires_at"] - stored["created_at"] == timedelta(seconds=3600)
        assert counts((fresh_engine, fresh_uow)) == initial_counts
        assert rig[4].resolve_calls == 0
    finally:
        fresh_engine.dispose()


@pytest.mark.parametrize("owner,closed,want", [("stranger", None, (404, "RESOURCE_NOT_FOUND")),
    ("stranger", "ended", (404, "RESOURCE_NOT_FOUND")), ("owner", "ended", (410, "CONVERSATION_ENDED")),
    ("owner", "expired", (410, "CONVERSATION_EXPIRED"))])
def test_read_enforces_owner_and_lifecycle_without_writes(rig, owner, closed, want):
    first = rig[5].create(rig[3], CreateConversationInput(idempotency_key="read"))
    identity = first.data["conversation"]["id"]
    if closed == "ended":
        with rig[1].begin() as session:
            session.execute(conversations.update().values(status="ended", ended_at=NOW + timedelta(seconds=1)))
    elif closed == "expired":
        rig[2].set(NOW + timedelta(seconds=3600))
    caller = VerifiedCaller(owner, "sda-product-bff", rig[2].now() + timedelta(seconds=60))
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].read(caller, identity)
    assert (error.value.status, error.value.code) == want
    assert error.value.details is None
    with rig[1].begin() as session:
        row = session.execute(select(conversations)).mappings().one()
        assert row["status"] == ("ended" if closed == "ended" else "active")
        assert row["revision"] == 0


def test_read_locks_parent_for_share_and_is_read_only(rig):
    first = rig[5].create(rig[3], CreateConversationInput(idempotency_key="read"))
    statements = []

    def capture(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement.upper())

    event.listen(rig[0], "before_cursor_execute", capture)
    try:
        result = rig[5].read(rig[3], first.data["conversation"]["id"])
    finally:
        event.remove(rig[0], "before_cursor_execute", capture)
    assert result.data == first.data["conversation"]
    assert any("FOR SHARE" in statement for statement in statements)
    assert all(not statement.lstrip().startswith(("INSERT", "UPDATE", "DELETE")) for statement in statements)


def test_read_refuses_superseded_current_result(rig, valid_v2_doc):
    with rig[1].begin() as session:
        parent = seed_conversation(session, created_at=NOW, capabilities=adaptive_capabilities())
        activity = seed_activity(session, parent, valid_v2_doc, completed=True)
        seed_result(session, parent, activity)
        session.execute(result_snapshots.update().values(validity="superseded"))
    with pytest.raises(RuntimeSessionError) as error:
        rig[5].read(rig[3], parent.id)
    assert (error.value.status, error.value.code) == (500, "INTERNAL_ERROR")


def test_read_snapshot_is_consistent_while_writer_waits(rig, valid_v2_doc):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    with rig[1].begin() as session:
        parent = seed_conversation(session, created_at=NOW, capabilities=adaptive_capabilities())
        seed_activity(session, parent, valid_v2_doc)
    locked, attempted, finished = Event(), Event(), Event()
    original = rig[5].activities.get

    def get_child(session, conversation_id, activity_id):
        locked.set()
        assert attempted.wait(timeout=5)
        assert not finished.wait(timeout=0.1)
        return original(session, conversation_id, activity_id)

    rig[5].activities.get = get_child

    def writer():
        assert locked.wait(timeout=5)
        with rig[1].begin() as session:
            attempted.set()
            session.execute(conversations.update().where(conversations.c.id == parent.id).values(revision=17))
            session.execute(activities.update().where(activities.c.conversation_id == parent.id).values(revision=16))
        finished.set()

    with ThreadPoolExecutor(2) as pool:
        future = pool.submit(writer)
        view = rig[5].read(rig[3], parent.id).data
        future.result(timeout=10)
    assert (view["revision"], view["active_activity"]["revision"]) == (16, 15)
    assert finished.is_set()


def test_created_adaptive_conversation_reads_started_state(rig, validator, valid_v2_doc):
    manifest = adaptive_capabilities()
    rig[4].agent = agent_release(content={"greeting_text": "Adaptive greeting",
                                        "allowed_activity_profiles": ["riasec.mean.bounds.v2"]})
    rig[4].experiences[("logical-experience", "riasec.mean.bounds.v2")] = experience_release(valid_v2_doc)
    created = rig[5].create(rig[3], CreateConversationInput(idempotency_key="adaptive",
        accepted_activity_profiles=manifest.accepted_activity_profiles, supported_blocks=manifest.supported_blocks))
    parent_id = created.data["conversation"]["id"]
    persistence = ActivityPersistence(rig[1], rig[4], validator, clock=rig[2])
    started = persistence.start(rig[3], parent_id, 0, "logical-experience", "riasec.mean.bounds.v2", "start")
    rig[4].unavailable = True
    view = rig[5].read(rig[3], parent_id).data
    assert view["active_activity"]["id"] == started.data["activity_id"]
    assert view["active_activity"]["schema_version"] == 2
    assert view["active_activity"]["status"] == "collecting_name"
    assert view["active_activity"]["progress"] == {
        "completed": 0, "min_total": 12, "max_total": 30, "total": None, "phase": "baseline"}
    assert rig[4].resolve_calls == 2


def test_restart_replays_same_greeting_ids_without_product(rig, test_database, validator):
    request = CreateConversationInput(idempotency_key="durable-create")
    first = rig[5].create(rig[3], request)
    rig[0].dispose()
    fresh_engine = build_engine(test_database.url)
    fresh_uow = RuntimeUnitOfWork(fresh_engine)
    rig[4].unavailable = True
    service = ConversationService(fresh_uow, rig[4], validator,
                                  policy=RuntimePolicy(environment="demo"), clock=rig[2])
    try:
        replay = service.create(rig[3], request)
        assert replay.status == 201 and replay.replayed is True
        assert replay.data == first.data
        assert replay.data["message_id"] == first.data["message_id"]
        assert replay.data["blocks"][0]["block_id"] == first.data["blocks"][0]["block_id"]
        assert counts((fresh_engine, fresh_uow)) == (1, 1, 1, 1)
        assert rig[4].resolve_calls == 1
    finally:
        fresh_engine.dispose()
