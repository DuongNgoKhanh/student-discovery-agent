"""Server-sent events for one turn: a worker thread runs the turn, the response iterator drains a bounded queue.

A client that disconnects only stops the iterator; the worker keeps running and commits, so GET /responses/{id}
still returns the result.
"""
import json
import queue
import threading
from collections.abc import Callable, Iterator

from agent_runtime.sessions.schemas.responses import TERMINAL_EVENTS

PING_SECONDS = 15.0
_DONE = object()


def frame(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def stream_turn(response: dict, work: Callable[[Callable], dict] | None, *,
                ping_seconds: float = PING_SECONDS) -> Iterator[str]:
    """`response` is the begun (in_progress) or replayed Response; `work(on_event)` returns the final one."""
    if work is None or response["status"] != "in_progress":
        yield frame(TERMINAL_EVENTS[response["status"]], {"response": response})
        return
    events: queue.Queue = queue.Queue(maxsize=512)

    def on_event(event):
        kind, value = event
        item = (frame("response.output_text.delta", {"delta": value}) if kind == "delta"
                else frame("response.tool_call", {"name": value}))
        try:
            events.put_nowait(item)
        except queue.Full:  # nobody is reading fast enough (or at all): drafts are disposable
            pass

    def run():
        try:
            final = work(on_event)
        except Exception:  # finish() maps business errors itself; this keeps the stream's single terminal event
            final = {**response, "status": "failed", "error": {"code": "INTERNAL_ERROR"}}
        events.put(frame(TERMINAL_EVENTS[final["status"]], {"response": final}))
        events.put(_DONE)

    yield frame("response.created", {"response": response})
    threading.Thread(target=run, name=f"turn-{response['id']}", daemon=True).start()
    while True:
        try:
            item = events.get(timeout=ping_seconds)
        except queue.Empty:
            yield ": ping\n\n"
            continue
        if item is _DONE:
            return
        yield item
