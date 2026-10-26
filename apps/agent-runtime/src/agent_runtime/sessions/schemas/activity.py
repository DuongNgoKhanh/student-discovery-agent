"""Versioned state, capability manifests, typed blocks and atomic harness patch."""
import re
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from .common import (
    ContentHash,
    ContractModel,
    JsonObject,
    JsonSafeInt,
    NonEmptyText,
    OpaqueId,
    PositiveRevision,
    UtcDatetime,
)
from .release import ReleaseKey
from .result import CurrentResultRef, PersonalityCardData, ResultSnapshotInput

ADAPTIVE_PROFILE = "riasec.mean.bounds.v2"
ActivityStatus = Literal["collecting_name", "in_progress", "completed", "ended", "expired"]


class BlockCapabilityInput(ContractModel):
    """Request shape only; advertised support is negotiated after replay guards."""
    type: NonEmptyText
    schema_versions: tuple[PositiveRevision, ...]

    @model_validator(mode="after")
    def supported_versions(self) -> "BlockCapabilityInput":
        if not self.schema_versions or len(set(self.schema_versions)) != len(self.schema_versions):
            raise ValueError("block versions must be nonempty and unique")
        return self


class SupportedBlock(BlockCapabilityInput):
    type: Literal[
        "text", "markdown", "suggestions", "assessment_question", "assessment_clarification", "personality_card"
    ]

    @model_validator(mode="after")
    def supported_version_set(self) -> "SupportedBlock":
        allowed = {1, 2} if self.type in {"assessment_question", "assessment_clarification"} else {1}
        if not set(self.schema_versions) <= allowed:
            raise ValueError("unsupported block version")
        return self


def legacy_blocks() -> tuple[SupportedBlock, ...]:
    return tuple(SupportedBlock(type=kind, schema_versions=(1,)) for kind in (
        "text", "assessment_question", "assessment_clarification", "personality_card"
    ))


class CapabilitySnapshot(ContractModel):
    accepted_activity_profiles: tuple[Literal["riasec.mean.bounds.v2"], ...] = ()
    supported_blocks: tuple[SupportedBlock, ...] = Field(default_factory=legacy_blocks)
    legacy_enabled: bool = True

    @model_validator(mode="after")
    def manifest(self) -> "CapabilitySnapshot":
        if len(set(self.accepted_activity_profiles)) != len(self.accepted_activity_profiles):
            raise ValueError("activity profiles must be unique")
        if self.legacy_enabled != (not self.accepted_activity_profiles):
            raise ValueError("legacy default must match the negotiated profiles")
        blocks = {block.type: set(block.schema_versions) for block in self.supported_blocks}
        if not blocks or len(blocks) != len(self.supported_blocks):
            raise ValueError("block types must be nonempty and unique")
        if ADAPTIVE_PROFILE in self.accepted_activity_profiles:
            required = {"text": 1, "assessment_question": 2, "assessment_clarification": 2, "personality_card": 1}
            if any(version not in blocks.get(kind, set()) for kind, version in required.items()):
                raise PydanticCustomError(
                    "incompatible_schema", "adaptive requires ActivityView v2 and its full block manifest"
                )
        return self


class AssessmentOption(ContractModel):
    id: OpaqueId
    label: NonEmptyText


class AssessmentQuestion(ContractModel):
    question_id: OpaqueId
    title: NonEmptyText
    options: Annotated[tuple[AssessmentOption, ...], Field(min_length=2)]

    @model_validator(mode="after")
    def unique_options(self) -> "AssessmentQuestion":
        if len({option.id for option in self.options}) != len(self.options):
            raise ValueError("question option ids must be unique")
        return self


class ClarificationCandidate(ContractModel):
    id: OpaqueId
    option_id: OpaqueId
    label: NonEmptyText


class ActivityClarification(ContractModel):
    proposal_id: OpaqueId
    question_id: OpaqueId
    activity_revision: JsonSafeInt
    title: NonEmptyText
    candidates: Annotated[tuple[ClarificationCandidate, ...], Field(min_length=1)]


class ActivityAnswer(ContractModel):
    answer_id: OpaqueId
    question_id: OpaqueId
    option_id: OpaqueId
    ordinal: PositiveRevision
    accepted_activity_revision: PositiveRevision
    source: Literal["option", "text_mapping", "text_confirmation", "edit_option"]
    question: AssessmentQuestion

    @model_validator(mode="after")
    def question_membership(self) -> "ActivityAnswer":
        if self.question_id != self.question.question_id or self.option_id not in {o.id for o in self.question.options}:
            raise ValueError("answer must belong to its question and options")
        return self


class AssessmentProgressV1(ContractModel):
    completed: Annotated[int, Field(strict=True, ge=0, le=6)]
    total: Literal[6] = 6


class AssessmentProgressV2(ContractModel):
    completed: Annotated[int, Field(strict=True, ge=0, le=30)]
    min_total: Literal[12] = 12
    # The question cap is a definition value; Harness never hard-codes it.
    max_total: Annotated[int, Field(strict=True, ge=12, le=30)] = 30
    total: Annotated[int, Field(strict=True, ge=12, le=30)] | None
    phase: Literal["baseline", "adaptive", "completed"]

    @model_validator(mode="after")
    def total_matches_phase(self) -> "AssessmentProgressV2":
        if self.completed > self.max_total:
            raise ValueError("completed progress cannot exceed the question cap")
        if self.phase == "completed":
            if self.total != self.completed:
                raise ValueError("completed progress requires its actual total")
        elif self.total is not None:
            raise ValueError("total must be null before completion")
        return self


class _ActivityContent(ContractModel):
    status: ActivityStatus
    display_name: NonEmptyText | None
    current_question: AssessmentQuestion | None
    clarification: ActivityClarification | None
    answers: tuple[ActivityAnswer, ...]

    def validate_content(self, completed: int, limit: int, has_result: bool) -> None:
        if completed != len(self.answers) or completed > limit:
            raise ValueError("progress must match the active answer count")
        for attribute in ("answer_id", "question_id"):
            if len({getattr(answer, attribute) for answer in self.answers}) != completed:
                raise ValueError("active answer and question ids must be unique")
        if [answer.ordinal for answer in self.answers] != list(range(1, completed + 1)):
            raise ValueError("active answer ordinals must be contiguous")
        if self.status == "collecting_name" and (
            self.display_name is not None or self.current_question is not None or self.clarification is not None
            or completed or has_result
        ):
            raise ValueError("collecting_name must have empty assessment state")
        if self.status == "in_progress" and (
            self.display_name is None or self.current_question is None or has_result or completed >= limit
        ):
            raise ValueError("in_progress requires name and current question without a result")
        if self.status == "completed" and (self.display_name is None or not has_result):
            raise ValueError("completed requires name and current result")
        if self.status in {"completed", "ended", "expired"} and (
            self.current_question is not None or self.clarification is not None
        ):
            raise ValueError("completed or closed state cannot contain an actionable question/proposal")
        if self.current_question and self.current_question.question_id in {a.question_id for a in self.answers}:
            raise ValueError("current question must not already have an active answer")
        if self.clarification:
            if self.current_question is None or self.clarification.question_id != self.current_question.question_id:
                raise ValueError("proposal must refer to the current question")
            if any(c.option_id not in {o.id for o in self.current_question.options} for c in self.clarification.candidates):
                raise ValueError("proposal candidates must belong to the current question")


class ActivityStateV1(_ActivityContent):
    state_schema_version: Literal[1]
    schema_version: Literal[1]
    type: Literal["personality_assessment"]
    progress: AssessmentProgressV1
    current_result_id: OpaqueId | None

    @model_validator(mode="after")
    def integrity(self) -> "ActivityStateV1":
        self.validate_content(self.progress.completed, 6, self.current_result_id is not None)
        if self.status == "completed" and self.progress.completed != 6:
            raise ValueError("legacy completion requires exactly six answers")
        return self


class ActivityStateV2(_ActivityContent):
    state_schema_version: Literal[2]
    schema_version: Literal[2]
    type: Literal["personality_assessment_adaptive"]
    algorithm_profile: Literal["riasec.mean.bounds.v2"]
    progress: AssessmentProgressV2
    current_result_id: OpaqueId | None

    @model_validator(mode="after")
    def integrity(self) -> "ActivityStateV2":
        self.validate_content(self.progress.completed, 30, self.current_result_id is not None)
        if self.status in {"collecting_name", "in_progress", "completed"}:
            if (self.status == "completed") != (self.progress.phase == "completed"):
                raise ValueError("completion status and progress phase disagree")
        if self.current_result_id is not None and self.progress.phase != "completed":
            raise ValueError("result requires completed progress")
        return self


ActivityState = Annotated[ActivityStateV1 | ActivityStateV2, Field(discriminator="state_schema_version")]


class _ActivityViewBase(_ActivityContent):
    id: OpaqueId
    conversation_id: OpaqueId
    experience_id: OpaqueId
    experience_release_id: OpaqueId
    definition_hash: ContentHash
    revision: JsonSafeInt
    result: CurrentResultRef | None
    is_demo: bool
    created_at: UtcDatetime
    expires_at: UtcDatetime | None


class ActivityViewV1(_ActivityViewBase):
    schema_version: Literal[1]
    type: Literal["personality_assessment"]
    progress: AssessmentProgressV1

    @model_validator(mode="after")
    def integrity(self) -> "ActivityViewV1":
        self.validate_content(self.progress.completed, 6, self.result is not None)
        if self.status == "completed" and self.progress.completed != 6:
            raise ValueError("legacy completion requires exactly six answers")
        return self


class ActivityViewV2(_ActivityViewBase):
    schema_version: Literal[2]
    type: Literal["personality_assessment_adaptive"]
    algorithm_profile: Literal["riasec.mean.bounds.v2"]
    progress: AssessmentProgressV2

    @model_validator(mode="after")
    def integrity(self) -> "ActivityViewV2":
        state_fields = set(ActivityStateV2.model_fields) - {"state_schema_version", "current_result_id"}
        ActivityStateV2.model_validate({
            **self.model_dump(include=state_fields), "state_schema_version": 2,
            "current_result_id": self.result.result_id if self.result else None,
        })
        return self


ActivityView = Annotated[ActivityViewV1 | ActivityViewV2, Field(discriminator="schema_version")]


class ActivityRecord(ContractModel):
    id: OpaqueId
    conversation_id: OpaqueId
    experience_id: OpaqueId
    experience_snapshot: ReleaseKey
    engine_version: NonEmptyText
    revision: JsonSafeInt
    state: ActivityState
    created_at: UtcDatetime
    closed_at: UtcDatetime | None = None

    @model_validator(mode="after")
    def integrity(self) -> "ActivityRecord":
        if self.experience_snapshot.kind != "experience":
            raise ValueError("activity requires experience snapshot")
        if self.state.clarification and self.state.clarification.activity_revision != self.revision:
            raise ValueError("proposal must match the current activity revision")
        if any(a.accepted_activity_revision > self.revision for a in self.state.answers):
            raise ValueError("answer revision cannot exceed the activity revision")
        return self


class TextBlock(ContractModel):
    block_id: OpaqueId
    type: Literal["text"]
    schema_version: Literal[1]
    content: NonEmptyText


_HTML_TAG = re.compile(r"<[A-Za-z/!]")
_LINK_TARGET = re.compile(r"\]\(\s*([^)\s]*)")
_REFERENCE_TARGET = re.compile(r"^[ \t>*+\-\d.]*\[[^\]]+\]:\s*(\S+)", re.MULTILINE)


class MarkdownBlock(ContractModel):
    """Safe subset only: emphasis, lists and http(s) links; clients still sanitize."""
    block_id: OpaqueId
    type: Literal["markdown"]
    schema_version: Literal[1]
    content: Annotated[str, StringConstraints(min_length=1, max_length=4000, pattern=r"\S")]

    @model_validator(mode="after")
    def safe_subset(self) -> "MarkdownBlock":
        if _HTML_TAG.search(self.content):
            raise ValueError("markdown must not contain HTML")
        if "![" in self.content:
            raise ValueError("markdown must not contain images")
        targets = [*_LINK_TARGET.findall(self.content), *_REFERENCE_TARGET.findall(self.content)]
        if any(not target.startswith(("http://", "https://")) for target in targets):
            raise ValueError("markdown links must use http or https")
        return self


class SuggestionItem(ContractModel):
    label: Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"\S")]
    message_text: Annotated[str, StringConstraints(min_length=1, max_length=500, pattern=r"\S")]


class SuggestionsBlock(ContractModel):
    """Quick replies; choosing one sends a message turn with message_text."""
    block_id: OpaqueId
    type: Literal["suggestions"]
    schema_version: Literal[1]
    items: Annotated[tuple[SuggestionItem, ...], Field(min_length=1, max_length=4)]


class _QuestionBlock(ContractModel):
    block_id: OpaqueId
    type: Literal["assessment_question"]
    activity_id: OpaqueId
    question_id: OpaqueId
    title: NonEmptyText
    options: Annotated[tuple[AssessmentOption, ...], Field(min_length=2)]


class AssessmentQuestionBlockV1(_QuestionBlock):
    schema_version: Literal[1]
    progress: AssessmentProgressV1


class AssessmentQuestionBlockV2(_QuestionBlock):
    schema_version: Literal[2]
    progress: AssessmentProgressV2


class _ClarificationBlock(ActivityClarification):
    block_id: OpaqueId
    type: Literal["assessment_clarification"]
    activity_id: OpaqueId


class AssessmentClarificationBlockV1(_ClarificationBlock):
    schema_version: Literal[1]
    progress: AssessmentProgressV1


class AssessmentClarificationBlockV2(_ClarificationBlock):
    schema_version: Literal[2]
    progress: AssessmentProgressV2


class PersonalityCardBlock(ContractModel):
    block_id: OpaqueId
    type: Literal["personality_card"]
    schema_version: Literal[1]
    activity_id: OpaqueId
    result_id: OpaqueId
    result_revision: PositiveRevision
    data: PersonalityCardData


QuestionBlock = Annotated[
    AssessmentQuestionBlockV1 | AssessmentQuestionBlockV2, Field(discriminator="schema_version")
]
ClarificationBlock = Annotated[
    AssessmentClarificationBlockV1 | AssessmentClarificationBlockV2, Field(discriminator="schema_version")
]
TypedBlock = Annotated[
    TextBlock | MarkdownBlock | SuggestionsBlock | QuestionBlock | ClarificationBlock | PersonalityCardBlock,
    Field(discriminator="type"),
]


class StoredInteraction(ContractModel):
    activity_id: OpaqueId
    action: Literal["set_name", "submit_answer", "confirm_answer", "edit_answer"]
    question_id: OpaqueId | None
    option_id: OpaqueId | None


class NewMessage(ContractModel):
    message_id: OpaqueId
    turn_id: OpaqueId | None = None
    role: Literal["user", "assistant", "system"]
    blocks: tuple[TypedBlock, ...]
    text: str | None = None
    interaction: StoredInteraction | None = None

    @model_validator(mode="after")
    def stable_block_ids(self) -> "NewMessage":
        ids = [block.block_id for block in self.blocks]
        if len(ids) != len(set(ids)):
            raise ValueError("message block ids must be nonempty and unique")
        return self


class CommitPatch(ContractModel):
    request_input: JsonObject
    activity_id: OpaqueId
    expected_activity_revision: JsonSafeInt
    next_state: ActivityState
    append_messages: tuple[NewMessage, ...]
    new_result: ResultSnapshotInput | None
    invalidate_result_ids: tuple[OpaqueId, ...]
    response_data: JsonObject

    @model_validator(mode="after")
    def result_targets_activity(self) -> "CommitPatch":
        if len(set(self.invalidate_result_ids)) != len(self.invalidate_result_ids):
            raise ValueError("invalidated result ids must be unique")
        if self.next_state.current_result_id in self.invalidate_result_ids:
            raise ValueError("current result cannot be invalidated by the same patch")
        if self.new_result and (
            self.new_result.activity_id != self.activity_id or self.next_state.current_result_id != self.new_result.result_id
            or self.new_result.result_id in self.invalidate_result_ids
        ):
            raise ValueError("new result must be current and belong to the patched activity")
        return self
