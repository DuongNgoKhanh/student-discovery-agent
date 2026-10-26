"""Raw data cannot enter trace DTOs, logging, or cleanup config fallbacks."""
import os
import subprocess
import sys
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from agent_runtime.sessions.trace import TraceEvent


def trace_type():
    return TraceEvent


def fields():
    return dict(event_id=uuid4().hex, request_id=str(uuid4()), action="conversation.create",
                step="complete", outcome="success", timestamp=datetime.now(UTC))


@pytest.mark.parametrize("field", ["owner_id", "display_name", "input", "token", "path", "proposal",
                                    "result_payload", "exception", "sql_parameters", "raw_output"])
def test_trace_rejects_raw_fields(field):
    model = trace_type()
    with pytest.raises(ValidationError):
        model(**fields(), **{field: "private-value"})


@pytest.mark.parametrize("field,value", [("action", "private text"), ("step", "private text"),
    ("outcome", "private text"), ("request_id", "raw/path"), ("trace_id", "name"),
    ("error_code", "raw database error"), ("timestamp", datetime(2026, 1, 1)), ("latency_ms", True)])
def test_trace_rejects_unbounded_or_untyped_metadata(field, value):
    model = trace_type()
    with pytest.raises(ValidationError):
        model(**(fields() | {field: value}))


@pytest.mark.parametrize("url", [None, "postgresql://synthetic-secret@invalid.invalid/db"])
def test_cli_fails_closed_without_leaking_credentials(url):
    trace_type()
    environment = dict(os.environ)
    environment.pop("RUNTIME_CLEANUP_DATABASE_URL", None)
    environment["RUNTIME_DATABASE_URL"] = "synthetic-runtime-secret"
    environment["DATABASE_URL"] = "synthetic-product-secret"
    if url:
        environment["RUNTIME_CLEANUP_DATABASE_URL"] = url
    result = subprocess.run([sys.executable, "-m", "agent_runtime.cli.cleanup", "--once"],
        env=environment, capture_output=True, text=True, timeout=20)
    assert result.returncode != 0
    assert "synthetic" not in result.stdout + result.stderr
    assert "Traceback" not in result.stdout + result.stderr


def test_cli_bad_arguments_do_not_echo_raw_values():
    result = subprocess.run([sys.executable, "-m", "agent_runtime.cli.cleanup", "--once", "--batch-size",
        "synthetic-private-value"], capture_output=True, text=True, timeout=20)
    assert result.returncode == 2
    assert "synthetic-private-value" not in result.stdout + result.stderr


class _Sink:
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(event)


def _observed_service(data, describe):
    from agent_runtime.sessions.schemas.common import ServiceResponse
    from agent_runtime.sessions.trace import observed

    class Service:
        trace_sink = _Sink()

        @observed("conversation.turn", describe)
        def run(self):
            return ServiceResponse(status=200, data=data)

    service = Service()
    service.run()
    return service.trace_sink.events[0]


def test_replayed_turn_trace_carries_identifiers_only():
    from agent_runtime.sessions.services.turns import describe_turn
    data = {"conversation_id": "conv1", "status": "completed", "revision": 15, "activity": {
        "id": "act1", "algorithm_profile": "riasec.mean.bounds.v2",
        "display_name": "Ngân", "result": {"result_id": "res1", "result_revision": 1}}}
    event = _observed_service(data, describe_turn)
    assert (event.conversation_id, event.activity_id, event.result_id, event.before_revision,
            event.after_revision, event.algorithm_profile) == (
        "conv1", "act1", "res1", 15, 15, "riasec.mean.bounds.v2")
    assert "Ngân" not in str(event.model_dump())


class _TurnStore:
    """Begins one turn; ``fail`` records the terminal failed Response."""
    uow = None
    access = SimpleNamespace(clock=None)

    def __init__(self, replay=None):
        from agent_runtime.sessions.schemas.responses import TurnResponse
        from agent_runtime.sessions.services.turns import Begun
        self.replay = replay
        pending = TurnResponse(id="resp1", conversation_id="conv1", status="in_progress", revision=4,
                               input_message_id="msg1", created_at=datetime(2026, 10, 26, tzinfo=UTC))
        self.begun = Begun(pending, request=None, fingerprint="f", owner_id="owner",
                           snapshot=SimpleNamespace(release=SimpleNamespace(release_id="exp-rel")))

    def begin(self, caller, conversation_id, request):
        return self.replay or self.begun

    def fail(self, begun, code):
        from agent_runtime.sessions.schemas.responses import ResponseError
        return begun.response.model_copy(update={"status": "failed", "error": ResponseError(code=code)})


def _turn_service(store, run):
    from agent_runtime.sessions.services.turns import TurnService
    service = TurnService(store, handler=None, responses=object(), trace_sink=_Sink())
    service._run = run
    return service


def _raise(*args):
    from agent_runtime.sessions.errors import RuntimeSessionError
    raise RuntimeSessionError(422, "ENGINE_FAILURE")


def test_failed_response_is_traced_once_as_failure():
    store = _TurnStore()
    service = _turn_service(store, _raise)
    data = service.submit(None, "conv1", None).data
    (event,) = service.trace_sink.events
    assert data["status"] == "failed" and (event.outcome, event.error_code) == ("failure", "SERVICE_FAILURE")
    assert (event.conversation_id, event.before_revision, event.after_revision, event.experience_release_id) == (
        "conv1", 4, 4, "exp-rel")


def test_completed_response_is_traced_once_with_the_pinned_release():
    store = _TurnStore()
    service = _turn_service(store, lambda caller, begun, on_event: begun.response.model_copy(
        update={"status": "completed", "revision": 5}))
    service.finish(None, service.begin(None, "conv1", None))
    (event,) = service.trace_sink.events
    assert (event.outcome, event.error_code, event.before_revision, event.after_revision,
            event.experience_release_id) == ("success", None, 4, 5, "exp-rel")


def test_replay_and_rejection_are_traced_by_begin_only():
    from agent_runtime.sessions.errors import RuntimeSessionError
    from agent_runtime.sessions.schemas.common import ServiceResponse
    replay = ServiceResponse(status=200, data={"conversation_id": "conv1", "status": "completed", "revision": 5,
                                               "activity": None}, replayed=True)
    service = _turn_service(_TurnStore(replay=replay), _raise)
    assert service.submit(None, "conv1", None) is replay
    rejecting = _TurnStore()
    rejecting.begin = _raise
    service.store = rejecting
    with pytest.raises(RuntimeSessionError):
        service.submit(None, "conv1", None)
    assert [(e.outcome, e.after_revision) for e in service.trace_sink.events] == [("replayed", 5), ("failure", None)]


@pytest.mark.parametrize("describe", [
    lambda response: {"display_name": "Ngân"},
    lambda response: {"conversation_id": "bad id/with path"},
    lambda response: 1 / 0,
])
def test_bad_trace_description_drops_metadata_not_the_event(describe):
    event = _observed_service({}, describe)
    assert event.outcome == "success" and event.conversation_id is None
    assert "Ngân" not in str(event.model_dump())
