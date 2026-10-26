"""Content blocks: safe markdown subset, bounded suggestions, capability manifest."""
import pytest
from pydantic import TypeAdapter, ValidationError

from agent_runtime.sessions.schemas.activity import (
    CapabilitySnapshot,
    MarkdownBlock,
    SuggestionsBlock,
    TypedBlock,
)
from agent_runtime.sessions.services.blocks import DEGRADABLE_TYPES, markdown_to_text, project_blocks

_BLOCK = TypeAdapter(TypedBlock)


def markdown(content):
    return {"block_id": "b1", "type": "markdown", "schema_version": 1, "content": content}


def suggestions(*labels):
    return {"block_id": "b2", "type": "suggestions", "schema_version": 1,
            "items": [{"label": label, "message_text": label} for label in labels]}


def test_markdown_and_suggestions_join_the_typed_block_union():
    assert isinstance(_BLOCK.validate_python(markdown("**Chào** em, xem [IHRD](https://ihrd.vn)")), MarkdownBlock)
    assert isinstance(_BLOCK.validate_python(suggestions("Làm bài khám phá")), SuggestionsBlock)


@pytest.mark.parametrize("content", [
    "<b>x</b>",
    "xem [link](javascript:alert(1))",
    "xem [link]( javascript:alert(1))",
    "xem [x][1]\n\n[1]: javascript:alert(1)",
    "x" * 4001,
    " ",
])
def test_markdown_rejects_html_unsafe_links_and_oversize(content):
    with pytest.raises(ValidationError):
        _BLOCK.validate_python(markdown(content))


def test_markdown_accepts_http_inline_and_reference_links():
    assert isinstance(_BLOCK.validate_python(markdown("xem [IHRD](https://ihrd.vn)")), MarkdownBlock)
    assert isinstance(_BLOCK.validate_python(markdown("xem [x][1]\n\n[1]: https://ihrd.vn")), MarkdownBlock)


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


FULL = CapabilitySnapshot(supported_blocks=[
    {"type": "text", "schema_versions": [1]}, {"type": "markdown", "schema_versions": [1]},
    {"type": "suggestions", "schema_versions": [1]}])


def test_supported_blocks_pass_through_unchanged():
    blocks = (_BLOCK.validate_python(markdown("**A**")), _BLOCK.validate_python(suggestions("Hi")))
    assert project_blocks(blocks, FULL) == blocks


def test_legacy_clients_receive_text_with_stable_ids():
    md = _BLOCK.validate_python(markdown("**Chào** em\n- một\n- [IHRD](https://ihrd.vn)"))
    sg = _BLOCK.validate_python(suggestions("Làm bài khám phá", "Ngành CNTT học gì?"))
    text_md, text_sg = project_blocks((md, sg), CapabilitySnapshot())
    assert (text_md.type, text_md.block_id) == ("text", "b1")
    assert text_md.content == "Chào em\n• một\n• IHRD (https://ihrd.vn)"
    assert (text_sg.type, text_sg.block_id) == ("text", "b2")
    assert text_sg.content == "Gợi ý: Làm bài khám phá · Ngành CNTT học gì?"


def test_markdown_to_text_strips_emphasis():
    assert markdown_to_text("*nghiêng* và __đậm__") == "nghiêng và đậm"


def test_degradable_types_are_the_content_blocks():
    assert DEGRADABLE_TYPES == {"markdown", "suggestions"}
