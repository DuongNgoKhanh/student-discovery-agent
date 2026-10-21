"""Wire aliases never mutate persisted/internal service error identities."""
import json
from datetime import datetime, timezone

from agent_runtime.api.internal.envelopes import failure
from agent_runtime.sessions.errors import RuntimeSessionError


def test_transport_uses_canonical_code_and_legacy_marker():
    error = RuntimeSessionError(409, "REVISION_CONFLICT", {"kind": "revision_conflict"})
    response = failure(error, "request", "trace", datetime.now(timezone.utc))
    body = json.loads(response.body)
    assert body["error"]["code"] == "CONFLICT_REVISION"
    assert body["error"]["legacy_code"] == "REVISION_CONFLICT"
    assert body["error"]["details"] == {"kind": "revision_conflict"}
    assert error.code == "REVISION_CONFLICT"


def test_unknown_code_and_details_never_escape_transport():
    response = failure(RuntimeSessionError(409, "PRIVATE_DATABASE_ERROR", {"secret": "credential"}),
                       "request", "trace", datetime.now(timezone.utc))
    body = json.loads(response.body)
    assert response.status_code == 500
    assert body["error"] == {"code": "SYS_INTERNAL_ERROR", "message": "Internal server error",
                             "retryable": False, "details": None}
    assert "credential" not in response.body.decode()


def test_stable_code_has_no_legacy_marker():
    response = failure(RuntimeSessionError(401, "AUTH_CALLER_CONTEXT_MISSING"),
                       "request", "trace", datetime.now(timezone.utc))
    error = json.loads(response.body)["error"]
    assert error["code"] == "AUTH_CALLER_CONTEXT_MISSING"
    assert "legacy_code" not in error
