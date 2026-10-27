"""Shared fixtures keep the TypeScript Studio writer byte-compatible with the Python reference."""

import json
from pathlib import Path

import pytest

from agent_runtime.knowledge.hashing import content_hash
from agent_runtime.knowledge.metadata import MetadataError, validate_metadata
from agent_runtime.knowledge.schemas import MetadataField

FIXTURES = Path(__file__).resolve().parents[5] / "contracts" / "fixtures"
HASHES = json.loads((FIXTURES / "knowledge-content-hash.json").read_text(encoding="utf-8"))["cases"]
METADATA = json.loads((FIXTURES / "knowledge-metadata-cases.json").read_text(encoding="utf-8"))
FIELDS = tuple(MetadataField.model_validate(field) for field in METADATA["fields"])


def expand(value):
    if isinstance(value, str) and value.startswith("REPEAT_LIST:"):
        _, item, count = value.split(":")
        return [item] * int(count)
    if isinstance(value, str) and value.startswith("REPEAT:"):
        _, item, count = value.split(":")
        return item * int(count)
    if isinstance(value, list):
        return [expand(item) for item in value]
    if isinstance(value, dict):
        return {key: expand(item) for key, item in value.items()}
    return value


@pytest.mark.parametrize("case", HASHES, ids=[case["name"] for case in HASHES])
def test_content_hash_matches_fixture(case):
    assert content_hash(case["title"], case["body"], case["source_url"], case["metadata"]) == case["hash"]


@pytest.mark.parametrize("case", METADATA["valid"], ids=[case["name"] for case in METADATA["valid"]])
def test_valid_metadata_matches_fixture(case):
    assert validate_metadata(FIELDS, expand(case["values"])) == expand(case["stored"])


@pytest.mark.parametrize("case", METADATA["invalid"], ids=[case["name"] for case in METADATA["invalid"]])
def test_invalid_metadata_matches_fixture(case):
    with pytest.raises(MetadataError):
        validate_metadata(FIELDS, expand(case["values"]))
