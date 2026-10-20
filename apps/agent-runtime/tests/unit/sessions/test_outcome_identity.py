"""Outcome identity guards execute before any SQL, including repository callers."""
import pytest

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.outcomes import OutcomeRepository
from agent_runtime.sessions.schemas.common import ServiceResponse


@pytest.mark.parametrize("field,value", [
    ("owner_id", "x" * 257), ("owner_id", chr(0x1F600) * 257), ("owner_id", "bad\ud800"),
    ("key", "k" * 257), ("operation", "o" * 65), ("resource_scope", "s" * 129),
    ("owner_id", b"owner"), ("key", b"key"), ("operation", b"op"), ("resource_scope", b"scope"),
    ("operation", "bad space"), ("resource_scope", chr(0x1F600)),
])
@pytest.mark.parametrize("method", ["find", "save"])
def test_repository_rejects_invalid_identity_before_sql(field, value, method):
    identity = dict(owner_id="owner", key="key", operation="activity.commit", resource_scope="conv/act:part")
    identity[field] = value
    extra = {} if method == "find" else dict(conversation_id="conv", response=ServiceResponse(status=200, data={}))
    with pytest.raises(RuntimeSessionError) as caught:
        getattr(OutcomeRepository(), method)(None, **identity, request_hash="hash", **extra)
    assert (caught.value.status, caught.value.code) == (400, "INVALID_REQUEST")
