"""Reject imports which could pin incompatible, forged or unsupported definitions."""
import json
from pathlib import Path

import pytest

from agent_runtime.evaluations.services.validator import ExperienceValidator, calculate_content_hash
from agent_runtime.infrastructure.product.releases import ProductUnavailable
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import CapabilitySnapshot
from agent_runtime.sessions.services.releases import validate_release
from tests.helpers.builders import adaptive_capabilities, agent_release, experience_release


def validate(descriptor, validator=None, capabilities=None, environment="demo"):
    return validate_release(descriptor, environment=environment,
                            capabilities=capabilities or CapabilitySnapshot(),
                            validator=validator or ExperienceValidator())


def assert_error(code, action, status=422):
    with pytest.raises(RuntimeSessionError) as error:
        action()
    assert (error.value.status, error.value.code, error.value.details) == (status, code, None)


@pytest.mark.parametrize("changes", [
    {"environment": "other"}, {"is_demo": False}, {"content_hash": "sha256:" + "0" * 64},
    {"delivery_schema_version": "unsupported"},
    {"content": {"greeting_text": " ", "allowed_activity_profiles": []}},
    {"content": {"greeting_text": "Hi", "allowed_activity_profiles": ["a", "a"]}},
    {"content": {"greeting_text": "Hi", "allowed_activity_profiles": [], "draft": True}},
])
def test_agent_import_revalidates_untrusted_descriptor(changes):
    assert_error("INCOMPATIBLE_RELEASE", lambda: validate(agent_release().model_copy(update=changes)))


def test_missing_descriptor_is_not_configured():
    assert_error("EXPERIENCE_NOT_CONFIGURED", lambda: validate(None))


def test_empty_agent_allowlist_is_preserved_without_permission_default():
    release = validate(agent_release(content={"greeting_text": "Hi", "allowed_activity_profiles": []}))
    assert release.content == {"greeting_text": "Hi", "allowed_activity_profiles": []}
    assert release.algorithm_profile is None


def test_valid_adaptive_import_uses_explicit_pilot_validator(valid_v2_doc, validator):
    release = validate(experience_release(valid_v2_doc), validator, adaptive_capabilities())
    assert release.definition_schema_version == "2.0"
    assert release.algorithm_profile == "riasec.mean.bounds.v2"


def test_definition_id_is_not_report_experience_context(valid_v2_doc, validator):
    valid_v2_doc["definition_id"] = "definition:valid"
    assert validate(experience_release(valid_v2_doc), validator, adaptive_capabilities()).content["definition_id"] == (
        "definition:valid"
    )


def test_legacy_none_profile_does_not_bypass_unregistered_semantic_validation(valid_v1_doc, validator):
    descriptor = experience_release(valid_v1_doc)
    assert descriptor.algorithm_profile is None
    report = validator.validate(valid_v1_doc, experience_id="runtime_release", draft_revision=1)
    assert report.status == "unsupported"
    assert any(issue.code == "VAL_UNSUPPORTED_RULE_PAYLOAD" for issue in report.issues)
    assert_error("INCOMPATIBLE_RELEASE", lambda: validate(descriptor, validator))


def test_default_registry_does_not_enable_pilot(valid_v2_doc):
    assert_error("INCOMPATIBLE_RELEASE", lambda: validate(experience_release(valid_v2_doc),
                                                        capabilities=adaptive_capabilities()))


@pytest.mark.parametrize("changes", [
    {"definition_schema_version": "1.0"}, {"engine_version": "unknown"},
    {"algorithm_profile": None}, {"algorithm_profile": "unknown"},
    {"delivery_schema_version": "2.0"}, {"is_demo": False}, {"environment": "other"},
])
def test_experience_metadata_must_match_definition(valid_v2_doc, validator, changes):
    descriptor = experience_release(valid_v2_doc).model_copy(update=changes)
    assert_error("INCOMPATIBLE_RELEASE", lambda: validate(descriptor, validator, adaptive_capabilities()))


@pytest.mark.parametrize("mutation", ["demo", "rule", "structure"])
def test_validator_failure_prevents_import_even_with_correct_hash(valid_v2_doc, validator, mutation):
    if mutation == "demo":
        valid_v2_doc["is_demo"] = False
    elif mutation == "rule":
        valid_v2_doc["selection_rules"]["engine_version"] = "other"
    else:
        valid_v2_doc["questions"] = []
    assert_error("INCOMPATIBLE_RELEASE", lambda: validate(experience_release(valid_v2_doc), validator,
                                                        adaptive_capabilities()))


def test_legacy_browser_cannot_import_adaptive(valid_v2_doc, validator):
    assert_error("INCOMPATIBLE_SCHEMA", lambda: validate(experience_release(valid_v2_doc), validator))


def test_adaptive_browser_does_not_automatically_enable_legacy(valid_v1_doc, validator):
    assert_error("INCOMPATIBLE_SCHEMA", lambda: validate(experience_release(valid_v1_doc), validator,
                                                       adaptive_capabilities()))


def test_missing_adaptive_block_is_rejected_at_import_boundary(valid_v2_doc, validator):
    caps = adaptive_capabilities().model_copy(update={"supported_blocks": CapabilitySnapshot().supported_blocks})
    assert_error("INCOMPATIBLE_SCHEMA", lambda: validate(experience_release(valid_v2_doc), validator, caps))


def test_oversized_release_is_rejected_before_import():
    release = agent_release(content={"greeting_text": "x" * 2097152, "allowed_activity_profiles": []})
    assert_error("PAYLOAD_TOO_LARGE", lambda: validate(release), status=413)


def test_shared_jcs_vectors_are_unchanged():
    vectors = json.loads((Path(__file__).resolve().parents[5] / "contracts/fixtures/experience-content-hash.json")
                         .read_text(encoding="utf-8"))
    for vector in vectors:
        assert calculate_content_hash(json.loads(vector["input_json"])) == vector["hash"]


def test_default_product_source_fails_closed():
    source = ProductUnavailable()
    assert_error("SERVICE_UNAVAILABLE", lambda: source.resolve_active_agent("demo"), status=503)
    assert_error("SERVICE_UNAVAILABLE", lambda: source.resolve_active_experience("demo", "exp", None), status=503)
