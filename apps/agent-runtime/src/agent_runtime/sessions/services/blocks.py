"""Server-side block negotiation: canonical blocks are stored, client-visible blocks are projected."""
import re
from collections.abc import Callable, Iterable

from pydantic import ValidationError

from agent_runtime.sessions.schemas.activity import (
    CapabilitySnapshot,
    KnowledgeCardBlock,
    MarkdownBlock,
    SuggestionsBlock,
    TextBlock,
    TypedBlock,
)

_LINK = re.compile(r"\[([^\]]+)\]\(\s*(https?://[^)\s]+)\)")
# Underscore emphasis never matches intraword (CommonMark), so snake_case stays intact; link targets are shielded
# in markdown_to_text, bare URLs are not.
_EMPHASIS = re.compile(r"(\*\*|\*)(?=\S)(.+?)(?<=\S)\1|(?<!\w)(__|_)(?=\S)(.+?)(?<=\S)\3(?!\w)")
_BULLET = re.compile(r"^(\s*)[-*+]\s+", re.MULTILINE)
_META = "\\[]()*_`"
_ESCAPABLE = re.compile(r"\\([\\\[\]()*_`])")
_NEEDS_ESCAPE = re.compile(r"([\\\[\]()*_`])")
_PLACEHOLDER = re.compile("[\ue000-\ue007]")  # private-use stand-ins for escaped characters while text is stripped


def escape_markdown(value: str) -> str:
    """Backslash-escape markdown metacharacters so stored values can never become links or emphasis."""
    return _NEEDS_ESCAPE.sub(r"\\\1", value)


def _strip_emphasis(text: str) -> str:
    return _EMPHASIS.sub(lambda m: m.group(2) or m.group(4), text)


def markdown_to_text(content: str) -> str:
    content = _ESCAPABLE.sub(lambda m: chr(0xE000 + _META.index(m.group(1))), content)
    out, pos = [], 0
    for link in _LINK.finditer(content):  # emphasis is stripped around link targets, never inside them
        out.append(_strip_emphasis(content[pos:link.start()]))
        out.append(f"{_strip_emphasis(link.group(1))} ({link.group(2)})")
        pos = link.end()
    out.append(_strip_emphasis(content[pos:]))
    text = _BULLET.sub(r"\1• ", "".join(out))
    return _PLACEHOLDER.sub(lambda m: _META[ord(m.group()) - 0xE000], text)


def _text(block_id: str, content: str) -> TextBlock:
    return TextBlock(block_id=block_id, type="text", schema_version=1, content=content)


def _degrade_markdown(block: MarkdownBlock) -> TextBlock:
    return _text(block.block_id, markdown_to_text(block.content))


def _degrade_suggestions(block: SuggestionsBlock) -> TextBlock:
    return _text(block.block_id, "Gợi ý: " + " · ".join(item.label for item in block.items))


def _degrade_knowledge_card(block: KnowledgeCardBlock) -> TypedBlock:
    lines = [f"**{escape_markdown(block.title)}**",
             *(f"- {escape_markdown(item.label)}: {escape_markdown(item.value)}" for item in block.fields)]
    if block.source_url:
        lines.append(f"[Nguồn]({block.source_url})")
    content = "\n".join(lines)
    try:
        return MarkdownBlock(block_id=block.block_id, type="markdown", schema_version=1, content=content)
    except ValidationError:  # markup in a stored value or an over-long card: the plain rendering stays exact
        return _text(block.block_id, markdown_to_text(content))


# Text v1 is mandatory at conversation create, so every chain ends in a renderable block.
_DEGRADE: dict[str, Callable[[TypedBlock], TypedBlock]] = {
    "markdown": _degrade_markdown,
    "suggestions": _degrade_suggestions,
    "knowledge_card": _degrade_knowledge_card,
}
# Stored canonically whatever the capability; projected to a supported fallback on output.
DEGRADABLE_TYPES = frozenset(_DEGRADE)


def project_blocks(blocks: Iterable[TypedBlock], capability: CapabilitySnapshot) -> tuple[TypedBlock, ...]:
    supported = {block.type: set(block.schema_versions) for block in capability.supported_blocks}
    projected = []
    for block in blocks:
        while block.schema_version not in supported.get(block.type, set()) and block.type in _DEGRADE:
            block = _DEGRADE[block.type](block)
        projected.append(block)
    return tuple(projected)
