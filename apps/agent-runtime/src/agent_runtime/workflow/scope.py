"""One turn's readable state: sys, conv (with an in-turn overlay), profile, result and finished node outputs."""
from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any

from agent_runtime.sessions.schemas.workflow import ConvVariable, value_fits

_STATIC = ("sys", "profile", "result")


def _dig(value: Any, dotted: str) -> Any:
    for key in dotted.split("."):
        if not isinstance(value, Mapping):
            return None
        value = value.get(key)
    return value


class Scope:
    def __init__(self, *, sys: Mapping[str, Any], conv: Mapping[str, Any], profile: Mapping[str, Any],
                 result: Mapping[str, Any] | None, variables: Sequence[ConvVariable]):
        self._static = {"sys": dict(sys), "profile": dict(profile), "result": dict(result or {})}
        self._declared = {variable.name: variable for variable in variables}
        self._conv = {}
        for name, variable in self._declared.items():
            stored = conv.get(name, variable.default)
            fits = value_fits(variable.type, stored, variable.values)
            self._conv[name] = deepcopy(stored if fits else variable.default)
        self._outputs: dict[str, Any] = {}

    def get(self, path: str) -> Any:
        head, _, rest = path.partition(".")
        if head == "conv":
            return self._conv.get(rest)
        if head in _STATIC:
            return self._static[head].get(rest)
        return _dig(self._outputs.get(head), rest) if rest else None

    def variable(self, name: str) -> ConvVariable | None:
        return self._declared.get(name)

    def assign(self, name: str, value: Any) -> None:
        if name not in self._declared:
            raise KeyError(name)
        self._conv[name] = value

    def conv_values(self) -> dict[str, Any]:
        return deepcopy(self._conv)

    def set_output(self, node_id: str, output: Mapping[str, Any]) -> None:
        self._outputs[node_id] = dict(output)

    def has_run(self, node_id: str) -> bool:
        return node_id in self._outputs
