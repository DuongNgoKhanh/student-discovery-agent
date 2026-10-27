import pytest

from agent_runtime.knowledge.filters import FilterError, compile_filter
from agent_runtime.knowledge.schemas import MetadataCondition, MetadataField

FIELDS = (
    MetadataField(id="f1", name="province", type="string", filterable=True),
    MetadataField(id="f2", name="fee", type="number", filterable=True),
    MetadataField(id="f3", name="updated", type="time", filterable=True),
    MetadataField(id="f4", name="houses", type="string_list", filterable=True),
    MetadataField(id="f5", name="note", type="string"),
)


def condition(*items, logical="and"):
    return MetadataCondition.model_validate({"logical_operator": logical, "conditions": [
        {"name": name, "comparison_operator": operator, "value": value} for name, operator, value in items]})


def test_no_condition_matches_everything():
    assert compile_filter(None, FIELDS).sql == "TRUE"


def test_conditions_compile_to_parameterised_sql():
    compiled = compile_filter(condition(("province", "is", "Hà Nội"), ("fee", "≤", 30),
                                        ("houses", "contains", "house_s"), ("updated", "after", "2026-01-01"),
                                        logical="or"), FIELDS)
    assert compiled.sql == (
        "((r.metadata->>:mf0k) = :mf0v OR "
        "(jsonb_typeof(r.metadata->:mf1k) = 'number' AND (r.metadata->>:mf1k)::numeric <= :mf1v) OR "
        "COALESCE(jsonb_exists(r.metadata->:mf2k, :mf2v), false) OR "
        "(r.metadata->>:mf3k)::timestamptz > CAST(:mf3v AS timestamptz))")
    assert compiled.params == {"mf0k": "f1", "mf0v": "Hà Nội", "mf1k": "f2", "mf1v": 30, "mf2k": "f4",
                               "mf2v": "house_s", "mf3k": "f3", "mf3v": "2026-01-01"}


def test_empty_operators_take_no_value():
    compiled = compile_filter(condition(("houses", "not empty", None), ("province", "empty", None)), FIELDS)
    assert compiled.sql == ("(COALESCE(jsonb_array_length(r.metadata->:mf0k), 0) > 0 AND "
                            "COALESCE(r.metadata->>:mf1k, '') = '')")
    assert compiled.params == {"mf0k": "f4", "mf1k": "f1"}


@pytest.mark.parametrize("item", [
    ("missing", "is", "x"),          # unknown field
    ("note", "is", "x"),             # not filterable
    ("province", ">", "x"),          # operator of another type
    ("fee", "=", "30"),              # string for a number
    ("houses", "contains", ["a"]),   # list for a list element
    ("updated", "before", "soon"),   # not an ISO time
    ("province", "is", None),        # missing value
])
def test_invalid_conditions_raise(item):
    with pytest.raises(FilterError):
        compile_filter(condition(item), FIELDS)
