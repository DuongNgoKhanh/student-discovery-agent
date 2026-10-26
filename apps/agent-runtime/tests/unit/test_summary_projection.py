"""summary.v1 projector tests (Task C-04 / M-CRD).

Verifies:
- FR-CRD-01/03/04: PersonalityCard and ShareCard projected from winning House metadata and scoring results.
- DEC-02 baseline: ShareCard closed allowlist (no scores, bounds, answers, or extra fields).
- DEC-04 & Section 7.3: Complete verification across all 6 Holland RIASEC Houses (R, I, A, S, E, C).
- AT-10/15/16: Reversibility, invalidation invariants, demo flag behaviors, and typed error handling.
"""
import pytest
from pydantic import ValidationError

from agent_runtime.engine.error_codes import EngineErrorCode
from agent_runtime.engine.exceptions import EngineError, MissingMappingError, UnsupportedDefinitionError
from agent_runtime.engine.fixtures.holland_career_pool import HOUSE_IDS, sample_experience_definition
from agent_runtime.engine.projection import (
    SUMMARY_V1_BRANDING,
    SUMMARY_V1_DEMO_LABEL,
    SUMMARY_V1_TEMPLATE_REF,
    project_card_block,
    project_personality_card,
    project_share_card,
    project_summary_from_result,
    project_summary_v1,
)
from agent_runtime.engine.schemas.scoring import (
    AssessmentScoringResult,
    HouseScoreDetail,
)
from agent_runtime.engine.schemas.selector import StoppingReason
from agent_runtime.sessions.schemas.activity import PersonalityCardBlock
from agent_runtime.sessions.schemas.result import ShareCard

DEFINITION = sample_experience_definition(seed=7, return_dict=True)
HOUSES = {house["house_id"]: house for house in DEFINITION["houses"]}


def _make_dummy_scoring(primary_house_id: str, is_complete: bool = True) -> AssessmentScoringResult:
    """Helper to construct a valid AssessmentScoringResult for a given winning House."""
    other_houses = [h for h in HOUSE_IDS if h != primary_house_id]
    ranked = [primary_house_id] + other_houses[:5]
    house_scores = {}
    for rank, hid in enumerate(ranked, start=1):
        house_scores[hid] = HouseScoreDetail(
            house_id=hid,
            sum=0,
            count=0,
            mean=None,
            lower=None,
            upper=None,
            gap=None,
            display_score=None,
            rank=rank,
            contributions=[],
        )

    return AssessmentScoringResult(
        schema_version="2.0",
        primary_house_id=primary_house_id,
        secondary_house_id=ranked[1],
        tertiary_house_id=ranked[2],
        holland_code="RIA",
        tie_applied=False,
        house_scores=house_scores,
        ranked_houses=ranked,
        all_contributions=[],
        is_complete=is_complete,
        stopping_reason=StoppingReason.BOUNDED_WINNER if is_complete else None,
        total_answers=18 if is_complete else 10,
    )


def project(house_id="house_r", *, is_demo=True, house=None):
    return project_summary_v1(
        house=house or HOUSES[house_id],
        display_name="Ngân",
        is_demo=is_demo,
        result_id="res_1",
        result_revision=1,
        activity_id="act_1",
    )


# ==============================================================================
# 1. Verification of All 6 Holland RIASEC Houses (Đủ 6 Hệ)
# ==============================================================================

@pytest.mark.parametrize("house_id", HOUSE_IDS)
def test_personality_card_verbatim_metadata_for_all_6_houses(house_id):
    """Verifies that PersonalityCard copies all canonical metadata for all 6 Houses verbatim."""
    house = HOUSES[house_id]
    card = project_personality_card(house=house, display_name="Trần Thanh Nam", is_demo=True)

    assert card.display_name == "Trần Thanh Nam"
    assert card.is_demo is True
    assert card.house.house_id == house["house_id"]
    assert card.house.name == house["name"]
    assert card.house.theme_ref == house["theme_ref"]
    assert card.house.mascot_ref == house["mascot_ref"]
    assert list(card.strengths) == house["strengths"]
    assert list(card.tendencies) == house["tendencies"]
    assert list(card.career_groups) == house["suggested_fields"]
    assert card.quote == house["quote"]


@pytest.mark.parametrize("house_id", HOUSE_IDS)
def test_share_card_allowlist_for_all_6_houses(house_id):
    """Verifies that ShareCard projects cleanly for all 6 Houses adhering to DEC-02 allowlist."""
    house = HOUSES[house_id]
    share = project_share_card(
        house=house,
        display_name="Lê Minh Châu",
        is_demo=False,
        result_id="res_abc",
        result_revision=2,
        activity_id="act_xyz",
    )

    assert share.display_name == "Lê Minh Châu"
    assert share.is_demo is False
    assert share.demo_label is None
    assert share.house.house_id == house["house_id"]
    assert share.house.name == house["name"]
    assert share.house.theme_ref == house["theme_ref"]
    assert share.house.mascot_ref == house["mascot_ref"]
    assert share.template_ref == SUMMARY_V1_TEMPLATE_REF
    assert share.branding.model_dump() == SUMMARY_V1_BRANDING
    assert share.result_id == "res_abc"
    assert share.result_revision == 2
    assert share.activity_id == "act_xyz"


# ==============================================================================
# 2. DEC-02 Closed Allowlist Invariants
# ==============================================================================

def test_share_is_a_closed_allowlist_with_projection_owned_constants():
    """Confirms ShareCard strictly contains only the 11 allowlisted fields (DEC-02)."""
    _, share = project()
    expected_allowlist_keys = {
        "schema_version",
        "projection_version",
        "result_id",
        "result_revision",
        "activity_id",
        "display_name",
        "house",
        "branding",
        "is_demo",
        "demo_label",
        "template_ref",
    }
    assert set(share.model_dump()) == expected_allowlist_keys
    assert (share.projection_version, share.template_ref, share.branding.model_dump()) == (
        "summary.v1",
        SUMMARY_V1_TEMPLATE_REF,
        SUMMARY_V1_BRANDING,
    )
    assert (share.result_id, share.result_revision, share.activity_id) == ("res_1", 1, "act_1")


def test_share_card_forbids_extra_or_leaked_internal_scores():
    """Confirms ShareCard extra='forbid' rejects extra fields and never leaks scores."""
    _, share = project()
    share_dict = share.model_dump()
    assert "mean" not in share_dict
    assert "scores" not in share_dict
    assert "answers" not in share_dict
    assert "lower_bound" not in share_dict
    assert "upper_bound" not in share_dict

    with pytest.raises(ValidationError):
        ShareCard(**{**share_dict, "leaked_mean_score": 4.5})


# ==============================================================================
# 3. Demo Flag Behaviors (is_demo True vs False)
# ==============================================================================

@pytest.mark.parametrize("is_demo, expected_label", [
    (True, SUMMARY_V1_DEMO_LABEL),
    (False, None),
])
def test_demo_label_follows_is_demo_flag(is_demo, expected_label):
    """Confirms demo_label is present and matches constant when is_demo=True, None when False."""
    card, share = project(is_demo=is_demo)
    assert card.is_demo == is_demo
    assert share.is_demo == is_demo
    assert share.demo_label == expected_label


def test_share_card_demo_label_invariant():
    """Confirms ShareCard model validator enforces demo_label when is_demo is True."""
    _, share = project(is_demo=False)
    share_dict = share.model_dump()
    share_dict["is_demo"] = True
    share_dict["demo_label"] = None
    with pytest.raises(ValueError, match="demo share card requires demo label"):
        ShareCard.model_validate(share_dict)


# ==============================================================================
# 4. Projection from AssessmentScoringResult (Result + Definition Metadata)
# ==============================================================================

@pytest.mark.parametrize("winning_house_id", HOUSE_IDS)
def test_project_from_scoring_result_for_all_6_houses(winning_house_id):
    """Tests projection directly from AssessmentScoringResult and ExperienceDefinitionDocument."""
    scoring = _make_dummy_scoring(primary_house_id=winning_house_id, is_complete=True)
    card, share = project_summary_from_result(
        scoring=scoring,
        definition=DEFINITION,
        display_name="Võ Thanh Duy",
        is_demo=True,
        result_id="res_score_1",
        result_revision=1,
        activity_id="act_score_1",
    )

    expected_house = HOUSES[winning_house_id]
    assert card.house.house_id == winning_house_id
    assert card.house.name == expected_house["name"]
    assert share.house.house_id == winning_house_id
    assert share.demo_label == SUMMARY_V1_DEMO_LABEL
    assert share.display_name == "Võ Thanh Duy"


def test_unified_project_summary_v1_with_scoring_and_definition():
    """Tests that project_summary_v1 dispatches seamlessly when passed scoring + definition."""
    scoring = _make_dummy_scoring(primary_house_id="house_s", is_complete=True)
    card, share = project_summary_v1(
        scoring=scoring,
        definition=DEFINITION,
        display_name="Đỗ Hoàng Long",
        is_demo=False,
        result_id="res_long",
        result_revision=3,
        activity_id="act_long",
    )
    assert card.house.house_id == "house_s"
    assert card.display_name == "Đỗ Hoàng Long"
    assert share.is_demo is False
    assert share.demo_label is None


def test_project_from_scoring_rejects_incomplete_result():
    """Confirms project_summary_from_result rejects scoring if is_complete is False."""
    incomplete_scoring = _make_dummy_scoring(primary_house_id="house_r", is_complete=False)
    with pytest.raises(EngineError, match="Cannot project card from incomplete scoring result"):
        project_summary_from_result(
            scoring=incomplete_scoring,
            definition=DEFINITION,
            display_name="Huy Bùi",
            is_demo=True,
            result_id="res_inc",
            result_revision=1,
            activity_id="act_inc",
        )


def test_project_from_scoring_rejects_missing_primary_house():
    """Confirms rejection when scoring has no primary winning house."""
    scoring_dict = _make_dummy_scoring(primary_house_id="house_r").model_dump()
    scoring_dict["primary_house_id"] = None
    with pytest.raises(UnsupportedDefinitionError, match="Scoring result contains no primary winning house"):
        project_summary_from_result(
            scoring=scoring_dict,
            definition=DEFINITION,
            display_name="Huy Bùi",
            is_demo=True,
            result_id="res_no_win",
            result_revision=1,
            activity_id="act_no_win",
        )


def test_project_from_scoring_rejects_house_not_in_definition():
    """Confirms MissingMappingError when winning house id is not in definition.houses."""
    foreign_scoring = _make_dummy_scoring(primary_house_id="house_unknown", is_complete=True)
    with pytest.raises(MissingMappingError) as exc_info:
        project_summary_from_result(
            scoring=foreign_scoring,
            definition=DEFINITION,
            display_name="Huy Bùi",
            is_demo=True,
            result_id="res_for",
            result_revision=1,
            activity_id="act_for",
        )
    assert exc_info.value.code == EngineErrorCode.INVALID_HOUSE_REF


# ==============================================================================
# 5. Typed Content Block Projection (PersonalityCardBlock)
# ==============================================================================

def test_project_card_block_generates_valid_typed_block():
    """Confirms PersonalityCardBlock wraps PersonalityCardData with contract compliance."""
    card = project_personality_card(house=HOUSES["house_i"], display_name="Bùi Ngọc", is_demo=True)
    block = project_card_block(
        card=card,
        activity_id="act_card_blk",
        result_id="res_card_blk",
        result_revision=1,
        block_id="blk_custom_id_123",
    )
    assert isinstance(block, PersonalityCardBlock)
    assert block.block_id == "blk_custom_id_123"
    assert block.type == "personality_card"
    assert block.schema_version == 1
    assert block.activity_id == "act_card_blk"
    assert block.result_id == "res_card_blk"
    assert block.result_revision == 1
    assert block.data == card


# ==============================================================================
# 6. Display Name Normalization & Validation
# ==============================================================================

@pytest.mark.parametrize("raw_name, expected_name", [
    ("  Ngô Khánh Dương  ", "Ngô Khánh Dương"),
    ("Trần Nam\t", "Trần Nam"),
    ("\nNguyễn Duy\n", "Nguyễn Duy"),
])
def test_display_name_whitespace_normalization(raw_name, expected_name):
    """Confirms leading and trailing whitespace are cleanly stripped from display_name."""
    card = project_personality_card(house=HOUSES["house_r"], display_name=raw_name, is_demo=False)
    assert card.display_name == expected_name


@pytest.mark.parametrize("invalid_name", ["", "   ", "\t\n  ", 12345, None])
def test_invalid_display_name_raises_value_error(invalid_name):
    """Confirms blank or non-string display names raise ValueError."""
    with pytest.raises(ValueError):
        project_personality_card(house=HOUSES["house_r"], display_name=invalid_name, is_demo=False)


# ==============================================================================
# 7. Edge Cases & Missing/Malformed Metadata Failure Modes (AT-01 / AT-10)
# ==============================================================================

@pytest.mark.parametrize("field_tamper", [
    lambda h: h.pop("house_id"),
    lambda h: h.pop("name"),
    lambda h: h.pop("theme_ref"),
    lambda h: h.pop("mascot_ref"),
    lambda h: h.pop("quote"),
    lambda h: h.pop("strengths"),
    lambda h: h.pop("tendencies"),
    lambda h: h.pop("suggested_fields"),
    lambda h: h.update(strengths=[]),
    lambda h: h.update(strengths=["   "]),
    lambda h: h.update(tendencies=[]),
    lambda h: h.update(tendencies=[""]),
    lambda h: h.update(suggested_fields=[]),
    lambda h: h.update(suggested_fields=[None]),
    lambda h: h.update(quote=""),
    lambda h: h.update(quote="   "),
    lambda h: h.update(name=""),
    lambda h: h.update(theme_ref=""),
    lambda h: h.update(mascot_ref=""),
    lambda h: h.update(strengths=123),
])
def test_missing_or_malformed_metadata_raises_missing_mapping_error(field_tamper):
    """Confirms any missing, empty, or malformed metadata fields raise MissingMappingError."""
    house_copy = dict(HOUSES["house_a"])
    field_tamper(house_copy)
    with pytest.raises(MissingMappingError) as exc_info:
        project_personality_card(house=house_copy, display_name="Trần Nam", is_demo=True)
    assert exc_info.value.code == EngineErrorCode.INVALID_HOUSE_REF


def test_project_summary_v1_without_arguments_fails():
    """Confirms project_summary_v1 raises MissingMappingError if neither house nor scoring is given."""
    with pytest.raises(MissingMappingError):
        project_summary_v1(
            display_name="Nam",
            is_demo=True,
            result_id="res_err",
            result_revision=1,
            activity_id="act_err",
        )
