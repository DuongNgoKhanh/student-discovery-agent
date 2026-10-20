"""Explicitly injected Product stand-in: active pointers, resolution count and outage."""
from agent_runtime.sessions.errors import RuntimeSessionError


class FakeProductReleaseSource:
    def __init__(self):
        self.agent = None
        self.experiences = {}
        self.resolve_calls = 0
        self.unavailable = False

    def _resolve(self, release, environment):
        self.resolve_calls += 1
        if self.unavailable:
            raise RuntimeSessionError(503, "SERVICE_UNAVAILABLE")
        if release is None or release.environment != environment:
            raise RuntimeSessionError(422, "EXPERIENCE_NOT_CONFIGURED")
        return release.model_copy(deep=True)

    def resolve_active_agent(self, environment):
        return self._resolve(self.agent, environment)

    def resolve_active_experience(self, environment, experience_id, algorithm_profile):
        return self._resolve(self.experiences.get((experience_id, algorithm_profile)), environment)
