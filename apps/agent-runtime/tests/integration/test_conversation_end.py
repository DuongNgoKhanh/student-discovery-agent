"""Atomic end closes every child once and only acknowledges retained resources."""
from datetime import timedelta

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.db.tables import (
    activities,
    conversations,
    messages,
    operation_outcomes,
    result_snapshots,
)
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.schemas.activity import ActivityRecord, CommitPatch
from agent_runtime.sessions.schemas.conversation import CreateConversationInput, EndConversationInput
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.history import HistoryCursorCodec, HistoryService
from agent_runtime.sessions.services.lifecycle import LifecycleService
from agent_runtime.sessions.services.results import ResultReadService
from tests.helpers.builders import adaptive_capabilities, seed_activity, seed_conversation, seed_result
from tests.integration.test_conversation_create import NOW
from tests.integration.test_conversation_create import rig as create_rig
from tests.integration.test_conversation_create import validator as create_validator
from tests.unit.conftest import valid_v1_doc as legacy_fixture
from tests.unit.conftest import valid_v2_doc as adaptive_fixture

pytestmark = pytest.mark.integration
rig = create_rig
validator = create_validator
valid_v1_doc = legacy_fixture
valid_v2_doc = adaptive_fixture


def lifecycle(rig):
    return LifecycleService(rig[1], clock=rig[2])


def populate(rig, definition, *, completed=False, pending=False):
    with rig[1].begin() as session:
        parent = seed_conversation(session, created_at=NOW, capabilities=(
            adaptive_capabilities() if definition["schema_version"] == "2.0" else None))
        child = seed_activity(session, parent, definition, completed=completed, pending=pending)
        if completed:
            seed_result(session, parent, child)
        parent = ConversationRepository().get(session, parent.id, "owner", lock="write")
    return parent, child


def request(parent, key="end", *, revision=None):
    return EndConversationInput(expected_revision=parent.revision if revision is None else revision,
                                idempotency_key=key)


def stored(rig):
    with rig[1].begin() as session:
        return {table.name: [dict(row) for row in session.execute(select(table)).mappings()]
                for table in (conversations, activities, messages, result_snapshots, operation_outcomes)}


def assert_error(action, status, code):
    with pytest.raises(RuntimeSessionError) as caught:
        action()
    assert (caught.value.status, caught.value.code, caught.value.details) == (status, code, None)


def test_end_repeated_and_new_keys_do_not_increment_twice(rig, valid_v1_doc):
    service = lifecycle(rig)
    parent, child = populate(rig, valid_v1_doc, pending=True)
    rig[2].set(NOW + timedelta(seconds=10))
    first = service.end(rig[3], parent.id, request(parent))
    assert first.status == 200 and first.replayed is False
    assert first.data == {"conversation_id": parent.id, "status": "ended", "revision": parent.revision + 1,
        "closed_at": "2026-10-20T00:00:10Z", "expires_at": "2026-10-20T01:00:00Z"}
    after = stored(rig)
    repeat = service.end(rig[3], parent.id, request(parent))
    assert repeat.data == first.data and repeat.replayed is True
    for index in range(3):
        fresh = service.end(rig[3], parent.id, request(parent, f"new-{index}", revision=0))
        assert fresh.data == first.data and fresh.replayed is False
    assert stored(rig) == after
    row = after["activities"][0]
    assert row["revision"] == child.revision + 1
    assert row["state"]["answers"] == child.state.model_dump(mode="json")["answers"]
    assert row["state"]["progress"] == {"completed": 3, "total": 6}
    assert row["state"]["clarification"] is None and row["state"]["current_question"] is None
    assert row["status"] == "ended" and row["closed_at"] == NOW + timedelta(seconds=10)
    assert after["result_snapshots"] == after["messages"] == []
    assert len(after["operation_outcomes"]) == 1
    assert after["operation_outcomes"][0]["response_data"] == first.data


@pytest.mark.parametrize("offset", [3600, 3601])
def test_end_at_deadline_returns_expired_even_with_old_revision(rig, valid_v1_doc, offset):
    service = lifecycle(rig)
    parent, child = populate(rig, valid_v1_doc, pending=True)
    rig[2].set(NOW + timedelta(seconds=offset))
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(hours=2))
    result = service.end(caller, parent.id, request(parent, revision=0))
    assert result.data == {"conversation_id": parent.id, "status": "expired", "revision": parent.revision + 1,
        "closed_at": "2026-10-20T01:00:00Z", "expires_at": "2026-10-20T01:00:00Z"}
    rows = stored(rig)
    assert rows["conversations"][0]["ended_at"] is None
    assert rows["activities"][0]["closed_at"] == parent.expires_at
    assert rows["activities"][0]["revision"] == child.revision + 1
    assert rows["result_snapshots"] == []


def test_end_just_before_deadline_is_ended_and_stays_ended(rig, valid_v1_doc):
    service = lifecycle(rig)
    parent, _ = populate(rig, valid_v1_doc)
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(hours=2))
    closed_at = parent.expires_at - timedelta(microseconds=1)
    rig[2].set(closed_at)
    ack = service.end(caller, parent.id, request(parent))
    assert ack.data["status"] == "ended"
    with rig[1].begin() as session:
        closed = ConversationRepository().get(session, parent.id, "owner")
        assert closed.ended_at == closed_at
        assert service.effective_closed_at(closed, NOW + timedelta(hours=2)) == closed_at
    rig[2].set(parent.expires_at)
    assert service.end(caller, parent.id, request(parent, "late", revision=0)).data == ack.data
    before = stored(rig)
    with rig[1].begin() as session:
        closed = ConversationRepository().get(session, parent.id, "owner", lock="write")
        assert service.materialize_expiry(session, closed, parent.expires_at).model_dump(mode="json") == ack.data
    assert stored(rig) == before


def test_active_revision_conflict_has_no_effect(rig, valid_v1_doc):
    service = lifecycle(rig)
    parent, _ = populate(rig, valid_v1_doc)
    before = stored(rig)
    assert_error(lambda: service.end(rig[3], parent.id, request(parent, revision=0)), 409, "REVISION_CONFLICT")
    assert stored(rig) == before
    assert service.effective_closed_at(parent, NOW) is None
    assert service.effective_closed_at(parent, parent.expires_at) == parent.expires_at


@pytest.mark.parametrize("closed", [False, True])
def test_key_collision_precedes_expiry_materialization_and_closed_ack(rig, valid_v1_doc, closed):
    service = lifecycle(rig)
    parent, _ = populate(rig, valid_v1_doc)
    service.end(rig[3], parent.id, request(parent))
    if not closed:
        # Retained outcome with an active row isolates collision-before-closure ordering.
        with rig[1].begin() as session:
            session.execute(conversations.update().values(status="active", ended_at=None))
    rig[2].set(parent.expires_at)
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(hours=2))
    before = stored(rig)
    assert_error(lambda: service.end(caller, parent.id, request(parent, revision=0)),
                 409, "IDEMPOTENCY_KEY_COLLISION")
    assert stored(rig) == before


@pytest.mark.parametrize("definition_name", ["valid_v1_doc", "valid_v2_doc"])
@pytest.mark.parametrize("closure", ["ended", "expired"])
def test_closure_preserves_completed_generation_progress_and_closes_all_children(rig, request, definition_name, closure):
    service = lifecycle(rig)
    parent, child = populate(rig, request.getfixturevalue(definition_name), completed=True)
    empty = child.state.model_dump(mode="json")
    empty.update(status="collecting_name", display_name=None, current_result_id=None, answers=[],
                 progress=({"completed": 0, "total": 6} if empty["schema_version"] == 1 else
                           {"completed": 0, "min_total": 12, "max_total": 30, "total": None, "phase": "baseline"}))
    with rig[1].begin() as session:
        extra = ActivityRecord.model_validate(child.model_dump() | {"id": "activity-extra", "state": empty, "revision": 0})
        ActivityRepository().insert(session, extra)
        old = ActivityRecord.model_validate(extra.model_dump() | {"id": "activity-old", "revision": 1,
            "closed_at": NOW, "state": empty | {"status": "ended"}})
        ActivityRepository().insert(session, old)
    before = stored(rig)
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(hours=2))
    if closure == "expired":
        rig[2].set(parent.expires_at)
    service.end(caller, parent.id, EndConversationInput(expected_revision=parent.revision, idempotency_key="end"))
    after = stored(rig)
    assert after["result_snapshots"] == before["result_snapshots"]
    assert after["messages"] == []
    previous = {row["id"]: row for row in before["activities"]}
    for row in after["activities"]:
        if row["id"] == "activity-old":
            assert row == previous[row["id"]]
        else:
            assert row["status"] == closure and row["revision"] == previous[row["id"]]["revision"] + 1
            for field in ("answers", "progress", "current_result_id", "display_name"):
                assert row["state"][field] == previous[row["id"]]["state"][field]


def test_guarded_patch_after_end_is_rejected(rig, valid_v1_doc):
    service = lifecycle(rig)
    parent, child = populate(rig, valid_v1_doc, pending=True)
    candidate = CommitPatch(request_input={"action": "confirm_answer", "proposal_id": "proposal-question-4"},
        activity_id=child.id, expected_activity_revision=child.revision, next_state=child.state,
        append_messages=(), new_result=None, invalidate_result_ids=(), response_data={})
    service.end(rig[3], parent.id, request(parent))
    before = stored(rig)
    persistence = ActivityPersistence(rig[1], rig[4], None, clock=rig[2])
    assert_error(lambda: persistence.commit(rig[3], parent.id, parent.revision, "confirm", candidate),
                 410, "CONVERSATION_ENDED")
    assert stored(rig) == before


@pytest.mark.parametrize("failure", ["outcome", "db_outcome", "commit"])
def test_end_failure_rolls_back_children_and_outcome(rig, valid_v1_doc, failure):
    service = lifecycle(rig)
    parent, _ = populate(rig, valid_v1_doc, pending=True)
    before = stored(rig)
    seen = []
    def fail(session):
        row = session.execute(select(conversations)).mappings().one()
        if row["status"] == "ended":
            seen.append((session.scalar(select(activities.c.status)),
                         session.scalar(select(func.count()).select_from(operation_outcomes))))
            raise RuntimeError("injected atomic end failure")
    if failure in {"outcome", "db_outcome"}:
        original = service.outcomes.save
        def fail_save(session, **kwargs):
            original(session, **kwargs)
            if failure == "outcome":
                fail(session)
            else:
                seen.append((session.scalar(select(activities.c.status)),
                             session.scalar(select(func.count()).select_from(operation_outcomes))))
                original(session, **kwargs)  # Real PostgreSQL unique violation after every closure write.
        service.outcomes.save = fail_save
    else:
        event.listen(Session, "before_commit", fail)
    try:
        with pytest.raises(IntegrityError if failure == "db_outcome" else RuntimeError):
            service.end(rig[3], parent.id, request(parent))
    finally:
        if failure == "commit":
            event.remove(Session, "before_commit", fail)
    assert seen == [("ended", 1)]
    assert stored(rig) == before


def test_end_owner_context_and_purged_checks_have_no_effect(rig, valid_v1_doc):
    service = lifecycle(rig)
    parent, _ = populate(rig, valid_v1_doc)
    service.end(rig[3], parent.id, request(parent))
    other = VerifiedCaller("stranger", "sda-product-bff", rig[3].expires_at)
    assert_error(lambda: service.end(other, parent.id, request(parent)), 404, "RESOURCE_NOT_FOUND")
    rig[2].set(rig[3].expires_at)
    assert_error(lambda: service.end(rig[3], parent.id, request(parent)), 401, "AUTH_REQUIRED")
    with rig[1].begin() as session:
        session.execute(conversations.delete().where(conversations.c.id == parent.id))
    rig[2].set(NOW)
    assert_error(lambda: service.end(rig[3], parent.id, request(parent)), 404, "RESOURCE_NOT_FOUND")


def test_content_readers_and_create_replay_remain_blocked_after_end(rig, valid_v1_doc):
    service = lifecycle(rig)
    parent, child = populate(rig, valid_v1_doc, completed=True)
    service.end(rig[3], parent.id, request(parent))
    history = HistoryService(rig[1], HistoryCursorCodec(b"h" * 32), clock=rig[2])
    results = ResultReadService(rig[1], clock=rig[2])
    for action in (lambda: rig[5].read(rig[3], parent.id),
                   lambda: history.read(rig[3], parent.id),
                   lambda: results.read_result(rig[3], child.id, 999),
                   lambda: results.read_share_card(rig[3], "result-fixed", 999)):
        assert_error(action, 410, "CONVERSATION_ENDED")
    create_input = CreateConversationInput(idempotency_key="create")
    created = rig[5].create(rig[3], create_input).data["conversation"]
    service.end(rig[3], created["id"], EndConversationInput(expected_revision=0, idempotency_key="end"))
    assert_error(lambda: rig[5].create(rig[3], create_input), 410, "CONVERSATION_ENDED")


def test_materialize_expiry_uses_owned_transaction_without_student_caller(rig, valid_v2_doc):
    service = lifecycle(rig)
    parent, child = populate(rig, valid_v2_doc, pending=True)
    with rig[1].begin() as session:
        locked = ConversationRepository().get(session, parent.id, "owner", lock="write")
        with pytest.raises(ValueError, match="not expired"):
            service.materialize_expiry(session, locked, parent.expires_at - timedelta(microseconds=1))
        ack = service.materialize_expiry(session, locked, parent.expires_at + timedelta(days=1))
    assert ack.status == "expired" and ack.closed_at == parent.expires_at and ack.revision == parent.revision + 1
    before = stored(rig)
    with rig[1].begin() as session:
        closed = ConversationRepository().get(session, parent.id, "owner", lock="write")
        assert service.materialize_expiry(session, closed, parent.expires_at + timedelta(days=2)) == ack
    assert stored(rig) == before
    assert before["operation_outcomes"] == before["result_snapshots"] == []
    assert before["activities"][0]["revision"] == child.revision + 1
    assert before["activities"][0]["state"]["progress"]["completed"] == 14
    assert before["activities"][0]["state"]["clarification"] is None


@pytest.mark.parametrize("boundary", ["context", "parent"])
def test_end_rechecks_final_clock_after_child_reads(rig, valid_v1_doc, boundary):
    service = lifecycle(rig)
    parent, _ = populate(rig, valid_v1_doc)
    caller = (rig[3] if boundary == "context" else
              VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(hours=2)))
    def advance(conn, cursor, statement, parameters, context, many):
        if statement.lstrip().startswith("SELECT") and "execution.activities" in statement:
            rig[2].set(caller.expires_at if boundary == "context" else parent.expires_at)
    before = stored(rig)
    event.listen(rig[0], "after_cursor_execute", advance)
    try:
        if boundary == "context":
            assert_error(lambda: service.end(caller, parent.id, request(parent)), 401, "AUTH_REQUIRED")
        else:
            assert service.end(caller, parent.id, request(parent)).data["status"] == "expired"
    finally:
        event.remove(rig[0], "after_cursor_execute", advance)
    if boundary == "context":
        assert stored(rig) == before
    else:
        assert stored(rig)["activities"][0]["closed_at"] == parent.expires_at
