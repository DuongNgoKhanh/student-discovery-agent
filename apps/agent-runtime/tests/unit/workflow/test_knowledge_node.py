import pytest

from agent_runtime.agent.catalog import KnowledgeShowParams
from agent_runtime.knowledge.schemas import KnowledgeUnavailable, MetadataField, Record, RetrievalResult
from agent_runtime.workflow.effects import KbRefsUsed
from agent_runtime.workflow.nodes.base import NodeError, RunState
from tests.unit.workflow.helpers import run_node, scope_for, workflow

FIELDS = {"kb1": (MetadataField(id="f1", name="entry_levels", type="string_list", filterable=True),
                  MetadataField(id="f2", name="tuition", type="number", filterable=True))}
SHOW = KnowledgeShowParams.model_validate({"display": [{"field": "tuition", "label": "Học phí"}]})


def record(document_id, **fields):
    return Record(content="x", score=0.9, title=f"Trường {document_id}", metadata={
        **fields, "document_id": document_id, "revision": 1, "chunk": 0, "updated_at": "2026-10-27T03:00:00Z"})


class Port:
    def __init__(self, outcome):
        self.outcome, self.calls = outcome, []

    def retrieve(self, request, *, required=None):
        self.calls.append((request, required))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


NODE = {"id": "kb", "type": "knowledge_retrieval", "config": {
    "knowledge_base_id": "kb1", "query": "học phí {{conv.topic}}", "top_k": 3,
    "fixed_filter": {"conditions": [{"name": "kind", "comparison_operator": "is", "value": "program"}]},
    "filter_from_vars": {"entry_levels": "profile.entry_level"}}}
WF = workflow([NODE], [], variables=[{"name": "topic", "type": "string", "default": "MTU"}])


def run(port, *, profile=None, state=None):
    return run_node(NODE, WF, scope=scope_for(WF, profile=profile or {}), state=state or RunState(),
                    knowledge=port, knowledge_fields=FIELDS, show_params=SHOW)


def test_found_returns_refs_chunks_and_a_kb_effect():
    port = Port(RetrievalResult(records=(record("a", tuition=15000000), record("b", tuition=9000000))))
    state = RunState()
    _, result, _, _ = run(port, profile={"entry_level": "cao_dang"}, state=state)
    assert (result.handle, result.output["refs"]) == ("found", ["k1", "k2"])
    assert result.effects == (KbRefsUsed("kb1", ("k1", "k2")),) and "kb" in state.knowledge
    request, required = port.calls[0]
    assert request.query == "học phí MTU" and request.retrieval_setting.top_k == 3
    assert [(c.name, c.comparison_operator, c.value) for c in request.metadata_condition.conditions] == [
        ("entry_levels", "contains", "cao_dang")]
    assert required.conditions[0].name == "kind"  # the fixed filter is applied on top, never replaced


def test_null_variable_drops_its_filter_but_keeps_the_fixed_one():
    port = Port(RetrievalResult(records=(record("a"),)))
    run(port, profile={})
    request, required = port.calls[0]
    assert request.metadata_condition is None and required is not None


def test_no_records_goes_to_empty_and_unavailable_goes_to_error():
    assert run(Port(RetrievalResult(records=())))[1].handle == "empty"
    for outcome in (KnowledgeUnavailable("timeout"), RuntimeError("boom")):
        with pytest.raises(NodeError) as error:
            run(Port(outcome))
        assert error.value.error_type == "kb_unavailable"


def test_a_filter_variable_for_an_unknown_field_is_an_invalid_output():
    node = {**NODE, "config": {**NODE["config"], "filter_from_vars": {"nope": "profile.entry_level"}}}
    with pytest.raises(NodeError) as error:
        run_node(node, WF, scope=scope_for(WF, profile={"entry_level": "x"}), knowledge=Port(RetrievalResult(records=())),
                 knowledge_fields=FIELDS)
    assert error.value.error_type == "invalid_output"


def test_answer_builds_a_card_only_from_a_ref_this_turn_produced():
    answer = {"id": "reply", "type": "answer", "config": {"blocks": [
        {"type": "knowledge_card", "ref": "kb.k1"}, {"type": "knowledge_card", "ref": "kb.k9"},
        {"type": "knowledge_card", "ref": "ghost.k1"}]}}
    state = RunState()
    run(Port(RetrievalResult(records=(record("a", tuition=15000000),))), state=state)
    _, result, _, _ = run_node(answer, state=state, show_params=SHOW)
    assert [(b.type, b.title) for b in result.blocks] == [("knowledge_card", "Trường a")]
    assert result.blocks[0].fields[0].value == "15.000.000"


def test_a_workflow_run_builds_the_card_traces_the_search_and_routes_a_failed_search_to_error():
    from agent_runtime.workflow.budget import Budget
    from agent_runtime.workflow.executor import run_workflow
    from tests.unit.workflow.helpers import ids, ports_for

    wf = workflow(
        [{"id": "start", "type": "start"}, {**NODE, "id": "kb"},
         {"id": "reply", "type": "answer", "config": {"text": "ok", "blocks": [{"type": "knowledge_card", "ref": "kb.k1"}]}},
         {"id": "sorry", "type": "answer", "config": {"text": "lỗi"}}],
        [("start", "next", "kb"), ("kb", "found", "reply"), ("kb", "empty", "reply"), ("kb", "error", "sorry")],
        variables=[{"name": "topic", "type": "string", "default": "MTU"}])

    def go(port):
        ports = ports_for(knowledge=port, knowledge_fields=FIELDS, show_params=SHOW)
        return run_workflow(wf, scope_for(wf), ports, budget=Budget(wf.budget), new_id=ids())

    found = go(Port(RetrievalResult(records=(record("a", tuition=15000000),))))
    assert found.path == ("start", "kb", "reply")
    assert [block.type for block in found.blocks] == ["markdown", "knowledge_card"]
    assert [(item["kb_id"], item["hits"], item["shown"]) for item in found.knowledge] == [
        ("kb1", (("a", 1, 0),), ("a",))]
    failed = go(Port(KnowledgeUnavailable("timeout")))
    assert failed.path == ("start", "kb", "sorry") and failed.status == "completed"
    assert failed.knowledge[0]["error"] == "knowledge_unavailable"
