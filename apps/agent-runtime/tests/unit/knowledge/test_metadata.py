import pytest
from pydantic import ValidationError

from agent_runtime.knowledge.hashing import chunk_hash, content_hash
from agent_runtime.knowledge.metadata import MetadataError, named_metadata, validate_metadata
from agent_runtime.knowledge.schemas import MetadataCondition, MetadataField, RetrievalRequest

FIELDS = (
    MetadataField(id="f_province", name="province", type="string", filterable=True),
    MetadataField(id="f_fee", name="fee", type="number"),
    MetadataField(id="f_updated", name="updated", type="time"),
    MetadataField(id="f_houses", name="houses", type="string_list", filterable=True),
)


def test_metadata_is_stored_by_field_id_and_read_back_by_name():
    stored = validate_metadata(FIELDS, {"province": "Hà Nội", "fee": 25.5, "updated": "2026-03-01",
                                        "houses": ["house_s"]})
    assert stored == {"f_province": "Hà Nội", "f_fee": 25.5, "f_updated": "2026-03-01", "f_houses": ["house_s"]}
    assert named_metadata(FIELDS, stored | {"f_deleted": "x"}) == {
        "province": "Hà Nội", "fee": 25.5, "updated": "2026-03-01", "houses": ["house_s"]}


@pytest.mark.parametrize("values", [
    {"unknown": "x"}, {"province": 1}, {"fee": True}, {"fee": float("nan")}, {"fee": "1"},
    {"updated": "yesterday"}, {"houses": "house_s"}, {"houses": [1]}, {"province": "x" * 2001},
])
def test_invalid_metadata_is_rejected(values):
    with pytest.raises(MetadataError):
        validate_metadata(FIELDS, values)


def test_none_values_are_dropped():
    assert validate_metadata(FIELDS, {"province": None}) == {}


def test_hashes_are_canonical_and_prefixed():
    first = content_hash("T", "B", None, {"b": 1, "a": 2})
    assert first == content_hash("T", "B", None, {"a": 2, "b": 1})
    assert first.startswith("sha256:") and len(first) == 71
    assert content_hash("T", "B2", None, {}) != content_hash("T", "B", None, {})
    assert chunk_hash("T", "H", "x") != chunk_hash("T2", "H", "x")


def test_retrieval_request_bounds():
    request = RetrievalRequest.model_validate({"knowledge_id": "kb1", "query": "học phí"})
    assert request.retrieval_setting.top_k == 4
    for bad in ({"knowledge_id": "kb1", "query": " "}, {"knowledge_id": "kb1", "query": "x" * 301},
                {"knowledge_id": "kb1", "query": "x", "retrieval_setting": {"top_k": 0}}):
        with pytest.raises(ValidationError):
            RetrievalRequest.model_validate(bad)


def test_condition_value_rejects_booleans():
    with pytest.raises(ValidationError):
        MetadataCondition.model_validate({"conditions": [{"name": "fee", "comparison_operator": "=", "value": True}]})
