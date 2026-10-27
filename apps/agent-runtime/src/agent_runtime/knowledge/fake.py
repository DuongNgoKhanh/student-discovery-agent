"""Deterministic bag-of-words embedding for tests and offline demos: shared words mean similar vectors."""
import math
import re
from hashlib import sha256

from agent_runtime.knowledge.embedding import EMBEDDING_DIMENSIONS, EmbeddingUnavailable


def _vector(text: str) -> list[float]:
    values = [0.0] * EMBEDDING_DIMENSIONS
    for word in re.findall(r"\w+", text.lower()):
        values[int(sha256(word.encode("utf-8")).hexdigest(), 16) % EMBEDDING_DIMENSIONS] += 1.0
    norm = math.sqrt(sum(value * value for value in values))
    if not norm:  # pgvector cosine distance is undefined for a zero vector
        values[0], norm = 1.0, 1.0
    return [value / norm for value in values]


class FakeEmbedding:
    model = "fake-embedding"

    def __init__(self, *, fail_documents: bool = False, fail_queries: bool = False):
        self.fail_documents = fail_documents
        self.fail_queries = fail_queries
        self.document_calls: list[int] = []
        self.query_calls: list[str] = []

    def embed_documents(self, items):
        self.document_calls.append(len(items))
        if self.fail_documents:
            return EmbeddingUnavailable("provider_error")
        return [_vector(f"{item.heading_path} {item.text}") for item in items]

    def embed_query(self, text):
        self.query_calls.append(text)
        if self.fail_queries:
            return EmbeddingUnavailable("provider_error")
        return _vector(text)
