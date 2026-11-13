"""knowledge.search / knowledge.show: one group, so show only shows refs this turn's searches returned (QT-13).

Every record shown to the model is kept in memory, so a card always matches the revision the model read, whatever
the knowledge base holds by the time the turn commits. Nothing here is persisted except the cards. Refs name
records the model saw; cards are built from them.
"""
import logging
import time
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Annotated, Any, Protocol
from uuid import uuid4

from pydantic import Field, StringConstraints, ValidationError, model_validator
from pydantic_core import PydanticCustomError

from agent_runtime.agent.output import link_allowed
from agent_runtime.knowledge.filters import FilterError
from agent_runtime.knowledge.schemas import (
    OPERATORS,
    FieldName,
    KnowledgeUnavailable,
    MetadataCondition,
    MetadataField,
    Record,
    RetrievalRequest,
    RetrievalResult,
    RetrievalSetting,
)
from agent_runtime.sessions.schemas.activity import KnowledgeCardBlock
from agent_runtime.sessions.schemas.common import ContractModel, OpaqueId
from agent_runtime.tools.kit import Answered, Call, Group, Ref, RefPorts, Tool, ToolError, TurnWorld

BUILTIN_DISPLAY_FIELDS = frozenset({"source_url"})
ALL_OPERATORS = frozenset().union(*OPERATORS.values())
_FILTER_VALUE = {"anyOf": [{"type": "string"}, {"type": "number"}, {"type": "array", "items": {"type": "string"}}]}


class KnowledgeSearchParams(ContractModel):
    knowledge_base_id: OpaqueId
    top_k: Annotated[int, Field(strict=True, ge=1, le=8)] = 5  # chunks, not documents
    max_chunks_per_doc: Annotated[int, Field(strict=True, ge=1, le=5)] = 2
    score_threshold: Annotated[float, Field(ge=0, le=1)] = 0.3
    semantic_weight: Annotated[float, Field(ge=0, le=1)] = 0.7
    fixed_filter: MetadataCondition | None = None  # Studio-owned; the model cannot lift it
    auto_filter_fields: Annotated[tuple[FieldName, ...], Field(max_length=10)] = ()

    @model_validator(mode="after")
    def unique_fields(self) -> "KnowledgeSearchParams":
        if len(set(self.auto_filter_fields)) != len(self.auto_filter_fields):
            raise PydanticCustomError("duplicate_items", "auto_filter_fields must be unique",
                                      {"field": "auto_filter_fields"})
        return self


class KnowledgeSearchArguments(ContractModel):
    query: Annotated[str, StringConstraints(min_length=1, max_length=300, pattern=r"\S")]
    filter: MetadataCondition | None = None


class DisplayField(ContractModel):
    field: FieldName
    label: Annotated[str, StringConstraints(min_length=1, max_length=60, pattern=r"\S")]


class KnowledgeShowParams(ContractModel):
    display: Annotated[tuple[DisplayField, ...], Field(min_length=1, max_length=8)]
    max_cards: Annotated[int, Field(strict=True, ge=1, le=3)] = 3


class KnowledgeShowArguments(ContractModel):
    refs: Annotated[tuple[Annotated[str, StringConstraints(min_length=1, max_length=8)], ...],
                    Field(min_length=1, max_length=3)]


logger = logging.getLogger(__name__)

CONTENT_CHARS = 800
VALUE_CHARS = 500
TITLE_CHARS = 300
MAX_TRACED_SEARCHES = 8
_POSITION = frozenset({"document_id", "revision", "chunk", "updated_at"})


class KnowledgePort(Protocol):
    def retrieve(self, request: RetrievalRequest, *, required: MetadataCondition | None = None
                 ) -> RetrievalResult | KnowledgeUnavailable: ...

    def fields(self, kb_ids: Sequence[str]) -> Mapping[str, tuple[MetadataField, ...]]: ...


@dataclass(frozen=True)
class _Search:
    kb_id: str
    refs: tuple[str, ...]
    degraded: bool
    latency_ms: int
    error: str | None = None


def format_value(value: Any, field_type: str | None) -> str:
    """Vietnamese display: 28000000 -> 28.000.000, 2.5 -> 2,5; lists joined; time fields keep the ISO date."""
    if isinstance(value, int | float):
        value = round(value, 2)
        if float(value).is_integer():
            return f"{int(value):,}".replace(",", ".")
        whole, fraction = f"{value:,.2f}".rstrip("0").split(".")
        return whole.replace(",", ".") + "," + fraction
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    return str(value)[:10] if field_type == "time" else str(value)


def _view(ref: str, record: Record) -> dict[str, Any]:
    metadata = record.metadata
    return {"ref": ref, "title": record.title, "content": record.content[:CONTENT_CHARS],
            "fields": {name: value for name, value in metadata.items() if name not in _POSITION},
            "updated_at": metadata["updated_at"]}


class KnowledgeTools:
    def __init__(self, port: KnowledgePort | None, search: KnowledgeSearchParams, show: KnowledgeShowParams | None,
                 fields: tuple[MetadataField, ...] = (), *, allowed_domains: tuple[str, ...] = (),
                 new_id: Callable[[], str] = lambda: uuid4().hex, clock: Callable[[], float] = time.monotonic):
        self._port, self._search, self._show = port, search, show
        self._types = {item.name: item.type for item in fields}
        self.fields = fields  # this base's metadata fields; describe/schema read them before any search
        self._domains, self._new_id, self._clock = allowed_domains, new_id, clock
        self._records: dict[str, Record] = {}
        self._cards: tuple[KnowledgeCardBlock, ...] = ()
        self._accumulated: set[str] = set()  # documents shown by calls made with accumulate=True
        self._searches: list[_Search] = []

    def search(self, arguments: KnowledgeSearchArguments) -> dict[str, Any]:
        started, params = self._clock(), self._search
        allowed = params.auto_filter_fields
        if arguments.filter and any(item.name not in allowed for item in arguments.filter.conditions):
            detail = "chỉ lọc được theo: " + ", ".join(allowed) if allowed else "không lọc được theo field nào"
            return self._failed(started, "invalid_filter", detail)
        if self._port is None:
            return self._failed(started, "knowledge_unavailable")
        request = RetrievalRequest(knowledge_id=params.knowledge_base_id, query=arguments.query,
                                   metadata_condition=arguments.filter, retrieval_setting=RetrievalSetting(
                                       top_k=params.top_k, max_chunks_per_doc=params.max_chunks_per_doc,
                                       score_threshold=params.score_threshold,
                                       semantic_weight=params.semantic_weight))
        try:
            result = self._port.retrieve(request, required=params.fixed_filter)
        except FilterError as error:
            return self._failed(started, "invalid_filter", str(error))
        except Exception as error:  # a knowledge failure must never fail the turn
            logger.warning("knowledge search failed: %s", type(error).__name__)
            return self._failed(started, "knowledge_unavailable")
        if isinstance(result, KnowledgeUnavailable):
            missing = result.reason == "not_found"
            return self._failed(started, "knowledge_base_unavailable" if missing else "knowledge_unavailable")
        refs = []
        for record in result.records:
            refs.append(f"k{len(self._records) + 1}")
            self._records[refs[-1]] = record
        self._searches.append(_Search(params.knowledge_base_id, tuple(refs), result.degraded, self._elapsed(started)))
        return {"results": [_view(ref, self._records[ref]) for ref in refs], "degraded": result.degraded}

    def show(self, arguments: KnowledgeShowArguments, *, accumulate: bool = False) -> dict[str, Any]:
        """``accumulate`` keeps earlier calls' documents in the trace (a chatflow answer shows one ref per block)."""
        if self._show is None:
            return {"error": "knowledge_unavailable"}
        if any(ref not in self._records for ref in arguments.refs):
            return {"error": "unknown_ref", "refs": list(self._records)}
        by_document: dict[str, Record] = {}
        for ref in arguments.refs:  # one card per document: the first ref naming it wins
            record = self._records[ref]
            by_document.setdefault(record.metadata["document_id"], record)
        chosen = list(by_document.values())[:self._show.max_cards]
        self._cards = tuple(card for record in chosen if (card := self._build_card(record)) is not None)
        if accumulate:
            self._accumulated.update(card.document_id for card in self._cards)
        return {"shown": len(self._cards)}

    def views(self) -> tuple[dict[str, Any], ...]:
        """Every record this turn's searches returned, as the model saw it (ref, title, fields)."""
        return tuple(_view(ref, record) for ref, record in self._records.items())

    def cards(self) -> tuple[KnowledgeCardBlock, ...]:
        return self._cards

    def trace(self) -> tuple[dict[str, Any], ...]:
        shown = {card.document_id for card in self._cards} | self._accumulated
        entries = []
        for search in self._searches[:MAX_TRACED_SEARCHES]:
            records = [self._records[ref].metadata for ref in search.refs]
            entry = {"kb_id": search.kb_id,
                     "hits": tuple((item["document_id"], item["revision"], item["chunk"]) for item in records),
                     "shown": tuple(dict.fromkeys(item["document_id"] for item in records
                                                  if item["document_id"] in shown)),
                     "degraded": search.degraded, "latency_ms": search.latency_ms}
            if search.error:
                entry["error"] = search.error
            entries.append(entry)
        return tuple(entries)

    def _failed(self, started: float, error: str, detail: str | None = None) -> dict[str, Any]:
        self._searches.append(_Search(self._search.knowledge_base_id, (), False, self._elapsed(started), error))
        return {"error": error, "detail": detail} if detail else {"error": error}

    def _elapsed(self, started: float) -> int:
        return max(0, int((self._clock() - started) * 1000))

    def _build_card(self, record: Record) -> KnowledgeCardBlock | None:
        try:
            return self._card(record)
        except ValidationError as error:  # a malformed record is skipped, it never fails the turn
            logger.warning("knowledge card skipped: %s", type(error).__name__)
            return None

    def _card(self, record: Record) -> KnowledgeCardBlock | None:
        metadata = record.metadata
        fields = []
        for item in self._show.display:
            value = metadata.get(item.field)
            text = "" if value in (None, "", []) else format_value(value, self._types.get(item.field))[:VALUE_CHARS]
            if text.strip():
                fields.append({"label": item.label, "value": text})
        if not fields:
            return None
        url = metadata.get("source_url")
        return KnowledgeCardBlock(block_id=self._new_id(), type="knowledge_card", schema_version=1,
                                  title=record.title[:TITLE_CHARS], fields=fields,
                                  source_url=url if isinstance(url, str) and link_allowed(url, self._domains) else None,
                                  document_id=metadata["document_id"], revision=metadata["revision"],
                                  updated_at=metadata["updated_at"])


def with_cards(blocks: tuple, cards: tuple[KnowledgeCardBlock, ...]) -> tuple:
    """Cards follow the agent's lead-in and precede its suggestions; a handoff block is appended after both."""
    split = next((index for index, block in enumerate(blocks) if block.type == "suggestions"), len(blocks))
    return (*blocks[:split], *cards, *blocks[split:])


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
