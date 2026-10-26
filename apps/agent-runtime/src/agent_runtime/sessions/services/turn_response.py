"""Pure finalisation of a turn draft: server IDs, messages, result generation and response from one source."""
from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import (
    ActivityRecord,
    ActivityView,
    CommitPatch,
    NewMessage,
    StoredInteraction,
    TypedBlock,
)
from agent_runtime.sessions.schemas.conversation import ConversationRecord
from agent_runtime.sessions.schemas.release import ValidatedRelease
from agent_runtime.sessions.schemas.result import CurrentResultRef, ResultSnapshotInput
from agent_runtime.sessions.schemas.turn import ConversationTurnResult, SetNameInteraction, SupportedInteraction
from agent_runtime.sessions.schemas.turn_execution import TurnDraft, TurnSnapshot
from agent_runtime.sessions.services.blocks import project_blocks

_VIEW = TypeAdapter(ActivityView)
_BLOCK = TypeAdapter(TypedBlock)


@dataclass(frozen=True)
class FinalizedTurn:
    patch: CommitPatch
    result: ConversationTurnResult


def project_activity(parent: ConversationRecord, activity: ActivityRecord, release: ValidatedRelease,
                     current_result: CurrentResultRef | None) -> ActivityView:
    """Shared read projection for GET, conflict snapshots and turn responses."""
    return _VIEW.validate_python({
        **activity.state.model_dump(exclude={"state_schema_version", "current_result_id"}),
        "id": activity.id, "conversation_id": parent.id, "experience_id": activity.experience_id,
        "experience_release_id": release.release_id, "definition_hash": release.content_hash,
        "revision": activity.revision, "result": current_result, "is_demo": release.is_demo,
        "created_at": activity.created_at, "expires_at": None})


def _assistant_block(activity: ActivityRecord, draft: TurnDraft):
    state = draft.next_state
    if draft.completion is not None:
        bundle = draft.completion
        return _BLOCK.validate_python({"block_id": uuid4().hex, "type": "personality_card", "schema_version": 1,
            "activity_id": activity.id, "result_id": bundle.result_id, "result_revision": bundle.result_revision,
            "data": bundle.card.model_dump(mode="json")})
    question = state.current_question
    return _BLOCK.validate_python({"block_id": uuid4().hex, "type": "assessment_question",
        "schema_version": state.schema_version, "activity_id": activity.id, "question_id": question.question_id,
        "title": question.title, "options": [option.model_dump(mode="json") for option in question.options],
        "progress": state.progress.model_dump(mode="json")})


def _new_result(snapshot: TurnSnapshot, draft: TurnDraft, committed_at: datetime) -> ResultSnapshotInput | None:
    bundle = draft.completion
    if bundle is None:
        return None
    activity = snapshot.activity
    card = bundle.card.model_dump(mode="json")
    return ResultSnapshotInput(result_id=bundle.result_id, activity_id=activity.id,
        result_revision=bundle.result_revision, source_activity_revision=bundle.source_activity_revision,
        result_projection={"result_id": bundle.result_id, "result_revision": bundle.result_revision,
            "conversation_id": snapshot.parent.id, "activity_id": activity.id, "activity_type": draft.next_state.type,
            "experience_release_id": snapshot.release.release_id, "created_at": committed_at, "data": card},
        card_projection=card, share_projection=bundle.share.model_dump(mode="json"), evidence=bundle.evidence)


def finalize_turn(snapshot: TurnSnapshot, request: SupportedInteraction, draft: TurnDraft,
                  committed_at: datetime) -> FinalizedTurn:
    """Server-owned composition: any validation failure is an internal error and nothing is written."""
    parent, activity = snapshot.parent, snapshot.activity
    try:
        draft = TurnDraft.model_validate(draft.model_dump(mode="json"))
        turn_id = uuid4().hex
        payload = request.payload
        is_name = isinstance(request, SetNameInteraction)
        user = NewMessage(message_id=uuid4().hex, turn_id=turn_id, role="user", blocks=(),
            text=draft.next_state.display_name if is_name else None,
            interaction=StoredInteraction(activity_id=activity.id, action=request.action,
                question_id=None if is_name else payload.question_id,
                option_id=None if is_name else payload.option_id))
        assistant = NewMessage(message_id=uuid4().hex, turn_id=turn_id, role="assistant",
                               blocks=(_assistant_block(activity, draft),))
        new_result = _new_result(snapshot, draft, committed_at)
        next_activity = ActivityRecord.model_validate(activity.model_dump(mode="json") | {
            "revision": activity.revision + 1, "state": draft.next_state.model_dump(mode="json")})
        next_parent = parent.model_copy(update={"revision": parent.revision + 1})
        current = (CurrentResultRef(result_id=new_result.result_id, result_revision=new_result.result_revision)
                   if new_result else None)
        result = ConversationTurnResult(conversation_id=parent.id, revision=next_parent.revision, turn_id=turn_id,
            message_id=assistant.message_id, committed_at=committed_at,
            activity=project_activity(next_parent, next_activity, snapshot.release, current),
            blocks=project_blocks(assistant.blocks, parent.capability_snapshot))
        patch = CommitPatch(request_input=request.model_dump(mode="json", exclude_unset=True),
            activity_id=activity.id, expected_activity_revision=activity.revision, next_state=draft.next_state,
            append_messages=(user, assistant), new_result=new_result, invalidate_result_ids=(),
            response_data=result.model_dump(mode="json"))
    except (ValidationError, ValueError, TypeError, AttributeError):
        raise RuntimeSessionError(500, "INTERNAL_ERROR") from None
    return FinalizedTurn(patch=patch, result=result)
