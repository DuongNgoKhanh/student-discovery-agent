"""Response reads and cancellation; the parent lock serialises cancel against commit."""
from datetime import timedelta

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.responses import ResponseRepository
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.schemas.responses import TurnResponse
from agent_runtime.sessions.services.access import AccessPolicy

# GET cannot see the agent's turn limit; begin uses the agent's own turn_timeout_ms + 30s.
DEFAULT_STALE = timedelta(seconds=60)


class ResponseService:
    def __init__(self, uow, *, clock=None, trace_sink=None):
        self.uow = uow
        self.access = AccessPolicy(clock=clock)
        self.repo = ResponseRepository()
        self.trace_sink = trace_sink

    def read_model(self, caller: VerifiedCaller, response_id: str) -> TurnResponse:
        with self.uow.begin() as session:
            row = self.repo.get(session, response_id, owner_id=caller.owner_id)
            if row is None:
                raise RuntimeSessionError(404, "RESOURCE_NOT_FOUND")
            if row.status == "in_progress":
                self.repo.expire_stale(session, row.conversation_id, now=self.access.clock.now(session),
                                       older_than=DEFAULT_STALE)
                row = self.repo.get(session, response_id, owner_id=caller.owner_id)
        return row

    def read(self, caller: VerifiedCaller, response_id: str) -> ServiceResponse:
        return ServiceResponse(status=200, data=self.read_model(caller, response_id).model_dump(mode="json"))

    def is_finished(self, caller: VerifiedCaller, response_id: str) -> bool:
        """One primary-key read; a missing row counts as finished so a running turn stops."""
        with self.uow.begin() as session:
            row = self.repo.get(session, response_id, owner_id=caller.owner_id)
        return row is None or row.status != "in_progress"

    def cancel(self, caller: VerifiedCaller, response_id: str) -> ServiceResponse:
        with self.uow.begin() as session:
            row = self.repo.get(session, response_id, owner_id=caller.owner_id)
            if row is None:
                raise RuntimeSessionError(404, "RESOURCE_NOT_FOUND")
            self.access.lock_open(session, caller, row.conversation_id, write=True)  # same lock as commit
            row = self.repo.get(session, response_id, owner_id=caller.owner_id, for_update=True)
            if row.status == "in_progress":
                row = row.model_copy(update={"status": "cancelled", "completed_at": self.access.clock.now(session)})
                self.repo.finish(session, row)
            elif row.status != "cancelled":
                raise RuntimeSessionError(409, "RESPONSE_NOT_CANCELLABLE", {"status": row.status})
        return ServiceResponse(status=200, data=row.model_dump(mode="json"))
