"""Turn lifecycle rows: replay identity per (owner, conversation, key) and at most one in-progress turn."""
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from agent_runtime.infrastructure.db.tables import responses
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.responses import ResponseError, TurnResponse


def _load(row) -> TurnResponse | None:
    return None if row is None else TurnResponse.model_validate(row["response_data"])


class ResponseRepository:
    def insert(self, session: Session, *, response: TurnResponse, owner_id: str, idempotency_key: str,
               request_hash: str, base_revision: int) -> None:
        session.execute(responses.insert().values(
            id=response.id, conversation_id=response.conversation_id, owner_id=owner_id,
            idempotency_key=idempotency_key, request_hash=request_hash, status=response.status,
            base_revision=base_revision, input_message_id=response.input_message_id,
            response_data=response.model_dump(mode="json"), created_at=response.created_at))

    def find_by_key(self, session: Session, owner_id: str, conversation_id: str, key: str, *,
                    request_hash: str) -> TurnResponse | None:
        row = session.execute(select(responses).where(
            responses.c.owner_id == owner_id, responses.c.conversation_id == conversation_id,
            responses.c.idempotency_key == key)).mappings().one_or_none()
        if row is not None and row["request_hash"] != request_hash:
            raise RuntimeSessionError(409, "IDEMPOTENCY_KEY_COLLISION")
        return _load(row)

    def active(self, session: Session, conversation_id: str) -> TurnResponse | None:
        return _load(session.execute(select(responses).where(
            responses.c.conversation_id == conversation_id, responses.c.status == "in_progress"))
            .mappings().one_or_none())

    def get(self, session: Session, response_id: str, *, owner_id: str, for_update: bool = False) -> TurnResponse | None:
        query = select(responses).where(responses.c.id == response_id, responses.c.owner_id == owner_id)
        return _load(session.execute(query.with_for_update() if for_update else query).mappings().one_or_none())

    def finish(self, session: Session, response: TurnResponse) -> bool:
        """Move an in-progress row to its terminal Response; False if it already left in_progress."""
        result = session.execute(update(responses).where(
            responses.c.id == response.id, responses.c.status == "in_progress").values(
            status=response.status, error_code=response.error.code if response.error else None,
            response_data=response.model_dump(mode="json"), completed_at=response.completed_at))
        return result.rowcount == 1

    def expire_stale(self, session: Session, conversation_id: str, *, now: datetime, older_than: timedelta) -> None:
        stale = self.active(session, conversation_id)
        if stale is None or stale.created_at > now - older_than:
            return
        self.finish(session, stale.model_copy(update={
            "status": "failed", "error": ResponseError(code="TURN_ABANDONED"), "completed_at": now}))
