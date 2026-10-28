"""Studio service tokens: no owner, one purpose, same request binding as student tokens."""

from datetime import UTC, datetime, timedelta

import pytest

from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import ServiceVerifier
from agent_runtime.sessions.errors import RuntimeSessionError
from tests.helpers.clock import FakeClock
from tests.helpers.signing import sign_request, sign_service_request

KEY = b"test-only-studio-signing-key-00001"
NOW = datetime(2026, 10, 27, 4, 0, tzinfo=UTC)
REQUEST = RawRequestContext("POST", "/api/v1/internal/knowledge/retrieval", b'{"query": "hoc phi"}')


@pytest.fixture
def verifier():
    return ServiceVerifier({"studio": KEY}, FakeClock(NOW))


def rejected(verifier, token, request=REQUEST):
    with pytest.raises(RuntimeSessionError) as failure:
        verifier.verify(token, request)
    return failure.value.status


def test_valid_service_token(verifier):
    caller = verifier.verify(sign_service_request(REQUEST, now=NOW, key=KEY, kid="studio"), REQUEST)
    assert caller.issuer == "sda-studio-api"
    assert caller.purpose == "knowledge.retrieval"
    assert caller.expires_at == NOW + timedelta(seconds=60)


def test_student_tokens_are_not_service_tokens(verifier):
    assert rejected(verifier, sign_request(REQUEST, owner_id="own_x", now=NOW, key=KEY, kid="studio")) == 401


@pytest.mark.parametrize("claims", [{"caller_type": "student"}, {"purpose": "experience.validate"}])
def test_wrong_caller_type_or_purpose_is_forbidden(verifier, claims):
    token = sign_service_request(REQUEST, now=NOW, key=KEY, kid="studio", **claims)
    assert rejected(verifier, token) == 403


@pytest.mark.parametrize("token_kwargs,context", [
    ({"ttl_seconds": 61}, REQUEST),
    ({"kid": "other"}, REQUEST),
    ({}, RawRequestContext("POST", REQUEST.request_target, b'{"query": "khac"}')),
    ({}, RawRequestContext("POST", "/api/v1/internal/conversations", REQUEST.body)),
])
def test_bad_lifetime_kid_or_binding_is_unauthenticated(verifier, token_kwargs, context):
    kwargs = {"now": NOW, "key": KEY, "kid": "studio"} | token_kwargs
    assert rejected(verifier, sign_service_request(REQUEST, **kwargs), context) == 401
