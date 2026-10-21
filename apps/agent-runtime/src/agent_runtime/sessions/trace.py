"""Protocol-neutral, metadata-only observation after service transaction exit."""
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from functools import wraps
from time import monotonic_ns
from typing import Annotated, Literal, Protocol
from uuid import uuid4

from pydantic import ConfigDict, Field, StringConstraints

from agent_runtime.sessions.schemas.common import ContractModel, JsonSafeInt, UtcDatetime

Reference = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=128,
                                            pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")]
EventId = Annotated[str, StringConstraints(strict=True, pattern=r"^[a-f0-9]{32}$")]
CorrelationId = Annotated[str, StringConstraints(strict=True, pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")]
Action = Literal["conversation.create", "conversation.read", "conversation.end", "conversation.turn",
                 "history.read", "activity.start", "activity.commit", "result.read", "share.read"]


class TraceEvent(ContractModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)
    event_id: EventId
    request_id: CorrelationId
    trace_id: CorrelationId | None = None
    conversation_id: Reference | None = None
    activity_id: Reference | None = None
    result_id: Reference | None = None
    action: Action
    step: Literal["complete"]
    outcome: Literal["success", "replayed", "failure"]
    error_code: Literal["SERVICE_FAILURE"] | None = None
    before_revision: JsonSafeInt | None = None
    after_revision: JsonSafeInt | None = None
    environment: Literal["demo"] | None = None
    agent_release_id: Reference | None = None
    experience_release_id: Reference | None = None
    algorithm_profile: Literal["riasec.mean.bounds.v2"] | None = None
    engine_version: Reference | None = None
    latency_ms: JsonSafeInt | None = None
    provider: Literal["openai"] | None = None
    fallback: Annotated[bool, Field(strict=True)] | None = None
    timestamp: UtcDatetime


class TraceSink(Protocol):
    def emit(self, event: TraceEvent) -> None: ...


_context: ContextVar[tuple[str, str] | None] = ContextVar("runtime_trace_context", default=None)
logger = logging.getLogger(__name__)


@contextmanager
def trace_context(request_id: str, trace_id: str):
    # HTTP supplies generated UUIDs; other adapters get the same validation.
    from pydantic import TypeAdapter

    value = (TypeAdapter(CorrelationId).validate_python(request_id), TypeAdapter(CorrelationId).validate_python(trace_id))
    token = _context.set(value)
    try:
        yield
    finally:
        _context.reset(token)


def observed(action: Action):
    """Never inspect caller, input, response payload, paths or exception text."""
    def decorate(method):
        @wraps(method)
        def call(self, *args, **kwargs):
            sink = self.trace_sink
            if sink is None:
                return method(self, *args, **kwargs)
            start = monotonic_ns()
            outcome = "failure"
            try:
                response = method(self, *args, **kwargs)
                outcome = "replayed" if response.replayed else "success"
                return response
            finally:
                # All service-owned UoWs have already exited, even on early return.
                try:
                    request_id, trace_id = _context.get() or (str(uuid4()), str(uuid4()))
                    sink.emit(TraceEvent(event_id=uuid4().hex, request_id=request_id, trace_id=trace_id,
                        action=action, step="complete", outcome=outcome,
                        error_code="SERVICE_FAILURE" if outcome == "failure" else None,
                        latency_ms=max(0, (monotonic_ns() - start) // 1_000_000), timestamp=datetime.now(UTC)))
                except Exception:
                    logger.warning("TRACE_SINK_FAILURE")
        return call
    return decorate
