"""Structured conversation turn inputs and the committed turn result.

The input grammar mirrors the public ConversationTurnInput union so well-formed but
unsupported branches can be rejected after guards instead of as malformed input.
"""
from typing import Annotated, Literal

from pydantic import Field, field_validator

from .activity import ActivityView, TypedBlock
from .common import ContractModel, IdempotencyKey, JsonSafeInt, OpaqueId, UtcDatetime
from .conversation import InputVersion


class _TurnBase(ContractModel):
    expected_revision: JsonSafeInt
    idempotency_key: IdempotencyKey
    schema_version: InputVersion = 1


class MessageContent(ContractModel):
    text: Annotated[str, Field(strict=True, min_length=1, pattern=r"\S")]


class MessageTurnInput(_TurnBase):
    type: Literal["message"]
    content: MessageContent


class _InteractionBase(_TurnBase):
    type: Literal["interaction"]
    activity_id: OpaqueId
    # Optional guard: omission is semantically distinct from any value, so explicit null is rejected.
    expected_activity_revision: JsonSafeInt | None = None

    @field_validator("expected_activity_revision", mode="before")
    @classmethod
    def present_means_integer(cls, value):
        if value is None:
            raise ValueError("expected_activity_revision must be an integer when present")
        return value


class SetNamePayload(ContractModel):
    # No raw max length: the 50 code point limit applies after normalization.
    display_name: Annotated[str, Field(strict=True, min_length=1)]


class OptionAnswerPayload(ContractModel):
    question_id: OpaqueId
    option_id: OpaqueId


class TextAnswerPayload(ContractModel):
    question_id: OpaqueId
    text: Annotated[str, Field(strict=True, min_length=1, pattern=r"\S")]


class ConfirmAnswerPayload(ContractModel):
    proposal_id: OpaqueId
    question_id: OpaqueId
    candidate_id: OpaqueId


class SetNameInteraction(_InteractionBase):
    action: Literal["set_name"]
    payload: SetNamePayload


class SubmitAnswerInteraction(_InteractionBase):
    action: Literal["submit_answer"]
    payload: OptionAnswerPayload | TextAnswerPayload


class ConfirmAnswerInteraction(_InteractionBase):
    action: Literal["confirm_answer"]
    payload: ConfirmAnswerPayload


class EditAnswerInteraction(_InteractionBase):
    action: Literal["edit_answer"]
    payload: OptionAnswerPayload


InteractionTurnInput = Annotated[
    SetNameInteraction | SubmitAnswerInteraction | ConfirmAnswerInteraction | EditAnswerInteraction,
    Field(discriminator="action"),
]
ConversationTurnInput = Annotated[MessageTurnInput | InteractionTurnInput, Field(discriminator="type")]
# B-02 executes only these two shapes; SubmitAnswerInteraction must carry an option payload.
SupportedInteraction = SetNameInteraction | SubmitAnswerInteraction


class ConversationTurnResult(ContractModel):
    conversation_id: OpaqueId
    schema_version: Literal[1] = 1
    revision: JsonSafeInt
    turn_id: OpaqueId
    message_id: OpaqueId
    committed_at: UtcDatetime
    activity: ActivityView | None
    blocks: Annotated[tuple[TypedBlock, ...], Field(min_length=1)]
