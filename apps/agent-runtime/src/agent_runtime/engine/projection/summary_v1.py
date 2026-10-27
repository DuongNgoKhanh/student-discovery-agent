"""summary.v1 card and share projection (Task C-04 / M-CRD).

Conforms to:
- SRS FR-CRD-01/03/04: PersonalityCard and ShareCard come verbatim from the pinned winning House metadata;
  missing or malformed metadata fails with MissingMappingError(INVALID_HOUSE_REF).
- DEC-02 baseline: ShareCard is a closed allowlist (name, House, branding, demo label); no scores, answers
  or bounds. Template, branding and demo label belong to this projection version: changing them requires
  a new projection version, never a runtime setting.
- FR-ENG-05: pure deterministic functions shared by runtime, preview and evaluation (no DB, no provider,
  no clock, no random ids).
"""

from typing import Any, Mapping

from pydantic import ValidationError

from agent_runtime.engine.error_codes import EngineErrorCode
from agent_runtime.engine.exceptions import EngineError, MissingMappingError, UnsupportedDefinitionError
from agent_runtime.engine.schemas.scoring import AssessmentScoringResult
from agent_runtime.evaluations.schemas.experience import AssessmentHouseMetadata
from agent_runtime.sessions.schemas.activity import PersonalityCardBlock
from agent_runtime.sessions.schemas.result import HouseIdentity, PersonalityCardData, ShareCard

SUMMARY_V1_TEMPLATE_REF = "share_summary_v1"
SUMMARY_V1_BRANDING = {"brand_ref": "ihrd", "label": "IHRD"}
SUMMARY_V1_DEMO_LABEL = "Minh họa — chưa thẩm định"

HouseInput = Mapping[str, Any] | AssessmentHouseMetadata


def project_personality_card(*, house: HouseInput, display_name: str, is_demo: bool) -> PersonalityCardData:
    """Project the winning House metadata into the PersonalityCard.

    Raises:
        EngineError: If display_name is not a non-blank string (VAL_INVALID_FIELD).
        MissingMappingError: If the house metadata is incomplete or malformed (VAL_INVALID_HOUSE_REF).
    """
    name = _display_name(display_name)
    try:
        # Model inputs are re-validated too: one constructed without validation must not slip through.
        source = house.model_dump() if isinstance(house, AssessmentHouseMetadata) else dict(house)
        metadata = AssessmentHouseMetadata.model_validate(source)
        return PersonalityCardData(
            display_name=name,
            house=HouseIdentity(
                house_id=metadata.house_id,
                name=metadata.name,
                theme_ref=metadata.theme_ref,
                mascot_ref=metadata.mascot_ref,
            ),
            strengths=tuple(metadata.strengths),
            tendencies=tuple(metadata.tendencies),
            career_groups=tuple(metadata.suggested_fields),
            quote=metadata.quote,
            is_demo=is_demo,
        )
    except (ValidationError, TypeError, ValueError) as error:
        raise MissingMappingError(
            f"House metadata cannot be projected: {error}", code=EngineErrorCode.INVALID_HOUSE_REF
        ) from error


def project_share_card(
    *,
    house: HouseInput | HouseIdentity,
    display_name: str,
    is_demo: bool,
    result_id: str,
    result_revision: int,
    activity_id: str,
) -> ShareCard:
    """Project the DEC-02 closed-allowlist ShareCard.

    Raw house metadata goes through the full card projection, so a share never exists for a House whose
    card could not be made.

    Raises:
        EngineError: If display_name is not a non-blank string (VAL_INVALID_FIELD).
        MissingMappingError: If the house metadata is incomplete or malformed (VAL_INVALID_HOUSE_REF).
        ValidationError: If result_id, result_revision or activity_id break the ShareCard contract.
    """
    name = _display_name(display_name)
    if isinstance(house, HouseIdentity):
        identity = house
    else:
        identity = project_personality_card(house=house, display_name=name, is_demo=is_demo).house
    return ShareCard(
        result_id=result_id,
        result_revision=result_revision,
        activity_id=activity_id,
        display_name=name,
        house=identity,
        branding=SUMMARY_V1_BRANDING,
        is_demo=is_demo,
        demo_label=SUMMARY_V1_DEMO_LABEL if is_demo else None,
        template_ref=SUMMARY_V1_TEMPLATE_REF,
    )


def project_summary_v1(
    *,
    house: HouseInput,
    display_name: str,
    is_demo: bool,
    result_id: str,
    result_revision: int,
    activity_id: str,
) -> tuple[PersonalityCardData, ShareCard]:
    """Project the winning house metadata into the PersonalityCard and its summary.v1 ShareCard.

    Raises:
        EngineError: If display_name is not a non-blank string (VAL_INVALID_FIELD).
        MissingMappingError: If the house metadata is incomplete or malformed (VAL_INVALID_HOUSE_REF).
    """
    card = project_personality_card(house=house, display_name=display_name, is_demo=is_demo)
    share = project_share_card(
        house=card.house,
        display_name=card.display_name,
        is_demo=is_demo,
        result_id=result_id,
        result_revision=result_revision,
        activity_id=activity_id,
    )
    return card, share


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
    """Resolve the winning House from a scoring result and the pinned definition, then project summary.v1.

    Checks run in the same order as EngineCompletionPort so both paths fail the same way.

    Raises:
        EngineError: If scoring is malformed (VAL_INVALID_FIELD) or not complete.
        UnsupportedDefinitionError: If scoring has no primary House (legacy v1 definitions).
        MissingMappingError: If the winning House is not in the definition or its metadata is malformed.
    """
    try:
        result = AssessmentScoringResult.model_validate(scoring)
    except ValidationError as error:
        raise EngineError(f"Scoring result is malformed: {error}", code=EngineErrorCode.INVALID_FIELD) from error
    if result.primary_house_id is None:
        raise UnsupportedDefinitionError("Scoring result contains no primary winning house")
    if not result.is_complete:
        raise EngineError("Cannot project card from incomplete scoring result")

    houses = definition.get("houses") if isinstance(definition, Mapping) else None
    candidates = houses if isinstance(houses, list) else ()
    house = next(
        (h for h in candidates if isinstance(h, Mapping) and h.get("house_id") == result.primary_house_id), None
    )
    if house is None:
        raise MissingMappingError(
            f"Winning house '{result.primary_house_id}' is missing from the pinned definition",
            code=EngineErrorCode.INVALID_HOUSE_REF,
        )
    return project_summary_v1(
        house=house,
        display_name=display_name,
        is_demo=is_demo,
        result_id=result_id,
        result_revision=result_revision,
        activity_id=activity_id,
    )


def project_card_block(
    *,
    card: PersonalityCardData,
    block_id: str,
    activity_id: str,
    result_id: str,
    result_revision: int,
) -> PersonalityCardBlock:
    """Wrap a projected card in its typed personality_card block; the caller owns block_id.

    Raises:
        ValidationError: If an id or result_revision breaks the block contract.
    """
    return PersonalityCardBlock(
        block_id=block_id,
        type="personality_card",
        schema_version=1,
        activity_id=activity_id,
        result_id=result_id,
        result_revision=result_revision,
        data=card,
    )


def _display_name(display_name: str) -> str:
    name = display_name.strip() if isinstance(display_name, str) else ""
    if not name:
        raise EngineError("display_name must be a non-blank string", code=EngineErrorCode.INVALID_FIELD)
    return name
