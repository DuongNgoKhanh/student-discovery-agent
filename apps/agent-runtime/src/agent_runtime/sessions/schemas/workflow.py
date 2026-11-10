"""Chatflow schema carried by agent.snapshot.v1 (mode=chatflow). Shape only: graph semantics are the T14 validator."""
import math
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from .common import ContractModel, JsonObject, NonEmptyText

NODE_TYPES = frozenset({"start", "if_else", "intent_classifier", "llm", "agent", "knowledge_retrieval",
                        "tool", "profile_propose", "assign", "answer"})

_JSON_SAFE_INT = 9007199254740991  # same bound as JsonSafeInt in common.py

Ident = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
Title = Annotated[str, StringConstraints(min_length=1, max_length=100, pattern=r"\S")]


def _supported_type(value: str) -> str:
    if value not in NODE_TYPES:
        raise PydanticCustomError("workflow_node_type_unsupported", "node type is not available in chatflow v1")
    return value


NodeType = Annotated[str, AfterValidator(_supported_type)]


def _fits(kind: str, value: Any, values: tuple[str, ...] | None) -> bool:
    if kind == "string":
        return isinstance(value, str)
    if kind == "number":
        if isinstance(value, bool):
            return False
        if isinstance(value, int):  # never float() an int: huge JSON integers raise OverflowError
            return abs(value) <= _JSON_SAFE_INT
        return isinstance(value, float) and math.isfinite(value)
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "enum":
        return isinstance(value, str) and value in (values or ())
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def value_fits(kind: str, value: Any, values: tuple[str, ...] | None = None) -> bool:
    """Public form of the variable type check, shared with the chatflow runtime."""
    return _fits(kind, value, values)


class ConvVariable(ContractModel):
    name: Ident
    type: Literal["string", "number", "boolean", "enum", "string_list"]
    values: Annotated[tuple[NonEmptyText, ...], Field(min_length=1, max_length=30)] | None = None
    default: Any

    @model_validator(mode="after")
    def consistent(self) -> "ConvVariable":
        if (self.type == "enum") != (self.values is not None):
            raise PydanticCustomError("workflow_variable_invalid", "only enum variables carry values, and they must",
                                      {"field": "values"})
        if self.values is not None and len(set(self.values)) != len(self.values):
            raise PydanticCustomError("duplicate_items", "enum values must be unique", {"field": "values"})
        if not _fits(self.type, self.default, self.values):
            raise PydanticCustomError("workflow_variable_invalid", "default does not fit the variable type",
                                      {"field": "default"})
        return self


class Position(ContractModel):
    x: Annotated[float, Field(allow_inf_nan=False)]
    y: Annotated[float, Field(allow_inf_nan=False)]


class NodeUi(ContractModel):
    position: Position | None = None


class WorkflowNode(ContractModel):
    id: Ident
    type: NodeType
    title: Title | None = None
    config: JsonObject = Field(default_factory=dict)  # per-type schema comes from the node-type catalog (T02/T14)
    ui: NodeUi = NodeUi()


class WorkflowEdge(ContractModel):
    id: Ident
    source: Ident
    source_handle: Ident
    target: Ident


class WorkflowBudget(ContractModel):
    # Defaults are the DEC-24 baseline proposal; hard ceilings are enforced by the T14 validator once DEC-24 is final.
    max_nodes: Annotated[int, Field(strict=True, ge=1)] = 20
    max_llm_calls: Annotated[int, Field(strict=True, ge=1)] = 6
    turn_timeout_ms: Annotated[int, Field(strict=True, ge=1)] = 25000


class Workflow(ContractModel):
    entry: Ident
    variables: Annotated[tuple[ConvVariable, ...], Field(max_length=30)] = ()
    nodes: Annotated[tuple[WorkflowNode, ...], Field(min_length=1, max_length=50)]
    edges: Annotated[tuple[WorkflowEdge, ...], Field(max_length=100)] = ()
    budget: WorkflowBudget = WorkflowBudget()

    @model_validator(mode="after")
    def unique_ids(self) -> "Workflow":
        for collection, key in (("variables", "name"), ("nodes", "id"), ("edges", "id")):
            seen: set[str] = set()
            for index, item in enumerate(getattr(self, collection)):
                value = getattr(item, key)
                if value in seen:  # first duplicate only; reporting every one is the T14 validator's job
                    raise PydanticCustomError("duplicate_items", "ids must be unique",
                                              {"field": f"{collection}.{index}.{key}"})
                seen.add(value)
        return self


class PersonaTurn(ContractModel):
    input: JsonObject
    llm_stubs: dict[str, Any] = Field(default_factory=dict)
    expect: JsonObject = Field(default_factory=dict)


class PersonaCase(ContractModel):
    id: Ident
    title: Title
    mandatory: bool = False
    initial_state: JsonObject = Field(default_factory=dict)
    turns: Annotated[tuple[PersonaTurn, ...], Field(min_length=1, max_length=20)]
