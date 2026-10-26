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


def observed(action: Action, describe=None):
    """Never inspect caller, input, paths or exception text.

    ``describe(response) -> dict`` may map a committed response to TraceEvent identifiers/revisions; it must
    return metadata only. Its failures drop the metadata, never the event or the business outcome.
    """
    def decorate(method):
        @wraps(method)
        def call(self, *args, **kwargs):
            sink = self.trace_sink
            if sink is None:
                return method(self, *args, **kwargs)
            start = monotonic_ns()
            outcome, metadata = "failure", {}
            try:
                response = method(self, *args, **kwargs)
                outcome = "replayed" if response.replayed else "success"
                metadata = _describe(describe, response)
                return response
            finally:
                # All service-owned UoWs have already exited, even on early return.
                emit_trace(sink, action, outcome, metadata, start)
        return call
    return decorate


def emit_trace(sink: TraceSink | None, action: Action, outcome: Literal["success", "replayed", "failure"],
               metadata: dict, start_ns: int) -> None:
    """One completed-step event after the service's UoWs exited; ``metadata`` comes from ``describe_metadata``.

    Sink failures are logged by code only and never reach the business outcome.
    """
    if sink is None:
        return
    try:
        request_id, trace_id = _context.get() or (str(uuid4()), str(uuid4()))
        sink.emit(TraceEvent(**metadata, event_id=uuid4().hex, request_id=request_id, trace_id=trace_id,
            action=action, step="complete", outcome=outcome,
            error_code="SERVICE_FAILURE" if outcome == "failure" else None,
            latency_ms=max(0, (monotonic_ns() - start_ns) // 1_000_000), timestamp=datetime.now(UTC)))
    except Exception:
        logger.warning("TRACE_SINK_FAILURE")


def describe_metadata(describe, subject) -> dict:
    """Validated identifiers/revisions only; any problem drops the metadata, never the event."""
    return _describe(describe, subject)


_DESCRIBED = frozenset({"conversation_id", "activity_id", "result_id", "before_revision", "after_revision",
                        "experience_release_id", "algorithm_profile"})


def _describe(describe, response) -> dict:
    if describe is None:
        return {}
    try:
        metadata = {key: value for key, value in describe(response).items() if value is not None}
        if not metadata.keys() <= _DESCRIBED:
            return {}
        # Validate in isolation so a bad identifier drops the metadata, not the whole event.
        TraceEvent.model_validate(metadata | {"event_id": uuid4().hex, "request_id": str(uuid4()),
                                              "action": "conversation.turn", "step": "complete",
                                              "outcome": "success", "timestamp": datetime.now(UTC)})
        return metadata
    except Exception:
        return {}
