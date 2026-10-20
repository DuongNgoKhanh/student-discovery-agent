"""Turn traces are metadata-only and never decide the business outcome."""
import pytest
from fastapi.testclient import TestClient

from agent_runtime.main import create_app
from tests.helpers.turns import post_turn, request_for, turn_container, turn_counts

pytestmark = pytest.mark.integration


class CapturingSink:
    def __init__(self, fail=False):
        self.events, self.fail = [], fail

    def emit(self, event):
        self.events.append(event)
        if self.fail:
            raise RuntimeError("sink down")


def test_turn_trace_metadata_and_sink_failure(turn_rig, caplog):
    sink = CapturingSink()
    request = request_for(turn_rig, "set_name", key="name")
    with TestClient(create_app(turn_container(turn_rig, trace_sink=sink))) as client:
        assert post_turn(client, turn_rig, request).status_code == 200
        assert post_turn(client, turn_rig, request).json()["meta"]["replayed"] is True
        bad = request_for(turn_rig, "set_name", key="bad").model_dump(mode="json", exclude_unset=True)
        assert post_turn(client, turn_rig, bad | {"payload": {"display_name": "Secret 007"}}).status_code == 422
    assert [(e.action, e.outcome) for e in sink.events] == [
        ("conversation.turn", "success"), ("conversation.turn", "replayed"), ("conversation.turn", "failure")]
    dumped = str([event.model_dump() for event in sink.events]) + caplog.text
    assert "Ngân" not in dumped and "Secret 007" not in dumped

    failing = CapturingSink(fail=True)
    answer = request_for(turn_rig, "submit_answer", key="answer")
    with TestClient(create_app(turn_container(turn_rig, trace_sink=failing))) as client:
        before = turn_counts(turn_rig)
        response = post_turn(client, turn_rig, answer)
    assert response.status_code == 200 and failing.events[0].outcome == "success"
    assert turn_counts(turn_rig)["answers"] == before["answers"] + 1
    assert "TRACE_SINK_FAILURE" in caplog.text
