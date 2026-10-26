"""Immutable Product delivery descriptors, separate from definition versions."""
from typing import Annotated, Literal

from pydantic import AfterValidator, Field, StringConstraints, ValidationError, model_validator

from agent_runtime.agent.catalog import PLACEHOLDER, PROMPT_VARIABLES, SUPPORTED_MODEL_PROVIDERS, TOOL_DECLARATIONS

from .common import ContentHash, ContractModel, JsonObject, NonEmptyText, OpaqueId


def _known_variables(text: str) -> str:
    unknown = set(PLACEHOLDER.findall(text)) - PROMPT_VARIABLES
    if unknown:
        raise ValueError(f"unknown prompt variables: {sorted(unknown)}")
    return text


PromptText = Annotated[str, StringConstraints(min_length=1, max_length=8000, pattern=r"\S"),
                       AfterValidator(_known_variables)]
TemplateText = Annotated[str, StringConstraints(min_length=1, max_length=500, pattern=r"\S"),
                         AfterValidator(_known_variables)]
Label = Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"\S")]
Labels = Annotated[tuple[Label, ...], Field(max_length=4)]


class ReleaseKey(ContractModel):
    environment: NonEmptyText
    kind: Literal["agent", "experience"]
    release_id: OpaqueId


class AgentPersona(ContractModel):
    name: Label = "IHRD Mentor"
    language: Literal["vi"] = "vi"
    system_prompt: PromptText = ("Bạn là người đồng hành hướng nghiệp thân thiện cho học sinh THPT. "
                                 "Trả lời ngắn gọn bằng tiếng Việt.")


class AgentModelConfig(ContractModel):
    ref: Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]+/[A-Za-z0-9._-]+$")]
    temperature: Annotated[float, Field(strict=True, ge=0, le=2)] = 0.4
    max_output_tokens: Annotated[int, Field(strict=True, ge=1, le=4096)] = 800
    timeout_ms: Annotated[int, Field(strict=True, ge=1000, le=30000)] = 8000
    max_retries: Annotated[int, Field(strict=True, ge=0, le=3)] = 1

    @property
    def provider(self) -> str:
        return self.ref.split("/", 1)[0]

    @property
    def model_id(self) -> str:
        return self.ref.split("/", 1)[1]

    @model_validator(mode="after")
    def supported_provider(self) -> "AgentModelConfig":
        if self.provider not in SUPPORTED_MODEL_PROVIDERS:
            raise ValueError("unsupported model provider")
        return self


class AgentLimits(ContractModel):
    max_tool_steps: Annotated[int, Field(strict=True, ge=1, le=8)] = 4
    turn_timeout_ms: Annotated[int, Field(strict=True, ge=1000, le=30000)] = 20000
    history_messages: Annotated[int, Field(strict=True, ge=0, le=50)] = 20
    max_input_chars: Annotated[int, Field(strict=True, ge=1, le=4000)] = 1000


class AgentToolBinding(ContractModel):
    name: NonEmptyText
    version: Annotated[int, Field(strict=True, ge=1)]
    params: JsonObject = Field(default_factory=dict)
    description: Annotated[str, StringConstraints(min_length=1, max_length=1000, pattern=r"\S")] | None = None

    @model_validator(mode="after")
    def declared(self) -> "AgentToolBinding":
        declaration = TOOL_DECLARATIONS.get((self.name, self.version))
        if declaration is None:
            raise ValueError("tool is not declared in the runtime catalog")
        try:
            declaration.params_model.model_validate(self.params)
        except ValidationError as error:
            raise ValueError(f"invalid params for {self.name}@{self.version}") from error
        return self


class AgentGuardrails(ContractModel):
    blocked_topics: Annotated[tuple[Label, ...], Field(max_length=20)] = ()
    refusal_text: TemplateText = "Mình chỉ hỗ trợ các chủ đề học tập và hướng nghiệp nhé."


class AgentTemplates(ContractModel):
    unknown_message: TemplateText = "Mình chưa hiểu ý em. Em thử chọn một gợi ý bên dưới nhé."
    fallback_suggestions: Labels = ("Làm bài khám phá",)
    next_question: TemplateText = "Câu tiếp theo nhé, {{display_name}}!"
    completed: TemplateText = "Đây là kết quả của em!"
    clarification: TemplateText = "Em chọn ý nào dưới đây?"


class AgentSnapshotV1(ContractModel):
    """agent.snapshot.v1: whole agent config. Defaults mean "no LLM, no tools" so older snapshots stay valid."""
    greeting_text: NonEmptyText
    allowed_activity_profiles: tuple[NonEmptyText, ...]
    greeting_suggestions: Labels = ()
    persona: AgentPersona = AgentPersona()
    model: AgentModelConfig | None = None
    limits: AgentLimits = AgentLimits()
    tools: tuple[AgentToolBinding, ...] = ()
    guardrails: AgentGuardrails = AgentGuardrails()
    templates: AgentTemplates = AgentTemplates()

    def tool(self, name: str) -> AgentToolBinding | None:
        return next((binding for binding in self.tools if binding.name == name), None)

    @model_validator(mode="after")
    def consistent(self) -> "AgentSnapshotV1":
        if len(set(self.allowed_activity_profiles)) != len(self.allowed_activity_profiles):
            raise ValueError("activity profiles must be unique")
        if len({binding.name for binding in self.tools}) != len(self.tools):
            raise ValueError("a tool can be bound once")
        start = self.tool("assessment.start")
        if start and any(item["algorithm_profile"] not in self.allowed_activity_profiles
                         for item in start.params["experiences"]):
            raise ValueError("assessment.start experiences must use allowed activity profiles")
        return self


class ReleaseDescriptor(ReleaseKey):
    content_hash: ContentHash
    delivery_schema_version: NonEmptyText
    content: JsonObject
    is_demo: bool
    definition_schema_version: NonEmptyText | None = None
    algorithm_profile: NonEmptyText | None = None
    engine_version: NonEmptyText | None = None

    @model_validator(mode="after")
    def validate_kind_metadata(self) -> "ReleaseDescriptor":
        if self.kind == "agent":
            if self.delivery_schema_version != "agent.snapshot.v1":
                raise ValueError("unsupported agent delivery schema")
            if any((self.definition_schema_version, self.algorithm_profile, self.engine_version)):
                raise ValueError("agent snapshot cannot carry experience metadata")
            AgentSnapshotV1.model_validate(self.content)
        elif self.definition_schema_version is None or self.engine_version is None:
            raise ValueError("experience requires definition and engine metadata")
        return self


class ValidatedRelease(ReleaseDescriptor):
    """Descriptor after hash/registry/policy validation by the release importer.

    Construction validates structure only; callers must use the importer for trust.
    """
