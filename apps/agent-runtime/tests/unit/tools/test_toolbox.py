"""Toolbox: only the release's bindings are reachable, arguments are checked first, a tool never fails the turn."""
from types import SimpleNamespace

import pytest

from agent_runtime.sessions.schemas.common import ContractModel
from agent_runtime.tools.kit import (
    Answered,
    Group,
    HandedOff,
    Ref,
    Refused,
    Replied,
    Settle,
    Tool,
    ToolError,
    TurnWorld,
)
from agent_runtime.tools.toolbox import Toolbox, check


class EchoArguments(ContractModel):
    text: str


class LimitParams(ContractModel):
    limit: int = 3


def _echo(call):
    if call.arguments.text == "no":
        raise ToolError("refused", why="said no")
    if call.arguments.text == "boom":
        raise RuntimeError("secret detail")
    return {"echo": call.arguments.text, "limit": call.params.limit}


def _settle(s: Settle):
    return ("settled", s.handoff.name)


def _grouped(call):
    raise RuntimeError("grouped failure")


def _refs(params, ports, agent):
    if params.limit > 5:
        yield Ref("limit", "too_big", "Quá lớn.")


DECLARED = {
    ("t.echo", 1): Tool("t.echo", 1, "query", label="Echo", summary="Lặp lại.", description="Echo the text.",
                        params=LimitParams, arguments=EchoArguments, run=_echo, refs=_refs),
    ("t.stop", 1): Tool("t.stop", 1, "handoff", label="Stop", summary="Dừng.", description="Stop the turn.",
                        arguments=EchoArguments, run=lambda call: {"stopped": True}, settle=_settle),
    ("t.chips", 1): Tool("t.chips", 1, "reply", label="Chips", summary="Gợi ý.", description="Show chips.",
                         arguments=EchoArguments),
    ("t.grouped", 1): Tool("t.grouped", 1, "query", label="G", summary="G.", description="Grouped.",
                           run=_grouped, group=Group("grouped", lambda world: True, unavailable="grouped_unavailable")),
}


def binding(name, params=None, description=None):
    return SimpleNamespace(name=name, version=1, params=params or {}, description=description)


def box(*bindings):
    agent = SimpleNamespace(tools=bindings or tuple(binding(name) for name, _ in DECLARED))
    return Toolbox(TurnWorld(SimpleNamespace(agent=agent, activity=None, result_card=None)), declared=DECLARED)


def test_offer_lists_bindings_with_the_override_description_and_arguments_schema():
    (definition,) = box(binding("t.echo", description="Override.")).offer()
    assert definition.name == "t.echo" and definition.description == "Override."
    assert definition.parameters["properties"]["text"]["type"] == "string"


def test_offer_can_narrow_to_a_node_s_tools():
    assert [d.name for d in box().offer({"t.stop"})] == ["t.stop"]


def test_a_tool_without_a_binding_is_unknown():
    assert box(binding("t.echo")).call("t.stop", {"text": "x"}) == Refused({"error": "unknown_tool"})


def test_a_tool_outside_the_offered_set_is_unknown():
    assert box().call("t.echo", {"text": "x"}, offered={"t.stop"}) == Refused({"error": "unknown_tool"})


def test_invalid_arguments_are_reported_before_the_tool_runs():
    outcome = box().call("t.echo", {"text": 3})
    assert isinstance(outcome, Refused) and outcome.invalid_arguments
    assert outcome.error["error"].startswith("invalid_arguments: text:")
    assert box().call("t.echo", None) == Refused({"error": "invalid_arguments: not a JSON object"},
                                                  invalid_arguments=True)


def test_a_query_answers_with_its_result_and_parsed_params():
    assert box(binding("t.echo", {"limit": 2})).call("t.echo", {"text": "hi"}) == Answered({"echo": "hi", "limit": 2})


def test_tool_error_becomes_an_error_result_for_the_model():
    assert box().call("t.echo", {"text": "no"}) == Refused({"error": "refused", "why": "said no"})


def test_an_unexpected_exception_never_fails_the_turn(caplog):
    assert box().call("t.echo", {"text": "boom"}) == Refused({"error": "tool_unavailable"})
    assert "RuntimeError" in caplog.text and "secret detail" not in caplog.text


def test_a_group_names_its_own_unavailable_code():
    assert box().call("t.grouped", {}) == Refused({"error": "grouped_unavailable"})


def test_a_handoff_ends_the_turn_for_every_later_call():
    toolbox = box()
    outcome = toolbox.call("t.stop", {"text": "x"})
    assert isinstance(outcome, HandedOff) and outcome.handoff.name == "t.stop"
    assert outcome.handoff.result == {"stopped": True}
    assert toolbox.call("t.echo", {"text": "x"}) == Refused({"error": "turn_ended"})


def test_a_reply_tool_is_never_run_and_not_callable_from_a_node():
    assert box().call("t.chips", {"text": "a"}) == Replied(EchoArguments(text="a"))
    assert box().call("t.chips", {"text": "a"}, via="node") == Refused({"error": "not_callable_here"})


def test_announce_fires_after_validation_for_everything_but_handoffs():
    seen = []
    toolbox = box()
    toolbox.call("t.echo", {"text": 3}, announce=seen.append)
    toolbox.call("t.echo", {"text": "hi"}, announce=seen.append)
    toolbox.call("t.chips", {"text": "a"}, announce=seen.append)
    toolbox.call("t.stop", {"text": "x"}, announce=seen.append)
    assert seen == ["t.echo", "t.chips"]


def test_trace_collects_from_opened_group_states():
    class Traced:
        def trace(self):
            return ({"kb": "k1"},)
    declared = {("t.q", 1): Tool("t.q", 1, "query", label="Q", summary="Q.", description="Q.",
                                 run=lambda call: {}, group=Group("g", lambda world: Traced()))}
    agent = SimpleNamespace(tools=(binding("t.q"),))
    toolbox = Toolbox(TurnWorld(SimpleNamespace(agent=agent, activity=None, result_card=None)), declared=declared)
    assert toolbox.trace() == ()  # nothing opened yet
    toolbox.call("t.q", {})
    assert toolbox.trace() == ({"kb": "k1"},)


def test_check_prefixes_reference_issues_with_the_binding_path():
    agent = SimpleNamespace(tools=(binding("t.stop"), binding("t.echo", {"limit": 9})))
    assert check(agent, ports=None, declared=DECLARED) == (Ref("tools[1].params.limit", "too_big", "Quá lớn."),)


def test_a_tool_declaration_must_match_its_kind():
    with pytest.raises(ValueError):
        Tool("t.bad", 1, "reply", label="B", summary="B.", description="B.", run=lambda call: {})
    with pytest.raises(ValueError):
        Tool("t.bad", 1, "handoff", label="B", summary="B.", description="B.", run=lambda call: {})
