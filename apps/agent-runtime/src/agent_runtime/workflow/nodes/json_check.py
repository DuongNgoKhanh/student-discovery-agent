"""The small JSON Schema subset an ``llm`` node may ask for: type, required, properties, items, enum."""
from typing import Any

_TYPES = {"object": dict, "array": list, "string": str, "boolean": bool}


def check_schema(schema: dict[str, Any], value: Any) -> bool:
    kind = schema.get("type")
    if kind == "number":
        ok = isinstance(value, int | float) and not isinstance(value, bool)
    elif kind == "integer":
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif kind in _TYPES:
        ok = isinstance(value, _TYPES[kind])
    else:
        ok = True
    if not ok or ("enum" in schema and value not in schema["enum"]):
        return False
    if kind == "object":
        if any(key not in value for key in schema.get("required", ())):
            return False
        return all(check_schema(sub, value[key]) for key, sub in schema.get("properties", {}).items() if key in value)
    if kind == "array" and "items" in schema:
        return all(check_schema(schema["items"], item) for item in value)
    return True
