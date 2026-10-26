"""Local-only Product stand-in: active releases read from a directory, for running the runtime without Product.

Layout: ``agent.json`` (agent.snapshot.v1 content) and ``experiences/<experience_id>.json`` (definition content).
Files are re-read on every resolution, so edits apply to the next conversation or activity; existing pins never
change. Release IDs derive from the content hash. Never configure this outside a local environment.
"""
import json
from pathlib import Path

from agent_runtime.evaluations.services.validator import calculate_content_hash
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.activity import ADAPTIVE_PROFILE
from agent_runtime.sessions.schemas.release import ReleaseDescriptor

_PROFILES = {"1.0": None, "2.0": ADAPTIVE_PROFILE}


class LocalReleaseSource:
    def __init__(self, directory: str | Path):
        self.directory = Path(directory)

    def _read(self, path: Path) -> dict:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise RuntimeSessionError(422, "EXPERIENCE_NOT_CONFIGURED") from None

    @staticmethod
    def _release_id(prefix: str, content_hash: str) -> str:
        return f"{prefix}-{content_hash.removeprefix('sha256:')[:16]}"

    def resolve_active_agent(self, environment: str) -> ReleaseDescriptor:
        content = self._read(self.directory / "agent.json")
        content_hash = calculate_content_hash(content)
        return ReleaseDescriptor(environment=environment, kind="agent",
            release_id=self._release_id("local-agent", content_hash), content_hash=content_hash,
            delivery_schema_version="agent.snapshot.v1", content=content, is_demo=True)

    def resolve_active_experience(
        self, environment: str, experience_id: str, algorithm_profile: str | None
    ) -> ReleaseDescriptor:
        if not experience_id.replace("_", "").replace("-", "").isalnum():
            raise RuntimeSessionError(422, "EXPERIENCE_NOT_CONFIGURED")
        content = self._read(self.directory / "experiences" / f"{experience_id}.json")
        version = content.get("schema_version")
        if version not in _PROFILES or _PROFILES[version] != algorithm_profile:
            raise RuntimeSessionError(422, "EXPERIENCE_NOT_CONFIGURED")
        content_hash = calculate_content_hash(content)
        return ReleaseDescriptor(environment=environment, kind="experience",
            release_id=self._release_id(f"local-{experience_id}".replace("_", "-"), content_hash),
            content_hash=content_hash, delivery_schema_version="experience.snapshot.v1", content=content,
            is_demo=True, definition_schema_version=version, engine_version=content.get("engine_version"),
            algorithm_profile=algorithm_profile)
