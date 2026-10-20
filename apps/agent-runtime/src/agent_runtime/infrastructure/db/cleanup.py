"""Bounded cleanup queries. Parent cascades are owned by the caller transaction."""
from datetime import timedelta

from sqlalchemy import and_, delete, func, or_, select, text

from agent_runtime.infrastructure.db.tables import conversations, runtime_traces


class CleanupRepository:
    def lock_candidates(self, session, now, batch_size):
        # Matches the migration's immutable UTC cleanup index expression.
        cutoff = (func.timezone("UTC", func.coalesce(conversations.c.ended_at, conversations.c.expires_at))
                  + conversations.c.content_retention_seconds * text("interval '1 second'"))
        eligible = or_(
            and_(conversations.c.status == "active", conversations.c.expires_at <= now),
            and_(conversations.c.status.in_(("ended", "expired")), cutoff <= now.replace(tzinfo=None)),
        )
        return session.execute(select(conversations.c.id, conversations.c.owner_id).where(eligible)
            .order_by(conversations.c.expires_at, conversations.c.id).limit(batch_size)
            .with_for_update(skip_locked=True)).all()

    def purge_parent(self, session, conversation_id):
        # FK CASCADE covers activities, all result projections, messages and outcomes,
        # including create outcomes. Releases and traces have no cascading parent FK.
        session.execute(delete(conversations).where(conversations.c.id == conversation_id))

    def purge_traces(self, session, now, batch_size):
        candidates = select(runtime_traces.c.event_id).where(
            runtime_traces.c.timestamp <= now - timedelta(seconds=86400)
        ).order_by(runtime_traces.c.timestamp, runtime_traces.c.event_id).limit(batch_size).with_for_update(skip_locked=True)
        return session.execute(delete(runtime_traces).where(runtime_traces.c.event_id.in_(candidates))).rowcount
