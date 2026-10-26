"""responses rows: idempotency identity, one in-progress turn per conversation, guarded finish."""
from datetime import timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.responses import ResponseRepository
from agent_runtime.sessions.schemas.responses import TurnResponse
from tests.helpers.turns import NOW

pytestmark = pytest.mark.integration
HASH = "sha256:" + "a" * 64


def pending(rig, response_id="r1"):
    return TurnResponse(id=response_id, conversation_id=rig.conversation_id, status="in_progress", revision=1,
                        input_message_id=f"in-{response_id}", created_at=NOW)


def insert(rig, session, response, key="k1", request_hash=HASH):
    ResponseRepository().insert(session, response=response, owner_id="owner", idempotency_key=key,
                                request_hash=request_hash, base_revision=1)


def test_key_replays_and_hash_mismatch_collides(turn_rig):
    repo = ResponseRepository()
    with turn_rig.uow.begin() as session:
        insert(turn_rig, session, pending(turn_rig))
        assert repo.find_by_key(session, "owner", turn_rig.conversation_id, "k1", request_hash=HASH).id == "r1"
        with pytest.raises(RuntimeSessionError) as error:
            repo.find_by_key(session, "owner", turn_rig.conversation_id, "k1", request_hash="sha256:" + "b" * 64)
        assert (error.value.status, error.value.code) == (409, "IDEMPOTENCY_KEY_COLLISION")


def test_only_one_in_progress_row_per_conversation(turn_rig):
    with pytest.raises(IntegrityError):
        with turn_rig.uow.begin() as session:
            insert(turn_rig, session, pending(turn_rig, "r1"), key="k1")
            insert(turn_rig, session, pending(turn_rig, "r2"), key="k2")


def test_finish_only_moves_an_in_progress_row(turn_rig):
    repo = ResponseRepository()
    with turn_rig.uow.begin() as session:
        insert(turn_rig, session, pending(turn_rig))
        done = pending(turn_rig).model_copy(update={"status": "cancelled", "completed_at": NOW})
        assert repo.finish(session, done) is True
        assert repo.finish(session, done.model_copy(update={"status": "completed"})) is False
        assert repo.get(session, "r1", owner_id="owner").status == "cancelled"
        assert repo.get(session, "r1", owner_id="someone-else") is None
        assert repo.active(session, turn_rig.conversation_id) is None


def test_stale_in_progress_rows_become_abandoned(turn_rig):
    repo = ResponseRepository()
    with turn_rig.uow.begin() as session:
        insert(turn_rig, session, pending(turn_rig))
        repo.expire_stale(session, turn_rig.conversation_id, now=NOW + timedelta(days=365),
                          older_than=timedelta(seconds=60))
        row = repo.get(session, "r1", owner_id="owner")
        assert (row.status, row.error.code) == ("failed", "TURN_ABANDONED")
