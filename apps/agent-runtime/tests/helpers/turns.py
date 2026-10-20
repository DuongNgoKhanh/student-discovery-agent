"""Shared turn fixtures. Synthetic examples come from contracts; never imported by runtime code."""
import copy
import json
from functools import cache
from pathlib import Path

FIXTURE = Path(__file__).resolve().parents[4] / "contracts" / "fixtures" / "session-turns.json"


@cache
def _examples() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8-sig"))


def turn_examples() -> dict:
    return copy.deepcopy(_examples())
