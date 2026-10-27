"""Knowledge contracts; request/response follow Dify's External Knowledge API shape."""
from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import Field, StrictFloat, StrictInt, StrictStr, StringConstraints

from agent_runtime.sessions.schemas.common import ContractModel, JsonObject, OpaqueId

FieldType = Literal["string", "number", "time", "string_list"]
FieldName = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,63}$")]

OPERATORS: dict[str, frozenset[str]] = {
    "string": frozenset({"is", "is not", "contains", "not contains", "start with", "end with", "empty", "not empty"}),
    "number": frozenset({"=", "≠", ">", "<", "≥", "≤", "empty", "not empty"}),
    "time": frozenset({"is", "before", "after", "empty", "not empty"}),
    "string_list": frozenset({"contains", "not contains", "empty", "not empty"}),
}


class MetadataField(ContractModel):
    id: OpaqueId
    name: FieldName
    type: FieldType
    filterable: bool = False
    label: str = ""


class Condition(ContractModel):
    name: FieldName
    comparison_operator: Annotated[str, StringConstraints(min_length=1, max_length=16)]
    value: StrictStr | StrictInt | StrictFloat | list[StrictStr] | None = None


class MetadataCondition(ContractModel):
    logical_operator: Literal["and", "or"] = "and"
    conditions: Annotated[tuple[Condition, ...], Field(min_length=1, max_length=10)]


class RetrievalSetting(ContractModel):
    top_k: Annotated[int, Field(strict=True, ge=1, le=20)] = 4
    score_threshold: Annotated[float, Field(ge=0, le=1)] = 0.0
    semantic_weight: Annotated[float, Field(ge=0, le=1)] = 0.7


class RetrievalRequest(ContractModel):
    knowledge_id: OpaqueId
    query: Annotated[str, StringConstraints(min_length=1, max_length=300, pattern=r"\S")]
    retrieval_setting: RetrievalSetting = RetrievalSetting()
    metadata_condition: MetadataCondition | None = None


class Record(ContractModel):
    content: str
    score: float
    title: str
    metadata: JsonObject


class RetrievalResult(ContractModel):
    records: tuple[Record, ...]
    degraded: bool = False  # the query embedding failed: keyword-only scores


@dataclass(frozen=True)
class KnowledgeUnavailable:
    reason: Literal["not_found", "timeout", "dependency_down"]
