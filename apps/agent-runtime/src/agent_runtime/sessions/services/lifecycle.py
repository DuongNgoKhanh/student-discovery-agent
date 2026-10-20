"""Atomic closure under the parent write lock; closed responses contain no content."""
from datetime import datetime

from pydantic import ValidationError
from sqlalchemy.orm import Session

from agent_runtime.infrastructure.auth.caller import VerifiedCaller, require_owner
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.repositories.outcomes import OutcomeRepository
from agent_runtime.sessions.schemas.activity import ActivityRecord
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.schemas.conversation import (
    ClosedConversationAcknowledgement,
    ConversationRecord,
    EndConversationInput,
)
from agent_runtime.sessions.services.access import AccessPolicy
from agent_runtime.sessions.services.activity import request_fingerprint
from agent_runtime.sessions.trace import observed

END_OPERATION = "conversation.end"


class LifecycleService:
    def __init__(self, uow, *, clock=None, trace_sink=None):
        self.trace_sink = trace_sink
        self.uow = uow
        self.access = AccessPolicy(clock=clock)
        self.conversations = ConversationRepository()
        self.activities = ActivityRepository()
        self.outcomes = OutcomeRepository()

    def effective_closed_at(self, conversation: ConversationRecord, now: datetime) -> datetime | None:
        if conversation.status == "ended":
            return conversation.ended_at
        if conversation.status == "expired" or now >= conversation.expires_at:
            return conversation.expires_at
        return None

    def _acknowledgement(self, parent: ConversationRecord) -> ClosedConversationAcknowledgement:
        return ClosedConversationAcknowledgement(conversation_id=parent.id, status=parent.status,
            revision=parent.revision, closed_at=(parent.ended_at if parent.status == "ended" else parent.expires_at),
            expires_at=parent.expires_at)

    def _close(self, session: Session, parent: ConversationRecord, children: tuple[ActivityRecord, ...], *,
               status: str, closed_at: datetime) -> ClosedConversationAcknowledgement:
        for child in children:
            state = child.state.model_dump(mode="json") | {
                "status": status, "current_question": None, "clarification": None}
            closed = ActivityRecord.model_validate(child.model_dump() | {
                "state": state, "revision": child.revision + 1, "closed_at": closed_at})
            self.activities.save(session, closed)
        closed_parent = ConversationRecord.model_validate(parent.model_dump() | {
            "status": status, "revision": parent.revision + 1,
            "ended_at": closed_at if status == "ended" else None})
        self.conversations.save(session, closed_parent)
        return self._acknowledgement(closed_parent)

    def materialize_expiry(self, session: Session, conversation: ConversationRecord,
                           now: datetime) -> ClosedConversationAcknowledgement:
        """Caller owns this transaction's parent FOR UPDATE and supplies fresh DB time.

        Cleanup needs no student caller. Active parents must already be expired;
        persisted closed parents keep their closure and cause no further writes.
        This primitive neither commits nor saves an end request outcome.
        """
        if conversation.status != "active":
            return self._acknowledgement(conversation)
        if now < conversation.expires_at:
            raise ValueError("conversation is not expired")
        children = self.activities.for_closure(session, conversation.id)
        return self._close(session, conversation, children, status="expired", closed_at=conversation.expires_at)

    def _require_caller(self, session: Session, caller: VerifiedCaller) -> datetime:
        now = self.access.clock.now(session)
        if now >= caller.expires_at:
            raise RuntimeSessionError(401, "AUTH_REQUIRED")
        return now

    @observed("conversation.end")
    def end(self, caller: VerifiedCaller, conversation_id: str, input: EndConversationInput) -> ServiceResponse:
        require_owner(caller)
        try:
            normalized = EndConversationInput.model_validate(input.model_dump(mode="json"))
        except (ValidationError, AttributeError, TypeError, ValueError):
            raise RuntimeSessionError(400, "INVALID_REQUEST") from None
        fingerprint = request_fingerprint(normalized.model_dump(mode="json", exclude={"idempotency_key"}))
        with self.uow.begin() as session:
            # End is the only closed-parent exception: normal access guards would reject its acknowledgement.
            parent = self.conversations.get(session, conversation_id, caller.owner_id, lock="write")
            if parent is None:
                raise RuntimeSessionError(404, "RESOURCE_NOT_FOUND")
            self._require_caller(session, caller)
            replay = self.outcomes.find(session, caller.owner_id, END_OPERATION, parent.id,
                normalized.idempotency_key, request_hash=fingerprint)
            if replay is not None:
                ack = ClosedConversationAcknowledgement.model_validate(replay.data)
                return ServiceResponse(status=200, data=ack.model_dump(mode="json"), replayed=True)
            if parent.status != "active":
                return ServiceResponse(status=200, data=self._acknowledgement(parent).model_dump(mode="json"))
            children = self.activities.for_closure(session, parent.id)
            # Recheck context and deadline after every read, immediately before guarded writes.
            now = self._require_caller(session, caller)
            if now >= parent.expires_at:
                status, closed_at = "expired", parent.expires_at
            else:
                self.access.require_revision(parent, normalized.expected_revision)
                status, closed_at = "ended", now
            ack = self._close(session, parent, children, status=status, closed_at=closed_at)
            response = ServiceResponse(status=200, data=ack.model_dump(mode="json"))
            self.outcomes.save(session, owner_id=caller.owner_id, operation=END_OPERATION,
                resource_scope=parent.id, key=normalized.idempotency_key, request_hash=fingerprint,
                conversation_id=parent.id, response=response)
        return response
