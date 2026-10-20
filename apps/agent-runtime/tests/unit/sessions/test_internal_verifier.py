"""Real signatures exercise the verifier; no wall-clock or JWT mocks."""

import json
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.auth.verifier import CallerVerifier
from agent_runtime.sessions.errors import RuntimeSessionError
from tests.helpers.clock import FakeClock
from tests.helpers.signing import sign_request

KEY = b"test-only-runtime-signing-key-0001"
OTHER_KEY = b"test-only-runtime-signing-key-0002"
NOW = datetime(2026, 10, 20, 4, 0, tzinfo=UTC)
REQUEST = RawRequestContext(
    "POST", "/api/v1/internal/conversations/a%2Fb?limit=20&cursor=x%2By", b'{"name": "secret-raw-body"}'
)


@pytest.fixture
def clock():
    return FakeClock(NOW)


@pytest.fixture
def verifier(clock):
    return CallerVerifier({"current": KEY}, clock)


def token_for(request=REQUEST, *, key=KEY, kid="current", ttl_seconds=60):
    return sign_request(request, owner_id="own_test", now=NOW, key=key, kid=kid, ttl_seconds=ttl_seconds)


def altered_token(*, claims=None, remove=(), headers=None, algorithm="HS256"):
    payload = jwt.decode(
        token_for(), KEY, algorithms=["HS256"],
        options={"verify_aud": False, "verify_exp": False, "verify_iat": False},
    )
    payload.update(claims or {})
    for name in remove:
        payload.pop(name)
    jose = {"typ": "sda-internal+jwt", "kid": "current"}
    jose.update(headers or {})
    key = KEY if algorithm == "HS256" else KEY * 2
    # JWS can sign malformed JWT claims without the high-level signer's validation.
    return jwt.api_jws.encode(json.dumps(payload).encode(), key, algorithm=algorithm, headers=jose)


def assert_rejected(verifier, token, *, request=REQUEST, caller="sda-product-bff", status=401):
    with pytest.raises(RuntimeSessionError) as failure:
        verifier.verify(token, caller, request)
    assert failure.value.status == status
    assert failure.value.code == ("AUTH_REQUIRED" if status == 401 else "FORBIDDEN")
    assert failure.value.details is None
    if token:
        assert token not in str(failure.value)
    assert "secret-raw-body" not in str(failure.value)
    assert KEY.decode() not in str(failure.value)
    return failure.value


def test_valid_signed_request(verifier):
    caller = verifier.verify(token_for(), "sda-product-bff", REQUEST)
    assert caller.owner_id == "own_test"
    assert caller.issuer == "sda-product-bff"
    assert caller.expires_at == NOW + timedelta(seconds=60)


@pytest.mark.parametrize("changed_request", [
    RawRequestContext("GET", REQUEST.request_target, REQUEST.body),
    RawRequestContext("POST", "/api/v1/internal/conversations/a/b?limit=20&cursor=x%2By", REQUEST.body),
    RawRequestContext("POST", "/api/v1/internal/conversations/a%2Fb?cursor=x%2By&limit=20", REQUEST.body),
    RawRequestContext("POST", "/api/v1/internal/conversations/a%2Fb?limit=21&cursor=x%2By", REQUEST.body),
    RawRequestContext("POST", REQUEST.request_target, b'{"name":"secret-raw-body"}'),
])
def test_rejects_changed_method_target_query_body(verifier, changed_request):
    assert_rejected(verifier, token_for(), request=changed_request)


@pytest.mark.parametrize("changes", [
    {"algorithm": "HS384"},
    {"headers": {"typ": "JWT"}},
    {"headers": {"kid": "unknown"}},
    {"headers": {"jku": "https://untrusted.invalid/key"}},
    {"headers": {"jwk": {"kty": "oct", "k": "untrusted"}}},
    {"headers": {"x5u": "https://untrusted.invalid/key"}},
    {"claims": {"iss": "login"}},
    {"claims": {"aud": "login"}},
    {"claims": {"aud": ["sda-agent-runtime", "login"]}},
])
def test_rejects_wrong_alg_type_issuer_audience_kid(verifier, changes):
    assert_rejected(verifier, altered_token(**changes))


def test_exact_expiry_and_future_iat(verifier, clock):
    token = token_for()
    clock.set(NOW - timedelta(microseconds=1))
    assert_rejected(verifier, token)
    clock.set(NOW)
    assert verifier.verify(token, "sda-product-bff", REQUEST).owner_id == "own_test"
    clock.set(NOW + timedelta(seconds=60, microseconds=-1))
    assert verifier.verify(token, "sda-product-bff", REQUEST).owner_id == "own_test"
    clock.set(NOW + timedelta(seconds=60))
    assert_rejected(verifier, token)
    clock.set(NOW + timedelta(seconds=61))
    assert_rejected(verifier, token)


def test_login_token_is_not_internal_context(verifier):
    login_token = jwt.encode({"sub": "own_test", "iat": int(NOW.timestamp())}, KEY, algorithm="HS256")
    assert_rejected(verifier, login_token)


@pytest.mark.parametrize("caller", [None, "", "login", "sda-product-bff "])
def test_internal_caller_header_is_required(verifier, caller):
    assert_rejected(verifier, token_for(), caller=caller, status=403)


@pytest.mark.parametrize("caller_type", ["admin", "service", "Student"])
def test_only_student_caller_is_authorized(verifier, caller_type):
    assert_rejected(verifier, altered_token(claims={"caller_type": caller_type}), status=403)


@pytest.mark.parametrize("name", [
    "iss", "aud", "caller_type", "owner_id", "iat", "exp", "method", "request_target", "body_sha256"
])
def test_all_context_claims_are_required(verifier, name):
    assert_rejected(verifier, altered_token(remove=(name,)))


@pytest.mark.parametrize(("name", "value"), [
    ("iat", True), ("iat", 1792468800.0), ("iat", "1792468800"), ("iat", None),
    ("exp", True), ("exp", 1792468860.0), ("exp", "1792468860"), ("exp", None),
    ("owner_id", ""), ("owner_id", "  "), ("owner_id", 12), ("owner_id", None),
    ("iss", ["sda-product-bff"]), ("aud", None), ("caller_type", True),
    ("method", "post"), ("method", ["POST"]), ("request_target", None),
    ("body_sha256", "A" * 64), ("body_sha256", 12),
    ("exp", 10**100), ("iat", -(10**100)),
])
def test_rejects_malformed_claim_types_and_values(verifier, name, value):
    assert_rejected(verifier, altered_token(claims={name: value}))


@pytest.mark.parametrize("ttl", [0, -1, 61])
def test_rejects_nonpositive_or_overlong_lifetime(verifier, ttl):
    assert_rejected(verifier, token_for(ttl_seconds=ttl))


@pytest.mark.parametrize("token", ["", "broken.jwt", "a.b.c", "x" * 8193, "é" * 4097])
def test_rejects_malformed_or_oversized_token_safely(verifier, token):
    assert_rejected(verifier, token)


def test_rejects_wrong_signature_and_unsigned_token(verifier):
    assert_rejected(verifier, token_for(key=OTHER_KEY))
    unsigned = jwt.encode({"owner_id": "own_test"}, "", algorithm="none", headers={"kid": "current"})
    assert_rejected(verifier, unsigned)


def test_empty_body_uses_raw_empty_digest(verifier):
    request = RawRequestContext("GET", "/api/v1/internal/conversations/a", b"")
    assert verifier.verify(token_for(request), "sda-product-bff", request).owner_id == "own_test"
    assert_rejected(verifier, token_for(request), request=RawRequestContext("GET", request.request_target, b" "))


def test_rotation_only_accepts_configured_keys(clock):
    keyring = {"current": KEY, "previous": OTHER_KEY}
    verifier = CallerVerifier(keyring, clock)
    assert verifier.verify(token_for(key=OTHER_KEY, kid="previous"), "sda-product-bff", REQUEST).owner_id == "own_test"
    assert_rejected(verifier, token_for(key=OTHER_KEY, kid="current"))
    del keyring["previous"]
    keyring["injected"] = OTHER_KEY
    assert_rejected(verifier, token_for(key=OTHER_KEY, kid="injected"))
    assert_rejected(CallerVerifier({"current": KEY}, clock), token_for(key=OTHER_KEY, kid="previous"))


@pytest.mark.parametrize("keys", [{}, {"short": b"x" * 31}, {"text": "x" * 32}, {"": KEY}])
def test_rejects_invalid_keyring_configuration(clock, keys):
    with pytest.raises(ValueError) as failure:
        CallerVerifier(keys, clock)
    assert KEY.decode() not in str(failure.value)
