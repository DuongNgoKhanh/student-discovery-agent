import pytest
from pydantic import ValidationError

from agent_runtime.agent.catalog import KnowledgeSearchParams, render_placeholders


def test_known_placeholder_is_substituted():
    assert render_placeholders("Chào {{ display_name }}!", {"display_name": "Minh"}) == "Chào Minh!"


def test_unknown_placeholder_stays_literal():
    assert render_placeholders("Hi {{owner_id}} {{display_name}}", {"display_name": "Minh"}) == "Hi {{owner_id}} Minh"


def test_search_params_reject_duplicate_filter_fields():
    with pytest.raises(ValidationError):
        KnowledgeSearchParams.model_validate({"knowledge_base_id": "kb", "auto_filter_fields": ["houses", "houses"]})
