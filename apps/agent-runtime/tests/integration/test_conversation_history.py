"""Real PostgreSQL pagination remains pinned and rechecks parent access."""
from datetime import timedelta

import pytest
from sqlalchemy import event

from agent_runtime.infrastructure.auth.caller import RawRequestContext, VerifiedCaller
from agent_runtime.infrastructure.auth.verifier import CallerVerifier
from agent_runtime.infrastructure.db.tables import conversations
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.repositories.messages import MessageRepository
from agent_runtime.sessions.schemas.activity import NewMessage
from agent_runtime.sessions.schemas.history import HistoryCursor
from agent_runtime.sessions.services.history import HistoryCursorCodec, HistoryService
from tests.helpers.builders import seed_conversation
from tests.helpers.signing import sign_request
from tests.integration.test_conversation_create import NOW
from tests.integration.test_conversation_create import rig as create_rig
from tests.integration.test_conversation_create import validator as create_validator
from tests.unit.sessions.test_history_cursor import KEY

pytestmark = pytest.mark.integration
rig = create_rig
validator = create_validator


def readers(rig):
    codec = HistoryCursorCodec(KEY)
    return HistoryService(rig[1], codec, clock=rig[2]), codec


def populate(rig, count=5):
    with rig[1].begin() as session:
        parent = seed_conversation(session, created_at=NOW)
        ConversationRepository().save(session, parent.model_copy(update={"revision": 3}))
        MessageRepository().append(session, parent.id, 3, tuple(
            NewMessage(message_id=f"message-{index}", role="assistant", text=f"Stored {index}", blocks=())
            for index in range(1, count + 1)), NOW)
    return parent


def test_new_turn_does_not_shift_history_watermark(rig):
    service, codec = readers(rig)
    parent = populate(rig)
    first = service.read(rig[3], parent.id, limit=2).data
    assert first["snapshot_revision"] == 3
    assert [item["message_id"] for item in first["items"]] == ["message-1", "message-2"]
    assert codec.decode(first["next_cursor"]).last_ordinal == 2
    with rig[1].begin() as session:
        session.execute(conversations.update().values(revision=4))
        MessageRepository().append(session, parent.id, 4,
            (NewMessage(message_id="message-new", role="assistant", text="New turn", blocks=()),), NOW)
    second = service.read(rig[3], parent.id, first["next_cursor"], 2).data
    third = service.read(rig[3], parent.id, second["next_cursor"], 2).data
    assert [item["message_id"] for item in second["items"] + third["items"]] == [
        "message-3", "message-4", "message-5"]
    assert second["snapshot_revision"] == third["snapshot_revision"] == 3
    assert third["next_cursor"] is None
    fresh = service.read(rig[3], parent.id).data
    assert fresh["snapshot_revision"] == 4 and fresh["items"][-1]["message_id"] == "message-new"
    assert set(first) == {"conversation_id", "items", "next_cursor", "snapshot_revision"}


def test_cursor_cannot_be_substituted_for_another_owned_conversation(rig):
    service, _ = readers(rig)
    parent = populate(rig)
    cursor = service.read(rig[3], parent.id, limit=2).data["next_cursor"]
    with rig[1].begin() as session:
        other = seed_conversation(session, created_at=NOW, conversation_id="other-conversation")
    with pytest.raises(RuntimeSessionError) as error:
        service.read(rig[3], other.id, cursor)
    assert (error.value.status, error.value.code) == (422, "INVALID_INPUT")


@pytest.mark.parametrize("mode,want", [("ended", (410, "CONVERSATION_ENDED")),
    ("expired", (410, "CONVERSATION_EXPIRED")), ("context", (401, "AUTH_REQUIRED")),
    ("owner", (404, "RESOURCE_NOT_FOUND"))])
def test_end_between_pages_blocks_history(rig, mode, want):
    service, _ = readers(rig)
    parent = populate(rig)
    cursor = service.read(rig[3], parent.id, limit=2).data["next_cursor"]
    caller = rig[3]
    if mode == "ended":
        with rig[1].begin() as session:
            session.execute(conversations.update().values(status="ended", ended_at=NOW + timedelta(seconds=1)))
    elif mode == "expired":
        rig[2].set(NOW + timedelta(seconds=3600))
        caller = VerifiedCaller("owner", "sda-product-bff", rig[2].now() + timedelta(seconds=60))
    elif mode == "context":
        rig[2].set(NOW + timedelta(seconds=60))
    else:
        caller = VerifiedCaller("stranger", "sda-product-bff", NOW + timedelta(seconds=60))
    with pytest.raises(RuntimeSessionError) as error:
        service.read(caller, parent.id, cursor)
    assert (error.value.status, error.value.code) == want and error.value.details is None


def test_closed_parent_precedes_malformed_cursor_and_limit(rig):
    service, _ = readers(rig)
    parent = populate(rig)
    with rig[1].begin() as session:
        session.execute(conversations.update().values(status="ended", ended_at=NOW))
    with pytest.raises(RuntimeSessionError) as error:
        service.read(rig[3], parent.id, "tampered", 0)
    assert error.value.status == 410


def test_valid_cursor_does_not_extend_signed_token_lifetime(rig):
    service, codec = readers(rig)
    parent = populate(rig)
    cursor = service.read(rig[3], parent.id, limit=2).data["next_cursor"]
    request = RawRequestContext("GET", f"/api/v1/internal/conversations/{parent.id}/messages?cursor={cursor}", b"")
    jwt_key = b"jwt-fixture-key-distinct-from-cursor"
    token = sign_request(request, owner_id="owner", now=NOW, key=jwt_key, kid="history")
    verifier = CallerVerifier({"history": jwt_key}, rig[2])
    rig[2].set(NOW + timedelta(seconds=59))
    caller = verifier.verify(token, "sda-product-bff", request)
    assert service.read(caller, parent.id, cursor, 2).data["items"][0]["message_id"] == "message-3"
    rig[2].set(NOW + timedelta(seconds=60))
    assert codec.decode(cursor).watermark_revision == 3
    with pytest.raises(RuntimeSessionError) as error:
        service.read(verifier.verify(token, "sda-product-bff", request), parent.id, cursor)
    assert (error.value.status, error.value.code) == (401, "AUTH_REQUIRED")


@pytest.mark.parametrize("limit", [0, 101, True, "2"])
def test_history_limit_is_strictly_bounded(rig, limit):
    service, _ = readers(rig)
    parent = populate(rig)
    with pytest.raises(RuntimeSessionError) as error:
        service.read(rig[3], parent.id, limit=limit)
    assert (error.value.status, error.value.code) == (422, "INVALID_INPUT")


def test_history_default_max_empty_pages_and_future_watermark(rig):
    service, codec = readers(rig)
    parent = populate(rig, 21)
    assert len(service.read(rig[3], parent.id).data["items"]) == 20
    assert len(service.read(rig[3], parent.id, limit=100).data["items"]) == 21
    cursor = codec.encode(HistoryCursor(conversation_id=parent.id, watermark_revision=3, last_ordinal=21))
    assert service.read(rig[3], parent.id, cursor).data["items"] == []
    future = codec.encode(HistoryCursor(conversation_id=parent.id, watermark_revision=4, last_ordinal=0))
    with pytest.raises(RuntimeSessionError) as error:
        service.read(rig[3], parent.id, future)
    assert error.value.status == 422


def test_history_keeps_shared_parent_lock_and_does_not_mutate(rig):
    service, _ = readers(rig)
    parent = populate(rig)
    statements = []
    def capture(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement.upper())
    event.listen(rig[0], "before_cursor_execute", capture)
    try:
        service.read(rig[3], parent.id, limit=2)
    finally:
        event.remove(rig[0], "before_cursor_execute", capture)
    assert any("FOR SHARE" in sql for sql in statements)
    assert any("LIMIT" in sql and "ORDINAL" in sql for sql in statements)
    assert all(not sql.lstrip().startswith(("INSERT", "UPDATE", "DELETE")) for sql in statements)
