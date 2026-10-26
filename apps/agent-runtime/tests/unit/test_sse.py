"""SSE framing and the worker/queue bridge."""
import asyncio
import contextvars
import json
import threading

from agent_runtime.api.internal.sse import frame, stream_turn


def collect(stream):
    async def drain():
        return [chunk async for chunk in stream]
    return asyncio.run(drain())


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

    chunks = collect(stream_turn(pending, work, ping_seconds=0.01, poll_seconds=0.005))
    events = [chunk.split("\n")[0] for chunk in chunks if chunk.startswith("event:")]
    assert events == ["event: response.created", "event: response.output_text.delta",
                      "event: response.tool_call", "event: response.completed"]
    assert json.loads(chunks[-1].split("data: ")[1]) == {"response": done}


def test_idle_stream_sends_pings():
    release = threading.Event()

    def work(on_event):
        release.wait(5)
        return {"id": "r1", "status": "completed"}

    async def first_three(stream):
        chunks = [await anext(stream) for _ in range(3)]
        release.set()
        return chunks + [chunk async for chunk in stream]

    chunks = asyncio.run(first_three(stream_turn({"id": "r1", "status": "in_progress"}, work,
                                                 ping_seconds=0.01, poll_seconds=0.005)))
    assert chunks[1] == chunks[2] == ": ping\n\n" and chunks[-1].startswith("event: response.completed")


def test_replay_streams_created_then_the_terminal_event():
    stored = {"id": "r1", "status": "completed"}
    chunks = collect(stream_turn(stored, None))
    assert [c.split("\n")[0] for c in chunks] == ["event: response.created", "event: response.completed"]
    assert all(json.loads(c.split("data: ")[1]) == {"response": stored} for c in chunks)


def test_worker_exception_still_ends_with_one_failed_event():
    pending = {"id": "r1", "status": "in_progress"}

    def work(on_event):
        raise RuntimeError("boom")

    chunks = [c for c in collect(stream_turn(pending, work, poll_seconds=0.005)) if c.startswith("event:")]
    assert [c.split("\n")[0] for c in chunks] == ["event: response.created", "event: response.failed"]
    final = json.loads(chunks[-1].split("data: ")[1])["response"]
    assert final["id"] == "r1" and final["status"] == "failed" and final["error"] == {"code": "SYS_INTERNAL_ERROR"}


def test_unknown_terminal_status_still_ends_with_failed_event():
    pending = {"id": "r1", "status": "in_progress"}
    stream = stream_turn(pending, lambda on_event: {"id": "r1", "status": "weird"}, poll_seconds=0.005)
    chunks = [c for c in collect(stream) if c.startswith("event:")]
    assert [c.split("\n")[0] for c in chunks] == ["event: response.created", "event: response.failed"]


def test_worker_exits_after_disconnect_even_with_a_full_queue():
    ran = threading.Event()

    def work(on_event):
        for _ in range(600):  # more than the queue holds, nobody reading
            on_event(("delta", "x"))
        ran.set()
        return {"id": "r1", "status": "completed"}

    async def disconnect():
        stream = stream_turn({"id": "r1", "status": "in_progress"}, work, ping_seconds=0.01)
        assert (await anext(stream)).startswith("event: response.created")
        assert ran.wait(5)
        # Captured while still blocked on the full queue: after aclose() it may already be gone.
        worker = next(t for t in threading.enumerate() if t.name == "turn-r1")
        await stream.aclose()  # client disconnect
        return worker

    worker = asyncio.run(disconnect())
    worker.join(5)
    assert not worker.is_alive()


def test_turn_runs_and_worker_exits_when_the_body_is_never_read():
    ran = threading.Event()

    def work(on_event):
        for _ in range(600):
            on_event(("delta", "x"))
        ran.set()
        return {"id": "r2", "status": "completed"}

    stream = stream_turn({"id": "r2", "status": "in_progress"}, work, abandon_seconds=0.2)
    worker = next(t for t in threading.enumerate() if t.name == "turn-r2")
    assert ran.wait(5)
    worker.join(5)
    assert not worker.is_alive()
    del stream


def test_worker_runs_in_the_callers_context():
    marker = contextvars.ContextVar("marker", default=None)
    marker.set("request-1")
    seen = []

    def work(on_event):
        seen.append(marker.get())
        return {"id": "r3", "status": "completed"}

    collect(stream_turn({"id": "r3", "status": "in_progress"}, work, poll_seconds=0.005))
    assert seen == ["request-1"]
