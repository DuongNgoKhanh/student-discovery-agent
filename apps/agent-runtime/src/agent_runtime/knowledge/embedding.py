"""Provider-neutral embedding port; adapters normalise every provider failure into EmbeddingUnavailable."""
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

EMBEDDING_DIMENSIONS = 768  # must match knowledge.embeddings.embedding vector(768)


@dataclass(frozen=True)
class DocumentText:
    title: str
    heading_path: str
    text: str


@dataclass(frozen=True)
class EmbeddingUnavailable:
    reason: Literal["not_configured", "rate_limited", "timeout", "provider_error", "invalid_response"]
    detail: str = ""


class EmbeddingPort(Protocol):
    model: str

    def embed_documents(self, items: Sequence[DocumentText]) -> list[list[float]] | EmbeddingUnavailable: ...

    def embed_query(self, text: str) -> list[float] | EmbeddingUnavailable: ...


def vector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(repr(float(value)) for value in values) + "]"
