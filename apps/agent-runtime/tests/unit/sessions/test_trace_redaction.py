"""Raw data cannot enter trace DTOs, logging, or cleanup config fallbacks."""
import os
import subprocess
import sys
from datetime import UTC, datetime
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


def test_turn_trace_carries_completion_identifiers_only():
    from agent_runtime.sessions.services.turns import describe_turn
    data = {"conversation_id": "conv1", "status": "completed", "revision": 15, "activity": {
        "id": "act1", "algorithm_profile": "riasec.mean.bounds.v2",
        "display_name": "Ngân", "result": {"result_id": "res1", "result_revision": 1}}}
    event = _observed_service(data, describe_turn)
    assert (event.conversation_id, event.activity_id, event.result_id, event.before_revision,
            event.after_revision, event.experience_release_id, event.algorithm_profile) == (
        "conv1", "act1", "res1", 14, 15, None, "riasec.mean.bounds.v2")
    assert "Ngân" not in str(event.model_dump())


@pytest.mark.parametrize("describe", [
    lambda response: {"display_name": "Ngân"},
    lambda response: {"conversation_id": "bad id/with path"},
    lambda response: 1 / 0,
])
def test_bad_trace_description_drops_metadata_not_the_event(describe):
    event = _observed_service({}, describe)
    assert event.outcome == "success" and event.conversation_id is None
    assert "Ngân" not in str(event.model_dump())
