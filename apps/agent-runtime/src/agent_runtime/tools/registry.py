"""Every tool the runtime declares, keyed by (name, version): a release pins both (QT-06)."""
from agent_runtime.tools import assessment, knowledge, ui
from agent_runtime.tools.kit import Tool

_GROUPS: tuple[tuple[Tool, ...], ...] = (assessment.TOOLS, ui.TOOLS, knowledge.TOOLS)

TOOLS: dict[tuple[str, int], Tool] = {}
for _group in _GROUPS:
    for _tool in _group:
        if (_tool.name, _tool.version) in TOOLS:
            raise ValueError(f"tool {_tool.name}@{_tool.version} is declared twice")
        TOOLS[(_tool.name, _tool.version)] = _tool


def find(name: object, version: object) -> Tool | None:
    return TOOLS.get((name, version)) if isinstance(name, str) and isinstance(version, int) else None
