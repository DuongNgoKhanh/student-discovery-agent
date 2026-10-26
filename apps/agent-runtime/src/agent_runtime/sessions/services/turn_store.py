"""Turn preflight and guarded commit. Engine/projector work happens between the two transactions."""
from uuid import uuid4

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.messages import MessageRepository
from agent_runtime.sessions.repositories.outcomes import OutcomeRepository
from agent_runtime.sessions.repositories.results import ResultRepository
from agent_runtime.sessions.repositories.snapshots import SnapshotRepository
from agent_runtime.sessions.schemas.activity import CommitPatch, NewMessage
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.schemas.conversation import ConversationRecord
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.schemas.turn import (
    ConversationTurnInput,
    ConversationTurnResult,
    MessageTurnInput,
    SupportedInteraction,
)
from agent_runtime.sessions.schemas.turn_execution import TurnDraft, TurnSnapshot
from agent_runtime.sessions.services.access import AccessPolicy
from agent_runtime.sessions.services.activity import ActivityPersistence
from agent_runtime.sessions.services.blocks import project_blocks
from agent_runtime.sessions.services.conversations import ConversationService
from agent_runtime.sessions.services.message_turns import MessagePlan, MessageSnapshot
from agent_runtime.sessions.services.results import is_current_result
from agent_runtime.sessions.services.turn_input import is_supported, turn_fingerprint
from agent_runtime.sessions.services.turn_response import finalize_turn

TURN_OPERATION = "conversation.turn"
OPEN_STATES = {"collecting_name", "in_progress"}


class TurnStore:
    def __init__(self, uow, activity_persistence: ActivityPersistence, conversations: ConversationService, *,
                 clock=None):
        self.uow = uow
        self.persistence = activity_persistence
        self.conversations = conversations
        self.access = AccessPolicy(clock=clock)
        self.activities = ActivityRepository()
        self.snapshots = SnapshotRepository()
        self.results = ResultRepository()
        self.outcomes = OutcomeRepository()
        self.messages = MessageRepository()

    def _lock_and_replay(self, session, caller, conversation_id, request, fingerprint):
        # Owner + lifecycle win before any stored content can be replayed.
        parent = self.access.lock_open(session, caller, conversation_id, write=True)
        replay = self.outcomes.find(session, caller.owner_id, TURN_OPERATION, parent.id, request.idempotency_key,
                                    request_hash=fingerprint)
        return parent, replay

    def _conflict(self, session, parent: ConversationRecord, resource_kind: str, expected: int, actual: int):
        """Readable snapshots built under the same parent lock that observed the conflict."""
        view = self.conversations.view_in_session(session, parent)
        return RuntimeSessionError(409, "REVISION_CONFLICT", {
            "kind": "revision_conflict", "resource_kind": resource_kind, "expected_revision": expected,
            "actual_revision": actual, "conversation": view.model_dump(mode="json"),
            "activity": view.active_activity.model_dump(mode="json") if view.active_activity else None})

    def preflight(self, caller: VerifiedCaller, conversation_id: str,
                  request: ConversationTurnInput) -> ServiceResponse | TurnSnapshot | MessageSnapshot:
        fingerprint = turn_fingerprint(request)
        with self.uow.begin() as session:
            parent, replay = self._lock_and_replay(session, caller, conversation_id, request, fingerprint)
            if replay is not None:
                return replay
            if parent.revision != request.expected_revision:
                raise self._conflict(session, parent, "conversation", request.expected_revision, parent.revision)
            if isinstance(request, MessageTurnInput):
                return self._message_snapshot(session, parent)
            activity = self.activities.get(session, parent.id, request.activity_id)
            if activity is None:
                raise RuntimeSessionError(404, "RESOURCE_NOT_FOUND")
            if parent.active_activity_id != activity.id:
                raise RuntimeSessionError(422, "INVALID_ACTIVITY_TRANSITION")
            # Absent optional guard stays absent: the server still captures and rechecks the revision at commit.
            if request.expected_activity_revision is not None and request.expected_activity_revision != activity.revision:
                raise self._conflict(session, parent, "activity", request.expected_activity_revision,
                                     activity.revision)
            if activity.state.status not in OPEN_STATES or not is_supported(request):
                raise RuntimeSessionError(422, "INVALID_ACTIVITY_TRANSITION")
            release = self.snapshots.get(session, activity.experience_snapshot)
            return TurnSnapshot(parent=parent, activity=activity, release=release,
                                next_result_revision=self.results.latest_revision(session, activity.id) + 1)

    def commit(self, caller: VerifiedCaller, conversation_id: str, request: SupportedInteraction,
               snapshot: TurnSnapshot, draft: TurnDraft) -> ServiceResponse:
        fingerprint = turn_fingerprint(request)
        with self.uow.begin() as session:
            parent, replay = self._lock_and_replay(session, caller, conversation_id, request, fingerprint)
            if replay is not None:
                # Another request with this key won while the engine ran; never re-run or re-validate.
                return replay
            if parent.revision != snapshot.parent.revision:
                raise self._conflict(session, parent, "conversation", snapshot.parent.revision, parent.revision)
            current = self.activities.get(session, parent.id, snapshot.activity.id)
            if current is None or parent.active_activity_id != current.id or current.revision != snapshot.activity.revision:
                raise self._conflict(session, parent, "activity", snapshot.activity.revision,
                                     current.revision if current else snapshot.activity.revision)
            release = self.snapshots.get(session, current.experience_snapshot)
            if (current.experience_snapshot != snapshot.activity.experience_snapshot
                    or release.content_hash != snapshot.release.content_hash
                    or self.results.latest_revision(session, current.id) + 1 != snapshot.next_result_revision):
                raise RuntimeSessionError(500, "INTERNAL_ERROR")
            now = self.access.check_open(session, caller, parent)
            finalized = finalize_turn(snapshot, request, draft, now)
            try:
                self.persistence.apply_patch(session, caller, parent, current, finalized.patch, now=now)
            except RuntimeSessionError as error:
                # Shared validation reports caller-supplied patches as 400; here the patch is server-owned.
                if error.status == 400:
                    raise RuntimeSessionError(500, "INTERNAL_ERROR") from None
                raise
            response = ServiceResponse(status=200, data=finalized.patch.response_data)
            self.outcomes.save(session, owner_id=caller.owner_id, operation=TURN_OPERATION,
                resource_scope=parent.id, key=request.idempotency_key, request_hash=fingerprint,
                conversation_id=parent.id, response=response)
        return response

    def _message_snapshot(self, session, parent: ConversationRecord) -> MessageSnapshot:
        agent = AgentSnapshotV1.model_validate(self.snapshots.get(session, parent.agent_snapshot).content)
        activity = release = card = None
        next_result_revision = 1
        if parent.active_activity_id is not None:
            activity = self.activities.get(session, parent.id, parent.active_activity_id)
            if activity is None:
                raise RuntimeSessionError(500, "INTERNAL_ERROR")
            release = self.snapshots.get(session, activity.experience_snapshot)
            next_result_revision = self.results.latest_revision(session, activity.id) + 1
            if activity.state.current_result_id is not None:
                result = self.results.get(session, activity.id, activity.state.current_result_id)
                if not is_current_result(parent, activity, result):
                    raise RuntimeSessionError(500, "INTERNAL_ERROR")
                card = result.card_projection.model_dump(mode="json")
        limit = agent.limits.history_messages
        history = tuple(self.messages.recent(session, parent.id, limit)) if limit else ()
        return MessageSnapshot(parent=parent, agent=agent, activity=activity, release=release, result_card=card,
                               history=history, next_result_revision=next_result_revision,
                               today=self.access.clock.now(session).date())

    def commit_message(self, caller: VerifiedCaller, conversation_id: str, request: MessageTurnInput,
                       snapshot: MessageSnapshot, plan: MessagePlan) -> ServiceResponse:
        """One atomic write: user + assistant messages, the planned activity change and the replay outcome."""
        fingerprint = turn_fingerprint(request)
        with self.uow.begin() as session:
            parent, replay = self._lock_and_replay(session, caller, conversation_id, request, fingerprint)
            if replay is not None:
                return replay
            # Every activity change bumps the parent revision, so it alone guards the captured state.
            if parent.revision != snapshot.parent.revision:
                raise self._conflict(session, parent, "conversation", snapshot.parent.revision, parent.revision)
            turn_id = uuid4().hex
            user = NewMessage(message_id=uuid4().hex, turn_id=turn_id, role="user", blocks=(),
                              text=request.content.text)
            assistant = NewMessage(message_id=uuid4().hex, turn_id=turn_id, role="assistant", blocks=plan.blocks)
            if plan.draft is not None:
                current = self.activities.get(session, parent.id, snapshot.activity.id)
                if current is None or current.revision != snapshot.activity.revision:
                    raise RuntimeSessionError(500, "INTERNAL_ERROR")
                now = self.access.check_open(session, caller, parent)
                self.persistence.apply_patch(session, caller, parent, current, CommitPatch(
                    request_input=request.model_dump(mode="json", exclude_unset=True), activity_id=current.id,
                    expected_activity_revision=current.revision, next_state=plan.draft.next_state,
                    append_messages=(user, assistant), new_result=None, invalidate_result_ids=(),
                    response_data={}), now=now)
                parent = parent.model_copy(update={"revision": parent.revision + 1,
                                                   "display_name": plan.draft.next_state.display_name})
            else:
                if plan.start is not None:
                    start = plan.start
                    _, parent, now = self.persistence.insert_activity(session, caller, parent, start.release,
                                                                      start.experience_id, start.algorithm_profile)
                else:
                    now = self.access.check_open(session, caller, parent)
                    parent = parent.model_copy(update={"revision": parent.revision + 1})
                    self.conversations.conversations.save(session, parent)
                self.messages.append(session, parent.id, parent.revision, (user, assistant), now)
            view = self.conversations.view_in_session(session, parent)
            result = ConversationTurnResult(conversation_id=parent.id, revision=parent.revision, turn_id=turn_id,
                message_id=assistant.message_id, committed_at=now, activity=view.active_activity,
                blocks=project_blocks(assistant.blocks, parent.capability_snapshot))
            response = ServiceResponse(status=200, data=result.model_dump(mode="json"))
            self.outcomes.save(session, owner_id=caller.owner_id, operation=TURN_OPERATION,
                resource_scope=parent.id, key=request.idempotency_key, request_hash=fingerprint,
                conversation_id=parent.id, response=response)
        return response
