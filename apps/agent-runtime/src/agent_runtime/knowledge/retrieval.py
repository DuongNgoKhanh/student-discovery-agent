"""Hybrid retrieval over each document's active revision: cosine similarity blended with keyword rank.

v1 scores every chunk of the knowledge base (no HNSW), which is fine at thousands of chunks.
"""
import logging
from datetime import UTC

import psycopg
from sqlalchemy import text
from sqlalchemy.exc import DataError, DisconnectionError, InterfaceError, OperationalError, TimeoutError

from agent_runtime.knowledge.embedding import EmbeddingPort, EmbeddingUnavailable, vector_literal
from agent_runtime.knowledge.filters import FilterError, compile_filter
from agent_runtime.knowledge.metadata import named_metadata
from agent_runtime.knowledge.repository import load_fields
from agent_runtime.knowledge.schemas import KnowledgeUnavailable, Record, RetrievalRequest, RetrievalResult

logger = logging.getLogger(__name__)

_SEARCH = """
    WITH q AS (
        SELECT CAST(replace(plainto_tsquery('simple', knowledge.immutable_unaccent(:query))::text, ' & ', ' | ')
                    AS tsquery) AS tsq,
               CAST(:vector AS vector) AS vec
    ), scored AS (
        SELECT d.id AS document_id, r.revision, r.title, r.source_url, r.metadata, r.created_at,
               c.heading_path, c.text,
               :weight * CASE WHEN q.vec IS NULL OR e.embedding IS NULL THEN 0
                              ELSE GREATEST(0, 1 - (e.embedding <=> q.vec)) END
               + (1 - :weight) * (ts_rank_cd(c.tsv, q.tsq) / (ts_rank_cd(c.tsv, q.tsq) + 1)) AS score
        FROM q, knowledge.documents d
        JOIN knowledge.document_revisions r ON r.id = d.active_revision_id
        JOIN knowledge.chunks c ON c.revision_id = r.id
        LEFT JOIN knowledge.embeddings e ON e.chunk_hash = c.chunk_hash AND e.embedding_model = :model
        WHERE d.kb_id = :kb AND d.status = 'active' AND {predicate}
    ), best AS (
        SELECT DISTINCT ON (document_id) * FROM scored ORDER BY document_id, score DESC
    )
    SELECT * FROM best WHERE score > 0 AND score >= :threshold ORDER BY score DESC, document_id LIMIT :top_k
"""


class PgKnowledge:
    def __init__(self, uow, embedding: EmbeddingPort | None, *, timeout_ms: int = 1500):
        self._uow = uow
        self._embedding = embedding
        self._timeout_ms = int(timeout_ms)

    def retrieve(self, request: RetrievalRequest) -> RetrievalResult | KnowledgeUnavailable:
        vector = self._embed_query(request.query)
        setting = request.retrieval_setting
        try:
            with self._uow.begin() as session:
                session.execute(text(f"SET LOCAL statement_timeout = {self._timeout_ms}"))
                model = session.execute(text("SELECT embedding_model FROM knowledge.knowledge_bases WHERE id = :id"),
                                        {"id": request.knowledge_id}).scalar_one_or_none()
                if model is None:
                    return KnowledgeUnavailable("not_found")
                fields = load_fields(session, request.knowledge_id)
                predicate = compile_filter(request.metadata_condition, fields)
                semantic = not isinstance(vector, EmbeddingUnavailable) and model == self._embedding.model
                rows = session.execute(text(_SEARCH.format(predicate=predicate.sql)), {
                    **predicate.params, "query": request.query, "kb": request.knowledge_id, "model": model,
                    "vector": vector_literal(vector) if semantic else None,
                    "weight": setting.semantic_weight if semantic else 0.0,
                    "threshold": setting.score_threshold, "top_k": setting.top_k}).mappings().all()
        except OperationalError as error:
            reason = "timeout" if isinstance(error.orig, psycopg.errors.QueryCanceled) else "dependency_down"
            return KnowledgeUnavailable(reason)
        except DataError as error:  # stored metadata that cannot be cast by the filter
            raise FilterError("metadata condition does not match stored values") from error
        except (DisconnectionError, InterfaceError, TimeoutError):
            return KnowledgeUnavailable("dependency_down")
        return RetrievalResult(records=tuple(self._record(row, fields) for row in rows), degraded=not semantic)

    def _embed_query(self, query: str):
        if self._embedding is None:
            return EmbeddingUnavailable("not_configured")
        try:
            return self._embedding.embed_query(query)
        except Exception as error:  # any provider failure must degrade to keyword search
            logger.warning("knowledge query embedding failed: %s", type(error).__name__)
            return EmbeddingUnavailable("provider_error")

    @staticmethod
    def _record(row, fields) -> Record:
        metadata = named_metadata(fields, row["metadata"]) | {
            "document_id": row["document_id"], "revision": row["revision"],
            "updated_at": row["created_at"].astimezone(UTC).isoformat().replace("+00:00", "Z")}
        if row["source_url"]:
            metadata["source_url"] = row["source_url"]
        content = f"{row['heading_path']}\n{row['text']}" if row["heading_path"] else row["text"]
        return Record(content=content, score=round(float(row["score"]), 6), title=row["title"], metadata=metadata)
