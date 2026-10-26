"""Server-side block negotiation: canonical blocks are stored, client-visible blocks are projected."""
import re
from collections.abc import Callable, Iterable

from agent_runtime.sessions.schemas.activity import (
    CapabilitySnapshot,
    MarkdownBlock,
    SuggestionsBlock,
    TextBlock,
    TypedBlock,
)

_LINK = re.compile(r"\[([^\]]+)\]\(\s*(https?://[^)\s]+)\)")
# Underscore emphasis never matches intraword (CommonMark), so snake_case and URLs stay intact.
_EMPHASIS = re.compile(r"(\*\*|\*)(?=\S)(.+?)(?<=\S)\1|(?<!\w)(__|_)(?=\S)(.+?)(?<=\S)\3(?!\w)")
_BULLET = re.compile(r"^(\s*)[-*+]\s+", re.MULTILINE)


def _strip_emphasis(text: str) -> str:
    return _EMPHASIS.sub(lambda m: m.group(2) or m.group(4), text)


def markdown_to_text(content: str) -> str:
    out, pos = [], 0
    for link in _LINK.finditer(content):  # emphasis is stripped around link targets, never inside them
        out.append(_strip_emphasis(content[pos:link.start()]))
        out.append(f"{_strip_emphasis(link.group(1))} ({link.group(2)})")
        pos = link.end()
    out.append(_strip_emphasis(content[pos:]))
    return _BULLET.sub(r"\1• ", "".join(out))


def _text(block_id: str, content: str) -> TextBlock:
    return TextBlock(block_id=block_id, type="text", schema_version=1, content=content)


def _degrade_markdown(block: MarkdownBlock) -> TextBlock:
    return _text(block.block_id, markdown_to_text(block.content))


def _degrade_suggestions(block: SuggestionsBlock) -> TextBlock:
    return _text(block.block_id, "Gợi ý: " + " · ".join(item.label for item in block.items))


# Text v1 is mandatory at conversation create, so every chain ends in a renderable block.
_DEGRADE: dict[str, Callable[[TypedBlock], TypedBlock]] = {
    "markdown": _degrade_markdown,
    "suggestions": _degrade_suggestions,
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
