"""summary.v1 card and share projection (Task C-04 / M-CRD).

Conforms to:
- SRS FR-CRD-01/03/04: PersonalityCard and ShareCard projected from winning House metadata.
- DEC-02 baseline: ShareCard is a strict closed allowlist (name, House, branding, demo label).
  Strictly NO internal scores, raw answers, bounds, or extra fields (additionalProperties: false).
  Template ('share_summary_v1'), branding ('IHRD' / 'ihrd'), and demo label ('Minh họa — chưa thẩm định')
  belong to this projection version (summary.v1).
- DEC-04 & Section 7.3: Full coverage for all 6 Holland RIASEC Houses (R, I, A, S, E, C).
- AT-10/15/16: Reversibility, invalidation safety, allowlist invariants, and demo flag rules.
- FR-ENG-05: Pure deterministic functions shared by runtime, preview, and evaluation (no DB, no provider).
"""

from typing import Any, Mapping
from uuid import uuid4

from pydantic import ValidationError

from agent_runtime.engine.error_codes import EngineErrorCode
from agent_runtime.engine.exceptions import EngineError, MissingMappingError, UnsupportedDefinitionError
from agent_runtime.engine.schemas.scoring import AssessmentScoringResult
from agent_runtime.evaluations.schemas.experience import AssessmentHouseMetadata
from agent_runtime.sessions.schemas.activity import PersonalityCardBlock
from agent_runtime.sessions.schemas.result import HouseIdentity, PersonalityCardData, ShareBranding, ShareCard

SUMMARY_V1_TEMPLATE_REF = "share_summary_v1"
SUMMARY_V1_BRANDING = {"brand_ref": "ihrd", "label": "IHRD"}
SUMMARY_V1_DEMO_LABEL = "Minh họa — chưa thẩm định"


def _normalize_display_name(display_name: str) -> str:
    """Normalize and validate display name.

    Raises:
        ValueError: If display_name is empty or consists solely of whitespace.
    """
    if not isinstance(display_name, str):
        raise ValueError(f"display_name must be a string, got {type(display_name).__name__}")
    normalized = display_name.strip()
    if not normalized:
        raise ValueError("display_name must not be empty or whitespace")
    return normalized


def _extract_house_metadata(
    house: Mapping[str, Any] | AssessmentHouseMetadata,
) -> AssessmentHouseMetadata:
    """Validate and extract AssessmentHouseMetadata from a mapping or existing model.

    Raises:
        MissingMappingError: If the house metadata is incomplete or malformed.
    """
    try:
        if isinstance(house, AssessmentHouseMetadata):
            metadata = house
        elif isinstance(house, Mapping):
            metadata = AssessmentHouseMetadata.model_validate(dict(house))
        else:
            raise TypeError(f"Expected mapping or AssessmentHouseMetadata, got {type(house).__name__}")

        # Extra domain-level check for empty lists or blank strings
        if not metadata.strengths or any(not s.strip() for s in metadata.strengths if isinstance(s, str)):
            raise ValueError("strengths must be non-empty and contain non-blank items")
        if not metadata.tendencies or any(not t.strip() for t in metadata.tendencies if isinstance(t, str)):
            raise ValueError("tendencies must be non-empty and contain non-blank items")
        if not metadata.suggested_fields or any(not f.strip() for f in metadata.suggested_fields if isinstance(f, str)):
            raise ValueError("suggested_fields must be non-empty and contain non-blank items")
        if not metadata.quote.strip():
            raise ValueError("quote must not be blank")

        return metadata
    except (ValidationError, TypeError, ValueError) as error:
        raise MissingMappingError(
            f"House metadata cannot be projected: {error}",
            code=EngineErrorCode.INVALID_HOUSE_REF,
        ) from error


def project_personality_card(
    *,
    house: Mapping[str, Any] | AssessmentHouseMetadata,
    display_name: str,
    is_demo: bool,
) -> PersonalityCardData:
    """Project House metadata into PersonalityCardData.

    Args:
        house: House metadata dictionary or AssessmentHouseMetadata model.
        display_name: Student display name.
        is_demo: Whether this assessment is in demo mode.

    Returns:
        PersonalityCardData with complete 6-House fields.

    Raises:
        MissingMappingError: If metadata is incomplete or malformed.
        ValueError: If display_name is invalid.
    """
    name = _normalize_display_name(display_name)
    metadata = _extract_house_metadata(house)

    identity = HouseIdentity(
        house_id=metadata.house_id,
        name=metadata.name,
        theme_ref=metadata.theme_ref,
        mascot_ref=metadata.mascot_ref,
    )
    return PersonalityCardData(
        display_name=name,
        house=identity,
        strengths=tuple(metadata.strengths),
        tendencies=tuple(metadata.tendencies),
        career_groups=tuple(metadata.suggested_fields),
        quote=metadata.quote,
        is_demo=is_demo,
    )


def project_share_card(
    *,
    house: Mapping[str, Any] | AssessmentHouseMetadata | HouseIdentity,
    display_name: str,
    is_demo: bool,
    result_id: str,
    result_revision: int,
    activity_id: str,
) -> ShareCard:
    """Project House metadata into DEC-02 closed allowlist ShareCard.

    Args:
        house: House metadata dictionary, AssessmentHouseMetadata, or HouseIdentity.
        display_name: Student display name.
        is_demo: Whether this card is in demo mode.
        result_id: Immutable result identifier.
        result_revision: Revision number of the result snapshot.
        activity_id: Activity identifier.

    Returns:
        ShareCard strictly adhering to closed allowlist (DEC-02).
        Contains NO internal scores, raw answers, bounds, or extra fields.

    Raises:
        MissingMappingError: If metadata is incomplete or malformed.
        ValueError: If parameters violate contract constraints.
    """
    name = _normalize_display_name(display_name)

    if isinstance(house, HouseIdentity):
        identity = house
    else:
        metadata = _extract_house_metadata(house)
        identity = HouseIdentity(
            house_id=metadata.house_id,
            name=metadata.name,
            theme_ref=metadata.theme_ref,
            mascot_ref=metadata.mascot_ref,
        )

    branding = ShareBranding.model_validate(SUMMARY_V1_BRANDING)
    demo_label = SUMMARY_V1_DEMO_LABEL if is_demo else None

    return ShareCard(
        schema_version=1,
        projection_version="summary.v1",
        result_id=result_id,
        result_revision=result_revision,
        activity_id=activity_id,
        display_name=name,
        house=identity,
        branding=branding,
        is_demo=is_demo,
        demo_label=demo_label,
        template_ref=SUMMARY_V1_TEMPLATE_REF,
    )


def project_card_block(
    *,
    card: PersonalityCardData,
    activity_id: str,
    result_id: str,
    result_revision: int,
    block_id: str | None = None,
) -> PersonalityCardBlock:
    """Wrap PersonalityCardData into a typed PersonalityCardBlock for message payloads.

    Args:
        card: Projected PersonalityCardData.
        activity_id: Activity identifier.
        result_id: Immutable result identifier.
        result_revision: Positive revision number.
        block_id: Optional unique block identifier (defaults to generated hex).

    Returns:
        PersonalityCardBlock conforming to OpenAPI typed-blocks specification.
    """
    return PersonalityCardBlock(
        block_id=block_id or f"blk_card_{uuid4().hex[:12]}",
        type="personality_card",
        schema_version=1,
        activity_id=activity_id,
        result_id=result_id,
        result_revision=result_revision,
        data=card,
    )


def project_summary_from_result(
    *,
    scoring: AssessmentScoringResult | Mapping[str, Any],
    definition: Mapping[str, Any],
    display_name: str,
    is_demo: bool,
    result_id: str,
    result_revision: int,
    activity_id: str,
) -> tuple[PersonalityCardData, ShareCard]:
    """Project cards directly from an AssessmentScoringResult and ExperienceDefinitionDocument.

    Args:
        scoring: Scoring result from ScoringEngine.calculate_scores.
        definition: Experience definition dictionary containing 'houses'.
        display_name: Student display name.
        is_demo: Whether this assessment is in demo mode.
        result_id: Unique result snapshot identifier.
        result_revision: Result revision number.
        activity_id: Activity identifier.

    Returns:
        A tuple of (PersonalityCardData, ShareCard).

    Raises:
        EngineError: If scoring is incomplete.
        UnsupportedDefinitionError: If definition has no primary winning house.
        MissingMappingError: If winning house is not found in definition metadata.
    """
    if isinstance(scoring, AssessmentScoringResult):
        if not scoring.is_complete:
            raise EngineError("Cannot project card from incomplete scoring result")
        primary_house_id = scoring.primary_house_id
    elif isinstance(scoring, Mapping):
        if not scoring.get("is_complete"):
            raise EngineError("Cannot project card from incomplete scoring result")
        primary_house_id = scoring.get("primary_house_id")
    else:
        raise TypeError(f"Expected AssessmentScoringResult or mapping, got {type(scoring).__name__}")

    if primary_house_id is None:
        raise UnsupportedDefinitionError("Scoring result contains no primary winning house")

    houses = definition.get("houses", ())
    target_house = next(
        (
            h
            for h in houses
            if (h.get("house_id") if isinstance(h, Mapping) else getattr(h, "house_id", None)) == primary_house_id
        ),
        None,
    )
    if target_house is None:
        raise MissingMappingError(
            f"Winning house '{primary_house_id}' is missing from the pinned definition",
            code=EngineErrorCode.INVALID_HOUSE_REF,
        )

    card = project_personality_card(house=target_house, display_name=display_name, is_demo=is_demo)
    share = project_share_card(
        house=card.house,
        display_name=display_name,
        is_demo=is_demo,
        result_id=result_id,
        result_revision=result_revision,
        activity_id=activity_id,
    )
    return card, share


def project_summary_v1(
    *,
    house: Mapping[str, Any] | AssessmentHouseMetadata | None = None,
    scoring: AssessmentScoringResult | Mapping[str, Any] | None = None,
    definition: Mapping[str, Any] | None = None,
    display_name: str,
    is_demo: bool,
    result_id: str,
    result_revision: int,
    activity_id: str,
) -> tuple[PersonalityCardData, ShareCard]:
    """Unified entrypoint to project summary.v1 PersonalityCard and ShareCard.

    Supports projection either from:
    1. Direct 'house' metadata mapping (preserving 100% backward compatibility with EngineCompletionPort).
    2. 'scoring' result and pinned 'definition' mapping.

    Raises:
        MissingMappingError: If metadata is incomplete or house cannot be resolved.
        EngineError: If scoring is incomplete or inconsistent.
        ValueError: If display_name is invalid.
    """
    if scoring is not None and definition is not None:
        return project_summary_from_result(
            scoring=scoring,
            definition=definition,
            display_name=display_name,
            is_demo=is_demo,
            result_id=result_id,
            result_revision=result_revision,
            activity_id=activity_id,
        )

    if house is not None:
        card = project_personality_card(house=house, display_name=display_name, is_demo=is_demo)
        share = project_share_card(
            house=card.house,
            display_name=display_name,
            is_demo=is_demo,
            result_id=result_id,
            result_revision=result_revision,
            activity_id=activity_id,
        )
        return card, share

    raise MissingMappingError(
        "Either 'house' or both 'scoring' and 'definition' must be provided to project summary.v1",
        code=EngineErrorCode.INVALID_HOUSE_REF,
    )
