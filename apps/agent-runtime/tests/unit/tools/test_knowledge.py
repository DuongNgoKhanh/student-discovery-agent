"""Knowledge tools through the Toolbox: refs live for the turn, cards come back on the show call."""
from types import SimpleNamespace

from agent_runtime.knowledge.schemas import MetadataField, Record, RetrievalResult
from agent_runtime.tools.kit import Answered, Refused, TurnWorld
from agent_runtime.tools.toolbox import Toolbox, check
from tests.unit.workflow.helpers import agent as demo_agent


def kb_id():
    return demo_agent().tool("knowledge.search").params["knowledge_base_id"]


def show_field():
    return demo_agent().tool("knowledge.show").params["display"][0]["field"]


class Port:
    def __init__(self, records=(), fail=False):
        self.records, self.fail = records, fail

    def retrieve(self, request, *, required=None):
        if self.fail:
            raise RuntimeError("db down")
        return RetrievalResult(records=self.records, degraded=False)

    def fields(self, kb_ids):
        return {}


def record(document_id="d1"):
    return Record(title="Trường A", content="Học phí ...", score=0.9,
                  metadata={"document_id": document_id, "revision": 1, "chunk": 0,
                            "updated_at": "2026-11-01T00:00:00Z", show_field(): "28000000"})


def box(port=None, fields=None):
    view = SimpleNamespace(agent=demo_agent(), activity=None, result_card=None)
    return Toolbox(TurnWorld(view, knowledge=port, knowledge_fields=fields or {}))


def test_search_then_show_returns_cards_on_the_show_outcome():
    toolbox = box(Port([record()]))
    searched = toolbox.call("knowledge.search", {"query": "học phí"})
    assert isinstance(searched, Answered) and searched.result["results"][0]["ref"] == "k1"
    shown = toolbox.call("knowledge.show", {"refs": ["k1"]})
    assert shown.result == {"shown": 1} and shown.blocks[0].type == "knowledge_card"
    assert toolbox.trace()[0]["kb_id"] == kb_id()


def test_a_ref_from_no_search_this_turn_is_unknown():
    assert box(Port()).call("knowledge.show", {"refs": ["k1"]}) == Refused({"error": "unknown_ref", "refs": []})


def test_no_port_and_a_raising_port_both_read_as_knowledge_unavailable():
    assert box(None).call("knowledge.search", {"query": "x"}) == Refused({"error": "knowledge_unavailable"})
    assert box(Port(fail=True)).call("knowledge.search", {"query": "x"}) == Refused({"error": "knowledge_unavailable"})


def test_filterable_fields_shape_the_description_and_the_arguments_schema():
    agent = demo_agent()
    filterable = agent.tool("knowledge.search").params["auto_filter_fields"]
    fields = {kb_id(): tuple(MetadataField(id=f"f{k}", name=name, type="string") for k, name in enumerate(filterable))}
    (definition,) = box(fields=fields).offer({"knowledge.search"})
    if filterable:
        assert "Lọc được theo:" in definition.description
        assert definition.parameters["properties"]["filter"]["properties"]["conditions"]["items"]["properties"][
            "name"]["enum"] == list(filterable)
    else:
        assert "filter" not in definition.parameters["properties"]


class Ports:
    def __init__(self, fields):
        self.fields = fields

    def experience_exists(self, experience_id, algorithm_profile):
        return True

    def kb_fields(self, kb):
        return self.fields


def test_references_report_a_missing_base_and_missing_display_fields():
    names = [b.name for b in demo_agent().tools]
    assert check(demo_agent(), Ports(None))[0].code == "knowledge_base_not_found"
    issues = check(demo_agent(), Ports(frozenset()))
    show = names.index("knowledge.show")
    assert any(i.path == f"tools[{show}].params.display[0].field" and i.code == "field_not_found" for i in issues)
