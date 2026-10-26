"""Wire shapes of POST /conversations/{id}/messages and the Response resource."""
from typing import Annotated, Literal

from pydantic import Field, field_validator

from .activity import (
    ActivityClarification,
    ActivityStatus,
    ActivityView,
    AssessmentProgressV1,
    AssessmentProgressV2,
    AssessmentQuestion,
    TypedBlock,
)
from .common import ContractModel, IdempotencyKey, JsonObject, JsonSafeInt, NonEmptyText, OpaqueId, UtcDatetime
from .conversation import InputVersion
from .result import CurrentResultRef

ResponseStatus = Literal["in_progress", "completed", "cancelled", "failed"]
TERMINAL_EVENTS: dict[ResponseStatus, str] = {
    "completed": "response.completed",
    "cancelled": "response.cancelled",
    "failed": "response.failed",
}


class TextPart(ContractModel):
    type: Literal["text"]
    text: Annotated[str, Field(strict=True, min_length=1, pattern=r"\S")]


class InteractionPart(ContractModel):
    type: Literal["interaction"]
    activity_id: OpaqueId
    expected_activity_revision: JsonSafeInt | None = None
    action: Literal["set_name", "submit_answer", "confirm_answer", "edit_answer"]
    payload: JsonObject

    @field_validator("expected_activity_revision", mode="before")
    @classmethod
    def present_means_integer(cls, value):
        if value is None:
            raise ValueError("expected_activity_revision must be an integer when present")
        return value


ContentPart = Annotated[TextPart | InteractionPart, Field(discriminator="type")]


class MessageInput(ContractModel):
    schema_version: InputVersion = 1
    expected_revision: JsonSafeInt
    idempotency_key: IdempotencyKey
    content: Annotated[tuple[ContentPart, ...], Field(min_length=1, max_length=1)]


class ActivitySummary(ContractModel):
    id: OpaqueId
    revision: JsonSafeInt
    schema_version: Literal[1, 2]
    type: NonEmptyText
    algorithm_profile: NonEmptyText | None = None
    status: ActivityStatus
    display_name: NonEmptyText | None
    progress: AssessmentProgressV1 | AssessmentProgressV2
    current_question: AssessmentQuestion | None
    clarification: ActivityClarification | None
    result: CurrentResultRef | None

    @classmethod
    def from_view(cls, view: ActivityView) -> "ActivitySummary":
        return cls(id=view.id, revision=view.revision, schema_version=view.schema_version, type=view.type,
                   algorithm_profile=getattr(view, "algorithm_profile", None), status=view.status,
                   display_name=view.display_name, progress=view.progress, current_question=view.current_question,
                   clarification=view.clarification, result=view.result)


class ResponseOutput(ContractModel):
    message_id: OpaqueId
    blocks: Annotated[tuple[TypedBlock, ...], Field(min_length=1)]


class ResponseError(ContractModel):
    code: NonEmptyText


class TurnResponse(ContractModel):
    id: OpaqueId
    conversation_id: OpaqueId
    status: ResponseStatus
    revision: JsonSafeInt
    input_message_id: OpaqueId
    output: ResponseOutput | None = None
    activity: ActivitySummary | None = None
    error: ResponseError | None = None
    created_at: UtcDatetime
    completed_at: UtcDatetime | None = None
