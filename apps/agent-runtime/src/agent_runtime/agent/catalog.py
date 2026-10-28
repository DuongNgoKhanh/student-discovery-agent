"""Code-owned declarations an agent snapshot may reference.

Studio may bind declared tools, fill their params and override their description; the tool set, the params
schema Studio fills and the arguments schema the model fills stay in code.
"""
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints, model_validator

from agent_runtime.knowledge.schemas import OPERATORS, FieldName, MetadataCondition, MetadataField
from agent_runtime.sessions.schemas.common import ContractModel, NonEmptyText, OpaqueId

SUPPORTED_MODEL_PROVIDERS = frozenset({"gemini", "openai", "vllm"})  # adapters: infrastructure/llm/model_registry.py
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


class KnowledgeSearchParams(ContractModel):
    knowledge_base_id: OpaqueId
    top_k: Annotated[int, Field(strict=True, ge=1, le=8)] = 5  # chunks, not documents
    max_chunks_per_doc: Annotated[int, Field(strict=True, ge=1, le=5)] = 2
    score_threshold: Annotated[float, Field(ge=0, le=1)] = 0.3
    semantic_weight: Annotated[float, Field(ge=0, le=1)] = 0.7
    fixed_filter: MetadataCondition | None = None  # Studio-owned; the model cannot lift it
    auto_filter_fields: Annotated[tuple[FieldName, ...], Field(max_length=10)] = ()

    @model_validator(mode="after")
    def unique_fields(self) -> "KnowledgeSearchParams":
        if len(set(self.auto_filter_fields)) != len(self.auto_filter_fields):
            raise ValueError("auto_filter_fields must be unique")
        return self


class KnowledgeSearchArguments(ContractModel):
    query: Annotated[str, StringConstraints(min_length=1, max_length=300, pattern=r"\S")]
    filter: MetadataCondition | None = None


class DisplayField(ContractModel):
    field: FieldName
    label: Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"\S")]


class KnowledgeShowParams(ContractModel):
    display: Annotated[tuple[DisplayField, ...], Field(min_length=1, max_length=8)]
    max_cards: Annotated[int, Field(strict=True, ge=1, le=3)] = 3


class KnowledgeShowArguments(ContractModel):
    refs: Annotated[tuple[Annotated[str, StringConstraints(min_length=1, max_length=8)], ...],
                    Field(min_length=1, max_length=3)]


@dataclass(frozen=True)
class ToolContext:
    """Server state read once per turn, before the model is called; some tools describe themselves from it."""
    knowledge_fields: Mapping[str, tuple[MetadataField, ...]] = field(default_factory=dict)


NO_CONTEXT = ToolContext()
ALL_OPERATORS = frozenset().union(*OPERATORS.values())
_FILTER_VALUE = {"anyOf": [{"type": "string"}, {"type": "number"}, {"type": "array", "items": {"type": "string"}}]}


def _start_detail(params: StartAssessmentParams, context: ToolContext) -> str:
    return "Các bài hiện có: " + "; ".join(f"{item.experience_id} ({item.label})" for item in params.experiences)


def _filter_fields(params: KnowledgeSearchParams, context: ToolContext) -> list[tuple[str, MetadataField | None]]:
    known = {item.name: item for item in context.knowledge_fields.get(params.knowledge_base_id, ())}
    return [(name, known.get(name)) for name in params.auto_filter_fields]


def _search_detail(params: KnowledgeSearchParams, context: ToolContext) -> str:
    fields = _filter_fields(params, context)
    if not fields:
        return ""
    return "Lọc được theo: " + "; ".join(
        f"{name} ({item.type}: {', '.join(sorted(OPERATORS[item.type]))})" if item else name
        for name, item in fields) + "."


def _search_schema(params: KnowledgeSearchParams, context: ToolContext) -> dict:
    properties: dict[str, Any] = {"query": {"type": "string", "description": "Câu cần tìm, tiếng Việt có dấu."}}
    fields = _filter_fields(params, context)
    if fields:
        operators = sorted(set().union(*(OPERATORS[item.type] if item else ALL_OPERATORS for _, item in fields)))
        properties["filter"] = {"type": "object", "properties": {
            "logical_operator": {"type": "string", "enum": ["and", "or"]},
            "conditions": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string", "enum": [name for name, _ in fields]},
                "comparison_operator": {"type": "string", "enum": operators},
                "value": _FILTER_VALUE}, "required": ["name", "comparison_operator"]}}},
            "required": ["conditions"]}
    return {"type": "object", "properties": properties, "required": ["query"]}


@dataclass(frozen=True)
class ToolDeclaration:
    name: str
    version: int
    params_model: type[BaseModel]
    description: str
    arguments_model: type[ContractModel] = NoParams
    # Handoff: the server renders the next activity block itself, so the model's turn ends after this call.
    handoff: bool = False
    detail: Callable[[Any, ToolContext], str] | None = None  # extra description from the parsed params
    schema: Callable[[Any, ToolContext], dict] | None = None  # per-turn arguments schema; default: arguments_model

    def describe(self, params: Mapping[str, Any], override: str | None = None,
                 context: ToolContext = NO_CONTEXT) -> str:
        text = override or self.description
        extra = self.detail(self.params_model.model_validate(params), context) if self.detail else ""
        return f"{text} {extra}" if extra else text

    def parameters(self, params: Mapping[str, Any], context: ToolContext = NO_CONTEXT) -> dict:
        if self.schema is None:
            return json_schema(self.arguments_model)
        return self.schema(self.params_model.model_validate(params), context)


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
        ToolDeclaration("knowledge.search", 1, KnowledgeSearchParams,
                        "Tìm thông tin tuyển sinh (trường, ngành, học phí, điều kiện) trong kho dữ liệu. Mỗi kết quả "
                        "có ref (k1, k2…) để dùng với knowledge.show trong cùng lượt.",
                        KnowledgeSearchArguments, detail=_search_detail, schema=_search_schema),
        ToolDeclaration("knowledge.show", 1, KnowledgeShowParams,
                        "Hiển thị thẻ thông tin cho các ref vừa tìm được trong lượt này; hệ thống tự dựng thẻ từ dữ "
                        "liệu gốc.", KnowledgeShowArguments),
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
