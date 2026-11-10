"""Safe JSONLogic subset (DEC-23): parse once, evaluate without eval(), never raise while evaluating.

A comparison with a null operand is false, including ``!=``; test for absence with ``missing``. ``missing`` is true
when at least one of the named variables is null. ``in`` takes a list literal or a string_list variable on the right.
"""
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

MAX_DEPTH = 8
MAX_NODES = 64
PATH = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
COMPARISONS = frozenset({"==", "!=", "<", "<=", ">", ">="})
LOGICAL = frozenset({"and", "or"})
OPERATORS = COMPARISONS | LOGICAL | {"!", "in", "missing", "var"}
INVALID = "workflow_invalid_expression"
MISMATCH = "workflow_type_mismatch"


class ExpressionError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Var:
    path: str


@dataclass(frozen=True)
class Lit:
    value: Any  # str | int | float | bool | None | tuple of str/number


@dataclass(frozen=True)
class Op:
    op: str
    args: tuple["Expr", ...]


Expr = Var | Lit | Op


@dataclass(frozen=True)
class Part:
    """One evaluated comparison, kept for the trace: operands are (variable path or None, value).

    A ``missing`` part holds (path, whether a value was present) instead: it never needs the value itself.
    """
    operator: str
    operands: tuple[tuple[str | None, Any], ...]
    matched: bool


@dataclass(frozen=True)
class Evaluation:
    matched: bool
    parts: tuple[Part, ...]


def _number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def parse(raw: Any) -> Expr:
    if not isinstance(raw, dict):
        raise ExpressionError(INVALID, "an expression is an object with one operator")
    counter = [0]
    expression = _parse(raw, counter)
    if depth(expression) > MAX_DEPTH:
        raise ExpressionError(INVALID, f"expression is deeper than {MAX_DEPTH} levels")
    return expression


def _count(counter: list[int], amount: int = 1) -> None:
    counter[0] += amount
    if counter[0] > MAX_NODES:
        raise ExpressionError(INVALID, f"expression has more than {MAX_NODES} nodes")


def _path(value: Any) -> str:
    if not isinstance(value, str) or not PATH.fullmatch(value):
        raise ExpressionError(INVALID, "a variable needs a namespace.name path")
    return value


def _parse(raw: Any, counter: list[int]) -> Expr:
    _count(counter)
    if isinstance(raw, dict):
        if len(raw) != 1:
            raise ExpressionError(INVALID, "an operator object has exactly one key")
        ((name, args),) = raw.items()
        if name not in OPERATORS:
            raise ExpressionError(INVALID, f"operator {name!r} is not allowed")
        if name == "var":
            return Var(_path(args[0] if isinstance(args, list) and len(args) == 1 else args))
        items = args if isinstance(args, list) else [args]
        if name == "missing":
            if not items:
                raise ExpressionError(INVALID, "missing needs at least one variable")
            _count(counter, len(items))
            return Op("missing", tuple(Var(_path(item)) for item in items))
        parsed = tuple(_parse(item, counter) for item in items)
        _check_arity(name, parsed)
        return Op(name, parsed)
    if isinstance(raw, list):
        if not all(isinstance(item, str) or _number(item) for item in raw):
            raise ExpressionError(INVALID, "list literals hold strings or numbers")
        _count(counter, len(raw))
        return Lit(tuple(raw))
    if raw is None or isinstance(raw, str | int | float | bool):
        return Lit(raw)
    raise ExpressionError(INVALID, "unsupported literal")


def _check_arity(name: str, args: tuple[Expr, ...]) -> None:
    if (name in COMPARISONS or name == "in") and len(args) != 2:
        raise ExpressionError(INVALID, f"{name} takes exactly two operands")
    if name == "!" and len(args) != 1:
        raise ExpressionError(INVALID, "! takes exactly one operand")
    if name in LOGICAL and not args:
        raise ExpressionError(INVALID, f"{name} needs at least one operand")
    for index, arg in enumerate(args):
        if isinstance(arg, Lit) and isinstance(arg.value, tuple) and not (name == "in" and index == 1):
            raise ExpressionError(INVALID, "a list literal is only allowed as the right side of in")
    if name == "in" and isinstance(args[1], Lit) and isinstance(args[1].value, str):
        raise ExpressionError(MISMATCH, "in needs a list or a string_list variable on the right, not a string")


def depth(expression: Expr) -> int:
    if isinstance(expression, Op):
        return 1 + max((depth(arg) for arg in expression.args), default=0)
    return 1


def variables(expression: Expr) -> tuple[str, ...]:
    found: dict[str, None] = {}

    def walk(node: Expr) -> None:
        if isinstance(node, Var):
            found.setdefault(node.path)
        elif isinstance(node, Op):
            for arg in node.args:
                walk(arg)

    walk(expression)
    return tuple(found)


def evaluate(expression: Expr, lookup: Callable[[str], Any]) -> Evaluation:
    parts: list[Part] = []
    value = _value(expression, lookup, parts)
    return Evaluation(bool(value), tuple(parts))


def _operand_path(arg: Expr) -> str | None:
    return arg.path if isinstance(arg, Var) else None


def _value(expression: Expr, lookup: Callable[[str], Any], parts: list[Part]) -> Any:
    if isinstance(expression, Lit):
        return expression.value
    if isinstance(expression, Var):
        return lookup(expression.path)
    op, args = expression.op, expression.args
    if op in LOGICAL:
        for arg in args:
            hit = bool(_value(arg, lookup, parts))
            if op == "and" and not hit:
                return False
            if op == "or" and hit:
                return True
        return op == "and"
    if op == "!":
        return not bool(_value(args[0], lookup, parts))
    if op == "missing":
        matched = any(lookup(arg.path) is None for arg in args)
        parts.append(Part("missing", tuple((arg.path, lookup(arg.path) is not None) for arg in args), matched))
        return matched
    left, right = (_value(arg, lookup, parts) for arg in args)
    matched = _compare(op, left, right)
    parts.append(Part(op, ((_operand_path(args[0]), left), (_operand_path(args[1]), right)), matched))
    return matched


def _same(left: Any, right: Any) -> bool:
    if _number(left) and _number(right):
        return left == right
    return type(left) is type(right) and left == right


def _compare(op: str, left: Any, right: Any) -> bool:
    if left is None or right is None:
        return False
    if op == "in":
        return isinstance(right, tuple | list) and any(_same(left, item) for item in right)
    if op == "==":
        return _same(left, right)
    if op == "!=":
        return not _same(left, right)
    if not (_number(left) and _number(right)):
        return False
    return {"<": left < right, "<=": left <= right, ">": left > right, ">=": left >= right}[op]
