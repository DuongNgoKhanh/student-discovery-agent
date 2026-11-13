"""What a node wants changed. Nodes never write; the turn commit applies these once."""
from dataclasses import dataclass
from typing import Any

from agent_runtime.tools.kit import Handoff


@dataclass(frozen=True)
class AssignConv:
    variable: str  # name without the "conv." prefix
    value: Any  # final value after the operation
    operation: str = "set"


@dataclass(frozen=True)
class ActivityChange:
    handoff: Handoff


@dataclass(frozen=True)
class ProfileProposal:
    fields: tuple[tuple[str, Any], ...]
    target_step: str | None = None


@dataclass(frozen=True)
class KbRefsUsed:
    kb_id: str
    refs: tuple[str, ...]


Effect = AssignConv | ActivityChange | ProfileProposal | KbRefsUsed
