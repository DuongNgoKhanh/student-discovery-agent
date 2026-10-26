"""SSE framing and the worker/queue bridge."""
import json

from agent_runtime.api.internal.sse import frame, stream_turn


def test_frame_is_one_event_with_json_data():
    assert frame("response.output_text.delta", {"delta": "Chào"}) == \
        'event: response.output_text.delta\ndata: {"delta": "Chào"}\n\n'


def test_stream_emits_created_deltas_and_exactly_one_terminal_event():
    pending = {"id": "r1", "status": "in_progress"}
    done = {"id": "r1", "status": "completed"}

    def work(on_event):
        on_event(("delta", "a"))
        on_event(("tool_call", "result.explain"))
        return done

    chunks = list(stream_turn(pending, work, ping_seconds=0.01))
    events = [chunk.split("\n")[0] for chunk in chunks if chunk.startswith("event:")]
    assert events == ["event: response.created", "event: response.output_text.delta",
                      "event: response.tool_call", "event: response.completed"]
    assert json.loads(chunks[-1].split("data: ")[1]) == {"response": done}


def test_replay_streams_only_the_terminal_event():
    chunks = list(stream_turn({"id": "r1", "status": "completed"}, None))
    assert len(chunks) == 1 and chunks[0].startswith("event: response.completed")


def test_worker_exception_still_ends_with_one_failed_event():
    pending = {"id": "r1", "status": "in_progress"}

    def work(on_event):
        raise RuntimeError("boom")

    chunks = [c for c in stream_turn(pending, work, ping_seconds=0.01) if c.startswith("event:")]
    assert [c.split("\n")[0] for c in chunks] == ["event: response.created", "event: response.failed"]
    final = json.loads(chunks[-1].split("data: ")[1])["response"]
    assert final["id"] == "r1" and final["status"] == "failed" and final["error"] == {"code": "SYS_INTERNAL_ERROR"}


def test_unknown_terminal_status_still_ends_with_failed_event():
    pending = {"id": "r1", "status": "in_progress"}
    chunks = [c for c in stream_turn(pending, lambda on_event: {"id": "r1", "status": "weird"}, ping_seconds=0.01)
              if c.startswith("event:")]
    assert [c.split("\n")[0] for c in chunks] == ["event: response.created", "event: response.failed"]


def test_worker_exits_after_disconnect_even_with_a_full_queue():
    import threading
    ran = threading.Event()

    def work(on_event):
        for _ in range(600):  # more than the queue holds, nobody reading
            on_event(("delta", "x"))
        ran.set()
        return {"id": "r1", "status": "completed"}

    stream = stream_turn({"id": "r1", "status": "in_progress"}, work, ping_seconds=0.01)
    assert next(stream).startswith("event: response.created")
    # Capture the thread while it is still blocked on the full queue: after close() it may already be gone.
    worker = next(t for t in threading.enumerate() if t.name == "turn-r1")
    stream.close()  # client disconnect
    assert ran.wait(5)
    worker.join(5)
    assert not worker.is_alive()
