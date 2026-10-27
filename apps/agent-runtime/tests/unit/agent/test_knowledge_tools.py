"""One turn's knowledge calls: refs name what the model saw, cards are built from exactly those records."""
import itertools

import pytest

from agent_runtime.agent.catalog import (
    KnowledgeSearchArguments,
    KnowledgeSearchParams,
    KnowledgeShowArguments,
    KnowledgeShowParams,
)
from agent_runtime.agent.knowledge_tools import KnowledgeTools, format_value
from agent_runtime.knowledge.filters import FilterError
from agent_runtime.knowledge.schemas import KnowledgeUnavailable, MetadataField, Record, RetrievalResult

SEARCH = KnowledgeSearchParams.model_validate({
    "knowledge_base_id": "kb1", "auto_filter_fields": ["houses"],
    "fixed_filter": {"conditions": [{"name": "kind", "comparison_operator": "is", "value": "school_program"}]}})
SHOW = KnowledgeShowParams.model_validate({"display": [{"field": "tuition", "label": "Học phí"},
                                                       {"field": "houses", "label": "Hệ"}]})
FIELDS = (MetadataField(id="f1", name="tuition", type="number"),
          MetadataField(id="f2", name="houses", type="string_list", filterable=True))


def record(document_id, chunk=0, revision=1, **fields):
    return Record(content="x" * 1000, score=0.9, title=f"Trường {document_id}", metadata={
        **fields, "document_id": document_id, "revision": revision, "chunk": chunk,
        "updated_at": "2026-10-27T03:00:00Z"})


A1 = record("a", tuition=28000000, houses=["house_i", "house_r"], source_url="https://ihrd.vn/a")
A2 = record("a", chunk=1, tuition=28000000)
B = record("b", tuition=15500000.5, source_url="https://evil.example/b")
C = record("c", note="chỉ có ghi chú")


class Port:
    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def retrieve(self, request, *, required=None):
        self.calls.append((request, required))
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def make(port, show=SHOW):
    counter = itertools.count(1)
    return KnowledgeTools(port, SEARCH, show, FIELDS, allowed_domains=("ihrd.vn",),
                          new_id=lambda: f"card{next(counter)}", clock=lambda: 0.0)


def ask(tools, query="học phí", **extra):
    return tools.search(KnowledgeSearchArguments.model_validate({"query": query, **extra}))


def test_refs_run_across_searches_and_position_metadata_stays_hidden():
    port = Port(RetrievalResult(records=(A1, B)), RetrievalResult(records=(C,), degraded=True))
    tools = make(port)
    first, second = ask(tools), ask(tools, "ghi chú")
    assert [item["ref"] for item in first["results"]] == ["k1", "k2"] and second["results"][0]["ref"] == "k3"
    assert first["degraded"] is False and second["degraded"] is True
    view = first["results"][0]
    assert len(view["content"]) == 800 and view["updated_at"] == "2026-10-27T03:00:00Z"
    assert view["fields"] == {"tuition": 28000000, "houses": ["house_i", "house_r"], "source_url": "https://ihrd.vn/a"}
    request, required = port.calls[0]
    assert (request.knowledge_id, request.query) == ("kb1", "học phí")
    assert (request.retrieval_setting.top_k, request.retrieval_setting.max_chunks_per_doc) == (5, 2)
    assert required == SEARCH.fixed_filter


def test_filter_outside_auto_filter_fields_never_reaches_the_knowledge_base():
    port = Port()
    result = ask(make(port), filter={"conditions": [{"name": "province", "comparison_operator": "is", "value": "HN"}]})
    assert result == {"error": "invalid_filter", "detail": "chỉ lọc được theo: houses"} and port.calls == []


@pytest.mark.parametrize(("outcome", "error"), [
    (KnowledgeUnavailable("not_found"), {"error": "knowledge_base_unavailable"}),
    (KnowledgeUnavailable("timeout"), {"error": "knowledge_unavailable"}),
    (KnowledgeUnavailable("invalid_binding"), {"error": "knowledge_unavailable"}),
    (FilterError("houses needs a string value"), {"error": "invalid_filter", "detail": "houses needs a string value"}),
    (RuntimeError("db exploded"), {"error": "knowledge_unavailable"}),
])
def test_knowledge_failures_become_tool_errors(outcome, error):
    assert ask(make(Port(outcome))) == error


def test_no_knowledge_port_is_reported_as_unavailable():
    assert ask(make(None)) == {"error": "knowledge_unavailable"}


def test_show_accepts_only_refs_from_this_turn():
    tools = make(Port(RetrievalResult(records=(A1,))))
    assert tools.show(KnowledgeShowArguments(refs=("k1",))) == {"error": "unknown_ref", "refs": []}
    ask(tools)
    assert tools.show(KnowledgeShowArguments(refs=("k1", "k9"))) == {"error": "unknown_ref", "refs": ["k1"]}
    assert tools.cards() == ()


def test_show_merges_a_document_into_one_card_and_the_last_call_wins():
    tools = make(Port(RetrievalResult(records=(A1, A2, B))))
    ask(tools)
    assert tools.show(KnowledgeShowArguments(refs=("k1", "k2", "k3"))) == {"shown": 2}
    assert [card.document_id for card in tools.cards()] == ["a", "b"]
    assert tools.show(KnowledgeShowArguments(refs=("k3",))) == {"shown": 1}
    assert [card.document_id for card in tools.cards()] == ["b"]


def test_show_is_cut_to_max_cards():
    tools = make(Port(RetrievalResult(records=(A1, B))), show=SHOW.model_copy(update={"max_cards": 1}))
    ask(tools)
    assert tools.show(KnowledgeShowArguments(refs=("k2", "k1"))) == {"shown": 1}
    assert tools.cards()[0].document_id == "b"


def test_cards_format_values_and_keep_only_allowed_links():
    tools = make(Port(RetrievalResult(records=(A1, B, C))))
    ask(tools)
    assert tools.show(KnowledgeShowArguments(refs=("k1", "k2", "k3"))) == {"shown": 2}  # C has nothing to display
    a, b = tools.cards()
    assert (a.block_id, a.title, a.revision, a.source_url) == ("card1", "Trường a", 1, "https://ihrd.vn/a")
    assert [(item.label, item.value) for item in a.fields] == [("Học phí", "28.000.000"), ("Hệ", "house_i, house_r")]
    assert b.source_url is None and b.fields[0].value == "15.500.000,5"


def test_trace_names_hits_and_shown_documents_but_never_the_question():
    tools = make(Port(RetrievalResult(records=(A1, B)), KnowledgeUnavailable("timeout")))
    ask(tools, "học phí bí mật")
    ask(tools, "lần hai")
    tools.show(KnowledgeShowArguments(refs=("k2",)))
    first, second = tools.trace()
    assert first == {"kb_id": "kb1", "hits": (("a", 1, 0), ("b", 1, 0)), "shown": ("b",), "degraded": False,
                     "latency_ms": 0}
    assert second == {"kb_id": "kb1", "hits": (), "shown": (), "degraded": False, "latency_ms": 0,
                      "error": "knowledge_unavailable"}
    assert "bí mật" not in str(tools.trace())


@pytest.mark.parametrize(("value", "kind", "text"), [
    (28000000, "number", "28.000.000"), (2.5, "number", "2,5"), (1234.567, "number", "1.234,57"),
    (3.0, "number", "3"), (["a", "b"], "string_list", "a, b"), ("2026-03-01T00:00:00Z", "time", "2026-03-01"),
    ("Hà Nội", "string", "Hà Nội"), ("Hà Nội", None, "Hà Nội"),
])
def test_format_value_uses_vietnamese_conventions(value, kind, text):
    assert format_value(value, kind) == text
