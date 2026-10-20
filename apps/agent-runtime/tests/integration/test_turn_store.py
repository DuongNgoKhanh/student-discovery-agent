"""Guarded turn preflight/commit with durable replay on real PostgreSQL."""
import pytest
from sqlalchemy import select

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.db.tables import messages, operation_outcomes
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.services.turn_input import parse_turn_input
from tests.helpers.turns import request_for, turn_counts

pytestmark = pytest.mark.integration


def _submit(rig, request):
    snapshot = rig.store.preflight(rig.caller, rig.conversation_id, request)
    if isinstance(snapshot, ServiceResponse):
        return snapshot
    return rig.store.commit(rig.caller, rig.conversation_id, request, snapshot,
                            rig.handler.prepare(snapshot, request))


def _error(call, status, code):
    with pytest.raises(RuntimeSessionError) as error:
        call()
    assert (error.value.status, error.value.code) == (status, code)
    return error.value


def test_store_commits_one_outcome_with_all_changes(turn_rig):
    request = request_for(turn_rig, "set_name", key="name")
    snapshot = turn_rig.store.preflight(turn_rig.caller, turn_rig.conversation_id, request)
    draft = turn_rig.handler.prepare(snapshot, request)
    before = turn_counts(turn_rig)
    response = turn_rig.store.commit(turn_rig.caller, turn_rig.conversation_id, request, snapshot, draft)
    after = turn_counts(turn_rig)
    assert response.status == 200
    assert after["messages"] - before["messages"] == 2
    assert after["outcomes"] - before["outcomes"] == 1
    assert after["activity_revision"] - before["activity_revision"] == 1
    assert after["conversation_revision"] - before["conversation_revision"] == 1
    with turn_rig.uow.begin() as session:
        rows = session.execute(select(messages).where(messages.c.turn_id == response.data["turn_id"])
                               .order_by(messages.c.ordinal)).mappings().all()
        outcome = session.execute(select(operation_outcomes).where(
            operation_outcomes.c.operation == "conversation.turn")).mappings().one()
    assert [row["role"] for row in rows] == ["user", "assistant"]
    assert {row["committed_conversation_revision"] for row in rows} == {response.data["revision"]}
    assert rows[1]["message_id"] == response.data["message_id"] and rows[0]["text"] == "Ngân"
    assert outcome["resource_scope"] == turn_rig.conversation_id and outcome["response_data"] == response.data
    read = turn_rig.conversations.read(turn_rig.caller, turn_rig.conversation_id).data
    assert read["display_name"] == "Ngân" and read["active_activity"] == response.data["activity"]


def test_replay_wins_before_revision_and_collision_before_validation(turn_rig):
    request = request_for(turn_rig, "set_name", key="name")
    first = _submit(turn_rig, request)
    _submit(turn_rig, request_for(turn_rig, "submit_answer", key="answer"))
    before = turn_counts(turn_rig)
    replay = _submit(turn_rig, request)  # stale revisions, but the same normalized request
    assert replay.replayed is True and replay.data == first.data and turn_counts(turn_rig) == before
    for other in (parse_turn_input(request.model_dump(mode="json") | {"activity_id": "other"}),
                  parse_turn_input(request.model_dump(mode="json") | {"payload": {"display_name": "<b>X</b>"}}),
                  parse_turn_input(request.model_dump(mode="json") | {"expected_revision": 5})):
        _error(lambda other=other: _submit(turn_rig, other), 409, "IDEMPOTENCY_KEY_COLLISION")
    assert turn_counts(turn_rig) == before


def test_optional_activity_revision_absent_stays_distinct(turn_rig):
    request = request_for(turn_rig, "set_name", key="name", with_activity_revision=False)
    first = _submit(turn_rig, request)
    assert first.status == 200
    _error(lambda: _submit(turn_rig, request_for(turn_rig, "submit_answer", key="name")), 409,
           "IDEMPOTENCY_KEY_COLLISION")
    assert _submit(turn_rig, request).data == first.data


@pytest.mark.parametrize("field,kind,actual", [("expected_revision", "conversation", 1),
                                               ("expected_activity_revision", "activity", 0)])
def test_revision_conflict_returns_typed_readable_snapshot(turn_rig, field, kind, actual):
    request = request_for(turn_rig, "set_name", key="stale")
    stale = parse_turn_input(request.model_dump(mode="json") | {field: 7})
    error = _error(lambda: _submit(turn_rig, stale), 409, "REVISION_CONFLICT")
    details = error.details
    assert (details["kind"], details["resource_kind"]) == ("revision_conflict", kind)
    assert (details["expected_revision"], details["actual_revision"]) == (7, actual)
    assert details["conversation"]["revision"] == 1 and details["activity"]["revision"] == 0
    assert turn_counts(turn_rig)["outcomes"] == 2  # create + start only


def test_guards_reject_without_writes(turn_rig):
    before = turn_counts(turn_rig)
    name = request_for(turn_rig, "set_name", key="name")
    data = name.model_dump(mode="json")
    message = parse_turn_input({"type": "message", "content": {"text": "hi"}, "expected_revision": 1,
                                "idempotency_key": "msg"})
    stranger = VerifiedCaller("stranger", "sda-product-bff", turn_rig.caller.expires_at)
    cases = [
        (lambda: _submit(turn_rig, message), 422, "INVALID_ACTIVITY_TRANSITION"),
        (lambda: _submit(turn_rig, parse_turn_input(data | {"activity_id": "missing"})), 404, "RESOURCE_NOT_FOUND"),
        (lambda: _submit(turn_rig, parse_turn_input(data | {"action": "submit_answer", "idempotency_key": "early",
                         "payload": {"question_id": "q_r_01", "option_id": "q_r_01_opt_3"}})),
         422, "INVALID_ACTIVITY_TRANSITION"),
        (lambda: _submit(turn_rig, parse_turn_input(data | {"idempotency_key": "bad", "payload": {
            "display_name": "Lan 2"}})), 422, "INVALID_INPUT"),
        (lambda: turn_rig.store.preflight(stranger, turn_rig.conversation_id, name), 404, "RESOURCE_NOT_FOUND"),
    ]
    for call, status, code in cases:
        _error(call, status, code)
    assert turn_counts(turn_rig) == before


def test_failed_name_does_not_consume_key(turn_rig):
    data = request_for(turn_rig, "set_name", key="name").model_dump(mode="json")
    _error(lambda: _submit(turn_rig, parse_turn_input(data | {"payload": {"display_name": "😀"}})), 422,
           "INVALID_INPUT")
    assert _submit(turn_rig, parse_turn_input(data)).status == 200
