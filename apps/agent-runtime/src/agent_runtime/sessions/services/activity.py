"""Python-only Harness persistence ports. Product and engine work stays outside write transactions."""
import json
from datetime import datetime
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError

from agent_runtime.evaluations.services.validator import calculate_content_hash
from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.repositories.messages import MessageRepository
from agent_runtime.sessions.repositories.outcomes import OutcomeRepository
from agent_runtime.sessions.repositories.results import ResultRepository
from agent_runtime.sessions.repositories.snapshots import SnapshotRepository
from agent_runtime.sessions.schemas.activity import (
    ADAPTIVE_PROFILE,
    ActivityRecord,
    ActivityStateV1,
    ActivityStateV2,
    CommitPatch,
)
from agent_runtime.sessions.schemas.common import IdempotencyKey, ServiceResponse
from agent_runtime.sessions.schemas.conversation import ConversationRecord
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.services.access import AccessPolicy
from agent_runtime.sessions.services.blocks import DEGRADABLE_TYPES
from agent_runtime.sessions.services.releases import validate_release
from agent_runtime.sessions.trace import observed


def request_fingerprint(value: dict) -> str:
    """Hash original normalized request fields, never candidate state/IDs/response."""
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > 65536:
            raise RuntimeSessionError(413, "PAYLOAD_TOO_LARGE")
        return calculate_content_hash(value)
    except (TypeError, ValueError, OverflowError, RecursionError):
        raise RuntimeSessionError(400, "INVALID_REQUEST") from None


class ActivityPersistence:
    def __init__(self, uow, product, validator, *, clock=None, trace_sink=None):
        self.trace_sink = trace_sink
        self.uow = uow
        self.product = product
        self.validator = validator
        self.access = AccessPolicy(clock=clock)
        self.conversations = ConversationRepository()
        self.activities = ActivityRepository()
        self.snapshots = SnapshotRepository()
        self.results = ResultRepository()
        self.messages = MessageRepository()
        self.outcomes = OutcomeRepository()

    def _guard(self, session, caller, conversation_id, expected_revision, key, operation, scope, fingerprint):
        # Acquire FOR UPDATE first, never FOR SHARE followed by an upgrade.
        parent = self.access.lock_open(session, caller, conversation_id, write=True)
        try:
            TypeAdapter(IdempotencyKey).validate_python(key)
        except ValidationError:
            raise RuntimeSessionError(400, "INVALID_REQUEST") from None
        replay = self.outcomes.find(session, caller.owner_id, operation, scope, key, request_hash=fingerprint)
        if replay is None:
            self.access.require_revision(parent, expected_revision)
        return parent, replay

    def _permission(self, session, parent, algorithm_profile):
        agent = AgentSnapshotV1.model_validate(self.snapshots.get(session, parent.agent_snapshot).content)
        permission = "personality_assessment" if algorithm_profile is None else algorithm_profile
        if permission not in agent.allowed_activity_profiles:
            raise RuntimeSessionError(403, "FORBIDDEN")
        capability = parent.capability_snapshot
        if ((algorithm_profile is None and not capability.legacy_enabled)
                or (algorithm_profile is not None and algorithm_profile not in capability.accepted_activity_profiles)):
            raise RuntimeSessionError(422, "INCOMPATIBLE_SCHEMA")
        if parent.active_activity_id:
            active = self.activities.get(session, parent.id, parent.active_activity_id)
            if active is None:
                raise RuntimeSessionError(500, "INTERNAL_ERROR")
            if active.state.status in {"collecting_name", "in_progress"}:
                raise RuntimeSessionError(409, "REVISION_CONFLICT")

    @observed("activity.start")
    def start(self, caller: VerifiedCaller, conversation_id: str, expected_revision: int, experience_id: str,
              algorithm_profile: str | None, idempotency_key: str) -> ServiceResponse:
        fingerprint = request_fingerprint({"experience_id": experience_id, "algorithm_profile": algorithm_profile,
                                           "expected_revision": expected_revision})
        scope, operation = conversation_id, "activity.start"
        with self.uow.begin() as session:
            parent, replay = self._guard(session, caller, conversation_id, expected_revision,
                                         idempotency_key, operation, scope, fingerprint)
            if replay is not None:
                return replay
            self._permission(session, parent, algorithm_profile)
        # A separate preflight transaction permits replay even if Product has become unavailable.
        descriptor = self.product.resolve_active_experience(parent.environment, experience_id, algorithm_profile)
        release = validate_release(descriptor, environment=parent.environment,
                                   capabilities=parent.capability_snapshot, validator=self.validator)
        if release.kind != "experience" or release.algorithm_profile != algorithm_profile:
            raise RuntimeSessionError(422, "INCOMPATIBLE_RELEASE")
        with self.uow.begin() as session:
            parent, replay = self._guard(session, caller, conversation_id, expected_revision,
                                         idempotency_key, operation, scope, fingerprint)
            if replay is not None:
                return replay
            self._permission(session, parent, algorithm_profile)
            pin = self.snapshots.store(session, release)
            now = self.access.check_open(session, caller, parent)
            state = dict(status="collecting_name", display_name=None, current_question=None, clarification=None,
                         answers=(), current_result_id=None)
            initial = (ActivityStateV2(**state, state_schema_version=2, schema_version=2,
                        type="personality_assessment_adaptive", algorithm_profile=ADAPTIVE_PROFILE,
                        progress={"completed": 0, "total": None, "phase": "baseline"})
                       if algorithm_profile == ADAPTIVE_PROFILE else
                       ActivityStateV1(**state, state_schema_version=1, schema_version=1,
                                       type="personality_assessment", progress={"completed": 0}))
            activity = ActivityRecord(id=uuid4().hex, conversation_id=parent.id, experience_id=experience_id,
                experience_snapshot=pin, engine_version=release.engine_version, revision=0, state=initial, created_at=now)
            self.activities.insert(session, activity)
            updated = parent.model_copy(update={"revision": parent.revision + 1, "active_activity_id": activity.id})
            self.conversations.save(session, updated)
            response = ServiceResponse(status=201, data={"activity_id": activity.id, "conversation_id": parent.id,
                                        "conversation_revision": updated.revision, "activity_revision": 0})
            self.outcomes.save(session, owner_id=caller.owner_id, operation=operation, resource_scope=scope,
                key=idempotency_key, request_hash=fingerprint, conversation_id=parent.id, response=response)
        return response

    def _validate_patch(self, session, parent, current, patch):
        try:
            # Revalidate nested mutable JSON and model_copy candidates only AFTER replay lookup.
            patch = CommitPatch.model_validate(patch.model_dump(mode="json"))
            candidate = ActivityRecord.model_validate(current.model_dump(mode="json") | {
                "state": patch.next_state.model_dump(mode="json"), "revision": current.revision + 1})
        except (ValidationError, ValueError, TypeError):
            raise RuntimeSessionError(400, "INVALID_REQUEST") from None
        if (candidate.state.type, candidate.state.schema_version, getattr(candidate.state, "algorithm_profile", None)) != (
                current.state.type, current.state.schema_version, getattr(current.state, "algorithm_profile", None)):
            raise RuntimeSessionError(422, "INCOMPATIBLE_SCHEMA")
        if candidate.state.status in {"ended", "expired"} or current.state.status in {"ended", "expired"}:
            raise RuntimeSessionError(409, "REVISION_CONFLICT")
        # Verify persisted pin integrity without consulting Product or re-running the engine.
        self.snapshots.get(session, current.experience_snapshot)
        old_id, new_id = current.state.current_result_id, candidate.state.current_result_id
        if old_id != new_id and old_id is not None and old_id not in patch.invalidate_result_ids:
            raise RuntimeSessionError(400, "INVALID_REQUEST")
        for identity in patch.invalidate_result_ids:
            result = self.results.get(session, current.id, identity)
            if result is None or result.validity != "valid":
                raise RuntimeSessionError(400, "INVALID_REQUEST")
        if patch.new_result is not None:
            result = patch.new_result
            projection = result.result_projection
            if (result.source_activity_revision != candidate.revision
                    or result.result_revision != self.results.latest_revision(session, current.id) + 1
                    or projection.conversation_id != parent.id or projection.activity_type != current.state.type
                    or projection.experience_release_id != current.experience_snapshot.release_id):
                raise RuntimeSessionError(400, "INVALID_REQUEST")
        elif new_id is not None:
            result = self.results.get(session, current.id, new_id)
            if new_id != old_id or result is None or result.validity != "valid":
                raise RuntimeSessionError(400, "INVALID_REQUEST")
        supported = {block.type: block.schema_versions for block in parent.capability_snapshot.supported_blocks}
        for message in patch.append_messages:
            if message.interaction and message.interaction.activity_id != current.id:
                raise RuntimeSessionError(400, "INVALID_REQUEST")
            for block in message.blocks:
                if (block.type not in DEGRADABLE_TYPES
                        and block.schema_version not in supported.get(block.type, ())):
                    raise RuntimeSessionError(422, "INCOMPATIBLE_SCHEMA")
                if hasattr(block, "activity_id") and block.activity_id != current.id:
                    raise RuntimeSessionError(400, "INVALID_REQUEST")
                if block.type == "personality_card":
                    result = patch.new_result or (self.results.get(session, current.id, new_id) if new_id else None)
                    if (result is None or block.result_id != new_id or block.result_revision != result.result_revision
                            or block.data != result.card_projection):
                        raise RuntimeSessionError(400, "INVALID_REQUEST")
        return patch, candidate

    def apply_patch(self, session, caller: VerifiedCaller, parent: ConversationRecord, current: ActivityRecord,
                    patch: CommitPatch, *, now: datetime | None = None) -> CommitPatch:
        """Validate and write one patch inside the caller's UoW; never opens a transaction or saves an outcome.

        The caller holds the parent FOR UPDATE and has already applied replay/revision guards. Lifecycle and
        caller expiry are rechecked here, immediately before the writes; a supplied ``now`` is the timestamp
        the caller already finalised into the patch.
        """
        checked, candidate = self._validate_patch(session, parent, current, patch)
        checked_at = self.access.check_open(session, caller, parent)
        now = now if now is not None else checked_at
        self.results.invalidate(session, current.id, checked.invalidate_result_ids)
        if checked.new_result:
            self.results.insert(session, checked.new_result, now)
        self.activities.save(session, candidate)
        updated = parent.model_copy(update={"revision": parent.revision + 1,
                                            "display_name": candidate.state.display_name})
        self.conversations.save(session, updated)
        self.messages.append(session, parent.id, updated.revision, checked.append_messages, now)
        return checked

    @observed("activity.commit")
    def commit(self, caller: VerifiedCaller, conversation_id: str, expected_revision: int,
               idempotency_key: str, patch: CommitPatch) -> ServiceResponse:
        fingerprint = request_fingerprint({"request_input": patch.request_input, "expected_revision": expected_revision,
                                           "expected_activity_revision": patch.expected_activity_revision})
        operation, scope = "activity.commit", f"{conversation_id}/{patch.activity_id}"
        with self.uow.begin() as session:
            parent, replay = self._guard(session, caller, conversation_id, expected_revision,
                                         idempotency_key, operation, scope, fingerprint)
            if replay is not None:
                return replay
            current = self.activities.get(session, parent.id, patch.activity_id)
            if current is None:
                raise RuntimeSessionError(404, "RESOURCE_NOT_FOUND")
            if parent.active_activity_id != current.id or current.revision != patch.expected_activity_revision:
                raise RuntimeSessionError(409, "REVISION_CONFLICT")
            checked = self.apply_patch(session, caller, parent, current, patch)
            response = ServiceResponse(status=200, data=checked.response_data)
            self.outcomes.save(session, owner_id=caller.owner_id, operation=operation, resource_scope=scope,
                key=idempotency_key, request_hash=fingerprint, conversation_id=parent.id, response=response)
        return response
