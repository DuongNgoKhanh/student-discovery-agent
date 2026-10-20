"""Parent access policy. Read locks must never be upgraded for a mutation."""
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.orm import Session

from agent_runtime.infrastructure.auth.caller import VerifiedCaller, require_owner
from agent_runtime.infrastructure.db.session import DatabaseClock
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.schemas.common import JsonSafeInt
from agent_runtime.sessions.schemas.conversation import ConversationRecord


class AccessPolicy:
    def __init__(self, *, clock=None):
        self.clock = clock if clock is not None else DatabaseClock()
        self.conversations = ConversationRepository()

    def check_open(self, session: Session, caller: VerifiedCaller, record: ConversationRecord):
        now = self.clock.now(session)
        if record.status == "ended":
            raise RuntimeSessionError(410, "CONVERSATION_ENDED")
        if record.status == "expired" or now >= record.expires_at:
            raise RuntimeSessionError(410, "CONVERSATION_EXPIRED")
        if now >= caller.expires_at:
            raise RuntimeSessionError(401, "AUTH_REQUIRED")
        return now

    def lock_open(self, session: Session, caller: VerifiedCaller, conversation_id: str, *, write: bool
                  ) -> ConversationRecord:
        require_owner(caller)
        record = self.conversations.get(session, conversation_id, caller.owner_id, lock="write" if write else "read")
        if record is None:
            raise RuntimeSessionError(404, "RESOURCE_NOT_FOUND")
        self.check_open(session, caller, record)
        return record

    def require_revision(self, record: ConversationRecord, expected_revision: int) -> None:
        try:
            TypeAdapter(JsonSafeInt).validate_python(expected_revision)
        except ValidationError:
            raise RuntimeSessionError(400, "INVALID_REQUEST") from None
        if record.revision != expected_revision:
            raise RuntimeSessionError(409, "REVISION_CONFLICT")

    def require_read(self, session: Session, caller: VerifiedCaller, conversation_id: str) -> ConversationRecord:
        return self.lock_open(session, caller, conversation_id, write=False)

    def require_write(self, session: Session, caller: VerifiedCaller, conversation_id: str,
                      expected_revision: int) -> ConversationRecord:
        record = self.lock_open(session, caller, conversation_id, write=True)
        self.require_revision(record, expected_revision)
        return record
