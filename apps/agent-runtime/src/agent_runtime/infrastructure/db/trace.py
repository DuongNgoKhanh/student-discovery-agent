"""Trace storage uses an independent transaction, never the business session."""
from agent_runtime.infrastructure.db.tables import runtime_traces
from agent_runtime.sessions.trace import TraceEvent


class DatabaseTraceSink:
    def __init__(self, uow):
        self.uow = uow

    def emit(self, event: TraceEvent) -> None:
        # Revalidate model_copy/model_construct so adapter cannot persist unknown fields.
        value = TraceEvent.model_validate(event.model_dump())
        with self.uow.begin() as session:
            session.execute(runtime_traces.insert().values(**value.model_dump()))
