import pytest
from pydantic import ValidationError

from agent_runtime.agent.catalog import TOOL_DECLARATIONS, KnowledgeSearchParams, ToolContext, render_placeholders
from agent_runtime.knowledge.schemas import MetadataField

SEARCH = TOOL_DECLARATIONS[("knowledge.search", 1)]
FIELDS = ToolContext(knowledge_fields={"kb_demo": (
    MetadataField(id="f1", name="houses", type="string_list", filterable=True),
    MetadataField(id="f2", name="province", type="string", filterable=True))})


def test_known_placeholder_is_substituted():
    assert render_placeholders("Chào {{ display_name }}!", {"display_name": "Minh"}) == "Chào Minh!"


def test_unknown_placeholder_stays_literal():
    assert render_placeholders("Hi {{owner_id}} {{display_name}}", {"display_name": "Minh"}) == "Hi {{owner_id}} Minh"


def test_search_filter_schema_names_only_auto_filter_fields_and_their_operators():
    schema = SEARCH.parameters({"knowledge_base_id": "kb_demo", "auto_filter_fields": ["houses"]}, FIELDS)
    condition = schema["properties"]["filter"]["properties"]["conditions"]["items"]["properties"]
    assert condition["name"]["enum"] == ["houses"]
    assert condition["comparison_operator"]["enum"] == ["contains", "empty", "not contains", "not empty"]
    assert schema["required"] == ["query"]


def test_search_without_auto_filter_fields_offers_no_filter():
    assert set(SEARCH.parameters({"knowledge_base_id": "kb_demo"}, FIELDS)["properties"]) == {"query"}


def test_search_description_lists_field_types_and_operators():
    text = SEARCH.describe({"knowledge_base_id": "kb_demo", "auto_filter_fields": ["houses", "major"]}, context=FIELDS)
    assert "houses (string_list: contains, empty, not contains, not empty)" in text
    assert text.endswith("; major.")  # not in the knowledge base yet: listed without a type
    assert SEARCH.describe({"knowledge_base_id": "kb_demo"}, context=FIELDS) == SEARCH.description


def test_search_params_reject_duplicate_filter_fields():
    with pytest.raises(ValidationError):
        KnowledgeSearchParams.model_validate({"knowledge_base_id": "kb", "auto_filter_fields": ["houses", "houses"]})
