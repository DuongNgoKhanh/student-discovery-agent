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
