"""Markdown -> heading sections -> character-bounded chunks; deterministic, so unchanged chunks keep their hash."""
import re
from dataclasses import dataclass

from chonkie import RecursiveChunker

from agent_runtime.knowledge.hashing import chunk_hash

CHUNK_SIZE = 1200  # characters; far below gemini-embedding-2's 8192-token input limit
_HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$")
_FENCE = re.compile(r"^\s*(```|~~~)")


@dataclass(frozen=True)
class Section:
    heading_path: str
    text: str


@dataclass(frozen=True)
class ChunkDraft:
    ordinal: int
    heading_path: str
    text: str
    chunk_hash: str


def split_sections(body: str) -> list[Section]:
    sections: list[Section] = []
    headings: list[tuple[int, str]] = []
    lines: list[str] = []
    fenced = False

    def flush() -> None:
        content = "\n".join(lines).strip()
        if content:
            sections.append(Section(" > ".join(title for _, title in headings), content))
        lines.clear()

    for line in body.splitlines():
        if _FENCE.match(line):
            fenced = not fenced
        heading = None if fenced else _HEADING.match(line)
        if heading is None:
            lines.append(line)
            continue
        flush()
        level = len(heading.group(1))
        while headings and headings[-1][0] >= level:
            headings.pop()
        headings.append((level, heading.group(2).strip()))
    flush()
    return sections


def chunk_document(title: str, body: str, *, chunk_size: int = CHUNK_SIZE) -> list[ChunkDraft]:
    chunker = RecursiveChunker(chunk_size=chunk_size)
    drafts: list[ChunkDraft] = []
    for section in split_sections(body):
        pieces = ([section.text] if len(section.text) <= chunk_size
                  else [chunk.text.strip() for chunk in chunker.chunk(section.text)])
        for piece in filter(None, pieces):
            drafts.append(ChunkDraft(len(drafts), section.heading_path, piece,
                                     chunk_hash(title, section.heading_path, piece)))
    return drafts
