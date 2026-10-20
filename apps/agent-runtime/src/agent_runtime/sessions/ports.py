"""Synchronous ports. Routes invoke services in FastAPI's worker threadpool."""
from datetime import datetime
from typing import Protocol

from agent_runtime.engine.schemas.selector import SelectionResult

from .schemas.activity import ActivityAnswer
from .schemas.release import ReleaseDescriptor, ValidatedRelease
from .schemas.turn_execution import CompletionBundle, CompletionContext


class Clock(Protocol):
    def now(self) -> datetime: ...


class ProductReleaseSource(Protocol):
    def resolve_active_agent(self, environment: str) -> ReleaseDescriptor: ...

    def resolve_active_experience(
        self, environment: str, experience_id: str, algorithm_profile: str | None
    ) -> ReleaseDescriptor: ...


class AssessmentEngine(Protocol):
    """Pinned definition + accepted prefix -> selection. No DB, Product or LLM access."""
    def select(self, release: ValidatedRelease, answers: tuple[ActivityAnswer, ...]) -> SelectionResult: ...


class CompletionPort(Protocol):
    """Result/card/share projector owned by B-03/C-04; B-02 only commits its bundle."""
    def prepare(self, context: CompletionContext) -> CompletionBundle: ...
