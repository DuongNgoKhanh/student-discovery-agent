"""Server-sent events for one turn: a worker thread runs the turn, an async reader drains a bounded queue.

`stream_turn` starts the worker before it returns, so the turn runs and commits even if the response body is
never iterated (a client gone before the first byte). A client that disconnects only stops the reader; GET
/responses/{id} still returns the result. The worker runs in a copy of the caller's context so its trace keeps
the request's correlation ids.
"""
import contextvars
import json
import queue
import threading
import time
from collections.abc import AsyncIterator, Callable

import anyio

from agent_runtime.sessions.schemas.responses import TERMINAL_EVENTS

PING_SECONDS = 15.0
POLL_SECONDS = 0.05
# A worker blocked on a full queue gives up after this long without a reader (a body that was never iterated
# never sets `closed`); the turn is already committed by then, only the undelivered frames are dropped.
ABANDON_SECONDS = 60.0
_DONE = object()


def frame(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def stream_turn(response: dict, work: Callable[[Callable], dict] | None, *,
                ping_seconds: float = PING_SECONDS, poll_seconds: float = POLL_SECONDS,
                abandon_seconds: float = ABANDON_SECONDS) -> AsyncIterator[str]:
    """`response` is the begun (in_progress) or replayed Response; `work(on_event)` returns the final one.

    Call from the request's context: the worker thread starts here, not on the first read.
    """
    created = frame("response.created", {"response": response})
    if work is None or response["status"] != "in_progress":
        return _replay(created, frame(TERMINAL_EVENTS[response["status"]], {"response": response}))
    events: queue.Queue = queue.Queue(maxsize=512)
    closed = threading.Event()

    def on_event(event):
        kind, value = event
        item = (frame("response.output_text.delta", {"delta": value}) if kind == "delta"
                else frame("response.tool_call", {"name": value}))
        try:
            events.put_nowait(item)
        except queue.Full:  # nobody is reading fast enough (or at all): drafts are disposable
            pass

    def put_until_closed(item, deadline):
        # Blocking so a slow live reader still gets the terminal event; abandoned once the reader is gone.
        while not closed.is_set() and time.monotonic() < deadline:
            try:
                events.put(item, timeout=0.1)
                return
            except queue.Full:
                continue

    def run():
        try:
            final = work(on_event)
            terminal = frame(TERMINAL_EVENTS[final["status"]], {"response": final})
        except Exception:  # finish() maps business errors itself; this keeps the stream's single terminal event
            failed = {**response, "status": "failed", "error": {"code": "SYS_INTERNAL_ERROR"}}
            terminal = frame(TERMINAL_EVENTS["failed"], {"response": failed})
        deadline = time.monotonic() + abandon_seconds
        put_until_closed(terminal, deadline)
        put_until_closed(_DONE, deadline)

    context = contextvars.copy_context()
    threading.Thread(target=context.run, args=(run,), name=f"turn-{response['id']}", daemon=True).start()
    return _read(created, events, closed, ping_seconds, poll_seconds)


async def _replay(created: str, terminal: str) -> AsyncIterator[str]:
    yield created
    yield terminal


async def _read(created: str, events: queue.Queue, closed: threading.Event,
                ping_seconds: float, poll_seconds: float) -> AsyncIterator[str]:
    # Non-blocking polls: an open stream holds no threadpool token while it waits.
    try:
        yield created
        idle = 0.0
        while True:
            try:
                item = events.get_nowait()
            except queue.Empty:
                if idle >= ping_seconds:
                    idle = 0.0
                    yield ": ping\n\n"
                await anyio.sleep(poll_seconds)
                idle += poll_seconds
                continue
            idle = 0.0
            if item is _DONE:
                return
            yield item
    finally:
        closed.set()
