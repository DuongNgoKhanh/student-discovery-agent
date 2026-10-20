"""Final-review regressions through real signed HTTP and PostgreSQL."""
import random
import string
from dataclasses import replace

import pytest
from sqlalchemy import event

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.conversation import CreateConversationInput
from tests.integration.test_conversation_create import counts
from tests.integration.test_session_http import assert_error, call
from tests.integration.test_session_http import http as http_fixture
from tests.integration.test_session_http import rig as create_rig
from tests.integration.test_session_http import validator as validator_fixture

http = http_fixture
rig = create_rig
validator = validator_fixture
pytestmark = pytest.mark.integration


@pytest.mark.parametrize("capability", [
    {"accepted_activity_profiles": ["riasec.mean.bounds.v2"]},
    {"accepted_activity_profiles": ["future.v99"]},
    {"supported_blocks": [{"type": "text", "schema_versions": [99]}]},
    {"supported_blocks": [{"type": "future", "schema_versions": [1]}]},
])
def test_negotiation_follows_replay_lifecycle_before_product(http, rig, capability):
    before = counts(rig)
    assert_error(call(http, rig, "POST", "/conversations", {"idempotency_key": "key", **capability}),
                 422, "INCOMPATIBLE_SCHEMA")
    assert counts(rig) == before and rig[4].resolve_calls == 0
    created = call(http, rig, "POST", "/conversations", {"idempotency_key": "key"})
    cid = created.json()["data"]["conversation"]["id"]
    before = counts(rig)
    assert_error(call(http, rig, "POST", "/conversations", {"idempotency_key": "key", **capability}),
                 409, "IDEMPOTENCY_KEY_COLLISION")
    assert counts(rig) == before and rig[4].resolve_calls == 1
    assert call(http, rig, "POST", f"/conversations/{cid}:end",
                {"idempotency_key": "end", "expected_revision": 0}).status_code == 200
    before = counts(rig)
    assert_error(call(http, rig, "POST", "/conversations", {"idempotency_key": "key", **capability}),
                 410, "CONVERSATION_ENDED")
    assert counts(rig) == before and rig[4].resolve_calls == 1


@pytest.mark.parametrize("capability", [
    {"accepted_activity_profiles": [1]}, {"accepted_activity_profiles": "future"},
    {"supported_blocks": [{"type": "text", "schema_versions": [True]}]},
    {"supported_blocks": [{"type": "text", "schema_versions": ["99"]}]},
    {"supported_blocks": {"type": "text"}},
])
def test_malformed_capability_is_structural_invalid_input(http, rig, capability):
    assert_error(call(http, rig, "POST", "/conversations", {"idempotency_key": "key", **capability}),
                 422, "INVALID_INPUT")
    assert counts(rig) == (0, 0, 0, 0) and rig[4].resolve_calls == 0


@pytest.mark.parametrize("length", [257, 4000])
def test_oversize_keys_never_resolve_product_or_write_create_end(http, rig, length):
    generator = random.Random(9001)
    key = "".join(generator.choice(string.ascii_letters + string.digits) for _ in range(length))
    assert_error(call(http, rig, "POST", "/conversations", {"idempotency_key": key}), 422, "INVALID_INPUT")
    assert counts(rig) == (0, 0, 0, 0) and rig[4].resolve_calls == 0
    created = call(http, rig, "POST", "/conversations", {"idempotency_key": "k" * 256})
    assert created.status_code == 201
    cid = created.json()["data"]["conversation"]["id"]
    before = counts(rig)
    assert_error(call(http, rig, "POST", f"/conversations/{cid}:end",
                 {"idempotency_key": key, "expected_revision": 0}), 422, "INVALID_INPUT")
    assert counts(rig) == before and rig[4].resolve_calls == 1
    assert call(http, rig, "GET", f"/conversations/{cid}").json()["data"]["revision"] == 0
    assert call(http, rig, "POST", f"/conversations/{cid}:end",
                {"idempotency_key": "e" * 256, "expected_revision": 0}).status_code == 200


@pytest.mark.parametrize("owner", ["x" * 257, chr(0x1F600) * 257, "bad\ud800"])
def test_invalid_owner_http_auth_and_direct_port_reject_before_sql_product(http, rig, owner):
    queries = []
    def record(*args):
        queries.append(True)
    event.listen(rig[0], "before_cursor_execute", record)
    try:
        assert_error(call(http, rig, "POST", "/conversations", {"idempotency_key": "key"}, owner=owner),
                     401, "AUTH_REQUIRED")
        with pytest.raises(RuntimeSessionError) as caught:
            rig[5].create(replace(rig[3], owner_id=owner), CreateConversationInput(idempotency_key="key"))
        assert (caught.value.status, caught.value.code) == (401, "AUTH_REQUIRED")
        assert queries == [] and rig[4].resolve_calls == 0
    finally:
        event.remove(rig[0], "before_cursor_execute", record)
    assert counts(rig) == (0, 0, 0, 0)


def test_max_unicode_owner_and_key_fit_both_postgresql_indexes(http, rig):
    owner = chr(0x1F600) * 256
    assert len(owner.encode("utf-8")) == 1024
    created = call(http, rig, "POST", "/conversations", {"idempotency_key": "k" * 256}, owner=owner)
    assert created.status_code == 201
    cid = created.json()["data"]["conversation"]["id"]
    assert call(http, rig, "GET", f"/conversations/{cid}", owner=owner).status_code == 200
    assert call(http, rig, "POST", f"/conversations/{cid}:end",
                {"idempotency_key": "e" * 256, "expected_revision": 0}, owner=owner).status_code == 200


def test_max_composite_outcome_identity_roundtrips_without_hashing(rig):
    from agent_runtime.sessions.repositories.outcomes import OutcomeRepository
    from agent_runtime.sessions.schemas.common import ServiceResponse

    generator = random.Random(9001)
    # Varied four-byte scalars avoid relying on compression of a repeated owner.
    owner = "".join(chr(generator.randrange(0x10000, 0x10FFFF)) for _ in range(256))
    caller = replace(rig[3], owner_id=owner)
    created = rig[5].create(caller, CreateConversationInput(idempotency_key="create"))
    identity = dict(owner_id=owner, operation="o" * 64, resource_scope="conv:" + "s" * 123, key="k" * 256)
    response = ServiceResponse(status=200, data={"stored": "exact"})
    with rig[1].begin() as session:
        repository = OutcomeRepository()
        repository.save(session, **identity, request_hash="sha256:" + "a" * 64,
            conversation_id=created.data["conversation"]["id"], response=response)
        found = repository.find(session, **identity, request_hash="sha256:" + "a" * 64)
        assert found.data == {"stored": "exact"} and found.replayed is True
        assert repository.find(session, **{**identity, "key": "other"}, request_hash="sha256:" + "a" * 64) is None
