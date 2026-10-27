"""Content writes for the seed CLI and tests; Studio gets its own TypeScript writer in phase 3."""
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from sqlalchemy import text

from agent_runtime.knowledge.hashing import content_hash
from agent_runtime.knowledge.metadata import MetadataError, validate_metadata
from agent_runtime.knowledge.repository import load_fields
from agent_runtime.knowledge.schemas import FieldType, MetadataField


@dataclass(frozen=True)
class PutResult:
    document_id: str
    revision: int
    created: bool


class KnowledgeWriter:
    def __init__(self, uow, new_id: Callable[[], str] = lambda: uuid4().hex):
        self._uow = uow
        self._new_id = new_id

    def create_knowledge_base(self, kb_id: str, name: str, embedding_model: str, description: str = "") -> None:
        with self._uow.begin() as session:
            session.execute(text(
                "INSERT INTO knowledge.knowledge_bases (id, name, description, embedding_model) "
                "VALUES (:id, :name, :description, :model) ON CONFLICT (id) DO UPDATE "
                "SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = clock_timestamp()"),
                {"id": kb_id, "name": name, "description": description, "model": embedding_model})

    def fields(self, kb_id: str) -> tuple[MetadataField, ...]:
        with self._uow.begin() as session:
            return load_fields(session, kb_id)

    def put_field(self, kb_id: str, name: str, type: FieldType, *, filterable: bool = False, label: str = "",
                  ordinal: int = 0) -> MetadataField:
        with self._uow.begin() as session:
            existing = next((field for field in load_fields(session, kb_id) if field.name == name), None)
            if existing is not None and existing.type != type:
                raise MetadataError(f"metadata field type is immutable: {name}")
            field_id = existing.id if existing else f"fld_{self._new_id()}"
            session.execute(text(
                "INSERT INTO knowledge.metadata_fields (id, kb_id, name, type, filterable, label, ordinal) "
                "VALUES (:id, :kb, :name, :type, :filterable, :label, :ordinal) ON CONFLICT (id) DO UPDATE "
                "SET filterable = EXCLUDED.filterable, label = EXCLUDED.label, ordinal = EXCLUDED.ordinal"),
                {"id": field_id, "kb": kb_id, "name": name, "type": type, "filterable": filterable, "label": label,
                 "ordinal": ordinal})
            return MetadataField(id=field_id, name=name, type=type, filterable=filterable, label=label)

    def put_document(self, kb_id: str, document_id: str, *, title: str, body: str,
                     metadata: Mapping[str, Any] | None = None, source_url: str | None = None) -> PutResult:
        with self._uow.begin() as session:
            stored = validate_metadata(load_fields(session, kb_id), metadata or {})
            digest = content_hash(title, body, source_url, stored)
            session.execute(text(
                "INSERT INTO knowledge.documents (id, kb_id) VALUES (:id, :kb) ON CONFLICT (id) DO NOTHING"),
                {"id": document_id, "kb": kb_id})
            current = session.execute(text(
                "SELECT d.kb_id, d.revision, r.content_hash FROM knowledge.documents d "
                "LEFT JOIN knowledge.document_revisions r ON r.id = d.latest_revision_id "
                "WHERE d.id = :id FOR UPDATE OF d"), {"id": document_id}).one()
            if current.kb_id != kb_id:
                raise MetadataError(f"document {document_id} belongs to another knowledge base")
            if current.content_hash == digest:
                return PutResult(document_id, current.revision, created=False)
            revision, revision_id = current.revision + 1, f"rev_{self._new_id()}"
            session.execute(text(
                "INSERT INTO knowledge.document_revisions "
                "(id, document_id, revision, title, body, source_url, metadata, content_hash) "
                "VALUES (:id, :document, :revision, :title, :body, :url, CAST(:metadata AS jsonb), :hash)"),
                {"id": revision_id, "document": document_id, "revision": revision, "title": title, "body": body,
                 "url": source_url, "metadata": json.dumps(stored, ensure_ascii=False), "hash": digest})
            session.execute(text(
                "UPDATE knowledge.documents SET revision = :revision, latest_revision_id = :latest, "
                "updated_at = clock_timestamp() WHERE id = :id"),
                {"revision": revision, "latest": revision_id, "id": document_id})
            return PutResult(document_id, revision, created=True)

    def archive(self, document_id: str) -> None:
        with self._uow.begin() as session:
            session.execute(text("UPDATE knowledge.documents SET status = 'archived', updated_at = clock_timestamp() "
                                 "WHERE id = :id"), {"id": document_id})
