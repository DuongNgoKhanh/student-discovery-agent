"""Code-owned declarations an agent snapshot may reference.

Studio may bind declared tools and fill their params; behaviour, argument schemas and effects stay in code.
"""
from dataclasses import dataclass
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from agent_runtime.sessions.schemas.common import ContractModel, NonEmptyText, OpaqueId

SUPPORTED_MODEL_PROVIDERS = frozenset({"gemini"})
PROMPT_VARIABLES = frozenset({"display_name", "current_date"})


class NoParams(ContractModel):
    pass


class StartExperience(ContractModel):
    experience_id: OpaqueId
    algorithm_profile: NonEmptyText
    label: Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"\S")]


class StartAssessmentParams(ContractModel):
    experiences: Annotated[tuple[StartExperience, ...], Field(min_length=1)]


@dataclass(frozen=True)
class ToolDeclaration:
    name: str
    version: int
    params_model: type[BaseModel]


TOOL_DECLARATIONS: dict[tuple[str, int], ToolDeclaration] = {
    (declaration.name, declaration.version): declaration for declaration in (
        ToolDeclaration("assessment.start", 1, StartAssessmentParams),
        ToolDeclaration("assessment.set_name", 1, NoParams),
        ToolDeclaration("assessment.current_question", 1, NoParams),
        ToolDeclaration("assessment.propose_answer", 1, NoParams),
        ToolDeclaration("result.explain", 1, NoParams),
        ToolDeclaration("ui.suggest_replies", 1, NoParams),
    )
}
