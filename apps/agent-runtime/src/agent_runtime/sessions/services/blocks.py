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

_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
_EMPHASIS = re.compile(r"(\*\*|__|\*|_)(?=\S)(.+?)(?<=\S)\1")
_BULLET = re.compile(r"^(\s*)[-*+]\s+", re.MULTILINE)


def markdown_to_text(content: str) -> str:
    text = _LINK.sub(r"\1 (\2)", content)
    text = _EMPHASIS.sub(r"\2", text)
    return _BULLET.sub(r"\1• ", text)


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


def project_blocks(blocks: Iterable[TypedBlock], capability: CapabilitySnapshot) -> tuple[TypedBlock, ...]:
    supported = {block.type: set(block.schema_versions) for block in capability.supported_blocks}
    projected = []
    for block in blocks:
        while block.schema_version not in supported.get(block.type, set()) and block.type in _DEGRADE:
            block = _DEGRADE[block.type](block)
        projected.append(block)
    return tuple(projected)
