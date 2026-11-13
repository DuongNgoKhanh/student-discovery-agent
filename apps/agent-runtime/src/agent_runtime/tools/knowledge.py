"""knowledge.search / knowledge.show: one group, so show only shows refs this turn's searches returned (QT-13)."""
from collections.abc import Iterator
from typing import Any

from agent_runtime.agent.catalog import (
    KnowledgeSearchArguments,
    KnowledgeSearchParams,
    KnowledgeShowArguments,
    KnowledgeShowParams,
)
from agent_runtime.agent.knowledge_tools import KnowledgeTools
from agent_runtime.knowledge.schemas import OPERATORS, MetadataField
from agent_runtime.tools.kit import Answered, Call, Group, Ref, RefPorts, Tool, ToolError, TurnWorld

BUILTIN_DISPLAY_FIELDS = frozenset({"source_url"})
ALL_OPERATORS = frozenset().union(*OPERATORS.values())
_FILTER_VALUE = {"anyOf": [{"type": "string"}, {"type": "number"}, {"type": "array", "items": {"type": "string"}}]}


def _open(world: TurnWorld) -> KnowledgeTools | None:
    agent = world.view.agent
    search = agent.tool("knowledge.search")
    if search is None:
        return None
    params = KnowledgeSearchParams.model_validate(search.params)
    show = agent.tool("knowledge.show")
    return KnowledgeTools(world.knowledge, params, KnowledgeShowParams.model_validate(show.params) if show else None,
                          world.knowledge_fields.get(params.knowledge_base_id, ()),
                          allowed_domains=agent.links.allowed_domains)


KNOWLEDGE = Group("knowledge", _open, unavailable="knowledge_unavailable")


def _filter_fields(params: KnowledgeSearchParams, state: KnowledgeTools | None
                   ) -> list[tuple[str, MetadataField | None]]:
    known = {item.name: item for item in (state.fields if state else ())}
    return [(name, known.get(name)) for name in params.auto_filter_fields]


def _search_detail(params: KnowledgeSearchParams, state: KnowledgeTools | None) -> str:
    fields = _filter_fields(params, state)
    if not fields:
        return ""
    return "Lọc được theo: " + "; ".join(
        f"{name} ({item.type}: {', '.join(sorted(OPERATORS[item.type]))})" if item else name
        for name, item in fields) + "."


def _search_schema(params: KnowledgeSearchParams, state: KnowledgeTools | None) -> dict:
    properties: dict[str, Any] = {"query": {"type": "string", "description": "Câu cần tìm, tiếng Việt có dấu."}}
    fields = _filter_fields(params, state)
    if fields:
        operators = sorted(set().union(*(OPERATORS[item.type] if item else ALL_OPERATORS for _, item in fields)))
        properties["filter"] = {"type": "object", "properties": {
            "logical_operator": {"type": "string", "enum": ["and", "or"]},
            "conditions": {"type": "array", "items": {"type": "object", "properties": {
                "name": {"type": "string", "enum": [name for name, _ in fields]},
                "comparison_operator": {"type": "string", "enum": operators},
                "value": _FILTER_VALUE}, "required": ["name", "comparison_operator"]}}},
            "required": ["conditions"]}
    return {"type": "object", "properties": properties, "required": ["query"]}


def _search(call: Call) -> dict[str, Any]:
    if call.state is None:
        raise ToolError("knowledge_unavailable")
    return call.state.search(call.arguments)


def _show(call: Call) -> dict[str, Any] | Answered:
    if call.state is None:
        raise ToolError("knowledge_unavailable")
    result = call.state.show(call.arguments)
    return result if "error" in result else Answered(result, blocks=call.state.cards())


def _search_refs(params: KnowledgeSearchParams, ports: RefPorts, agent: Any) -> Iterator[Ref]:
    known = ports.kb_fields(params.knowledge_base_id)
    if known is None:
        yield Ref("knowledge_base_id", "knowledge_base_not_found",
                  f"Không tìm thấy knowledge base '{params.knowledge_base_id}'.")
        return
    for k, name in enumerate(params.auto_filter_fields):
        if name not in known:
            yield Ref(f"auto_filter_fields[{k}]", "field_not_found", f"Knowledge base không có trường '{name}'.")


def _show_refs(params: KnowledgeShowParams, ports: RefPorts, agent: Any) -> Iterator[Ref]:
    search = agent.tool("knowledge.search")
    if search is None:
        return  # the snapshot schema already rejects show without search
    known = ports.kb_fields(KnowledgeSearchParams.model_validate(search.params).knowledge_base_id)
    if known is None:
        return  # reported once, on knowledge.search
    for k, item in enumerate(params.display):
        if item.field not in known and item.field not in BUILTIN_DISPLAY_FIELDS:
            yield Ref(f"display[{k}].field", "field_not_found", f"Knowledge base không có trường '{item.field}'.")


TOOLS = (
    Tool("knowledge.search", 1, "query", label="Tìm trong Knowledge Base",
         summary="Tra cứu thông tin tuyển sinh trong KB đã chọn.",
         description="Tìm thông tin tuyển sinh (trường, ngành, học phí, điều kiện) trong kho dữ liệu. Mỗi kết quả "
                     "có ref (k1, k2…) để dùng với knowledge.show trong cùng lượt.",
         params=KnowledgeSearchParams, arguments=KnowledgeSearchArguments, run=_search, detail=_search_detail,
         schema=_search_schema, refs=_search_refs, group=KNOWLEDGE, editor="knowledge.search"),
    Tool("knowledge.show", 1, "query", label="Hiện thẻ thông tin",
         summary="Dựng thẻ từ kết quả tìm kiếm (cần bật Tìm trong KB).",
         description="Hiển thị thẻ thông tin cho các ref vừa tìm được trong lượt này; hệ thống tự dựng thẻ từ dữ "
                     "liệu gốc.",
         params=KnowledgeShowParams, arguments=KnowledgeShowArguments, run=_show, refs=_show_refs,
         group=KNOWLEDGE, editor="knowledge.show"),
)
