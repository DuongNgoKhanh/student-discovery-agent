"""One bounded, retry-safe retention transaction, without student credentials."""
import logging
from dataclasses import dataclass
from datetime import timedelta

from agent_runtime.infrastructure.db.cleanup import CleanupRepository
from agent_runtime.infrastructure.db.session import DatabaseClock
from agent_runtime.sessions.repositories.conversations import ConversationRepository
from agent_runtime.sessions.services.lifecycle import LifecycleService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CleanupReport:
    expired: int = 0
    purged: int = 0
    traces_purged: int = 0
    failed_batches: int = 0


class CleanupService:
    def __init__(self, uow, *, clock=None):
        self.uow = uow
        self.clock = clock if clock is not None else DatabaseClock()
        self.repository = CleanupRepository()
        self.conversations = ConversationRepository()
        self.lifecycle = LifecycleService(uow, clock=self.clock)

    def run_once(self, batch_size: int = 100) -> CleanupReport:
        if type(batch_size) is not int or not 1 <= batch_size <= 100:
            raise ValueError("cleanup batch size must be between 1 and 100")
        expired = purged = 0
        content_checks = []
        try:
            with self.uow.begin() as session:
                candidate_checked_at = self.clock.now(session)
                candidates = self.repository.lock_candidates(session, candidate_checked_at, batch_size)
                for identity, owner in candidates:
                    # Re-read current data while this transaction owns the parent lock.
                    parent = self.conversations.get(session, identity, owner, lock="write")
                    now = self.clock.now(session)
                    content_checks.append(now)
                    if parent.status == "active" and now >= parent.expires_at:
                        self.lifecycle.materialize_expiry(session, parent, now)
                        expired += 1
                    closed_at = self.lifecycle.effective_closed_at(parent, now)
                    if closed_at is not None and now >= closed_at + timedelta(seconds=parent.content_retention_seconds):
                        self.repository.purge_parent(session, identity)
                        purged += 1
                trace_checked_at = self.clock.now(session)
                traces = self.repository.purge_traces(session, trace_checked_at, batch_size)
        except Exception:
            # Counts represent committed work only. Never interpolate DB exceptions.
            logger.error("CLEANUP_BATCH_FAILURE")
            return CleanupReport(failed_batches=1)
        # Report the exact eligibility clocks used, only after a successful commit.
        # Content has per-parent pinned cutoffs; the range is recheck time, not a
        # single content cutoff. Trace has its own independent timestamp cutoff.
        logger.info("CLEANUP_BATCH_COMMITTED candidate_checked_at=%s content_checked_from=%s "
            "content_checked_through=%s content_cutoff_policy=effective_closed_at_plus_pinned_retention "
            "trace_checked_at=%s trace_timestamp_cutoff=%s trace_retention_seconds=86400",
            candidate_checked_at.isoformat(), min(content_checks).isoformat() if content_checks else "none",
            max(content_checks).isoformat() if content_checks else "none", trace_checked_at.isoformat(),
            (trace_checked_at - timedelta(seconds=86400)).isoformat())
        return CleanupReport(expired, purged, traces)
