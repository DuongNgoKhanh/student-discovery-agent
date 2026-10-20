"""Immutable result generations with a single mutable validity flag."""
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from agent_runtime.infrastructure.db.tables import activities, result_snapshots
from agent_runtime.sessions.schemas.result import ResultSnapshotInput, StoredResult


class ResultRepository:
    def parent_reference(self, session: Session, result_id: str) -> tuple[str, str] | None:
        """Read IDs only, before locking/checking the owning conversation."""
        row = session.execute(select(activities.c.conversation_id, activities.c.id).join(
            result_snapshots, result_snapshots.c.activity_id == activities.c.id).where(
                result_snapshots.c.result_id == result_id)).one_or_none()
        return (row[0], row[1]) if row is not None else None

    def get(self, session: Session, activity_id: str, result_id: str) -> StoredResult | None:
        row = session.execute(select(result_snapshots).where(result_snapshots.c.result_id == result_id,
                              result_snapshots.c.activity_id == activity_id)).mappings().one_or_none()
        return StoredResult.model_validate(dict(row)) if row is not None else None

    def latest_revision(self, session: Session, activity_id: str) -> int:
        return session.scalar(select(func.coalesce(func.max(result_snapshots.c.result_revision), 0))
                              .where(result_snapshots.c.activity_id == activity_id))

    def insert(self, session: Session, result: ResultSnapshotInput, created_at: datetime) -> None:
        session.execute(result_snapshots.insert().values(**result.model_dump(mode="json"), validity="valid",
                                                        created_at=created_at))

    def invalidate(self, session: Session, activity_id: str, result_ids: tuple[str, ...]) -> None:
        if result_ids:
            session.execute(result_snapshots.update().where(result_snapshots.c.activity_id == activity_id,
                             result_snapshots.c.result_id.in_(result_ids)).values(validity="superseded"))
