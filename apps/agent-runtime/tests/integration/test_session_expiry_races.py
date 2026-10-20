"""Real parent-lock waits must recheck context and lifecycle before closure/commit."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from time import monotonic

import pytest
from sqlalchemy import event, select, text

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.db.tables import conversations
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.schemas.activity import CommitPatch
from agent_runtime.sessions.services.activity import ActivityPersistence
from tests.integration.test_conversation_end import (
    NOW,
    lifecycle,
    populate,
    request,
    stored,
)
from tests.integration.test_conversation_end import rig as end_rig
from tests.integration.test_conversation_end import valid_v1_doc as legacy_fixture
from tests.integration.test_conversation_end import validator as end_validator

pytestmark = pytest.mark.integration
rig = end_rig
validator = end_validator
valid_v1_doc = legacy_fixture


def blocked_on_parent(blocker, pid):
    deadline = monotonic() + 5
    while not blocker.scalar(text("SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                                  "WHERE :pid = ANY(pg_blocking_pids(pid)))"), {"pid": pid}):
        assert monotonic() < deadline, "request did not actually block on the PostgreSQL parent lock"


@pytest.mark.parametrize("boundary", ["context", "parent", "both"])
def test_end_waiting_for_parent_lock_rechecks_fresh_clock(rig, valid_v1_doc, boundary):
    service = lifecycle(rig)
    parent, _ = populate(rig, valid_v1_doc)
    caller = (rig[3] if boundary != "parent" else
              VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(hours=2)))
    waiting = Event()
    def observe(conn, cursor, statement, parameters, context, many):
        if "FOR UPDATE" in statement and "conversations" in statement:
            waiting.set()
    def end():
        try:
            return service.end(caller, parent.id, request(parent, revision=0)).data["status"]
        except RuntimeSessionError as error:
            return error.code
    before = stored(rig)
    with ThreadPoolExecutor(1) as pool:
        with rig[1].begin() as blocker:
            blocker.execute(select(conversations).where(conversations.c.id == parent.id).with_for_update())
            pid = blocker.scalar(text("SELECT pg_backend_pid()"))
            event.listen(rig[0], "before_cursor_execute", observe)
            future = pool.submit(end)
            try:
                assert waiting.wait(timeout=5)
                blocked_on_parent(blocker, pid)
                rig[2].set(caller.expires_at if boundary == "context" else parent.expires_at)
            finally:
                event.remove(rig[0], "before_cursor_execute", observe)
        assert future.result(timeout=10) == ("expired" if boundary == "parent" else "AUTH_REQUIRED")
    if boundary != "parent":
        assert stored(rig) == before
    else:
        assert stored(rig)["activities"][0]["closed_at"] == parent.expires_at


@pytest.mark.parametrize("same_key", [False, True])
def test_two_ends_serialize_to_one_closure_and_one_outcome(rig, valid_v1_doc, same_key):
    service = lifecycle(rig)
    parent, child = populate(rig, valid_v1_doc, pending=True)
    owns_lock, waiting, proceed = Event(), Event(), Event()
    first_pid = []
    def observe(conn, cursor, statement, parameters, context, many):
        if "FOR UPDATE" in statement and "conversations" in statement:
            if owns_lock.is_set():
                waiting.set()
    def hold_first(conn, cursor, statement, parameters, context, many):
        if "FOR UPDATE" in statement and "conversations" in statement and not owns_lock.is_set():
            first_pid.append(conn.scalar(text("SELECT pg_backend_pid()")))
            owns_lock.set()
            assert proceed.wait(timeout=10)
    event.listen(rig[0], "before_cursor_execute", observe)
    event.listen(rig[0], "after_cursor_execute", hold_first)
    try:
        with ThreadPoolExecutor(2) as pool:
            first_future = pool.submit(service.end, rig[3], parent.id, request(parent, "one"))
            try:
                assert owns_lock.wait(timeout=5)
                second_future = pool.submit(service.end, rig[3], parent.id,
                                            request(parent, "one" if same_key else "two"))
                assert waiting.wait(timeout=5)
                with rig[1].begin() as observer:
                    blocked_on_parent(observer, first_pid[0])
            finally:
                proceed.set()
            first, second = first_future.result(timeout=10), second_future.result(timeout=10)
    finally:
        event.remove(rig[0], "before_cursor_execute", observe)
        event.remove(rig[0], "after_cursor_execute", hold_first)
    assert first.data == second.data and second.replayed is same_key
    rows = stored(rig)
    assert rows["conversations"][0]["revision"] == parent.revision + 1
    assert rows["activities"][0]["revision"] == child.revision + 1
    assert len(rows["operation_outcomes"]) == 1


@pytest.mark.parametrize("closure", ["end", "cleanup", "natural_expiry"])
def test_candidate_computed_outside_transaction_cannot_commit_after_closure(rig, valid_v1_doc, closure):
    service = lifecycle(rig)
    parent, child = populate(rig, valid_v1_doc, pending=True)
    persistence = ActivityPersistence(rig[1], rig[4], None, clock=rig[2])
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(hours=2))
    ready, proceed = Event(), Event()
    def compute_then_commit():
        candidate = CommitPatch(request_input={"action": "confirm_answer", "proposal_id": "proposal-question-4"},
            activity_id=child.id, expected_activity_revision=child.revision, next_state=child.state,
            append_messages=(), new_result=None, invalidate_result_ids=(), response_data={})
        ready.set()
        assert proceed.wait(timeout=10)
        try:
            persistence.commit(caller, parent.id, parent.revision, "late-confirm", candidate)
            return "committed"
        except RuntimeSessionError as error:
            return error.code
    with ThreadPoolExecutor(1) as pool:
        future = pool.submit(compute_then_commit)
        assert ready.wait(timeout=5)
        if closure == "end":
            service.end(caller, parent.id, request(parent))
        elif closure == "cleanup":
            rig[2].set(parent.expires_at)
            with rig[1].begin() as session:
                locked = ConversationRepository().get(session, parent.id, "owner", lock="write")
                service.materialize_expiry(session, locked, rig[2].now(session))
        else:
            rig[2].set(parent.expires_at)
        before = stored(rig)
        proceed.set()
        assert future.result(timeout=10) == ("CONVERSATION_ENDED" if closure == "end" else "CONVERSATION_EXPIRED")
    assert stored(rig) == before
    assert before["result_snapshots"] == before["messages"] == []


def test_cleanup_lock_serializes_with_waiting_end_without_adding_outcome(rig, valid_v1_doc):
    service = lifecycle(rig)
    parent, child = populate(rig, valid_v1_doc)
    rig[2].set(parent.expires_at)
    caller = VerifiedCaller("owner", "sda-product-bff", NOW + timedelta(hours=2))
    waiting = Event()
    def observe(conn, cursor, statement, parameters, context, many):
        if "FOR UPDATE" in statement and "conversations" in statement:
            waiting.set()
    with ThreadPoolExecutor(1) as pool:
        with rig[1].begin() as session:
            locked = ConversationRepository().get(session, parent.id, "owner", lock="write")
            pid = session.scalar(text("SELECT pg_backend_pid()"))
            event.listen(rig[0], "before_cursor_execute", observe)
            future = pool.submit(service.end, caller, parent.id, request(parent, revision=0))
            try:
                assert waiting.wait(timeout=5)
                blocked_on_parent(session, pid)
                ack = service.materialize_expiry(session, locked, rig[2].now(session))
            finally:
                event.remove(rig[0], "before_cursor_execute", observe)
        assert future.result(timeout=10).data == ack.model_dump(mode="json")
    rows = stored(rig)
    assert rows["operation_outcomes"] == []
    assert rows["activities"][0]["revision"] == child.revision + 1
