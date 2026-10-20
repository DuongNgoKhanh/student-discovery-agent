"""Immutable Product delivery descriptors, separate from definition versions."""
from typing import Literal

from pydantic import model_validator

from .common import ContentHash, ContractModel, JsonObject, NonEmptyText, OpaqueId


class ReleaseKey(ContractModel):
    environment: NonEmptyText
    kind: Literal["agent", "experience"]
    release_id: OpaqueId


class AgentSnapshotV1(ContractModel):
    greeting_text: NonEmptyText
    allowed_activity_profiles: tuple[NonEmptyText, ...]

    @model_validator(mode="after")
    def unique_profiles(self) -> "AgentSnapshotV1":
        if len(set(self.allowed_activity_profiles)) != len(self.allowed_activity_profiles):
            raise ValueError("activity profiles must be unique")
        return self


class ReleaseDescriptor(ReleaseKey):
    content_hash: ContentHash
    delivery_schema_version: NonEmptyText
    content: JsonObject
    is_demo: bool
    definition_schema_version: NonEmptyText | None = None
    algorithm_profile: NonEmptyText | None = None
    engine_version: NonEmptyText | None = None

    @model_validator(mode="after")
    def validate_kind_metadata(self) -> "ReleaseDescriptor":
        if self.kind == "agent":
            if self.delivery_schema_version != "agent.snapshot.v1":
                raise ValueError("unsupported agent delivery schema")
            if any((self.definition_schema_version, self.algorithm_profile, self.engine_version)):
                raise ValueError("agent snapshot cannot carry experience metadata")
            AgentSnapshotV1.model_validate(self.content)
        elif self.definition_schema_version is None or self.engine_version is None:
            raise ValueError("experience requires definition and engine metadata")
        return self


class ValidatedRelease(ReleaseDescriptor):
    """Descriptor after hash/registry/policy validation by the release importer.

    Construction validates structure only; callers must use the importer for trust.
    """
