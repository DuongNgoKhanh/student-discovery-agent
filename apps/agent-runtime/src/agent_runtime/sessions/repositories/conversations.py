"""Conversation rows; mutations are called only while holding the parent write lock."""
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from agent_runtime.infrastructure.db.tables import conversations
from agent_runtime.sessions.schemas.conversation import ConversationRecord


class ConversationRepository:
    def get(self, session: Session, conversation_id: str, owner_id: str, *,
            lock: Literal["read", "write"] = "read") -> ConversationRecord | None:
        row = session.execute(select(conversations).where(
            conversations.c.id == conversation_id, conversations.c.owner_id == owner_id,
        ).with_for_update(read=lock == "read")).mappings().one_or_none()
        if row is None:
            return None
        values = dict(row)
        values["agent_snapshot"] = {name: values.pop(f"agent_{name}")
                                    for name in ("environment", "kind", "release_id")}
        return ConversationRecord.model_validate(values)

    def insert(self, session: Session, record: ConversationRecord) -> None:
        values = record.model_dump()
        pin = values.pop("agent_snapshot")
        values.update({f"agent_{name}": value for name, value in pin.items()})
        values["capability_snapshot"] = record.capability_snapshot.model_dump(mode="json")
        session.execute(conversations.insert().values(**values))

    def save(self, session: Session, record: ConversationRecord) -> None:
        # Pin, owner, capabilities and deadlines cannot be changed through mutation primitives.
        values = record.model_dump(include={"status", "revision", "display_name", "active_activity_id", "ended_at"})
        session.execute(conversations.update().where(conversations.c.id == record.id,
                                                     conversations.c.owner_id == record.owner_id).values(**values))
