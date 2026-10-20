"""Fail closed until an actual Product delivery adapter is configured."""
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.release import ReleaseDescriptor


class ProductUnavailable:
    def resolve_active_agent(self, environment: str) -> ReleaseDescriptor:
        raise RuntimeSessionError(503, "SERVICE_UNAVAILABLE")

    def resolve_active_experience(
        self, environment: str, experience_id: str, algorithm_profile: str | None
    ) -> ReleaseDescriptor:
        raise RuntimeSessionError(503, "SERVICE_UNAVAILABLE")
