"""Name-keyed metadata in, field-id-keyed storage out, so renaming a field never touches revisions."""
import math
from collections.abc import Mapping, Sequence
from datetime import date, datetime
from typing import Any

from agent_runtime.knowledge.schemas import MetadataField

MAX_STRING = 2000
MAX_LIST_ITEMS = 50
MAX_LIST_ITEM = 200


class MetadataError(ValueError):
    pass


def is_time(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    for parse in (date.fromisoformat, datetime.fromisoformat):
        try:
            parse(value)
            return True
        except ValueError:
            continue
    return False


def _valid(field: MetadataField, value: Any) -> bool:
    if field.type == "string":
        return isinstance(value, str) and len(value) <= MAX_STRING
    if field.type == "number":
        return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
    if field.type == "time":
        return is_time(value)
    return (isinstance(value, list) and len(value) <= MAX_LIST_ITEMS
            and all(isinstance(item, str) and 0 < len(item) <= MAX_LIST_ITEM for item in value))


def validate_metadata(fields: Sequence[MetadataField], values: Mapping[str, Any]) -> dict[str, Any]:
    by_name = {field.name: field for field in fields}
    stored: dict[str, Any] = {}
    for name, value in values.items():
        if value is None:
            continue
        field = by_name.get(name)
        if field is None:
            raise MetadataError(f"unknown metadata field: {name}")
        if not _valid(field, value):
            raise MetadataError(f"invalid value for {name}: expected {field.type}")
        stored[field.id] = value
    return stored


def named_metadata(fields: Sequence[MetadataField], stored: Mapping[str, Any]) -> dict[str, Any]:
    """Values of deleted fields are dropped."""
    return {field.name: stored[field.id] for field in fields if field.id in stored}
