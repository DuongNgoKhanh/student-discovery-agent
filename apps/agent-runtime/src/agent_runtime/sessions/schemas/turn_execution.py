"""Internal immutable turn DTOs passed between preflight, handler, composer and commit. Never public."""
from agent_runtime.engine.schemas.selector import SelectionResult

from .activity import ActivityAnswer, ActivityRecord, ActivityState
from .common import ContractModel, OpaqueId, PositiveRevision
from .conversation import ConversationRecord
from .release import ValidatedRelease
from .result import PersonalityCardData, ShareCard


class TurnSnapshot(ContractModel):
    """Detached state captured under the preflight parent lock; commit compares against it."""
    parent: ConversationRecord
    activity: ActivityRecord
    release: ValidatedRelease
    next_result_revision: PositiveRevision


class CompletionContext(ContractModel):
    snapshot: TurnSnapshot
    answers: tuple[ActivityAnswer, ...]
    selection: SelectionResult
    next_activity_revision: PositiveRevision


class CompletionBundle(ContractModel):
    """Pure projector output; ResultView/created_at are finalised with the commit timestamp."""
    result_id: OpaqueId
    result_revision: PositiveRevision
    source_activity_revision: PositiveRevision
    card: PersonalityCardData
    share: ShareCard


class TurnDraft(ContractModel):
    """Candidate computed outside any transaction: no DB writes, timestamps or HTTP metadata."""
    next_state: ActivityState
    completion: CompletionBundle | None = None
