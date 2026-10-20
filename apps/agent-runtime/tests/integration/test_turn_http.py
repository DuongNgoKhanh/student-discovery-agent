"""Signed internal HTTP turns over real PostgreSQL, the real adaptive selector and a pinned pilot release."""
import json

import pytest
from fastapi.testclient import TestClient

from agent_runtime.main import create_app
from agent_runtime.sessions.schemas.turn import ConversationTurnResult
from agent_runtime.sessions.services.turn_handlers import TurnHandler
from tests.helpers.turns import (
    biased_option,
    current_state,
    post_turn,
    request_for,
    signed_call,
    turn_container,
    turn_counts,
)

pytestmark = pytest.mark.integration


def assert_error(response, status, code):
    assert response.status_code == status
    payload = response.json()
    assert (payload["status"], payload["success"], payload["data"]) == (status, False, None)
    assert payload["error"]["code"] == code
    assert response.headers["cache-control"] == "no-store"


def test_http_name_then_option_uses_real_selector(turn_http):
    client, rig = turn_http
    rig.product.unavailable = True  # option/name turns must never consult Product
    calls = rig.product.resolve_calls
    response = post_turn(client, rig, request_for(rig, "set_name", key="name"))
    assert response.status_code == 200
    assert response.json()["data"]["revision"] == 2
    assert response.json()["data"]["activity"]["revision"] == 1
    assert response.json()["data"]["activity"]["progress"]["completed"] == 0
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["meta"]["replayed"] is False
    first = response.json()["data"]["activity"]["current_question"]["question_id"]

    answer = post_turn(client, rig, request_for(rig, "submit_answer", key="answer"))
    data = ConversationTurnResult.model_validate(answer.json()["data"]).model_dump(mode="json")
    assert answer.status_code == 200 and (data["revision"], data["activity"]["revision"]) == (3, 2)
    assert data["activity"]["progress"]["completed"] == 1
    assert data["activity"]["answers"][0]["question_id"] == first
    assert data["blocks"][0]["question_id"] == data["activity"]["current_question"]["question_id"] != first
    assert rig.product.resolve_calls == calls

    read = signed_call(client, rig, "GET", f"/conversations/{rig.conversation_id}").json()["data"]
    assert read["revision"] == 3 and read["active_activity"] == data["activity"]
    history = signed_call(client, rig, "GET", f"/conversations/{rig.conversation_id}/messages").json()["data"]
    turn = [item for item in history["items"] if item["turn_id"] == data["turn_id"]]
    assert [item["role"] for item in turn] == ["user", "assistant"]
    assert turn[1]["message_id"] == data["message_id"] and turn[1]["blocks"] == data["blocks"]
    assert turn[0]["text"] is None and turn[0]["interaction"]["option_id"] == f"{first}_opt_3"


def test_http_boundary_rejections_preserve_envelope(turn_http):
    client, rig = turn_http
    before = turn_counts(rig)
    body = request_for(rig, "set_name", key="name").model_dump(mode="json", exclude_unset=True)
    path = f"/conversations/{rig.conversation_id}/turns"
    assert_error(post_turn(client, rig, body | {"owner_id": "spoof"}), 422, "INVALID_INPUT")
    assert_error(post_turn(client, rig, body | {"schema_version": 2}), 422, "INVALID_INPUT")
    assert_error(post_turn(client, rig, b'{"type":"interaction","type":"message"}'), 400, "INVALID_REQUEST")
    assert_error(post_turn(client, rig, body, path=path + "?debug=1"), 422, "INVALID_INPUT")
    assert_error(post_turn(client, rig, body, owner="stranger"), 404, "RESOURCE_NOT_FOUND")
    assert_error(post_turn(client, rig, json.dumps(body | {"pad": "x" * 70000}).encode()), 413, "PAYLOAD_TOO_LARGE")
    message = {"type": "message", "content": {"text": "hi"}, "expected_revision": 1, "idempotency_key": "msg"}
    assert_error(post_turn(client, rig, message), 422, "INVALID_ACTIVITY_TRANSITION")
    unsigned = client.post("/api/v1/internal" + path, content=json.dumps(body).encode(),
                           headers={"X-Caller-Context": "bad", "X-Internal-Caller": "sda-product-bff"})
    assert_error(unsigned, 401, "AUTH_REQUIRED")
    assert turn_counts(rig) == before


def test_terminal_fixture_projector_commits_atomically(turn_http):
    """Fixture projector: integration/atomicity evidence only, not AT-07 scoring proof."""
    client, rig = turn_http
    assert post_turn(client, rig, request_for(rig, "set_name", key="name")).status_code == 200
    # Same container without a completion port: the final answer must not be stored.
    with TestClient(create_app(turn_container(rig, handler=TurnHandler(rig.handler.engine)))) as bare:
        step = 0
        while True:
            step += 1
            option = biased_option(current_state(rig)[2]["current_question"]["question_id"])
            request = request_for(rig, "submit_answer", key=f"answer-{step}", option_id=option)
            before = turn_counts(rig)
            missing = post_turn(bare, rig, request)
            if missing.status_code == 503:
                assert_error(missing, 503, "SERVICE_UNAVAILABLE")
                assert missing.json()["error"]["retryable"] is True
                assert turn_counts(rig) == before
                break
            assert missing.status_code == 200 and step < 30
    done = post_turn(client, rig, request)  # retry the same key/payload once the projector is configured
    assert done.status_code == 200 and rig.completion.calls == 1
    data = done.json()["data"]
    after = turn_counts(rig)
    assert data["activity"]["status"] == "completed" and data["blocks"][0]["type"] == "personality_card"
    assert data["activity"]["progress"]["total"] == data["activity"]["progress"]["completed"] == after["answers"]
    assert after["results"] == 1 and after["answers"] == before["answers"] + 1
    result = signed_call(client, rig, "GET", f"/activities/{rig.activity_id}/result").json()["data"]
    assert result["result_id"] == data["blocks"][0]["result_id"] and result["data"]["display_name"] == "Ngân"
    late = request_for(rig, "set_name", key="late")
    assert_error(post_turn(client, rig, late), 422, "INVALID_ACTIVITY_TRANSITION")
