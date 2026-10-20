"""Versioned activity storage without release or capability mutation."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from agent_runtime.infrastructure.db.tables import activities
from agent_runtime.sessions.schemas.activity import ActivityRecord


def state_values(record: ActivityRecord) -> dict:
    state = record.state
    return dict(state=state.model_dump(mode="json"), type=state.type, view_schema_version=state.schema_version,
                state_schema_version=state.state_schema_version, algorithm_profile=getattr(state, "algorithm_profile", None),
                status=state.status, revision=record.revision, closed_at=record.closed_at)


def _record(row) -> ActivityRecord:
    values = {name: row[name] for name in ActivityRecord.model_fields if name != "experience_snapshot"}
    values["experience_snapshot"] = {name: row[f"experience_{name}"]
                                     for name in ("environment", "kind", "release_id")}
    return ActivityRecord.model_validate(values)


class ActivityRepository:
    def for_closure(self, session: Session, conversation_id: str) -> tuple[ActivityRecord, ...]:
        """All nonclosed children, including completed; caller owns the parent write lock."""
        rows = session.execute(select(activities).where(
            activities.c.conversation_id == conversation_id,
            activities.c.status.not_in(("ended", "expired")),
        ).order_by(activities.c.id)).mappings()
        return tuple(_record(row) for row in rows)

    def conversation_id(self, session: Session, activity_id: str) -> str | None:
        """Resolve only the parent reference; content requires its access lock."""
        return session.scalar(select(activities.c.conversation_id).where(activities.c.id == activity_id))

    def get(self, session: Session, conversation_id: str, activity_id: str) -> ActivityRecord | None:
        row = session.execute(select(activities).where(activities.c.id == activity_id,
                              activities.c.conversation_id == conversation_id)).mappings().one_or_none()
        if row is None:
            return None
        return _record(row)

    def insert(self, session: Session, record: ActivityRecord) -> None:
        values = record.model_dump(exclude={"state", "experience_snapshot"})
        values.update({f"experience_{name}": value for name, value in record.experience_snapshot.model_dump().items()})
        session.execute(activities.insert().values(**(values | state_values(record))))

    def save(self, session: Session, record: ActivityRecord) -> None:
        values = state_values(record)
        # Discriminators/profile belong to the pinned identity, not a harness patch.
        for key in ("type", "view_schema_version", "state_schema_version", "algorithm_profile"):
            values.pop(key)
        session.execute(activities.update().where(activities.c.id == record.id,
                         activities.c.conversation_id == record.conversation_id).values(**values))
