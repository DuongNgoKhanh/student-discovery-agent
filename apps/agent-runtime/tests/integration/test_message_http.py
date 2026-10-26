"""POST /messages over signed HTTP: JSON and SSE modes, GET and cancel of a response."""
import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from agent_runtime.infrastructure.auth.caller import RawRequestContext
from agent_runtime.infrastructure.db.tables import responses
from agent_runtime.main import create_app
from agent_runtime.sessions.services.turn_input import to_message_body
from tests.helpers.signing import sign_request
from tests.helpers.turns import HTTP_KEY, INTERNAL_PREFIX, request_for, signed_call, turn_container

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
    assert response.headers["x-request-id"] and response.headers["x-trace-id"]
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


def test_stream_trace_carries_the_request_correlation_ids(turn_rig):
    class Sink:
        events = []

        def emit(self, event):
            self.events.append(event)

    sink = Sink()
    with TestClient(create_app(turn_container(turn_rig, trace_sink=sink))) as client:
        response = post(client, turn_rig, to_message_body(request_for(turn_rig, "set_name", key="name")), stream=True)
    assert events(response)[0][-1] == "response.completed"
    assert [(e.action, e.outcome) for e in sink.events] == [("conversation.turn", "success")]
    assert sink.events[0].request_id == response.headers["x-request-id"]
    assert sink.events[0].trace_id == response.headers["x-trace-id"]


def _disconnect_at_once(app, rig, raw):
    """Raw ASGI call whose client is gone right after the request body: nothing reads the stream."""
    target = INTERNAL_PREFIX + f"/conversations/{rig.conversation_id}/messages"
    token = sign_request(RawRequestContext("POST", target, raw), owner_id="owner", now=rig.clock.now(),
                         key=HTTP_KEY, kid="http")
    headers = [(b"x-caller-context", token.encode()), (b"x-internal-caller", b"sda-product-bff"),
               (b"accept", b"text/event-stream"), (b"content-type", b"application/json"),
               (b"content-length", str(len(raw)).encode()), (b"host", b"testserver")]
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
             "scheme": "http", "path": target, "raw_path": target.encode(), "root_path": "", "query_string": b"",
             "headers": headers, "client": ("testclient", 50000), "server": ("testserver", 80)}
    inbox = [{"type": "http.request", "body": raw, "more_body": False}]
    sent = []

    async def receive():
        return inbox.pop(0) if inbox else {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    return sent


def test_turn_commits_even_if_the_stream_is_never_read(turn_rig):
    app = create_app(turn_container(turn_rig))
    raw = json.dumps(to_message_body(request_for(turn_rig, "set_name", key="name"))).encode()
    sent = _disconnect_at_once(app, turn_rig, raw)
    assert not any(m.get("body", b"").startswith(b"event: response.completed") for m in sent)
    with turn_rig.db_engine.connect() as connection:
        response_id = connection.execute(select(responses.c.id)).scalar_one()
    with TestClient(app) as client:
        deadline = time.monotonic() + 10
        while True:
            status = signed_call(client, turn_rig, "GET", f"/responses/{response_id}").json()["data"]["status"]
            if status != "in_progress" or time.monotonic() > deadline:
                break
            time.sleep(0.02)
    assert status == "completed"
