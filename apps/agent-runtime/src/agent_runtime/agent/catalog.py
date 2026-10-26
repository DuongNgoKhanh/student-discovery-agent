"""Code-owned declarations an agent snapshot may reference.

Studio may bind declared tools, fill their params and override their description; the tool set, the params
schema Studio fills and the arguments schema the model fills stay in code.
"""
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Annotated, Any

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


# Arguments the model fills; validated before any tool runs.
class StartArguments(ContractModel):
    experience_id: OpaqueId


class SetNameArguments(ContractModel):
    display_name: Annotated[str, StringConstraints(min_length=1, max_length=50, pattern=r"\S")]


class ProposeAnswerArguments(ContractModel):
    option_id: OpaqueId


class SuggestedReply(ContractModel):
    label: Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"\S")]
    message_text: Annotated[str, StringConstraints(min_length=1, max_length=500, pattern=r"\S")]


class SuggestRepliesArguments(ContractModel):
    items: Annotated[tuple[SuggestedReply, ...], Field(min_length=1, max_length=4)]


def _start_detail(params: StartAssessmentParams) -> str:
    return "Các bài hiện có: " + "; ".join(f"{item.experience_id} ({item.label})" for item in params.experiences)


@dataclass(frozen=True)
class ToolDeclaration:
    name: str
    version: int
    params_model: type[BaseModel]
    description: str
    arguments_model: type[ContractModel] = NoParams
    # Handoff: the server renders the next activity block itself, so the model's turn ends after this call.
    handoff: bool = False
    detail: Callable[[Any], str] | None = None  # extra description rendered from the binding's parsed params

    def describe(self, params: Mapping[str, Any], override: str | None = None) -> str:
        text = override or self.description
        if self.detail is None:
            return text
        return f"{text} {self.detail(self.params_model.model_validate(params))}"


TOOL_DECLARATIONS: dict[tuple[str, int], ToolDeclaration] = {
    (declaration.name, declaration.version): declaration for declaration in (
        ToolDeclaration("assessment.start", 1, StartAssessmentParams,
                        "Bắt đầu bài khám phá khi học sinh muốn làm bài.", StartArguments, handoff=True,
                        detail=_start_detail),
        ToolDeclaration("assessment.set_name", 1, NoParams,
                        "Lưu tên học sinh khi bạn ấy cho biết tên.", SetNameArguments, handoff=True),
        ToolDeclaration("assessment.current_question", 1, NoParams,
                        "Hiển thị lại câu hỏi hiện tại của bài khám phá.", handoff=True),
        ToolDeclaration("assessment.propose_answer", 1, NoParams,
                        "Đề xuất đáp án cho câu hỏi hiện tại từ câu trả lời tự do của học sinh; hệ thống sẽ hỏi "
                        "lại để học sinh xác nhận. Chỉ dùng option_id có trong câu hỏi hiện tại.",
                        ProposeAnswerArguments, handoff=True),
        ToolDeclaration("result.explain", 1, NoParams,
                        "Lấy kết quả bài khám phá đã hoàn thành để giải thích cho học sinh."),
        ToolDeclaration("ui.suggest_replies", 1, NoParams,
                        "Hiển thị tối đa 4 gợi ý trả lời nhanh, nhãn không trùng nhau.", SuggestRepliesArguments),
    )
}


def json_schema(model: type[BaseModel]) -> dict:
    """Provider-safe JSON schema: $refs inlined; title, default and additionalProperties dropped (Gemini rejects them)."""
    raw = model.model_json_schema()
    definitions = raw.pop("$defs", {})

    def clean(node):
        if isinstance(node, list):
            return [clean(item) for item in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            return clean(definitions[node["$ref"].rsplit("/", 1)[-1]])
        return {key: clean(value) for key, value in node.items()
                if key not in {"title", "default", "additionalProperties"}}

    return clean(raw)
