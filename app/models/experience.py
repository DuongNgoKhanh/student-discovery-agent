"""
SQLModel database models for Experience, Drafts, Immutable Releases and Active Pointers.
Aligned with docs/openapi/experience-api.yaml and docs/openapi/experience-release-api.yaml.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
import pytz
from sqlalchemy import JSON, BigInteger, Boolean, Column, DateTime, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


# JSON column type compatible with PostgreSQL (JSONB) and SQLite (JSON)
JsonType = JSON().with_variant(JSONB, "postgresql")


def get_current_time_vn() -> datetime:
    return datetime.now(pytz.timezone("Asia/Ho_Chi_Minh"))


class Experience(SQLModel, table=True):
    """
    Experience metadata model.
    Tracks overall experience identity and monotonic metadata revision.
    """
    __tablename__ = "experiences"

    id: str = Field(
        sa_column=Column(String(64), primary_key=True),
        description="Experience identifier, e.g. exp_personality_v1",
    )
    revision: int = Field(
        default=1,
        sa_column=Column(BigInteger, nullable=False, default=1),
        description="Monotonic revision counter for metadata",
    )
    name: str = Field(
        sa_column=Column(String(255), nullable=False),
        description="Name of experience",
    )
    description: Optional[str] = Field(
        default=None,
        sa_column=Column(String(1000)),
        description="Description of experience",
    )
    activity_type: str = Field(
        default="personality_assessment",
        sa_column=Column(String(64), nullable=False),
        description="Registered activity/engine type, e.g. personality_assessment",
    )
    created_at: datetime = Field(
        default_factory=get_current_time_vn,
        sa_column=Column(DateTime(timezone=True), server_default=func.now(), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=get_current_time_vn,
        sa_column=Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
    )


class ExperienceDraft(SQLModel, table=True):
    """
    Current draft for an experience.
    Allows incomplete definition content. Revision guard (QT-03) enforced on updates.
    """
    __tablename__ = "experience_drafts"

    id: str = Field(
        sa_column=Column(String(64), primary_key=True),
        description="Draft identifier, e.g. draft_01J...",
    )
    experience_id: str = Field(
        sa_column=Column(String(64), nullable=False, index=True),
        description="Target experience ID",
    )
    revision: int = Field(
        default=1,
        sa_column=Column(BigInteger, nullable=False, default=1),
        description="Draft revision counter (monotonic increment on save)",
    )
    content_hash: str = Field(
        sa_column=Column(String(128), nullable=False),
        description="RFC 8785 canonical sha256 hash: sha256:<hex>",
    )
    content: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JsonType, nullable=False),
        description="Draft JSON payload (can be partial/incomplete definition)",
    )
    updated_by: str = Field(
        default="system",
        sa_column=Column(String(64), nullable=False),
        description="User/Admin identifier who updated this draft",
    )
    updated_at: datetime = Field(
        default_factory=get_current_time_vn,
        sa_column=Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
    )


class ExperienceRelease(SQLModel, table=True):
    """
    Immutable release snapshot.
    Once created via publish, records must NEVER be updated or deleted.
    """
    __tablename__ = "experience_releases"

    id: str = Field(
        sa_column=Column(String(64), primary_key=True),
        description="Release identifier, e.g. rel_01J...",
    )
    experience_id: str = Field(
        sa_column=Column(String(64), nullable=False, index=True),
        description="Target experience ID",
    )
    definition_version: str = Field(
        sa_column=Column(String(64), nullable=False),
        description="Semantic or business definition version",
    )
    definition_hash: str = Field(
        sa_column=Column(String(128), nullable=False),
        description="RFC 8785 canonical sha256 hash of configuration snapshot",
    )
    definition_schema_version: str = Field(
        default="1.0",
        sa_column=Column(String(32), nullable=False),
        description="Schema version, e.g. 1.0",
    )
    engine_version: str = Field(
        default="career-assessment-v1",
        sa_column=Column(String(64), nullable=False),
        description="Compatible execution engine version",
    )
    is_demo: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
        description="True if this is a demo/pilot release",
    )
    configuration: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JsonType, nullable=False),
        description="Immutable frozen JSON definition snapshot",
    )
    approval_refs: List[str] = Field(
        default_factory=list,
        sa_column=Column(JsonType, nullable=False),
        description="Auditable approval reference identifiers",
    )
    published_by: str = Field(
        sa_column=Column(String(64), nullable=False),
        description="Admin who published this release",
    )
    published_at: datetime = Field(
        default_factory=get_current_time_vn,
        sa_column=Column(DateTime(timezone=True), server_default=func.now(), nullable=False),
    )


class ActiveReleasePointer(SQLModel, table=True):
    """
    Active release pointer for a given environment (e.g. demo, production).
    Monotonically updated via atomic pointer revision check (QT-03, QT-06).
    """
    __tablename__ = "active_release_pointers"

    id: str = Field(
        sa_column=Column(String(64), primary_key=True),
        description="Pointer ID, e.g. ptr_exp_personality_v1_demo",
    )
    experience_id: str = Field(
        sa_column=Column(String(64), nullable=False, index=True),
    )
    environment: str = Field(
        sa_column=Column(String(32), nullable=False),
        description="Environment: demo, production, staging",
    )
    revision: int = Field(
        default=1,
        sa_column=Column(BigInteger, nullable=False, default=1),
        description="Monotonic revision counter for pointer",
    )
    release_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
        description="Target active release ID",
    )
    updated_at: datetime = Field(
        default_factory=get_current_time_vn,
        sa_column=Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False),
    )


class IdempotencyRecord(SQLModel, table=True):
    """
    Idempotency store for handling QT-04 idempotency replay/collision.
    """
    __tablename__ = "idempotency_records"

    id: str = Field(
        sa_column=Column(String(128), primary_key=True),
        description="Composite key: scope + idempotency_key",
    )
    scope: str = Field(
        sa_column=Column(String(64), nullable=False, index=True),
        description="Scope or endpoint",
    )
    idempotency_key: str = Field(
        sa_column=Column(String(128), nullable=False, index=True),
    )
    request_hash: str = Field(
        sa_column=Column(String(128), nullable=False),
        description="Hash of request body to detect collisions",
    )
    response_data: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JsonType, nullable=False),
        description="Saved response envelope data",
    )
    created_at: datetime = Field(
        default_factory=get_current_time_vn,
        sa_column=Column(DateTime(timezone=True), server_default=func.now(), nullable=False),
    )
