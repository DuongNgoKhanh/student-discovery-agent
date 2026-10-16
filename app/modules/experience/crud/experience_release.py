"""
CRUD operations for Immutable Experience Releases and Active Release Pointers.
Ensures published releases cannot be modified or deleted (QT-06, FR-CFG-05).
"""

from typing import Any, Dict, List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlmodel import select

from app.models.experience import (
    ActiveReleasePointer,
    Experience,
    ExperienceDraft,
    ExperienceRelease,
    IdempotencyRecord,
    get_current_time_vn,
)
from app.modules.common.utils.canonical_json import compute_content_hash
from app.modules.common.utils.logging import logger
from app.modules.experience.schemas.experience import (
    ActiveReleasePointer as ActiveReleasePointerSchema,
    ExperienceRelease as ExperienceReleaseSchema,
)


def get_experience_release(db: Session, release_id: str) -> Optional[ExperienceReleaseSchema]:
    """
    Read an immutable release snapshot by release_id.
    """
    rel = db.exec(select(ExperienceRelease).where(ExperienceRelease.id == release_id)).first()
    if not rel:
        return None

    return ExperienceReleaseSchema(
        id=rel.id,
        experience_id=rel.experience_id,
        definition_version=rel.definition_version,
        definition_hash=rel.definition_hash,
        definition_schema_version=rel.definition_schema_version,
        engine_version=rel.engine_version,
        is_demo=rel.is_demo,
        configuration=rel.configuration,
        approval_refs=rel.approval_refs,
        published_by=rel.published_by,
        published_at=rel.published_at.isoformat(),
    )


def list_experience_releases(
    db: Session, experience_id: str, limit: int = 50, cursor: Optional[str] = None
) -> List[ExperienceReleaseSchema]:
    """
    List published releases of an experience.
    """
    query = (
        select(ExperienceRelease)
        .where(ExperienceRelease.experience_id == experience_id)
        .order_by(ExperienceRelease.published_at.desc())
        .limit(limit)
    )
    records = db.exec(query).all()
    return [
        ExperienceReleaseSchema(
            id=r.id,
            experience_id=r.experience_id,
            definition_version=r.definition_version,
            definition_hash=r.definition_hash,
            definition_schema_version=r.definition_schema_version,
            engine_version=r.engine_version,
            is_demo=r.is_demo,
            configuration=r.configuration,
            approval_refs=r.approval_refs,
            published_by=r.published_by,
            published_at=r.published_at.isoformat(),
        )
        for r in records
    ]


def get_active_release_pointer(
    db: Session, experience_id: str, environment: str
) -> Optional[ActiveReleasePointerSchema]:
    """
    Get active pointer for a specific environment (e.g. demo, production).
    """
    ptr = db.exec(
        select(ActiveReleasePointer).where(
            ActiveReleasePointer.experience_id == experience_id,
            ActiveReleasePointer.environment == environment,
        )
    ).first()

    if not ptr:
        # Create default empty pointer
        ptr = ActiveReleasePointer(
            id=f"ptr_{experience_id}_{environment}",
            experience_id=experience_id,
            environment=environment,
            revision=1,
            release_id=None,
            updated_at=get_current_time_vn(),
        )
        db.add(ptr)
        db.commit()
        db.refresh(ptr)

    return ActiveReleasePointerSchema(
        experience_id=ptr.experience_id,
        environment=ptr.environment,
        revision=ptr.revision,
        release_id=ptr.release_id,
        updated_at=ptr.updated_at.isoformat(),
    )


def create_release_snapshot(
    db: Session,
    release_id: str,
    experience_id: str,
    definition_version: str,
    configuration: Dict[str, Any],
    published_by: str = "admin",
    is_demo: bool = False,
    engine_version: str = "career-assessment-v1",
    approval_refs: Optional[List[str]] = None,
) -> ExperienceReleaseSchema:
    """
    Creates an immutable release snapshot in the database.
    Once created, this snapshot can never be mutated or deleted.
    """
    # Check if release already exists
    existing = db.exec(select(ExperienceRelease).where(ExperienceRelease.id == release_id)).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error_code": "RESOURCE_EXISTS", "message": f"Release '{release_id}' already exists"},
        )

    content_hash = compute_content_hash(configuration)
    rel = ExperienceRelease(
        id=release_id,
        experience_id=experience_id,
        definition_version=definition_version,
        definition_hash=content_hash,
        definition_schema_version="1.0",
        engine_version=engine_version,
        is_demo=is_demo,
        configuration=configuration,
        approval_refs=approval_refs or [],
        published_by=published_by,
        published_at=get_current_time_vn(),
    )
    db.add(rel)
    db.commit()
    db.refresh(rel)

    logger.info(f"Published immutable release '{rel.id}' with hash {content_hash}")
    return ExperienceReleaseSchema(
        id=rel.id,
        experience_id=rel.experience_id,
        definition_version=rel.definition_version,
        definition_hash=rel.definition_hash,
        definition_schema_version=rel.definition_schema_version,
        engine_version=rel.engine_version,
        is_demo=rel.is_demo,
        configuration=rel.configuration,
        approval_refs=rel.approval_refs,
        published_by=rel.published_by,
        published_at=rel.published_at.isoformat(),
    )

