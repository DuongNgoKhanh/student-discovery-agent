"""Signed cursors reject changes rather than granting access to history."""
import base64
import hashlib
import hmac
import json

import pytest

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.history import HistoryCursor
from agent_runtime.sessions.services.history import HistoryCursorCodec

KEY = b"cursor-test-key-separate-from-jwt!"


def codec():
    return HistoryCursorCodec(KEY)


def signed(payload):
    raw = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=")
    signature = hmac.new(KEY, raw, hashlib.sha256).digest()
    return raw.decode() + "." + base64.urlsafe_b64encode(signature).rstrip(b"=").decode()


def test_cursor_roundtrip_preserves_safe_boundary_counters():
    value = HistoryCursor(conversation_id="conversation-one", watermark_revision=9007199254740991,
                          last_ordinal=9007199254740991)
    subject = codec()
    assert subject.decode(subject.encode(value)) == value


def test_cursor_from_different_signing_key_is_rejected():
    token = codec().encode(HistoryCursor(conversation_id="c", watermark_revision=1, last_ordinal=1))
    with pytest.raises(RuntimeSessionError) as error:
        HistoryCursorCodec(b"different-cursor-key-256-bit-long!").decode(token)
    assert error.value.status == 422


@pytest.mark.parametrize("field,value", [("conversation_id", "conversation-other"),
                                           ("watermark_revision", 800), ("last_ordinal", 90)])
def test_cursor_cannot_change_conversation_or_watermark(field, value):
    subject = codec()
    token = subject.encode(HistoryCursor(conversation_id="conversation-one", watermark_revision=8, last_ordinal=9))
    payload, signature = token.split(".")
    data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    data[field] = value
    changed = base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()
    with pytest.raises(RuntimeSessionError) as error:
        subject.decode(changed + "." + signature)
    assert (error.value.status, error.value.code, error.value.details) == (422, "INVALID_INPUT", None)


@pytest.mark.parametrize("payload", [
    {"version": 2, "conversation_id": "c", "watermark_revision": 1, "last_ordinal": 1},
    {"version": 1, "conversation_id": "c", "watermark_revision": -1, "last_ordinal": 1},
    {"version": 1, "conversation_id": "c", "watermark_revision": 1, "last_ordinal": True},
    {"version": 1, "conversation_id": "c", "watermark_revision": 1, "last_ordinal": 1, "text": "forbidden"},
])
def test_even_signed_payload_must_match_closed_cursor_schema(payload):
    subject = codec()
    with pytest.raises(RuntimeSessionError) as error:
        subject.decode(signed(payload))
    assert error.value.code == "INVALID_INPUT"


@pytest.mark.parametrize("version", [True, 1.0], ids=["boolean", "float"])
def test_signed_cursor_requires_integer_version(version):
    token = signed({"version": version, "conversation_id": "c", "watermark_revision": 1, "last_ordinal": 1})
    with pytest.raises(RuntimeSessionError) as error:
        codec().decode(token)
    assert (error.value.status, error.value.code, error.value.details) == (422, "INVALID_INPUT", None)


@pytest.mark.parametrize("token", ["", "bad", "a.b.c", "a.!", "a" * 10000],
                         ids=["empty", "no-signature", "extra-part", "invalid-base64", "oversized"])
def test_malformed_cursor_is_safe_input_error(token):
    subject = codec()
    with pytest.raises(RuntimeSessionError) as error:
        subject.decode(token)
    assert error.value.status == 422 and error.value.details is None
