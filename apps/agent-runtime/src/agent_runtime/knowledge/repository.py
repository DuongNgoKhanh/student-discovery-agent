"""Shared knowledge reads."""
from sqlalchemy import text
from sqlalchemy.orm import Session

from agent_runtime.knowledge.schemas import MetadataField


def load_fields(session: Session, kb_id: str) -> tuple[MetadataField, ...]:
    rows = session.execute(text(
        "SELECT id, name, type, filterable, label FROM knowledge.metadata_fields "
        "WHERE kb_id = :kb ORDER BY ordinal, name"), {"kb": kb_id}).mappings()
    return tuple(MetadataField.model_validate(dict(row)) for row in rows)
