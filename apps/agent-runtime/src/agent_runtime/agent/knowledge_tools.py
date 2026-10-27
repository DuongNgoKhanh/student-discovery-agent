"""knowledge.search / knowledge.show for one turn: refs name records the model saw, cards are built from them.

Every record shown to the model is kept in memory, so a card always matches the revision the model read, whatever
the knowledge base holds by the time the turn commits. Nothing here is persisted except the cards.
"""
import logging
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import uuid4

from pydantic import ValidationError

from agent_runtime.agent.catalog import (
    KnowledgeSearchArguments,
    KnowledgeSearchParams,
    KnowledgeShowArguments,
    KnowledgeShowParams,
)
from agent_runtime.agent.output import link_allowed
from agent_runtime.knowledge.filters import FilterError
from agent_runtime.knowledge.schemas import (
    KnowledgeUnavailable,
    MetadataCondition,
    MetadataField,
    Record,
    RetrievalRequest,
    RetrievalResult,
    RetrievalSetting,
)
from agent_runtime.sessions.schemas.activity import KnowledgeCardBlock

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
        self._domains, self._new_id, self._clock = allowed_domains, new_id, clock
        self._records: dict[str, Record] = {}
        self._cards: tuple[KnowledgeCardBlock, ...] = ()
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

    def show(self, arguments: KnowledgeShowArguments) -> dict[str, Any]:
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
        return {"shown": len(self._cards)}

    def cards(self) -> tuple[KnowledgeCardBlock, ...]:
        return self._cards

    def trace(self) -> tuple[dict[str, Any], ...]:
        shown = {card.document_id for card in self._cards}
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
