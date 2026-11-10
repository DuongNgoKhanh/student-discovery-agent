import pytest

from agent_runtime.sessions.schemas.workflow import ConvVariable
from agent_runtime.workflow.scope import Scope

VARIABLES = (
    ConvVariable(name="stage", type="enum", values=("welcome", "assessment"), default="welcome"),
    ConvVariable(name="offered", type="string_list", default=[]),
    ConvVariable(name="count", type="number", default=0),
)


def scope(**changes):
    base = dict(sys={"query": "hi", "interaction_outcome": "none"}, conv={}, profile={"entry_level": "cao_dang"},
                result=None, variables=VARIABLES)
    return Scope(**{**base, **changes})


def test_reads_every_namespace():
    s = scope(result={"house_id": "R"})
    assert (s.get("sys.query"), s.get("profile.entry_level"), s.get("result.house_id")) == ("hi", "cao_dang", "R")
    assert s.get("profile.province") is None and s.get("result.revision") is None
    assert s.get("unknown.thing") is None


def test_conv_starts_from_defaults_and_keeps_valid_stored_values():
    s = scope(conv={"stage": "assessment", "count": "oops", "removed": 1})
    assert s.conv_values() == {"stage": "assessment", "offered": [], "count": 0}  # bad type -> default; undeclared dropped


def test_assign_is_visible_to_later_reads_and_rejects_undeclared_names():
    s = scope()
    s.assign("stage", "assessment")
    assert s.get("conv.stage") == "assessment"
    with pytest.raises(KeyError):
        s.assign("nope", 1)


def test_node_outputs_are_readable_by_node_id_and_nested_fields():
    s = scope()
    assert s.get("kb.refs") is None
    s.set_output("kb", {"refs": ["k1"], "json": {"label": "x"}})
    assert s.get("kb.refs") == ["k1"] and s.get("kb.json.label") == "x"


def test_conv_defaults_do_not_alias_the_variable_declaration():
    s = scope()
    s.get("conv.offered").append("x")
    assert VARIABLES[1].default == [] and scope().get("conv.offered") == []
