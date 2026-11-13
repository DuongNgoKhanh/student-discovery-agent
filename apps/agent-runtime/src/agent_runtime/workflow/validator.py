"""Chatflow graph validator (FR-WFL-07): reads the raw workflow dict and reports every issue in one pass.

It works on the raw dict, not the parsed model, so one bad node cannot hide the rest. Each check only uses what the
earlier checks accepted; anything it cannot read is skipped here and reported by the schema layer instead.
"""
import logging
import re
from collections import defaultdict, deque
from collections.abc import Mapping
from typing import Any, NamedTuple

from pydantic import ValidationError

from agent_runtime.sessions.schemas.workflow import NODE_TYPES, RESERVED_NODE_IDS, value_fits
from agent_runtime.workflow import registry
from agent_runtime.workflow.budget import HARD_CEILING
from agent_runtime.workflow.catalog import HANDLE_SPECS, NAMESPACES
from agent_runtime.workflow.expressions import COMPARISONS, ExpressionError, Lit, Op, Var, parse, variables
from agent_runtime.workflow.templates import placeholders

logger = logging.getLogger(__name__)

MAX_NODES, MAX_EDGES, MAX_VARIABLES = 50, 100, 30
IDENT = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
VARIABLE_KINDS = {"string": "string", "enum": "string", "number": "number", "boolean": "boolean",
                  "string_list": "string_list"}
ASSIGN_SCOPE = "assign chỉ được ghi biến conv.* đã khai báo."
_NAMES = {"nodes": "node", "edges": "cạnh", "variables": "biến"}
_STATIC_KINDS = {item["name"]: {v["name"]: v["type"] for v in item["variables"]}
                 for item in NAMESPACES if item["name"] in ("sys", "result")}
TEMPLATE_FIELDS = {"llm": ("prompt",), "intent_classifier": ("input",), "profile_propose": ("input",),
                   "answer": ("text",), "knowledge_retrieval": ("query",)}


class Finding(NamedTuple):
    path: str
    code: str
    message: str


def _list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _loc(loc: tuple[Any, ...]) -> str:
    return "".join(f"[{part}]" if isinstance(part, int) else f".{part}" for part in loc)


def _literal_kind(value: Any) -> str | None:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int | float):
        return "number"
    if isinstance(value, str):
        return "string"
    return "list" if isinstance(value, tuple) else None


def knowledge_base_ids(raw: object) -> list[str]:
    """Every knowledge base a ``knowledge_retrieval`` node names, so the caller can fetch their fields once."""
    found = [_dict(node.get("config")).get("knowledge_base_id") for node in _list(_dict(raw).get("nodes"))
             if isinstance(node, dict) and node.get("type") == "knowledge_retrieval"]
    return sorted({item for item in found if isinstance(item, str)})


def validate_workflow(raw: object, agent: Mapping[str, Any], kb_fields: Mapping[str, frozenset[str]]) -> list[Finding]:
    try:
        return _Check(raw, agent, kb_fields).run()
    except Exception as error:  # the input is hostile by nature: a checker bug must read as a failure, never a 500
        logger.error("workflow validation failed to run: %s", type(error).__name__)
        return [Finding("workflow", "workflow_unverifiable", "Không kiểm tra được workflow này; kiểm tra lại cấu trúc JSON.")]


class _Check:
    def __init__(self, raw: object, agent: Mapping[str, Any], kb_fields: Mapping[str, frozenset[str]]):
        self.raw, self.agent, self.kb_fields = raw, agent, kb_fields
        self.out: dict[tuple[str, str, str], Finding] = {}
        self.nodes: list[Any] = []
        self.edges: list[Any] = []
        self.variables: list[Any] = []
        self.by_id: dict[str, int] = {}  # every well-formed id, first occurrence
        self.typed: dict[str, int] = {}  # the subset whose type is supported: the nodes the graph can use
        self.configs: dict[int, Any] = {}  # parsed config of the nodes whose config is valid
        self.vars: dict[str, dict[str, Any]] = {}
        self.good: list[tuple[int, str, str, str]] = []  # (edge index, source, handle, target) between typed nodes
        self.wired: set[tuple[str, str]] = set()
        self.start_id: str | None = None
        self._ancestors_cache: dict[str, set[str]] = {}

    def add(self, path: str, code: str, message: str) -> None:
        self.out.setdefault((path, code, message), Finding(path, code, message))

    def run(self) -> list[Finding]:
        if not isinstance(self.raw, dict):
            self.add("workflow", "type_error", "Workflow phải là một JSON object.")
            return list(self.out.values())
        self.nodes, self.edges = _list(self.raw.get("nodes")), _list(self.raw.get("edges"))
        self.variables = _list(self.raw.get("variables"))
        for item in self.variables:
            if (isinstance(item, dict) and isinstance(item.get("name"), str) and isinstance(item.get("type"), str)
                    and item["type"] in VARIABLE_KINDS):
                self.vars.setdefault(item["name"], item)
        self._sizes()
        self._duplicates()
        self._nodes()
        self._start()
        self._edges()
        reached = self._reachable()
        self._cycles()
        if reached is not None:
            self._wiring(reached)
        self._semantics()
        self._budget()
        return list(self.out.values())

    # -- structure ---------------------------------------------------------------------------------------------

    def _sizes(self) -> None:
        for name, items, limit in (("nodes", self.nodes, MAX_NODES), ("edges", self.edges, MAX_EDGES),
                                   ("variables", self.variables, MAX_VARIABLES)):
            if len(items) > limit:
                self.add(f"workflow.{name}", "workflow_too_large", f"Tối đa {limit} {_NAMES[name]}.")

    def _duplicates(self) -> None:
        for name, items, key in (("variables", self.variables, "name"), ("nodes", self.nodes, "id"),
                                 ("edges", self.edges, "id")):
            seen: set[str] = set()
            for index, item in enumerate(items):
                value = _dict(item).get(key)
                if not isinstance(value, str):
                    continue
                if value in seen:
                    self.add(f"workflow.{name}[{index}].{key}", "duplicate_items", f"'{value}' bị trùng.")
                seen.add(value)

    def _nodes(self) -> None:
        for index, node in enumerate(self.nodes):
            if not isinstance(node, dict):
                continue
            at = f"workflow.nodes[{index}]"
            node_id, kind = node.get("id"), node.get("type")
            well_formed = isinstance(node_id, str) and IDENT.match(node_id) is not None
            if well_formed:
                self.by_id.setdefault(node_id, index)
                if node_id in RESERVED_NODE_IDS:
                    self.add(f"{at}.id", "workflow_node_id_reserved",
                             "Id node không được trùng không gian tên dành riêng (sys, conv, profile, result).")
            if not isinstance(kind, str) or kind not in NODE_TYPES:
                self.add(f"{at}.type", "workflow_node_type_unsupported", "Loại node này chưa được hỗ trợ trong chatflow.")
                continue
            if well_formed and self.by_id[node_id] == index:
                self.typed[node_id] = index
            self._config(index, at, kind, node.get("config", {}))

    def _config(self, index: int, at: str, kind: str, config: Any) -> None:
        try:
            self.configs[index] = registry.get(kind).config_model.model_validate(config)
        except ValidationError as error:
            for item in error.errors():
                code, message = self._config_error(kind, item)
                self.add(f"{at}.config{_loc(item['loc'])}", code, message)

    @staticmethod
    def _config_error(kind: str, item: Any) -> tuple[str, str]:
        if kind == "assign" and item["loc"][-1:] == ("variable",) and item["type"] == "string_pattern_mismatch":
            return "workflow_assign_invalid", ASSIGN_SCOPE
        code = item["type"]
        if code == "value_error":  # a model validator may carry one of our codes as "workflow_x: reason"
            match = re.search(r"(workflow_[a-z_]+):", item["msg"])
            code = match.group(1) if match else code
        return code, "Cấu hình node không hợp lệ: " + str(item["msg"])

    def _start(self) -> None:
        starts = [(i, _dict(n).get("id")) for i, n in enumerate(self.nodes) if _dict(n).get("type") == "start"]
        if len(starts) != 1:
            self.add("workflow.nodes", "workflow_start_invalid", "Đồ thị phải có đúng một node start.")
            return
        start_id = starts[0][1]
        if isinstance(start_id, str):
            self.start_id = start_id
        if _dict(self.raw).get("entry") != start_id:
            self.add("workflow.entry", "workflow_start_invalid", "entry phải là id của node start.")

    def _handles(self, index: int) -> set[str]:
        node = self.nodes[index]
        if index in self.configs:
            return set(registry.get(node["type"]).handles(self.configs[index]))
        handles = set(HANDLE_SPECS[node["type"]]["static"])  # the config is invalid: the labels as written will do
        if node["type"] == "intent_classifier":
            handles |= {item["id"] for item in _list(_dict(node.get("config")).get("labels"))
                        if isinstance(item, dict) and isinstance(item.get("id"), str)}
        return handles

    def _edges(self) -> None:
        for index, edge in enumerate(self.edges):
            if not isinstance(edge, dict):
                continue
            at = f"workflow.edges[{index}]"
            source, handle, target = edge.get("source"), edge.get("source_handle"), edge.get("target")
            for key, node_id in (("source", source), ("target", target)):
                if isinstance(node_id, str) and node_id not in self.by_id:
                    self.add(f"{at}.{key}", "workflow_edge_invalid", f"Node '{node_id}' không tồn tại.")
            source_ok = isinstance(source, str) and source in self.typed
            target_ok = isinstance(target, str) and target in self.typed
            if target_ok and self.nodes[self.typed[target]]["type"] == "start":
                self.add(f"{at}.target", "workflow_edge_invalid", "Không được nối cạnh vào node start.")
            if source_ok and isinstance(handle, str):
                if handle not in self._handles(self.typed[source]):
                    self.add(f"{at}.source_handle", "workflow_unknown_handle",
                             f"Node '{source}' không có handle '{handle}'.")
                elif (source, handle) in self.wired:
                    self.add(f"{at}.source_handle", "workflow_duplicate_handle_edge",
                             f"Handle '{handle}' của node '{source}' chỉ được có một cạnh.")
                else:
                    self.wired.add((source, handle))
            if source_ok and target_ok:
                self.good.append((index, source, handle if isinstance(handle, str) else "", target))

    def _graph(self) -> dict[str, list[tuple[int, str]]]:
        graph: dict[str, list[tuple[int, str]]] = defaultdict(list)
        for index, source, _handle, target in self.good:
            graph[source].append((index, target))
        return graph

    def _reachable(self) -> set[str] | None:
        if self.start_id is None or self.start_id not in self.typed:
            return None
        graph = self._graph()
        seen, queue = {self.start_id}, deque([self.start_id])
        while queue:
            for _, target in graph[queue.popleft()]:
                if target not in seen:
                    seen.add(target)
                    queue.append(target)
        for node_id, index in self.typed.items():
            if node_id not in seen:
                self.add(f"workflow.nodes[{index}]", "workflow_unreachable_node",
                         f"Node '{node_id}' không đi tới được từ start.")
        return seen

    def _cycles(self) -> None:
        graph = self._graph()
        state: dict[str, int] = {}  # 1 on the current path, 2 finished
        for root in self.typed:
            if root in state:
                continue
            state[root] = 1
            stack, iterators = [root], {root: iter(graph[root])}
            while stack:
                node = stack[-1]
                step = next(iterators[node], None)
                if step is None:
                    state[node] = 2
                    stack.pop()
                    continue
                edge_index, target = step
                if state.get(target) == 1:
                    ring = [*stack[stack.index(target):], target]
                    self.add(f"workflow.edges[{edge_index}]", "workflow_cycle",
                             "Chu trình giữa các node: " + " → ".join(ring) + ".")
                elif target not in state:
                    state[target] = 1
                    stack.append(target)
                    iterators[target] = iter(graph[target])

    def _wiring(self, reached: set[str]) -> None:
        """Every handle but ``error`` needs an edge; with a DAG and an edge-less ``answer`` that ends every path."""
        for node_id in sorted(reached, key=lambda item: self.typed[item]):
            index = self.typed[node_id]
            kind = self.nodes[index]["type"]
            loose = sorted(handle for handle in self._handles(index)
                           if handle != "error" and (node_id, handle) not in self.wired)
            if kind == "intent_classifier":
                labels = _list(_dict(self.nodes[index].get("config")).get("labels"))
                for handle in loose:
                    position = next((j for j, item in enumerate(labels) if _dict(item).get("id") == handle), None)
                    at = f"workflow.nodes[{index}]" + (f".config.labels[{position}]" if position is not None else "")
                    self.add(at, "workflow_unwired_label", f"Nhãn '{handle}' của node '{node_id}' chưa được nối.")
            elif loose:
                self.add(f"workflow.nodes[{index}]", "workflow_dead_end",
                         f"Node '{node_id}' có nhánh chưa nối ({', '.join(loose)}) nên đường đi không kết thúc ở answer.")

    # -- semantics ---------------------------------------------------------------------------------------------

    @property
    def enabled(self) -> dict[str, Any]:
        return {tool["name"]: tool.get("version") for tool in _list(self.agent.get("tools"))
                if isinstance(tool, dict) and isinstance(tool.get("name"), str)}  # version is checked where it is used

    def _ancestors(self, node_id: str) -> set[str]:
        if node_id not in self._ancestors_cache:
            reverse: dict[str, list[str]] = defaultdict(list)
            for _index, source, _handle, target in self.good:
                reverse[target].append(source)
            seen: set[str] = set()
            queue = deque([node_id])
            while queue:
                for source in reverse[queue.popleft()]:
                    if source not in seen:
                        seen.add(source)
                        queue.append(source)
            self._ancestors_cache[node_id] = seen
        return self._ancestors_cache[node_id]

    def _lookup(self, path: str, node_id: str, at: str, *, report: bool = True) -> str | None:
        """The kind of a variable path as seen from ``node_id`` (None when unknown or not typed here)."""
        head, _, rest = path.partition(".")
        kind: str | None = None
        if head in _STATIC_KINDS:
            kind = _STATIC_KINDS[head].get(rest)
            known = kind is not None
        elif head == "profile":
            known = True  # the runtime has no profile catalog yet: the namespace is all that can be checked
        elif head == "conv":
            variable = self.vars.get(rest)
            known = variable is not None
            kind = VARIABLE_KINDS[variable["type"]] if variable else None
        else:
            known = head in self.typed and head in self._ancestors(node_id)
        if not known and report:
            self.add(at, "workflow_unknown_variable",
                     f"Biến '{path}' không tồn tại hoặc node chứa nó không chạy trước node này.")
        return kind

    def _semantics(self) -> None:
        for node_id, index in self.typed.items():
            node = self.nodes[index]
            kind, config = node["type"], _dict(node.get("config"))
            at = f"workflow.nodes[{index}].config"
            if kind == "if_else":
                self._expression(node_id, config.get("condition"), f"{at}.condition")
            for field in TEMPLATE_FIELDS.get(kind, ()):
                self._template(node_id, config.get(field), f"{at}.{field}")
            if kind == "knowledge_retrieval":
                self._knowledge(node_id, config, at)
            elif kind == "assign":
                self._assign(node_id, config, at)
            elif kind == "tool":
                self._tool(node_id, index, config, at)
            elif kind == "agent":
                self._agent(node_id, index, config, at)

    def _template(self, node_id: str, text: Any, at: str) -> None:
        if isinstance(text, str):
            for path in placeholders(text):
                self._lookup(path, node_id, at)

    def _walk(self, node_id: str, value: Any, at: str) -> None:
        """Templates and ``{"var": path}`` references anywhere inside a nested value."""
        if isinstance(value, str):
            self._template(node_id, value, at)
        elif isinstance(value, dict) and set(value) == {"var"} and isinstance(value["var"], str):
            self._lookup(value["var"], node_id, at)
        elif isinstance(value, dict):
            for key, item in value.items():
                self._walk(node_id, item, f"{at}.{key}")
        elif isinstance(value, list):
            for position, item in enumerate(value):
                self._walk(node_id, item, f"{at}[{position}]")

    def _expression(self, node_id: str, raw: Any, at: str) -> None:
        try:
            tree = parse(raw)
        except ExpressionError as error:
            self.add(at, error.code, f"Biểu thức không hợp lệ: {error}")
            return
        for path in variables(tree):
            self._lookup(path, node_id, at)
        self._compare(tree, node_id, at)

    def _kind_of(self, expression: Any, node_id: str, at: str) -> str | None:
        if isinstance(expression, Var):
            return self._lookup(expression.path, node_id, at, report=False)
        return _literal_kind(expression.value) if isinstance(expression, Lit) else None

    def _compare(self, expression: Any, node_id: str, at: str) -> None:
        if not isinstance(expression, Op):
            return
        for argument in expression.args:
            self._compare(argument, node_id, at)
        if len(expression.args) != 2:
            return
        left, right = expression.args
        if expression.op in COMPARISONS:
            kinds = (self._kind_of(left, node_id, at), self._kind_of(right, node_id, at))
            if expression.op not in ("==", "!="):
                if any(kind not in (None, "number") for kind in kinds):
                    self.add(at, "workflow_type_mismatch", f"Phép '{expression.op}' chỉ so sánh số.")
            elif None not in kinds and kinds[0] != kinds[1]:
                self.add(at, "workflow_type_mismatch", f"Không thể so sánh {kinds[0]} với {kinds[1]}.")
            for variable, literal in ((left, right), (right, left)):
                declared = (self.vars.get(variable.path.removeprefix("conv."))
                            if isinstance(variable, Var) and variable.path.startswith("conv.") else None)
                if (declared and declared.get("type") == "enum" and isinstance(literal, Lit)
                        and isinstance(literal.value, str) and isinstance(declared.get("values"), list)
                        and literal.value not in declared["values"]):
                    self.add(at, "workflow_type_mismatch",
                             f"'{literal.value}' không thuộc danh sách giá trị của {variable.path}.")
        elif expression.op == "in" and self._kind_of(right, node_id, at) == "string":
            self.add(at, "workflow_type_mismatch", "Vế phải của 'in' phải là danh sách hoặc biến string_list.")

    def _knowledge(self, node_id: str, config: dict[str, Any], at: str) -> None:
        base = config.get("knowledge_base_id")
        fields = self.kb_fields.get(base) if isinstance(base, str) else None
        if isinstance(base, str) and fields is None:
            self.add(f"{at}.knowledge_base_id", "knowledge_base_not_found", f"Không tìm thấy knowledge base '{base}'.")
        for field, path in _dict(config.get("filter_from_vars")).items():
            if fields is not None and field not in fields:
                self.add(f"{at}.filter_from_vars.{field}", "field_not_found", f"Knowledge base không có trường '{field}'.")
            if isinstance(path, str):
                self._lookup(path, node_id, f"{at}.filter_from_vars.{field}")
        for position, item in enumerate(_list(_dict(config.get("fixed_filter")).get("conditions"))):
            name = _dict(item).get("name")
            if fields is not None and isinstance(name, str) and name not in fields:
                self.add(f"{at}.fixed_filter.conditions[{position}].name", "field_not_found",
                         f"Knowledge base không có trường '{name}'.")

    def _assign(self, node_id: str, config: dict[str, Any], at: str) -> None:
        for position, item in enumerate(_list(config.get("assignments"))):
            if not isinstance(item, dict) or not isinstance(item.get("variable"), str):
                continue
            base, name = f"{at}.assignments[{position}]", item["variable"]
            self._walk(node_id, item.get("value"), f"{base}.value")
            declared = self.vars.get(name.removeprefix("conv.")) if name.startswith("conv.") else None
            if declared is None:
                self.add(f"{base}.variable", "workflow_assign_invalid", ASSIGN_SCOPE)
            else:
                self._assign_type(node_id, declared, item, base)

    def _assign_type(self, node_id: str, declared: dict[str, Any], item: dict[str, Any], base: str) -> None:
        kind, operation = declared["type"], item.get("operation", "set")
        if not isinstance(operation, str):
            return  # the schema layer rejects it; nothing here can be judged against it
        needed = {"append": "string_list", "add": "number"}.get(operation)
        if needed and kind != needed:
            self.add(f"{base}.operation", "workflow_assign_invalid", f"Phép '{operation}' chỉ dùng cho biến {needed}.")
            return
        if operation == "clear" or "value" not in item:
            return
        value = item["value"]
        if isinstance(value, dict) and set(value) == {"var"} and isinstance(value["var"], str):
            got = self._lookup(value["var"], node_id, f"{base}.value", report=False)
            want = {"append": "string", "add": "number"}.get(operation, VARIABLE_KINDS[kind])
            if got is not None and got != want:
                self.add(f"{base}.value", "workflow_assign_invalid", f"Giá trị kiểu {got} không khớp biến kiểu {want}.")
            return
        if isinstance(value, str) and "{{" in value:
            return  # a template renders to text; what it renders to is only known at run time
        if operation == "append":
            fits = isinstance(value, str)
        elif operation == "add":
            fits = isinstance(value, int | float) and not isinstance(value, bool)
        else:
            listed = declared.get("values")
            allowed = tuple(item for item in listed if isinstance(item, str)) if isinstance(listed, list) else None
            fits = value_fits(kind, value, allowed or None)
        if not fits:
            self.add(f"{base}.value", "workflow_assign_invalid", f"Giá trị không khớp biến kiểu {kind}.")

    def _is_handoff(self, name: str) -> bool:
        from agent_runtime.tools.registry import find  # lazy, as in workflow/trace.py

        tool = find(name, self.enabled.get(name))
        return bool(tool and tool.kind == "handoff")

    def _terminal(self, node_id: str, index: int, handle: str) -> None:
        for _edge, source, edge_handle, target in self.good:
            if source == node_id and edge_handle == handle and self.nodes[self.typed[target]]["type"] != "answer":
                self.add(f"workflow.nodes[{index}]", "workflow_handoff_not_terminal",
                         f"Handle '{handle}' của node '{node_id}' phải nối thẳng tới node answer.")

    def _tool(self, node_id: str, index: int, config: dict[str, Any], at: str) -> None:
        name = config.get("tool")
        if isinstance(name, str):
            if name not in self.enabled:
                self.add(f"{at}.tool", "workflow_tool_not_enabled", f"Công cụ '{name}' chưa được bật trong snapshot.")
            elif self._is_handoff(name):
                self._terminal(node_id, index, "success")
        self._walk(node_id, config.get("arguments"), f"{at}.arguments")

    def _agent(self, node_id: str, index: int, config: dict[str, Any], at: str) -> None:
        for position, name in enumerate(_list(config.get("tools"))):
            if isinstance(name, str) and name not in self.enabled:
                self.add(f"{at}.tools[{position}]", "workflow_tool_not_enabled",
                         f"Công cụ '{name}' chưa được bật trong snapshot.")
        limit = _dict(self.agent.get("limits")).get("max_tool_steps", 4)
        steps = config.get("max_tool_steps")
        if isinstance(steps, int) and isinstance(limit, int) and steps > limit:
            self.add(f"{at}.max_tool_steps", "workflow_budget_exceeds_ceiling",
                     f"max_tool_steps không được vượt limits.max_tool_steps ({limit}).")
        self._terminal(node_id, index, "handoff")

    def _budget(self) -> None:
        budget = _dict(self.raw.get("budget")) if isinstance(self.raw, dict) else {}
        for key, ceiling in (("max_nodes", HARD_CEILING.max_nodes), ("max_llm_calls", HARD_CEILING.max_llm_calls),
                             ("turn_timeout_ms", HARD_CEILING.turn_timeout_ms)):
            value = budget.get(key)
            if isinstance(value, int) and not isinstance(value, bool) and value > ceiling:
                self.add(f"workflow.budget.{key}", "workflow_budget_exceeds_ceiling",
                         f"{key} không được vượt trần {ceiling}.")
