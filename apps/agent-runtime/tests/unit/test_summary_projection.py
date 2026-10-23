"""summary.v1 projector: pinned house metadata -> PersonalityCard + closed-allowlist ShareCard (C-04)."""
import pytest

from agent_runtime.engine.exceptions import MissingMappingError
from agent_runtime.engine.fixtures.holland_career_pool import HOUSE_IDS, sample_experience_definition
from agent_runtime.engine.projection import (
    SUMMARY_V1_BRANDING,
    SUMMARY_V1_DEMO_LABEL,
    SUMMARY_V1_TEMPLATE_REF,
    project_summary_v1,
)

DEFINITION = sample_experience_definition(seed=7, return_dict=True)
HOUSES = {house["house_id"]: house for house in DEFINITION["houses"]}


def project(house_id="house_r", *, is_demo=True, house=None):
    return project_summary_v1(house=house or HOUSES[house_id], display_name="Ngân", is_demo=is_demo,
                              result_id="res_1", result_revision=1, activity_id="act_1")


@pytest.mark.parametrize("house_id", HOUSE_IDS)
def test_card_copies_pinned_metadata_for_every_house(house_id):
    card, share = project(house_id)
    house = HOUSES[house_id]
    assert card.house.model_dump() == {key: house[key] for key in ("house_id", "name", "theme_ref", "mascot_ref")}
    assert (list(card.strengths), list(card.tendencies), list(card.career_groups), card.quote) == (
        house["strengths"], house["tendencies"], house["suggested_fields"], house["quote"])
    assert (card.display_name, share.display_name, share.house) == ("Ngân", "Ngân", card.house)


def test_share_is_a_closed_allowlist_with_projection_owned_constants():
    _, share = project()
    assert set(share.model_dump()) == {"schema_version", "projection_version", "result_id", "result_revision",
                                       "activity_id", "display_name", "house", "branding", "is_demo",
                                       "demo_label", "template_ref"}
    assert (share.projection_version, share.template_ref, share.branding.model_dump()) == (
        "summary.v1", SUMMARY_V1_TEMPLATE_REF, SUMMARY_V1_BRANDING)
    assert (share.result_id, share.result_revision, share.activity_id) == ("res_1", 1, "act_1")


@pytest.mark.parametrize("is_demo, label", [(True, SUMMARY_V1_DEMO_LABEL), (False, None)])
def test_demo_label_follows_the_pinned_release(is_demo, label):
    card, share = project(is_demo=is_demo)
    assert (card.is_demo, share.is_demo, share.demo_label) == (is_demo, is_demo, label)


@pytest.mark.parametrize("change", [
    lambda h: h.pop("quote"), lambda h: h.update(strengths=[]), lambda h: h.update(mascot_ref=""),
    lambda h: h.update(suggested_fields=None), lambda h: h.update(tendencies=[""]),
])
def test_missing_metadata_fails_instead_of_inventing_card_content(change):
    house = dict(HOUSES["house_s"])
    change(house)
    with pytest.raises(MissingMappingError):
        project(house=house)
