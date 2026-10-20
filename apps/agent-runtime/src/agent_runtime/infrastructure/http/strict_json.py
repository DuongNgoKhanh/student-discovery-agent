"""Parse unambiguous UTF-8 JSON objects without retaining rejected input."""
import json
import math

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import JsonObject


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError


def _float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError
    return number


def read_strict_json(raw: bytes) -> JsonObject:
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_object,
                           parse_constant=_reject_constant, parse_float=_float)
        if not isinstance(value, dict):
            raise ValueError
        return value
    except (ValueError, UnicodeError, RecursionError):
        raise RuntimeSessionError(400, "INVALID_REQUEST") from None
