"""Scripted ModelPort for tests and offline demos."""
from collections.abc import Callable

from .port import ModelReply, ModelUnavailable

Outcome = ModelReply | ModelUnavailable | Callable[[tuple], ModelReply | ModelUnavailable]


class FakeModel:
    def __init__(self, *outcomes: Outcome):
        self._outcomes = list(outcomes)
        self.calls: list[tuple] = []

    def invoke(self, messages, tools, settings) -> ModelReply | ModelUnavailable:
        self.calls.append((tuple(messages), tuple(tools), settings))
        if not self._outcomes:  # an unscripted call is a test bug, not a fallback path
            raise AssertionError("FakeModel script exhausted")
        outcome = self._outcomes.pop(0)
        return outcome(tuple(messages)) if callable(outcome) else outcome
