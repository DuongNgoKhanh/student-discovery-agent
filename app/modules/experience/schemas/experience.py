"""
Pydantic schemas for Experience metadata, Drafts, and Immutable Releases.
Aligned with docs/openapi/experience-api.yaml and docs/openapi/experience-release-api.yaml.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class DraftRef(BaseModel):
    model_config = ConfigDict(extra="allow")

    draft_id: str
    revision: int
    content_hash: str


class ExperienceMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    revision: int
    name: str
    description: Optional[str] = None
    activity_type: str = "personality_assessment"
    created_at: str
    updated_at: str
    draft_ref: Optional[DraftRef] = None


class ExperienceDraft(BaseModel):
    model_config = ConfigDict(extra="allow")

    experience_id: str
    draft_id: str
    revision: int
    content_hash: str
    content: Dict[str, Any] = Field(default_factory=dict)
    updated_by: str
    updated_at: str


class SaveDraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=0)
    idempotency_key: str = Field(min_length=1)
    content: Dict[str, Any] = Field(default_factory=dict)


class CreateExperienceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    description: Optional[str] = None
    activity_type: str = "personality_assessment"
    idempotency_key: str = Field(min_length=1)


class ExperienceRelease(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    experience_id: str
    definition_version: str
    definition_hash: str
    definition_schema_version: str = "1.0"
    engine_version: str = "career-assessment-v1"
    is_demo: bool = False
    configuration: Dict[str, Any] = Field(default_factory=dict)
    approval_refs: List[str] = Field(default_factory=list)
    published_by: str
    published_at: str


class PublishReleaseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=0)
    content_hash: str
    validation_id: str
    evaluation_id: str
    approval_refs: List[str] = Field(default_factory=list)
    idempotency_key: str


class ActiveReleasePointer(BaseModel):
    model_config = ConfigDict(extra="allow")

    experience_id: str
    environment: str
    revision: int
    release_id: Optional[str] = None
    updated_at: str


class ActivateReleaseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    environment: str
    expected_revision: int
    expected_active_release_id: Optional[str] = None
    idempotency_key: str

