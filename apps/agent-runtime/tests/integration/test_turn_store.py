"""Guarded turn begin/commit with durable replay on real PostgreSQL."""
import pytest
from sqlalchemy import select

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.infrastructure.db.tables import messages, responses
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.services.turn_input import parse_turn_input
from tests.helpers.turns import request_for, turn_counts

pytestmark = pytest.mark.integration


def _submit(rig, request):
    """begin -> prepare -> commit; a post-begin error marks the Response failed (as TurnService does) and re-raises."""
    begun = rig.store.begin(rig.caller, rig.conversation_id, request)
    if isinstance(begun, ServiceResponse):
        return begun
    try:
        draft = rig.handler.prepare(begun.snapshot, request)
        done = rig.store.commit(rig.caller, begun, draft)
    except RuntimeSessionError as error:
        rig.store.fail(begun, error.code)
        raise
    return ServiceResponse(status=200, data=done.model_dump(mode="json"))


def _error(call, status, code):
    with pytest.raises(RuntimeSessionError) as error:
        call()
    assert (error.value.status, error.value.code) == (status, code)
    return error.value


def test_store_commits_one_outcome_with_all_changes(turn_rig):
    request = request_for(turn_rig, "set_name", key="name")
    begun = turn_rig.store.begin(turn_rig.caller, turn_rig.conversation_id, request)
    assert begun.response.status == "in_progress" and turn_counts(turn_rig)["outcomes"] == 1
    draft = turn_rig.handler.prepare(begun.snapshot, request)
    before = turn_counts(turn_rig)
    response = turn_rig.store.commit(turn_rig.caller, begun, draft)
    after = turn_counts(turn_rig)
    data = response.model_dump(mode="json")
    assert response.status == "completed" and response.id == begun.response.id
    assert after["messages"] - before["messages"] == 2
    assert after["outcomes"] == before["outcomes"]  # the in-progress row became the terminal Response
    assert after["activity_revision"] - before["activity_revision"] == 1
    assert after["conversation_revision"] - before["conversation_revision"] == 1
    with turn_rig.uow.begin() as session:
        rows = session.execute(select(messages).where(messages.c.message_id.in_(
            (response.input_message_id, response.output.message_id))).order_by(messages.c.ordinal)).mappings().all()
        stored = session.execute(select(responses)).mappings().one()
    assert [row["role"] for row in rows] == ["user", "assistant"]
    assert {row["committed_conversation_revision"] for row in rows} == {response.revision}
    assert rows[1]["message_id"] == response.output.message_id and rows[0]["text"] == "Ngân"
    assert stored["conversation_id"] == turn_rig.conversation_id and stored["response_data"] == data
    assert (stored["status"], stored["completed_at"] is not None) == ("completed", True)
    read = turn_rig.conversations.read(turn_rig.caller, turn_rig.conversation_id).data
    assert read["display_name"] == "Ngân"
    assert {key: read["active_activity"][key] for key in data["activity"]} == data["activity"]


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
    assert turn_counts(turn_rig)["outcomes"] == 0  # a rejected begin leaves no Response row


def test_guards_reject_without_writes(turn_rig):
    before = turn_counts(turn_rig)
    name = request_for(turn_rig, "set_name", key="name")
    data = name.model_dump(mode="json")
    stranger = VerifiedCaller("stranger", "sda-product-bff", turn_rig.caller.expires_at)
    cases = [
        (lambda: _submit(turn_rig, parse_turn_input(data | {"activity_id": "missing"})), 404, "RESOURCE_NOT_FOUND"),
        (lambda: turn_rig.store.begin(stranger, turn_rig.conversation_id, name), 404, "RESOURCE_NOT_FOUND"),
    ]
    for call, status, code in cases:
        _error(call, status, code)
    assert turn_counts(turn_rig) == before
    # An answer before the name is only rejected by the engine, past begin: a failed Response, nothing else written.
    _error(lambda: _submit(turn_rig, parse_turn_input(data | {"action": "submit_answer", "idempotency_key": "early",
                         "payload": {"question_id": "q_r_01", "option_id": "q_r_01_opt_3"}})),
           422, "INVALID_ACTIVITY_TRANSITION")
    assert turn_counts(turn_rig) == before | {"outcomes": before["outcomes"] + 1}


def test_second_begin_while_in_progress_is_rejected(turn_rig):
    first = turn_rig.store.begin(turn_rig.caller, turn_rig.conversation_id,
                                 request_for(turn_rig, "set_name", key="one"))
    other = request_for(turn_rig, "set_name", key="two")
    error = _error(lambda: turn_rig.store.begin(turn_rig.caller, turn_rig.conversation_id, other), 409,
                   "TURN_IN_PROGRESS")
    assert error.details == {"response_id": first.response.id}
    same_key = request_for(turn_rig, "set_name", key="one")
    _error(lambda: turn_rig.store.begin(turn_rig.caller, turn_rig.conversation_id, same_key), 409,
           "TURN_IN_PROGRESS")
    assert turn_counts(turn_rig)["outcomes"] == 1


def test_failed_name_consumes_key_and_a_new_key_succeeds(turn_rig):
    data = request_for(turn_rig, "set_name", key="name").model_dump(mode="json")
    before = turn_counts(turn_rig)
    for key, name in (("name", "😀"), ("digits", "Lan 2")):
        _error(lambda key=key, name=name: _submit(turn_rig, parse_turn_input(
            data | {"idempotency_key": key, "payload": {"display_name": name}})), 422, "INVALID_INPUT")
    after = turn_counts(turn_rig)
    assert after == before | {"outcomes": before["outcomes"] + 2}  # two failed Responses, nothing else written
    replay = _submit(turn_rig, parse_turn_input(data | {"payload": {"display_name": "😀"}}))
    assert replay.replayed is True and replay.data["status"] == "failed"
    assert replay.data["error"] == {"code": "INVALID_INPUT"}
    assert _submit(turn_rig, parse_turn_input(data | {"idempotency_key": "name-2"})).data["status"] == "completed"
