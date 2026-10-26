"""Append immutable history in parent-lock order."""
from datetime import datetime

from sqlalchemy import func, null, select
from sqlalchemy.orm import Session

from agent_runtime.infrastructure.db.tables import messages
from agent_runtime.sessions.schemas.activity import NewMessage
from agent_runtime.sessions.schemas.history import MessageView


class MessageRepository:
    def page(self, session: Session, conversation_id: str, watermark_revision: int,
             last_ordinal: int, limit: int) -> list[tuple[int, MessageView]]:
        rows = session.execute(select(messages).where(messages.c.conversation_id == conversation_id,
            messages.c.committed_conversation_revision <= watermark_revision,
            messages.c.ordinal > last_ordinal).order_by(messages.c.ordinal.asc()).limit(limit)).mappings()
        return [(row["ordinal"], MessageView(**{name: row[name] for name in NewMessage.model_fields},
            conversation_revision=row["committed_conversation_revision"], created_at=row["committed_at"]))
            for row in rows]

    def recent(self, session: Session, conversation_id: str, limit: int) -> list[MessageView]:
        """The last ``limit`` committed messages, oldest first."""
        rows = session.execute(select(messages).where(messages.c.conversation_id == conversation_id)
            .order_by(messages.c.ordinal.desc()).limit(limit)).mappings()
        return [MessageView(**{name: row[name] for name in NewMessage.model_fields},
                            conversation_revision=row["committed_conversation_revision"], created_at=row["committed_at"])
                for row in reversed(list(rows))]

    def append(self, session: Session, conversation_id: str, revision: int,
               items: tuple[NewMessage, ...], committed_at: datetime) -> None:
        ordinal = session.scalar(select(func.coalesce(func.max(messages.c.ordinal), 0)).where(
            messages.c.conversation_id == conversation_id))
        for item in items:
            ordinal += 1
            values = item.model_dump(mode="json")
            if item.interaction is None:
                values["interaction"] = null()
            session.execute(messages.insert().values(**values, conversation_id=conversation_id,
                ordinal=ordinal, committed_conversation_revision=revision, committed_at=committed_at))
