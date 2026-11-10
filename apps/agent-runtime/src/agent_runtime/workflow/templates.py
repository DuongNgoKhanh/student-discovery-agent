"""``{{namespace.name}}`` templates: values are substituted once and inserted as data, never re-expanded."""
import re
from collections.abc import Callable
from typing import Any

PLACEHOLDER = re.compile(r"\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)\s*\}\}")


def placeholders(template: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(PLACEHOLDER.findall(template)))


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list | tuple):
        return ", ".join(_text(item) for item in value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def render(template: str, lookup: Callable[[str], Any]) -> str:
    return PLACEHOLDER.sub(lambda match: _text(lookup(match.group(1))), template)
