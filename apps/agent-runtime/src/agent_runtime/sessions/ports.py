"""Synchronous ports. Routes invoke services in FastAPI's worker threadpool."""
from datetime import datetime
from typing import Protocol

from .schemas.release import ReleaseDescriptor


class Clock(Protocol):
    def now(self) -> datetime: ...


class ProductReleaseSource(Protocol):
    def resolve_active_agent(self, environment: str) -> ReleaseDescriptor: ...

    def resolve_active_experience(
        self, environment: str, experience_id: str, algorithm_profile: str | None
    ) -> ReleaseDescriptor: ...
