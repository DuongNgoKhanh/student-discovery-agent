"""Browser inputs, internal persistence record and safe read/close projections."""
from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, model_validator

from .activity import ActivityView, BlockCapabilityInput, CapabilitySnapshot, legacy_blocks
from .common import ContractModel, IdempotencyKey, JsonSafeInt, NonEmptyText, OpaqueId, OwnerId, UtcDatetime
from .release import ReleaseKey
from .result import CurrentResultRef


def _strict_input_version(value):
    if type(value) is not int:
        raise ValueError("schema version must be an integer")
    return value


InputVersion = Annotated[Literal[1], BeforeValidator(_strict_input_version)]


class CreateConversationInput(ContractModel):
    idempotency_key: IdempotencyKey
    schema_version: InputVersion = 1
    accepted_activity_profiles: tuple[NonEmptyText, ...] = ()
    supported_blocks: tuple[BlockCapabilityInput, ...] = Field(default_factory=legacy_blocks, min_length=1)

    @model_validator(mode="after")
    def check_manifest(self) -> "CreateConversationInput":
        if len(set(self.accepted_activity_profiles)) != len(self.accepted_activity_profiles):
            raise ValueError("activity profiles must be unique")
        if len({block.type for block in self.supported_blocks}) != len(self.supported_blocks):
            raise ValueError("block types must be unique")
        return self

    def capability_snapshot(self) -> CapabilitySnapshot:
        return CapabilitySnapshot(
            accepted_activity_profiles=self.accepted_activity_profiles,
            supported_blocks=[block.model_dump() for block in self.supported_blocks],
            legacy_enabled=not self.accepted_activity_profiles,
        )


class EndConversationInput(ContractModel):
    expected_revision: JsonSafeInt
    idempotency_key: IdempotencyKey
    schema_version: InputVersion = 1


class ConversationRecord(ContractModel):
    id: OpaqueId
    owner_id: OwnerId = Field(repr=False)
    environment: NonEmptyText
    status: Literal["active", "ended", "expired"]
    revision: JsonSafeInt
    agent_snapshot: ReleaseKey
    capability_snapshot: CapabilitySnapshot
    display_name: NonEmptyText | None = None
    active_activity_id: OpaqueId | None = None
    created_at: UtcDatetime
    expires_at: UtcDatetime
    ended_at: UtcDatetime | None = None
    content_retention_seconds: JsonSafeInt

    @model_validator(mode="after")
    def lifecycle_integrity(self) -> "ConversationRecord":
        if self.expires_at <= self.created_at:
            raise ValueError("expiry must follow creation")
        if self.agent_snapshot.kind != "agent" or self.agent_snapshot.environment != self.environment:
            raise ValueError("conversation pin must identify an agent in the same environment")
        if self.status == "ended" and (
            self.ended_at is None or not self.created_at <= self.ended_at < self.expires_at
        ):
            raise ValueError("ended conversation requires an end time before expiry")
        if self.status != "ended" and self.ended_at is not None:
            raise ValueError("only ended conversations have an ended_at timestamp")
        return self


class ConversationView(ContractModel):
    id: OpaqueId
    schema_version: Literal[1] = 1
    status: Literal["active"] = "active"
    revision: JsonSafeInt
    agent_release_id: OpaqueId
    display_name: NonEmptyText | None
    active_activity: ActivityView | None
    created_at: UtcDatetime
    expires_at: UtcDatetime
    current_result: CurrentResultRef | None = None

    @model_validator(mode="after")
    def child_membership(self) -> "ConversationView":
        if self.expires_at <= self.created_at:
            raise ValueError("expiry must follow creation")
        if self.active_activity and self.active_activity.conversation_id != self.id:
            raise ValueError("active activity must belong to this conversation")
        if self.current_result and (not self.active_activity or self.current_result != self.active_activity.result):
            raise ValueError("current result must match the active activity")
        return self


class ClosedConversationAcknowledgement(ContractModel):
    conversation_id: OpaqueId
    status: Literal["ended", "expired"]
    revision: JsonSafeInt
    closed_at: UtcDatetime
    expires_at: UtcDatetime

    @model_validator(mode="after")
    def effective_close(self) -> "ClosedConversationAcknowledgement":
        if self.status == "expired" and self.closed_at != self.expires_at:
            raise ValueError("expired closure must use the original expiry time")
        if self.status == "ended" and self.closed_at >= self.expires_at:
            raise ValueError("ended closure must occur before expiry")
        return self
