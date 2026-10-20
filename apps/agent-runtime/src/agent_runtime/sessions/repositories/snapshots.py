"""Shared snapshots: insert once, compare on collision, never update."""
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from agent_runtime.infrastructure.db.tables import release_snapshots
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.release import ReleaseKey, ValidatedRelease
from agent_runtime.sessions.services.releases import validate_snapshot_integrity


class SnapshotRepository:
    def store(self, session: Session, release: ValidatedRelease) -> ReleaseKey:
        checked = validate_snapshot_integrity(release)
        key = ReleaseKey(environment=checked.environment, kind=checked.kind, release_id=checked.release_id)
        session.execute(insert(release_snapshots).values(**checked.model_dump(mode="json"))
                        .on_conflict_do_nothing(index_elements=["environment", "kind", "release_id"]))
        # READ COMMITTED gives this separate statement a fresh snapshot after a
        # competing INSERT commits. No UPDATE is needed or allowed on this table.
        if self.get(session, key) != checked:
            raise RuntimeSessionError(422, "INCOMPATIBLE_RELEASE")
        return key

    def get(self, session: Session, key: ReleaseKey) -> ValidatedRelease:
        row = session.execute(select(release_snapshots).where(
            release_snapshots.c.environment == key.environment,
            release_snapshots.c.kind == key.kind,
            release_snapshots.c.release_id == key.release_id,
        )).mappings().one_or_none()
        if row is None:
            raise RuntimeSessionError(500, "INTERNAL_ERROR")
        try:
            release = ValidatedRelease.model_validate({name: row[name] for name in ValidatedRelease.model_fields})
            return validate_snapshot_integrity(release)
        except (ValueError, RuntimeSessionError):
            raise RuntimeSessionError(500, "INTERNAL_ERROR") from None
