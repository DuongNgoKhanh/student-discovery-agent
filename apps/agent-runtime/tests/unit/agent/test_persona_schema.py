import pytest
from pydantic import ValidationError

from agent_runtime.sessions.schemas.workflow import PersonaCase


def case(**turn):
    return {"id": "c1", "title": "x", "mandatory": True, "turns": [{"input": {"text": "hi"}, **turn}]}


def test_a_turn_needs_exactly_one_input():
    PersonaCase.model_validate(case())
    PersonaCase.model_validate({**case(), "turns": [{"input": {"interaction": {"action": "set_name"}}}]})
    for bad in ({}, {"text": "a", "interaction": {"action": "x"}}):
        with pytest.raises(ValidationError):
            PersonaCase.model_validate({**case(), "turns": [{"input": bad}]})


def test_expect_is_closed_and_typed():
    ok = PersonaCase.model_validate(case(expect={
        "path": ["start", "reply"], "blocks_present": ["knowledge_card"], "conv": {"stage": "fee"},
        "proposals": 0, "status": "completed"}))
    assert ok.turns[0].expect.path == ("start", "reply")
    for bad in ({"nope": 1}, {"blocks_present": ["html"]}, {"status": "failed"}, {"proposals": -1},
                {"path": ["Bad Id"]}):
        with pytest.raises(ValidationError):
            PersonaCase.model_validate(case(expect=bad))


def test_initial_state_is_closed():
    PersonaCase.model_validate({**case(), "initial_state": {"profile": {"entry_level": "cao_dang"},
                                                              "conv": {"stage": "fee"}}})
    with pytest.raises(ValidationError):
        PersonaCase.model_validate({**case(), "initial_state": {"extra": 1}})
