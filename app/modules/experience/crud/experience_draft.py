"""
CRUD operations for Experience metadata and Drafts with Optimistic Revision Guard (QT-03)
and Idempotency handling (QT-04).
"""

from datetime import datetime
from typing import Any, Dict, Optional, Tuple
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlmodel import select

from app.models.experience import (
    ActiveReleasePointer,
    Experience,
    ExperienceDraft,
    IdempotencyRecord,
    get_current_time_vn,
)
from app.modules.common.utils.canonical_json import compute_content_hash
from app.modules.common.utils.logging import logger
from app.modules.experience.schemas.experience import DraftRef, ExperienceDraft as ExperienceDraftSchema, ExperienceMetadata


DEFAULT_EXPERIENCE_ID = "exp_personality_v1"


def get_or_create_default_experience(db: Session) -> Experience:
    """Ensures a baseline experience exists."""
    exp = db.exec(select(Experience).where(Experience.id == DEFAULT_EXPERIENCE_ID)).first()
    if not exp:
        exp = Experience(
            id=DEFAULT_EXPERIENCE_ID,
            revision=1,
            name="Trắc nghiệm Tính cách & Hướng nghiệp ĐBSCL",
            description="Đánh giá sở thích nghề nghiệp và đặc tính cá nhân dành cho học sinh THPT",
            activity_type="personality_assessment",
            created_at=get_current_time_vn(),
            updated_at=get_current_time_vn(),
        )
        db.add(exp)
        db.commit()
        db.refresh(exp)

    # Also ensure initial draft exists
    draft = db.exec(select(ExperienceDraft).where(ExperienceDraft.experience_id == exp.id)).first()
    if not draft:
        initial_content: Dict[str, Any] = {"questions": []}
        content_hash = compute_content_hash(initial_content)
        draft = ExperienceDraft(
            id=f"draft_{exp.id}",
            experience_id=exp.id,
            revision=1,
            content_hash=content_hash,
            content=initial_content,
            updated_by="system",
            updated_at=get_current_time_vn(),
        )
        db.add(draft)
        db.commit()
        db.refresh(draft)

    return exp


def get_experience_metadata(db: Session, experience_id: str) -> Optional[ExperienceMetadata]:
    """Retrieve experience metadata with current draft reference."""
    exp = db.exec(select(Experience).where(Experience.id == experience_id)).first()
    if not exp:
        return None

    draft = db.exec(select(ExperienceDraft).where(ExperienceDraft.experience_id == experience_id)).first()
    draft_ref = None
    if draft:
        draft_ref = DraftRef(
            draft_id=draft.id,
            revision=draft.revision,
            content_hash=draft.content_hash,
        )

    return ExperienceMetadata(
        id=exp.id,
        revision=exp.revision,
        name=exp.name,
        description=exp.description,
        activity_type=exp.activity_type,
        created_at=exp.created_at.isoformat(),
        updated_at=exp.updated_at.isoformat(),
        draft_ref=draft_ref,
    )


def get_experience_draft(db: Session, experience_id: str) -> Optional[ExperienceDraftSchema]:
    """Retrieve current experience draft."""
    draft = db.exec(select(ExperienceDraft).where(ExperienceDraft.experience_id == experience_id)).first()
    if not draft:
        return None

    return ExperienceDraftSchema(
        experience_id=draft.experience_id,
        draft_id=draft.id,
        revision=draft.revision,
        content_hash=draft.content_hash,
        content=draft.content,
        updated_by=draft.updated_by,
        updated_at=draft.updated_at.isoformat(),
    )


def save_experience_draft(
    db: Session,
    experience_id: str,
    expected_revision: int,
    idempotency_key: str,
    content: Dict[str, Any],
    user_id: str = "admin",
) -> ExperienceDraftSchema:
    """
    Saves an experience draft with strict optimistic revision lock (QT-03)
    and idempotency handling (QT-04).
    """
    # 1. Check Idempotency (QT-04)
    scope = f"save_draft:{experience_id}"
    idem_id = f"{scope}:{idempotency_key}"
    req_hash = compute_content_hash({"expected_revision": expected_revision, "content": content})

    existing_idem = db.exec(select(IdempotencyRecord).where(IdempotencyRecord.id == idem_id)).first()
    if existing_idem:
        if existing_idem.request_hash == req_hash:
            logger.info(f"Idempotent replay detected for key {idempotency_key}")
            return ExperienceDraftSchema(**existing_idem.response_data)
        else:
            logger.warning(f"Idempotency collision for key {idempotency_key}")
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error_code": "IDEMPOTENCY_COLLISION",
                    "message": "Idempotency key reused with conflicting payload",
                },
            )

    # 2. Fetch current draft
    draft = db.exec(select(ExperienceDraft).where(ExperienceDraft.experience_id == experience_id)).first()
    if not draft:
        # If experience exists, create initial draft
        exp = db.exec(select(Experience).where(Experience.id == experience_id)).first()
        if not exp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error_code": "RESOURCE_NOT_FOUND", "message": f"Experience '{experience_id}' not found"},
            )
        draft = ExperienceDraft(
            id=f"draft_{experience_id}",
            experience_id=experience_id,
            revision=0,
            content_hash="",
            content={},
            updated_by=user_id,
        )

    # 3. Check expected revision (QT-03 Revision Guard)
    if draft.revision != expected_revision:
        logger.warning(
            f"Revision conflict for draft '{draft.id}': expected {expected_revision}, current {draft.revision}"
        )
        current_data = ExperienceDraftSchema(
            experience_id=draft.experience_id,
            draft_id=draft.id,
            revision=draft.revision,
            content_hash=draft.content_hash,
            content=draft.content,
            updated_by=draft.updated_by,
            updated_at=draft.updated_at.isoformat(),
        ).model_dump()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_code": "REVISION_CONFLICT",
                "message": f"Revision conflict: draft has revision {draft.revision}, but {expected_revision} was expected",
                "current_state": current_data,
            },
        )

    # 4. Compute new RFC 8785 content hash and increment revision
    new_hash = compute_content_hash(content)
    draft.content = content
    draft.content_hash = new_hash
    draft.revision += 1
    draft.updated_by = user_id
    draft.updated_at = get_current_time_vn()

    db.add(draft)

    # Construct response
    res_schema = ExperienceDraftSchema(
        experience_id=draft.experience_id,
        draft_id=draft.id,
        revision=draft.revision,
        content_hash=draft.content_hash,
        content=draft.content,
        updated_by=draft.updated_by,
        updated_at=draft.updated_at.isoformat(),
    )

    # Record idempotency
    idem_rec = IdempotencyRecord(
        id=idem_id,
        scope=scope,
        idempotency_key=idempotency_key,
        request_hash=req_hash,
        response_data=res_schema.model_dump(),
        created_at=get_current_time_vn(),
    )
    db.add(idem_rec)

    db.commit()
    db.refresh(draft)

    logger.info(f"Successfully saved draft '{draft.id}' to revision {draft.revision} with hash {new_hash}")
    return res_schema

