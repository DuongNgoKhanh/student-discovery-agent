"""Validate immutable delivery content before starting a resource transaction."""
import json

from pydantic import ValidationError

from agent_runtime.evaluations.schemas.validation import ValidationStatus
from agent_runtime.evaluations.services.validator import ExperienceValidator, calculate_content_hash
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import ADAPTIVE_PROFILE, CapabilitySnapshot
from agent_runtime.sessions.schemas.release import ReleaseDescriptor, ValidatedRelease


def validate_snapshot_integrity(descriptor: ReleaseDescriptor) -> ValidatedRelease:
    """Recheck persisted shape/hash without renegotiating pinned registry/capabilities.

    Frozen DTOs still contain mutable nested JSON, so check again at the DB boundary.
    This does not replace ExperienceValidator at the initial import boundary.
    """
    try:
        data = descriptor.model_dump(mode="python")
        release = ValidatedRelease.model_validate(data)
        encoded = json.dumps(release.content, ensure_ascii=False, allow_nan=False,
                             separators=(",", ":")).encode("utf-8")
        if len(encoded) > 2097152:
            raise RuntimeSessionError(413, "PAYLOAD_TOO_LARGE")
        if calculate_content_hash(release.content) != release.content_hash:
            raise ValueError("hash mismatch")
        if release.environment != "demo" or not release.is_demo:
            raise ValueError("unsupported environment or demo policy")
        if release.kind == "experience":
            doc = release.content
            expected_profile = {"1.0": None, "2.0": ADAPTIVE_PROFILE}
            if (release.delivery_schema_version != "experience.snapshot.v1"
                    or release.definition_schema_version not in expected_profile
                    or release.definition_schema_version != doc.get("schema_version")
                    or release.engine_version != doc.get("engine_version")
                    or release.algorithm_profile != expected_profile[release.definition_schema_version]
                    or doc.get("is_demo") is not True):
                raise ValueError("inconsistent experience metadata")
        return release
    except (ValidationError, ValueError, TypeError, AttributeError, OverflowError):
        raise RuntimeSessionError(422, "INCOMPATIBLE_RELEASE") from None


def validate_release(
    descriptor: ReleaseDescriptor, *, environment: str, capabilities: CapabilitySnapshot,
    validator: ExperienceValidator,
) -> ValidatedRelease:
    if descriptor is None:
        raise RuntimeSessionError(422, "EXPERIENCE_NOT_CONFIGURED")
    release = validate_snapshot_integrity(descriptor)
    if release.environment != environment:
        raise RuntimeSessionError(422, "INCOMPATIBLE_RELEASE")
    try:
        negotiated = CapabilitySnapshot.model_validate(capabilities.model_dump(mode="python"))
    except (ValidationError, AttributeError):
        raise RuntimeSessionError(422, "INCOMPATIBLE_SCHEMA") from None
    if release.kind == "experience":
        adaptive = release.algorithm_profile == ADAPTIVE_PROFILE
        if ((adaptive and ADAPTIVE_PROFILE not in negotiated.accepted_activity_profiles)
                or (not adaptive and not negotiated.legacy_enabled)):
            raise RuntimeSessionError(422, "INCOMPATIBLE_SCHEMA")
        # Descriptor has no logical experience_id. This is only report context;
        # root definition_id retains the validator's own, broader ID semantics.
        report = validator.validate(release.content, experience_id="runtime_release", draft_revision=1)
        if report.status != ValidationStatus.PASSED:
            raise RuntimeSessionError(422, "INCOMPATIBLE_RELEASE")
    return release
