"""Hybrid retrieval over each document's active revision: cosine similarity blended with keyword coverage.

Keyword score = share of the question's distinct (unaccented) words found in the chunk, heading included, so a
chunk that repeats one term cannot outrank one that answers the whole question. Results are chunks: at most
max_chunks_per_doc per document, top_k overall. v1 scores every chunk of the knowledge base (no HNSW), which is
fine at thousands of chunks.
"""
import logging
from collections.abc import Mapping, Sequence
from datetime import UTC

import psycopg
from sqlalchemy import text
from sqlalchemy.exc import DataError, DisconnectionError, InterfaceError, OperationalError, TimeoutError

from agent_runtime.knowledge.embedding import EmbeddingPort, EmbeddingUnavailable, vector_literal
from agent_runtime.knowledge.filters import FilterError, compile_filter
from agent_runtime.knowledge.metadata import named_metadata
from agent_runtime.knowledge.repository import load_fields
from agent_runtime.knowledge.schemas import (
    KnowledgeUnavailable,
    MetadataCondition,
    MetadataField,
    Record,
    RetrievalRequest,
    RetrievalResult,
)

logger = logging.getLogger(__name__)

_SEARCH = """
    WITH q AS (
        SELECT tsvector_to_array(to_tsvector('simple', knowledge.immutable_unaccent(:query))) AS words,
               CAST(:vector AS vector) AS vec
    ), scored AS (
        SELECT d.id AS document_id, r.revision, r.title, r.source_url, r.metadata, r.created_at,
               c.ordinal, c.heading_path, c.text,
               :weight * CASE WHEN q.vec IS NULL OR e.embedding IS NULL THEN 0
                              ELSE GREATEST(0, 1 - (e.embedding <=> q.vec)) END
               + (1 - :weight) * CAST(cardinality(ARRAY(
                     SELECT unnest(tsvector_to_array(c.tsv)) INTERSECT SELECT unnest(q.words))) AS float)
                 / GREATEST(cardinality(q.words), 1) AS score
        FROM q, knowledge.documents d
        JOIN knowledge.document_revisions r ON r.id = d.active_revision_id
        JOIN knowledge.chunks c ON c.revision_id = r.id
        LEFT JOIN knowledge.embeddings e ON e.chunk_hash = c.chunk_hash AND e.embedding_model = :model
        WHERE d.kb_id = :kb AND d.status = 'active' AND {predicate}
    ), ranked AS (
        SELECT *, row_number() OVER (PARTITION BY document_id ORDER BY score DESC, ordinal) AS place FROM scored
    )
    SELECT * FROM ranked WHERE place <= :per_doc AND score > 0 AND score >= :threshold
    ORDER BY score DESC, document_id, ordinal LIMIT :top_k
"""


class PgKnowledge:
    def __init__(self, uow, embeddings: Mapping[str, EmbeddingPort], *, timeout_ms: int = 1500):
        self._uow = uow
        self._embeddings = embeddings
        self._timeout_ms = int(timeout_ms)

    def retrieve(self, request: RetrievalRequest, *, required: MetadataCondition | None = None
                 ) -> RetrievalResult | KnowledgeUnavailable:
        """``required`` is the binding's own condition, ANDed with the caller's; a bad one is a misconfiguration.

        The query is embedded between the two reads, with the KB's own model, so no transaction waits on it."""
        setting = request.retrieval_setting
        try:
            with self._uow.begin() as session:
                session.execute(text(f"SET LOCAL statement_timeout = {self._timeout_ms}"))
                model = session.execute(text("SELECT embedding_model FROM knowledge.knowledge_bases WHERE id = :id"),
                                        {"id": request.knowledge_id}).scalar_one_or_none()
                if model is None:
                    return KnowledgeUnavailable("not_found")
                fields = load_fields(session, request.knowledge_id)
            try:
                pinned = compile_filter(required, fields, prefix="rf")
            except FilterError:
                return KnowledgeUnavailable("invalid_binding")
            predicate = compile_filter(request.metadata_condition, fields)
            vector = self._embed_query(model, request.query)
            semantic = not isinstance(vector, EmbeddingUnavailable)
            with self._uow.begin() as session:
                session.execute(text(f"SET LOCAL statement_timeout = {self._timeout_ms}"))
                rows = session.execute(text(_SEARCH.format(predicate=f"{pinned.sql} AND {predicate.sql}")), {
                    **pinned.params, **predicate.params, "query": request.query, "kb": request.knowledge_id,
                    "model": model, "vector": vector_literal(vector) if semantic else None,
                    "weight": setting.semantic_weight if semantic else 0.0,
                    "threshold": setting.score_threshold, "top_k": setting.top_k,
                    "per_doc": setting.max_chunks_per_doc}).mappings().all()
        except OperationalError as error:
            reason = "timeout" if isinstance(error.orig, psycopg.errors.QueryCanceled) else "dependency_down"
            return KnowledgeUnavailable(reason)
        except DataError as error:  # stored metadata that cannot be cast by the filter
            raise FilterError("metadata condition does not match stored values") from error
        except (DisconnectionError, InterfaceError, TimeoutError):
            return KnowledgeUnavailable("dependency_down")
        return RetrievalResult(records=tuple(self._record(row, fields) for row in rows), degraded=not semantic)

    def fields(self, kb_ids: Sequence[str]) -> dict[str, tuple[MetadataField, ...]]:
        """Metadata fields per knowledge base in one read; an unreachable database yields none (tools still run)."""
        if not kb_ids:
            return {}
        try:
            with self._uow.begin() as session:
                session.execute(text(f"SET LOCAL statement_timeout = {self._timeout_ms}"))
                rows = session.execute(text(
                    "SELECT kb_id, id, name, type, filterable, label FROM knowledge.metadata_fields "
                    "WHERE kb_id = ANY(:kbs) ORDER BY kb_id, ordinal, name"), {"kbs": list(kb_ids)}).mappings().all()
        except (OperationalError, DisconnectionError, InterfaceError, TimeoutError):
            logger.warning("knowledge fields unavailable")
            return {}
        found: dict[str, list[MetadataField]] = {}
        for row in rows:
            found.setdefault(row["kb_id"], []).append(MetadataField.model_validate(
                {key: row[key] for key in ("id", "name", "type", "filterable", "label")}))
        return {kb_id: tuple(items) for kb_id, items in found.items()}

    def _embed_query(self, model: str, query: str):
        embedding = self._embeddings.get(model)
        if embedding is None:
            return EmbeddingUnavailable("not_configured")
        try:
            return embedding.embed_query(query)
        except Exception as error:  # any provider failure must degrade to keyword search
            logger.warning("knowledge query embedding failed: %s", type(error).__name__)
            return EmbeddingUnavailable("provider_error")

    @staticmethod
    def _record(row, fields) -> Record:
        metadata = named_metadata(fields, row["metadata"]) | {
            "document_id": row["document_id"], "revision": row["revision"], "chunk": row["ordinal"],
            "updated_at": row["created_at"].astimezone(UTC).isoformat().replace("+00:00", "Z")}
        if row["source_url"]:
            metadata["source_url"] = row["source_url"]
        content = f"{row['heading_path']}\n{row['text']}" if row["heading_path"] else row["text"]
        return Record(content=content, score=round(float(row["score"]), 6), title=row["title"], metadata=metadata)
