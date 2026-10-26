"""POST /messages over signed HTTP: JSON and SSE modes, GET and cancel of a response."""
import json

import pytest

from agent_runtime.sessions.services.turn_input import to_message_body
from tests.helpers.turns import request_for, signed_call

pytestmark = pytest.mark.integration


def events(response):
    names, data = [], []
    for block in response.text.split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line and not line.startswith(":"))
        if "event" in lines:
            names.append(lines["event"])
            data.append(json.loads(lines["data"]))
    return names, data


def post(client, rig, body, *, stream=False):
    raw = json.dumps(body).encode()
    headers = {"Accept": "text/event-stream"} if stream else {}
    return signed_call(client, rig, "POST", f"/conversations/{rig.conversation_id}/messages", raw,
                       extra_headers=headers)


def test_json_and_stream_modes_return_the_same_response_shape(turn_http):
    client, rig = turn_http
    body = to_message_body(request_for(rig, "set_name", key="name"))
    response = post(client, rig, body, stream=True)
    assert response.headers["content-type"].startswith("text/event-stream")
    names, data = events(response)
    assert names == ["response.created", "response.completed"]
    final = data[-1]["response"]
    assert final["status"] == "completed" and "answers" not in final["activity"]
    replay = post(client, rig, body)
    assert replay.json()["data"] == final and replay.json()["meta"]["replayed"] is True


def test_get_and_cancel_a_finished_response(turn_http):
    client, rig = turn_http
    final = post(client, rig, to_message_body(request_for(rig, "set_name", key="name"))).json()["data"]
    assert signed_call(client, rig, "GET", f"/responses/{final['id']}").json()["data"] == final
    conflict = signed_call(client, rig, "POST", f"/responses/{final['id']}/cancel")
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "CONFLICT_RESPONSE_NOT_CANCELLABLE"
    assert signed_call(client, rig, "GET", f"/responses/{final['id']}", owner="intruder").status_code == 404


def test_guard_errors_stay_json_even_when_streaming_is_requested(turn_http):
    client, rig = turn_http
    body = to_message_body(request_for(rig, "set_name", key="name"))
    body["expected_revision"] = 99
    response = post(client, rig, body, stream=True)
    assert response.status_code == 409 and response.json()["error"]["code"] == "CONFLICT_REVISION"
