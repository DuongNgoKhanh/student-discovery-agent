"""Scripted ModelPort for tests and offline demos."""
from collections.abc import Callable

from .port import ModelReply, ModelUnavailable

Outcome = ModelReply | ModelUnavailable | Callable[[tuple], ModelReply | ModelUnavailable]


class FakeModel:
    def __init__(self, *outcomes: Outcome):
        self._outcomes = list(outcomes)
        self.calls: list[tuple] = []

    def invoke(self, messages, tools, settings, on_text_delta=None) -> ModelReply | ModelUnavailable:
        self.calls.append((tuple(messages), tuple(tools), settings))
        if not self._outcomes:  # an unscripted call is a test bug, not a fallback path
            raise AssertionError("FakeModel script exhausted")
        outcome = self._outcomes.pop(0)
        reply = outcome(tuple(messages)) if callable(outcome) else outcome
        if on_text_delta is not None and isinstance(reply, ModelReply) and reply.text:
            half = len(reply.text) // 2 or len(reply.text)
            for chunk in (reply.text[:half], reply.text[half:]):
                if chunk and on_text_delta(chunk) is False:
                    return ModelUnavailable("cancelled")
        return reply
