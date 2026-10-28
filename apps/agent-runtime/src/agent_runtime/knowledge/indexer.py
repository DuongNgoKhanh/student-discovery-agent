"""Index pending revisions: claim (short tx) -> chunk + embed (no tx) -> write chunks and activate (one tx).

An older revision never replaces a newer active one, and a failed revision leaves the active one serving.
"""
import logging
from dataclasses import dataclass, fields
from datetime import datetime

from sqlalchemy import text

from agent_runtime.knowledge.chunking import CHUNK_SIZE, chunk_document
from agent_runtime.knowledge.embedding import DocumentText, EmbeddingPort, EmbeddingUnavailable, vector_literal

logger = logging.getLogger(__name__)

_CLAIM = text("""
    WITH next AS (
        SELECT id FROM knowledge.document_revisions WHERE index_status = 'pending'
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE knowledge.document_revisions r
    SET index_status = 'indexing', claimed_at = clock_timestamp(), error = NULL
    FROM next, knowledge.documents d, knowledge.knowledge_bases kb
    WHERE r.id = next.id AND d.id = r.document_id AND kb.id = d.kb_id
    RETURNING r.id AS revision_id, r.document_id, r.revision, d.kb_id, kb.embedding_model, r.title, r.body, r.claimed_at
""")


@dataclass(frozen=True)
class IndexJob:
    revision_id: str
    document_id: str
    revision: int
    kb_id: str
    embedding_model: str
    title: str
    body: str
    claimed_at: datetime


@dataclass(frozen=True)
class IndexReport:
    indexed: int = 0
    failed: int = 0
    embedded: int = 0
    reused: int = 0
    reclaimed: int = 0
    purged: int = 0

    def __add__(self, other: "IndexReport") -> "IndexReport":
        return IndexReport(*(getattr(self, item.name) + getattr(other, item.name) for item in fields(self)))


class IndexerService:
    def __init__(self, uow, embedding: EmbeddingPort, *, chunk_size: int = CHUNK_SIZE,
                 stale_after_seconds: int = 600):
        self._uow = uow
        self._embedding = embedding
        self._chunk_size = chunk_size
        self._stale_after_seconds = stale_after_seconds

    def run_once(self, batch_size: int = 20) -> IndexReport:
        report = IndexReport(reclaimed=self.reclaim_stale(), purged=self.purge_archived())
        for _ in range(batch_size):
            job = self.claim()
            if job is None:
                break
            report += self.index(job)
        return report

    def claim(self) -> IndexJob | None:
        with self._uow.begin() as session:
            row = session.execute(_CLAIM).mappings().first()
            return IndexJob(**row) if row else None

    def index(self, job: IndexJob) -> IndexReport:
        try:
            return self._index(job)
        except Exception:
            logger.exception("knowledge index failed for revision %s", job.revision_id)
            self._fail(job, "internal error")
            return IndexReport(failed=1)

    def _index(self, job: IndexJob) -> IndexReport:
        if job.embedding_model != self._embedding.model:
            self._fail(job, f"embedding model not configured: {job.embedding_model}")
            return IndexReport(failed=1)
        drafts = chunk_document(job.title, job.body, chunk_size=self._chunk_size)
        hashes = list(dict.fromkeys(draft.chunk_hash for draft in drafts))
        with self._uow.begin() as session:
            known = set(session.execute(text(
                "SELECT chunk_hash FROM knowledge.embeddings WHERE embedding_model = :model "
                "AND chunk_hash = ANY(:hashes)"), {"model": job.embedding_model, "hashes": hashes}).scalars())
        missing = list({draft.chunk_hash: draft for draft in drafts if draft.chunk_hash not in known}.values())
        vectors = self._embedding.embed_documents(
            [DocumentText(job.title, draft.heading_path, draft.text) for draft in missing]) if missing else []
        if isinstance(vectors, EmbeddingUnavailable):
            self._fail(job, f"embedding {vectors.reason}")
            return IndexReport(failed=1)
        with self._uow.begin() as session:
            locked = session.execute(text(
                "SELECT r.index_status, r.claimed_at, d.active_revision_id "
                "FROM knowledge.document_revisions r JOIN knowledge.documents d ON d.id = r.document_id "
                "WHERE r.id = :id FOR UPDATE OF r, d"), {"id": job.revision_id}).one()
            if locked.index_status != "indexing" or locked.claimed_at != job.claimed_at:
                # The claim was reclaimed (and possibly re-claimed by another worker); this job no longer owns it.
                logger.info("knowledge index dropped for revision %s: claim no longer owned", job.revision_id)
                return IndexReport()
            # Separate statement: under READ COMMITTED it takes a fresh snapshot after the lock wait, so a
            # revision activated by another worker meanwhile is seen (a join in the locking query is not).
            active_revision = (session.execute(text(
                "SELECT revision FROM knowledge.document_revisions WHERE id = :id"),
                {"id": locked.active_revision_id}).scalar()
                if locked.active_revision_id is not None else None)
            if missing:
                session.execute(text(
                    "INSERT INTO knowledge.embeddings (chunk_hash, embedding_model, embedding) "
                    "VALUES (:hash, :model, CAST(:vector AS vector)) ON CONFLICT DO NOTHING"),
                    [{"hash": draft.chunk_hash, "model": job.embedding_model, "vector": vector_literal(vector)}
                     for draft, vector in zip(missing, vectors, strict=True)])
            if active_revision is None or job.revision >= active_revision:
                session.execute(text("DELETE FROM knowledge.chunks WHERE revision_id IN "
                                     "(SELECT id FROM knowledge.document_revisions WHERE document_id = :document)"),
                                {"document": job.document_id})
                if drafts:
                    session.execute(text(
                        "INSERT INTO knowledge.chunks (revision_id, ordinal, heading_path, text, chunk_hash) "
                        "VALUES (:revision, :ordinal, :heading_path, :text, :hash)"),
                        [{"revision": job.revision_id, "ordinal": draft.ordinal, "heading_path": draft.heading_path,
                          "text": draft.text, "hash": draft.chunk_hash} for draft in drafts])
                session.execute(text("UPDATE knowledge.documents SET active_revision_id = :revision WHERE id = :id"),
                                {"revision": job.revision_id, "id": job.document_id})
            session.execute(text("UPDATE knowledge.document_revisions SET index_status = 'ready', claimed_at = NULL "
                                 "WHERE id = :id"), {"id": job.revision_id})
        return IndexReport(indexed=1, embedded=len(missing), reused=len(hashes) - len(missing))

    def _fail(self, job: IndexJob, message: str) -> None:
        with self._uow.begin() as session:
            session.execute(text(
                "UPDATE knowledge.document_revisions SET index_status = 'error', error = :error, claimed_at = NULL "
                "WHERE id = :id AND index_status = 'indexing' AND claimed_at = :claimed_at"),
                {"error": message[:500], "id": job.revision_id, "claimed_at": job.claimed_at})

    def reclaim_stale(self) -> int:
        with self._uow.begin() as session:
            return session.execute(text(
                "UPDATE knowledge.document_revisions SET index_status = 'pending', claimed_at = NULL "
                "WHERE index_status = 'indexing' AND claimed_at < clock_timestamp() - make_interval(secs => :age)"),
                {"age": self._stale_after_seconds}).rowcount

    def purge_archived(self) -> int:
        with self._uow.begin() as session:
            return session.execute(text(
                "DELETE FROM knowledge.chunks c USING knowledge.document_revisions r, knowledge.documents d "
                "WHERE c.revision_id = r.id AND r.document_id = d.id AND d.status = 'archived'")).rowcount

    def retry_errors(self, kb_id: str | None = None) -> int:
        """Send failed active-document revisions back to the queue (optionally for one knowledge base)."""
        with self._uow.begin() as session:
            return session.execute(text(
                "UPDATE knowledge.document_revisions SET index_status = 'pending', claimed_at = NULL, error = NULL "
                "WHERE index_status = 'error' AND id IN (SELECT latest_revision_id FROM knowledge.documents "
                "WHERE status = 'active' AND (CAST(:kb AS text) IS NULL OR kb_id = :kb))"), {"kb": kb_id}).rowcount

    def requeue_knowledge_base(self, kb_id: str) -> int:
        """Re-embed every active revision, e.g. after the knowledge base's embedding model changes."""
        with self._uow.begin() as session:
            return session.execute(text(
                "UPDATE knowledge.document_revisions SET index_status = 'pending', claimed_at = NULL, error = NULL "
                "WHERE index_status <> 'indexing' AND id IN (SELECT active_revision_id FROM knowledge.documents "
                "WHERE kb_id = :kb AND status = 'active' AND active_revision_id IS NOT NULL)"), {"kb": kb_id}).rowcount
