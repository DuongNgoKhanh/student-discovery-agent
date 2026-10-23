"""summary.v1 card projection (Task C-04 / M-CRD).

Conforms to:
- SRS FR-CRD-01/03: card content comes verbatim from the pinned house metadata; missing metadata fails.
- DEC-02 baseline: ShareCard is a closed allowlist (name, House, branding, demo label); no scores, answers
  or bounds. Template, branding and demo label belong to this projection version: changing them requires
  a new projection version, never a runtime setting.
- FR-ENG-05: pure function shared by runtime, preview and evaluation (no DB, no provider).
"""

from typing import Any, Mapping

from pydantic import ValidationError

from agent_runtime.engine.error_codes import EngineErrorCode
from agent_runtime.engine.exceptions import MissingMappingError
from agent_runtime.evaluations.schemas.experience import AssessmentHouseMetadata
from agent_runtime.sessions.schemas.result import PersonalityCardData, ShareCard

SUMMARY_V1_TEMPLATE_REF = "share_summary_v1"
SUMMARY_V1_BRANDING = {"brand_ref": "ihrd", "label": "IHRD"}
SUMMARY_V1_DEMO_LABEL = "Minh họa — chưa thẩm định"


def project_summary_v1(
    *,
    house: Mapping[str, Any],
    display_name: str,
    is_demo: bool,
    result_id: str,
    result_revision: int,
    activity_id: str,
) -> tuple[PersonalityCardData, ShareCard]:
    """Project the winning house metadata into the PersonalityCard and its summary.v1 ShareCard.

    Raises:
        MissingMappingError: If the house metadata is incomplete or malformed.
    """
    try:
        metadata = AssessmentHouseMetadata.model_validate(dict(house))
        card = _card(metadata, display_name, is_demo)
    except (ValidationError, TypeError, ValueError) as error:
        raise MissingMappingError(
            f"House metadata cannot be projected: {error}", code=EngineErrorCode.INVALID_HOUSE_REF
        ) from error
    share = ShareCard(
        result_id=result_id,
        result_revision=result_revision,
        activity_id=activity_id,
        display_name=display_name,
        house=card.house,
        branding=SUMMARY_V1_BRANDING,
        is_demo=is_demo,
        demo_label=SUMMARY_V1_DEMO_LABEL if is_demo else None,
        template_ref=SUMMARY_V1_TEMPLATE_REF,
    )
    return card, share


def _card(metadata: AssessmentHouseMetadata, display_name: str, is_demo: bool) -> PersonalityCardData:
    identity = {
        "house_id": metadata.house_id,
        "name": metadata.name,
        "theme_ref": metadata.theme_ref,
        "mascot_ref": metadata.mascot_ref,
    }
    return PersonalityCardData(
        display_name=display_name,
        house=identity,
        strengths=tuple(metadata.strengths),
        tendencies=tuple(metadata.tendencies),
        career_groups=tuple(metadata.suggested_fields),
        quote=metadata.quote,
        is_demo=is_demo,
    )
