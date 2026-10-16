"""
Experience API Routes conforming directly to:
- docs/openapi/experience-api.yaml
- docs/openapi/experience-release-api.yaml
Prefix: /admin
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.constants.messages import MessageConstants
from app.db import get_db
from app.modules.admin.utils.auth import get_admin_user
from app.modules.common.schemas.common import ApiResponse
from app.modules.common.utils.logging import logger
from app.modules.experience.crud.experience_draft import (
    DEFAULT_EXPERIENCE_ID,
    get_experience_draft,
    get_experience_metadata,
    get_or_create_default_experience,
    save_experience_draft,
)
from app.modules.experience.crud.experience_release import (
    create_release_snapshot,
    get_active_release_pointer,
    get_experience_release,
    list_experience_releases,
)
from app.modules.experience.schemas.experience import (
    ActiveReleasePointer,
    ExperienceDraft,
    ExperienceMetadata,
    ExperienceRelease,
    SaveDraftInput,
)

router = APIRouter(tags=["Studio Experiences & Releases"])


@router.get("/admin/experiences", response_model=ApiResponse[List[ExperienceMetadata]])
def list_experiences(
    response: Response,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin_user),
):
    """
    List experiences (currently returns the default personality assessment experience).
    """
    response.headers["Cache-Control"] = "no-store"
    exp = get_or_create_default_experience(db)
    meta = get_experience_metadata(db, exp.id)
    return ApiResponse(
        success=True,
        message=MessageConstants.OPERATION_SUCCESSFUL,
        data=[meta] if meta else [],
    )


@router.get("/admin/experiences/{id}", response_model=ApiResponse[ExperienceMetadata])
def read_experience(
    id: str,
    response: Response,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin_user),
):
    """
    Read experience metadata and current draft summary.
    """
    response.headers["Cache-Control"] = "no-store"
    meta = get_experience_metadata(db, id)
    if not meta:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "EXPERIENCE_NOT_FOUND", "message": f"Experience '{id}' not found"},
        )
    return ApiResponse(
        success=True,
        message=MessageConstants.OPERATION_SUCCESSFUL,
        data=meta,
    )


@router.get("/admin/experiences/{id}/draft", response_model=ApiResponse[ExperienceDraft])
def read_experience_draft(
    id: str,
    response: Response,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin_user),
):
    """
    Read the current draft of an experience.
    """
    response.headers["Cache-Control"] = "no-store"
    # Ensure default experience exists if querying default ID
    if id == DEFAULT_EXPERIENCE_ID:
        get_or_create_default_experience(db)

    draft = get_experience_draft(db, id)
    if not draft:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "DRAFT_NOT_FOUND", "message": f"Draft for experience '{id}' not found"},
        )
    return ApiResponse(
        success=True,
        message=MessageConstants.OPERATION_SUCCESSFUL,
        data=draft,
    )


@router.put("/admin/experiences/{id}/draft", response_model=ApiResponse[ExperienceDraft])
def save_draft(
    id: str,
    payload: SaveDraftInput,
    response: Response,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin_user),
):
    """
    Save draft with optimistic revision locking (QT-03) and idempotency (QT-04).
    Allow incomplete JSON object draft, reject malformed input.
    """
    response.headers["Cache-Control"] = "no-store"
    if id == DEFAULT_EXPERIENCE_ID:
        get_or_create_default_experience(db)

    user_id = admin.get("sub", "admin")
    saved_draft = save_experience_draft(
        db=db,
        experience_id=id,
        expected_revision=payload.expected_revision,
        idempotency_key=payload.idempotency_key,
        content=payload.content,
        user_id=user_id,
    )
    return ApiResponse(
        success=True,
        message=MessageConstants.OPERATION_SUCCESSFUL,
        data=saved_draft,
    )


@router.get("/admin/experience-releases/{release_id}", response_model=ApiResponse[ExperienceRelease])
def read_experience_release(
    release_id: str,
    response: Response,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin_user),
):
    """
    Read immutable release snapshot (FR-CFG-05).
    """
    response.headers["Cache-Control"] = "no-store"
    rel = get_experience_release(db, release_id)
    if not rel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error_code": "RELEASE_NOT_FOUND", "message": f"Release '{release_id}' not found"},
        )
    return ApiResponse(
        success=True,
        message=MessageConstants.OPERATION_SUCCESSFUL,
        data=rel,
    )


@router.get("/admin/experiences/{id}/releases", response_model=ApiResponse[List[ExperienceRelease]])
def list_releases(
    id: str,
    response: Response,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin_user),
):
    """
    List published releases of an experience.
    """
    response.headers["Cache-Control"] = "no-store"
    releases = list_experience_releases(db, id, limit=limit, cursor=cursor)
    return ApiResponse(
        success=True,
        message=MessageConstants.OPERATION_SUCCESSFUL,
        data=releases,
    )


@router.get("/admin/experiences/{id}/active-release", response_model=ApiResponse[ActiveReleasePointer])
def read_active_release(
    id: str,
    environment: str = Query(..., pattern="^[A-Za-z0-9._-]+$"),
    response: Response = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_admin_user),
):
    """
    Read active pointer by environment (e.g. demo, production).
    """
    if response:
        response.headers["Cache-Control"] = "no-store"
    ptr = get_active_release_pointer(db, id, environment)
    return ApiResponse(
        success=True,
        message=MessageConstants.OPERATION_SUCCESSFUL,
        data=ptr,
    )
