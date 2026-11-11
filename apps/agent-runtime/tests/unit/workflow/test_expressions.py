import json
from pathlib import Path

import pytest

from agent_runtime.workflow.expressions import (
    MAX_DEPTH,
    MAX_NODES,
    ExpressionError,
    Part,
    depth,
    evaluate,
    parse,
    variables,
)

VECTORS = json.loads(
    (Path(__file__).resolve().parents[5] / "contracts/fixtures/workflow-expressions.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", VECTORS["valid"], ids=lambda case: case["name"])
def test_valid_vectors(case):
    values = case["vars"]
    assert evaluate(parse(case["expression"]), lambda path: values.get(path)).matched is case["expect"]


@pytest.mark.parametrize("case", VECTORS["invalid"], ids=lambda case: case["name"])
def test_invalid_vectors(case):
    with pytest.raises(ExpressionError) as error:
        parse(case["expression"])
    assert error.value.code == case["code"]


def nested_not(levels):
    expression = {"var": "conv.done"}
    for _ in range(levels):
        expression = {"!": [expression]}
    return expression


def test_depth_limit_counts_every_level():
    assert depth(parse(nested_not(MAX_DEPTH - 1))) == MAX_DEPTH
    with pytest.raises(ExpressionError) as error:
        parse(nested_not(MAX_DEPTH))
    assert error.value.code == "workflow_invalid_expression"


def test_builder_limit_of_three_groups_fits_inside_depth_five():
    comparison = {"==": [{"var": "conv.stage"}, "a"]}
    grouped = {"and": [{"or": [{"and": [comparison]}]}]}
    assert depth(parse(grouped)) == 5


def test_node_limit():
    def comparisons(count):
        return {"and": [{"==": [{"var": "conv.a"}, 1]} for _ in range(count)]}

    assert parse(comparisons(21))  # 1 + 21 * 3 = 64 nodes
    with pytest.raises(ExpressionError):
        parse(comparisons(22))
    assert MAX_NODES == 64


def test_parts_record_operands_for_the_trace():
    expression = parse({"and": [{"==": [{"var": "conv.stage"}, "a"]},
                                {"in": [{"var": "profile.x"}, ["p", "q"]]}]})
    values = {"conv.stage": "a"}
    result = evaluate(expression, lambda path: values.get(path))
    assert result.matched is False
    assert result.parts == (
        Part("==", (("conv.stage", "a"), (None, "a")), True),
        Part("in", (("profile.x", None), (None, ("p", "q"))), False))


def test_evaluation_is_deterministic():
    expression = parse({"or": [{"==": [{"var": "conv.stage"}, "a"]}, {"missing": ["profile.x"]}]})
    lookup = {"conv.stage": "b"}.get
    assert {evaluate(expression, lookup) for _ in range(5)} == {evaluate(expression, lookup)}


def test_variables_lists_each_path_once_in_order():
    expression = parse({"and": [{"==": [{"var": "conv.stage"}, "a"]}, {"!=": [{"var": "conv.stage"}, "b"]},
                                {"missing": ["profile.x", "result.house_id"]}]})
    assert variables(expression) == ("conv.stage", "profile.x", "result.house_id")


def test_path_pattern_is_equally_strict_when_reused_as_a_pydantic_constraint():
    from typing import Annotated

    from pydantic import StringConstraints, TypeAdapter, ValidationError

    from agent_runtime.workflow.expressions import PATH

    adapter = TypeAdapter(Annotated[str, StringConstraints(pattern=PATH.pattern)])
    assert adapter.validate_python("conv.stage") == "conv.stage"
    with pytest.raises(ValidationError):
        adapter.validate_python("conv.stage\n")


def test_a_missing_part_records_presence_and_not_the_value():
    result = evaluate(parse({"missing": ["profile.phone", "profile.x"]}), {"profile.phone": "0900123456"}.get)
    assert result.parts == (Part("missing", (("profile.phone", True), ("profile.x", False)), True),)
