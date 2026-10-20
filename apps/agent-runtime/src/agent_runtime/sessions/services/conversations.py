"""Durable conversation creation/replay and read projections from pinned state."""
from datetime import timedelta
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from agent_runtime.infrastructure.auth.caller import VerifiedCaller, require_owner
from agent_runtime.infrastructure.db.tables import operation_outcomes
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.repositories.messages import MessageRepository
from agent_runtime.sessions.repositories.outcomes import OutcomeRepository
from agent_runtime.sessions.repositories.results import ResultRepository
from agent_runtime.sessions.repositories.snapshots import SnapshotRepository
from agent_runtime.sessions.schemas.activity import ActivityView, NewMessage, TextBlock
from agent_runtime.sessions.schemas.common import RuntimePolicy, ServiceResponse
from agent_runtime.sessions.schemas.conversation import (
    ConversationRecord,
    ConversationView,
    CreateConversationInput,
)
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.schemas.result import CurrentResultRef
from agent_runtime.sessions.services.access import AccessPolicy
from agent_runtime.sessions.services.activity import request_fingerprint
from agent_runtime.sessions.services.releases import validate_release
from agent_runtime.sessions.services.results import is_current_result
from agent_runtime.sessions.trace import observed

CREATE_OPERATION = "conversation.create"
CREATE_SCOPE = "create"


class ConversationService:
    def __init__(self, uow, product, validator, *, policy: RuntimePolicy, clock=None, trace_sink=None):
        self.trace_sink = trace_sink
        self.uow = uow
        self.product = product
        self.validator = validator
        self.policy = RuntimePolicy.model_validate(policy.model_dump())
        self.access = AccessPolicy(clock=clock)
        self.conversations = ConversationRepository()
        self.activities = ActivityRepository()
        self.snapshots = SnapshotRepository()
        self.results = ResultRepository()
        self.messages = MessageRepository()
        self.outcomes = OutcomeRepository()

    def _require_caller(self, session, caller):
        now = self.access.clock.now(session)
        if now >= caller.expires_at:
            raise RuntimeSessionError(401, "AUTH_REQUIRED")
        return now

    def _replay(self, session, caller, key, fingerprint):
        # Fetch only the reference first: stored greeting/state cannot be replayed
        # before a fresh owner-scoped lifecycle check under the parent share lock.
        conversation_id = session.scalar(select(operation_outcomes.c.conversation_id).where(
            operation_outcomes.c.owner_id == caller.owner_id,
            operation_outcomes.c.operation == CREATE_OPERATION,
            operation_outcomes.c.resource_scope == CREATE_SCOPE,
            operation_outcomes.c.key == key))
        if conversation_id is None:
            return None
        self.access.require_read(session, caller, conversation_id)
        return self.outcomes.find(session, caller.owner_id, CREATE_OPERATION, CREATE_SCOPE, key,
                                  request_hash=fingerprint)

    @observed("conversation.create")
    def create(self, caller: VerifiedCaller, input: CreateConversationInput) -> ServiceResponse:
        require_owner(caller)
        try:
            normalized = CreateConversationInput.model_validate(input.model_dump(mode="json"))
        except (ValidationError, AttributeError, TypeError, ValueError):
            raise RuntimeSessionError(400, "INVALID_REQUEST") from None
        fingerprint = request_fingerprint(normalized.model_dump(mode="json", exclude={"idempotency_key"}))
        with self.uow.begin() as session:
            replay = self._replay(session, caller, normalized.idempotency_key, fingerprint)
            if replay is not None:
                return replay
            self._require_caller(session, caller)

        try:
            capability = normalized.capability_snapshot()
        except ValidationError:
            raise RuntimeSessionError(422, "INCOMPATIBLE_SCHEMA") from None
        if not any(block.type == "text" and 1 in block.schema_versions for block in capability.supported_blocks):
            raise RuntimeSessionError(422, "INCOMPATIBLE_SCHEMA")
        descriptor = self.product.resolve_active_agent(self.policy.environment)
        release = validate_release(descriptor, environment=self.policy.environment, capabilities=capability,
                                   validator=self.validator)
        if release.kind != "agent":
            raise RuntimeSessionError(422, "INCOMPATIBLE_RELEASE")
        agent = AgentSnapshotV1.model_validate(release.content)
        try:
            with self.uow.begin() as session:
                replay = self._replay(session, caller, normalized.idempotency_key, fingerprint)
                if replay is not None:
                    return replay
                pin = self.snapshots.store(session, release)
                now = self._require_caller(session, caller)
                record = ConversationRecord(id=uuid4().hex, owner_id=caller.owner_id,
                    environment=self.policy.environment, status="active", revision=0,
                    agent_snapshot=pin, capability_snapshot=capability, created_at=now,
                    expires_at=now + timedelta(seconds=self.policy.session_ttl_seconds),
                    content_retention_seconds=self.policy.content_retention_seconds)
                self.conversations.insert(session, record)
                block = TextBlock(block_id=uuid4().hex, type="text", schema_version=1, content=agent.greeting_text)
                greeting = NewMessage(message_id=uuid4().hex, role="assistant", blocks=(block,))
                self.messages.append(session, record.id, 0, (greeting,), now)
                view = self._view(session, record)
                response = ServiceResponse(status=201, data={"conversation": view.model_dump(mode="json"),
                    "message_id": greeting.message_id, "blocks": [block.model_dump(mode="json")]})
                self.outcomes.save(session, owner_id=caller.owner_id, operation=CREATE_OPERATION,
                    resource_scope=CREATE_SCOPE, key=normalized.idempotency_key, request_hash=fingerprint,
                    conversation_id=record.id, response=response)
            return response
        except IntegrityError as error:
            # Only the durable create-key race is recoverable. PK/FK/check errors
            # on any other write retain their original failure semantics.
            original = error.orig
            diagnostic = getattr(original, "diag", None)
            if (getattr(original, "sqlstate", None) != "23505"
                    or getattr(diagnostic, "constraint_name", None) != "operation_outcomes_pkey"
                    or getattr(diagnostic, "table_name", None) != "operation_outcomes"
                    or getattr(diagnostic, "schema_name", None) != "execution"):
                raise
            # The failed UoW has exited and rolled back ALL losing resources.
            # READ COMMITTED in a new transaction can see the committed winner.
            with self.uow.begin() as session:
                replay = self._replay(session, caller, normalized.idempotency_key, fingerprint)
                if replay is None:
                    raise
                return replay

    def _view(self, session, parent):
        self.snapshots.get(session, parent.agent_snapshot)
        child_view = None
        current_result = None
        if parent.active_activity_id is not None:
            child = self.activities.get(session, parent.id, parent.active_activity_id)
            if child is None:
                raise RuntimeSessionError(500, "INTERNAL_ERROR")
            snapshot = self.snapshots.get(session, child.experience_snapshot)
            if child.state.current_result_id is not None:
                result = self.results.get(session, child.id, child.state.current_result_id)
                if not is_current_result(parent, child, result):
                    raise RuntimeSessionError(500, "INTERNAL_ERROR")
                current_result = CurrentResultRef(result_id=result.result_id, result_revision=result.result_revision)
            child_view = TypeAdapter(ActivityView).validate_python({
                **child.state.model_dump(exclude={"state_schema_version", "current_result_id"}),
                "id": child.id, "conversation_id": parent.id, "experience_id": child.experience_id,
                "experience_release_id": snapshot.release_id, "definition_hash": snapshot.content_hash,
                "revision": child.revision, "result": current_result, "is_demo": snapshot.is_demo,
                "created_at": child.created_at, "expires_at": None})
        return ConversationView(id=parent.id, revision=parent.revision,
            agent_release_id=parent.agent_snapshot.release_id, display_name=parent.display_name,
            active_activity=child_view, created_at=parent.created_at, expires_at=parent.expires_at,
            current_result=current_result)

    @observed("conversation.read")
    def read(self, caller: VerifiedCaller, conversation_id: str) -> ServiceResponse:
        with self.uow.begin() as session:
            parent = self.access.require_read(session, caller, conversation_id)
            view = self._view(session, parent)
            response = ServiceResponse(status=200, data=view.model_dump(mode="json"))
        return response
