"""Code-owned declarations an agent snapshot may reference.

Studio may bind declared tools, fill their params and override their description; the tool set and its params
schema stay in code.
"""
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, model_validator

from agent_runtime.sessions.schemas.common import ContractModel, NonEmptyText, OpaqueId

SUPPORTED_MODEL_PROVIDERS = frozenset({"gemini", "openai"})  # adapters: infrastructure/llm/model_registry.py
PROMPT_VARIABLES = frozenset({"display_name", "current_date"})
PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def render_placeholders(text: str, values: Mapping[str, str]) -> str:
    """Substitute {{name}} placeholders whose name is in values; others stay literal."""
    return PLACEHOLDER.sub(lambda match: values.get(match.group(1), match.group(0)), text)


class NoParams(ContractModel):
    pass


class StartExperience(ContractModel):
    experience_id: OpaqueId
    algorithm_profile: NonEmptyText
    label: Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"\S")]


class StartAssessmentParams(ContractModel):
    experiences: Annotated[tuple[StartExperience, ...], Field(min_length=1)]

    @model_validator(mode="after")
    def unique_experiences(self) -> "StartAssessmentParams":
        if len({item.experience_id for item in self.experiences}) != len(self.experiences):
            raise ValueError("experience_id must be unique")
        return self


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
