"""Public result/card projections only; scoring evidence belongs to the engine."""
from typing import Literal

from pydantic import model_validator

from .common import ContractModel, NonEmptyText, OpaqueId, PositiveRevision, UtcDatetime


class HouseIdentity(ContractModel):
    house_id: OpaqueId
    name: NonEmptyText
    theme_ref: OpaqueId
    mascot_ref: OpaqueId


class PersonalityCardData(ContractModel):
    display_name: NonEmptyText
    house: HouseIdentity
    strengths: tuple[NonEmptyText, ...]
    tendencies: tuple[NonEmptyText, ...]
    career_groups: tuple[NonEmptyText, ...]
    quote: NonEmptyText
    is_demo: bool

    @model_validator(mode="after")
    def nonempty_lists(self) -> "PersonalityCardData":
        if not self.strengths or not self.tendencies or not self.career_groups:
            raise ValueError("card lists must not be empty")
        return self


class ShareBranding(ContractModel):
    brand_ref: OpaqueId
    label: NonEmptyText


class ShareCard(ContractModel):
    schema_version: Literal[1] = 1
    projection_version: Literal["summary.v1"] = "summary.v1"
    result_id: OpaqueId
    result_revision: PositiveRevision
    activity_id: OpaqueId
    display_name: NonEmptyText
    house: HouseIdentity
    branding: ShareBranding
    is_demo: bool
    demo_label: NonEmptyText | None
    template_ref: OpaqueId

    @model_validator(mode="after")
    def demo_requires_label(self) -> "ShareCard":
        if self.is_demo and self.demo_label is None:
            raise ValueError("demo share card requires demo label")
        return self


class CurrentResultRef(ContractModel):
    result_id: OpaqueId
    result_revision: PositiveRevision
    validity: Literal["valid"] = "valid"


class ResultView(CurrentResultRef):
    schema_version: Literal[1] = 1
    conversation_id: OpaqueId
    activity_id: OpaqueId
    activity_type: Literal["personality_assessment", "personality_assessment_adaptive"]
    experience_release_id: OpaqueId
    created_at: UtcDatetime
    data: PersonalityCardData


class ResultSnapshotInput(ContractModel):
    result_id: OpaqueId
    activity_id: OpaqueId
    result_revision: PositiveRevision
    source_activity_revision: PositiveRevision
    result_projection: ResultView
    card_projection: PersonalityCardData
    share_projection: ShareCard

    @model_validator(mode="after")
    def consistent_generation(self) -> "ResultSnapshotInput":
        for projection in (self.result_projection, self.share_projection):
            if (projection.result_id, projection.activity_id, projection.result_revision) != (
                self.result_id, self.activity_id, self.result_revision
            ):
                raise ValueError("result projection references a different generation")
        if self.result_projection.data != self.card_projection:
            raise ValueError("card and result projections disagree")
        if (self.share_projection.display_name, self.share_projection.house, self.share_projection.is_demo) != (
            self.card_projection.display_name, self.card_projection.house, self.card_projection.is_demo
        ):
            raise ValueError("share and card projections disagree")
        return self


class StoredResult(ResultSnapshotInput):
    validity: Literal["valid", "superseded"]
    created_at: UtcDatetime
