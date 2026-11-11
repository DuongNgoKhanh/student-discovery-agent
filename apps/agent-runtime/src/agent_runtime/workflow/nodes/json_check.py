"""The small JSON Schema subset an ``llm`` node may ask for: type, required, properties, items, enum.

``check_schema`` is total: a value or schema it cannot judge is simply not valid, it never raises.
"""
from typing import Any

_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool}


def _same(left: Any, right: Any) -> bool:
    return isinstance(left, bool) == isinstance(right, bool) and left == right  # True is not 1


def _check(schema: Any, value: Any) -> bool:
    if not isinstance(schema, dict):
        return False
    kind = schema.get("type")
    if kind is None:
        ok = True
    elif not isinstance(kind, str):
        return False
    elif kind == "number":
        ok = isinstance(value, int | float) and not isinstance(value, bool)
    elif kind == "integer":
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif kind in _TYPES:
        ok = isinstance(value, _TYPES[kind])
    else:
        ok = True
    if not ok:
        return False
    if "enum" in schema:
        options = schema["enum"]
        if not isinstance(options, list) or not any(_same(value, option) for option in options):
            return False
    if kind == "object":
        required = schema.get("required", ())
        properties = schema.get("properties", {})
        if not isinstance(required, list | tuple) or not isinstance(properties, dict):
            return False
        if any(not isinstance(key, str) or key not in value for key in required):
            return False
        return all(_check(sub, value[key]) for key, sub in properties.items() if key in value)
    if kind == "array" and "items" in schema:
        return all(_check(schema["items"], item) for item in value)
    return True


def check_schema(schema: Any, value: Any) -> bool:
    try:
        return _check(schema, value)
    except (TypeError, ValueError, KeyError, AttributeError, RecursionError):
        return False
