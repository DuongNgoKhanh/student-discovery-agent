"""Dify-style metadata conditions -> a parameterised SQL predicate over field-id-keyed revision metadata."""
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from agent_runtime.knowledge.metadata import is_time
from agent_runtime.knowledge.schemas import OPERATORS, MetadataCondition, MetadataField

_STRING = {
    "is": "({c}->>:{k}) = :{v}",
    "is not": "({c}->>:{k}) IS DISTINCT FROM :{v}",
    "contains": "COALESCE(strpos({c}->>:{k}, :{v}), 0) > 0",
    "not contains": "COALESCE(strpos({c}->>:{k}, :{v}), 0) = 0",
    "start with": "left({c}->>:{k}, char_length(:{v})) = :{v}",
    "end with": "right({c}->>:{k}, char_length(:{v})) = :{v}",
    "empty": "COALESCE({c}->>:{k}, '') = ''",
    "not empty": "COALESCE({c}->>:{k}, '') <> ''",
}
_NUMBER_OPS = {"=": "=", "≠": "<>", ">": ">", "<": "<", "≥": ">=", "≤": "<="}
_TIME_OPS = {"is": "=", "before": "<", "after": ">"}
_LIST = {
    "contains": "COALESCE(jsonb_exists({c}->:{k}, :{v}), false)",
    "not contains": "NOT COALESCE(jsonb_exists({c}->:{k}, :{v}), false)",
    "empty": "COALESCE(jsonb_array_length({c}->:{k}), 0) = 0",
    "not empty": "COALESCE(jsonb_array_length({c}->:{k}), 0) > 0",
}
_VALUELESS = {"empty", "not empty"}


class FilterError(ValueError):
    pass


@dataclass(frozen=True)
class CompiledFilter:
    sql: str
    params: dict[str, Any]


def _template(field: MetadataField, operator: str, value: Any) -> str:
    if operator in _VALUELESS:
        if field.type in ("number", "time"):
            return "{c}->:{k} IS NULL" if operator == "empty" else "{c}->:{k} IS NOT NULL"
        return (_LIST if field.type == "string_list" else _STRING)[operator]
    if field.type == "number":
        if not isinstance(value, int | float):
            raise FilterError(f"{field.name} needs a number")
        return f"(jsonb_typeof({{c}}->:{{k}}) = 'number' AND ({{c}}->>:{{k}})::numeric {_NUMBER_OPS[operator]} :{{v}})"
    if not isinstance(value, str):
        raise FilterError(f"{field.name} needs a string value")
    if field.type == "time":
        if not is_time(value):
            raise FilterError(f"{field.name} needs an ISO date or datetime")
        return f"({{c}}->>:{{k}})::timestamptz {_TIME_OPS[operator]} CAST(:{{v}} AS timestamptz)"
    return (_LIST if field.type == "string_list" else _STRING)[operator]


def compile_filter(condition: MetadataCondition | None, fields: Sequence[MetadataField], *,
                   column: str = "r.metadata", prefix: str = "mf") -> CompiledFilter:
    if condition is None:
        return CompiledFilter("TRUE", {})
    by_name = {field.name: field for field in fields}
    parts: list[str] = []
    params: dict[str, Any] = {}
    for index, item in enumerate(condition.conditions):
        field = by_name.get(item.name)
        if field is None or not field.filterable:
            raise FilterError(f"{item.name} is not a filterable field")
        if item.comparison_operator not in OPERATORS[field.type]:
            raise FilterError(f"{item.comparison_operator} does not apply to {field.type}")
        if item.comparison_operator not in _VALUELESS and item.value is None:
            raise FilterError(f"{item.name} needs a value")
        key, value = f"{prefix}{index}k", f"{prefix}{index}v"
        parts.append(_template(field, item.comparison_operator, item.value).format(c=column, k=key, v=value))
        params[key] = field.id
        if item.comparison_operator not in _VALUELESS:
            params[value] = item.value
    joiner = " OR " if condition.logical_operator == "or" else " AND "
    return CompiledFilter("(" + joiner.join(parts) + ")", params)
