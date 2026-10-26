"""Content blocks: safe markdown subset, bounded suggestions, capability manifest."""
import pytest
from pydantic import TypeAdapter, ValidationError

from agent_runtime.sessions.schemas.activity import (
    CapabilitySnapshot,
    MarkdownBlock,
    SuggestionsBlock,
    TypedBlock,
)

_BLOCK = TypeAdapter(TypedBlock)


def markdown(content):
    return {"block_id": "b1", "type": "markdown", "schema_version": 1, "content": content}


def suggestions(*labels):
    return {"block_id": "b2", "type": "suggestions", "schema_version": 1,
            "items": [{"label": label, "message_text": label} for label in labels]}


def test_markdown_and_suggestions_join_the_typed_block_union():
    assert isinstance(_BLOCK.validate_python(markdown("**Chào** em, xem [IHRD](https://ihrd.vn)")), MarkdownBlock)
    assert isinstance(_BLOCK.validate_python(suggestions("Làm bài khám phá")), SuggestionsBlock)


@pytest.mark.parametrize("content", ["<b>x</b>", "xem [link](javascript:alert(1))", "x" * 4001, " "])
def test_markdown_rejects_html_unsafe_links_and_oversize(content):
    with pytest.raises(ValidationError):
        _BLOCK.validate_python(markdown(content))


@pytest.mark.parametrize("labels", [(), ("a", "b", "c", "d", "e"), ("x" * 61,)])
def test_suggestions_are_bounded(labels):
    with pytest.raises(ValidationError):
        _BLOCK.validate_python(suggestions(*labels))


def test_clients_may_advertise_new_blocks_but_defaults_do_not():
    snapshot = CapabilitySnapshot(supported_blocks=[
        {"type": "text", "schema_versions": [1]}, {"type": "markdown", "schema_versions": [1]},
        {"type": "suggestions", "schema_versions": [1]}])
    assert {block.type for block in snapshot.supported_blocks} == {"text", "markdown", "suggestions"}
    assert {block.type for block in CapabilitySnapshot().supported_blocks}.isdisjoint({"markdown", "suggestions"})
    with pytest.raises(ValidationError):
        CapabilitySnapshot(supported_blocks=[{"type": "markdown", "schema_versions": [2]}])
