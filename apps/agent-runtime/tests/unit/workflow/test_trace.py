import json

import pytest

from agent_runtime.agent.model import FakeModel, ModelReply
from agent_runtime.knowledge.schemas import Record, RetrievalResult
from agent_runtime.workflow.budget import Budget
from agent_runtime.workflow.executor import NodeRecord, WorkflowRun, run_workflow
from agent_runtime.workflow.trace import Redaction, build_trace
from tests.unit.workflow.helpers import ids, ports_for, scope_for, workflow

SENTINEL = "XQ-7731 em tên Lan 0900123456"
FLOW = workflow(
    [{"id": "start", "type": "start"},
     {"id": "known", "type": "if_else", "config": {"condition": {"and": [
         {"==": [{"var": "profile.entry_level"}, "cao_dang"]}, {"==": [{"var": "conv.stage"}, "welcome"]}]}}},
     {"id": "ask", "type": "intent_classifier", "config": {"labels": [
         {"id": "hoi_hoc_phi", "description": "hỏi học phí"}, {"id": "lam_bai", "description": "làm bài"}]}},
     {"id": "say", "type": "llm", "config": {"prompt": "Trả lời {{sys.query}}"}},
     {"id": "mark", "type": "assign", "config": {"assignments": [{"variable": "conv.note", "value": "{{say.text}}"}]}},
     {"id": "reply", "type": "answer", "config": {"text": "Bạn nói: {{sys.query}}"}}],
    [("start", "next", "known"), ("known", "true", "ask"), ("known", "false", "ask"), ("ask", "hoi_hoc_phi", "say"),
     ("ask", "other", "say"), ("say", "success", "mark"), ("mark", "next", "reply")],
    variables=[{"name": "stage", "type": "enum", "values": ["welcome", "explore"], "default": "welcome"},
               {"name": "note", "type": "string", "default": ""}])


def traced(mode, flow=FLOW, *replies, query=SENTINEL, **ports):
    model = FakeModel(*(replies or (ModelReply(text="hoi_hoc_phi"), ModelReply(text=f"Mình nhớ: {SENTINEL}"))))
    scope = scope_for(flow, query=query, profile={"entry_level": "cao_dang", "phone": "0900123456"})
    budget = Budget(flow.budget)  # the trace reports the very budget the run used
    run = run_workflow(flow, scope, ports_for(model=model, **ports), budget=budget, new_id=ids())
    redaction = Redaction(mode, {variable.name: variable for variable in flow.variables})
    trace = build_trace(run, redaction=redaction, agent_release_id="agent-1", content_hash="sha256:" + "0" * 64,
                        mode="chatflow", budget=budget)
    return run, json.dumps(trace.model_dump(mode="json"), ensure_ascii=False)


def test_production_trace_never_contains_what_the_student_typed_or_profile_values():
    run, text = traced("production")
    assert run.status == "completed"
    for secret in (SENTINEL, "XQ-7731", "Lan", "0900123456", "Mình nhớ"):
        assert secret not in text
    assert '"node_id": "known"' in text and '"handle": "hoi_hoc_phi"' in text


def test_production_trace_drops_node_inputs_and_keeps_only_the_size_of_text_outputs():
    _, text = traced("production")
    data = json.loads(text)
    assert all(item["input"] is None for item in data["node_runs"])
    say = next(item for item in data["node_runs"] if item["node_id"] == "say")
    assert say["output"] == {"text": {"chars": len(f"Mình nhớ: {SENTINEL}")}, "error_type": ""}
    ask = next(item for item in data["node_runs"] if item["node_id"] == "ask")
    assert ask["output"] == {"label": "hoi_hoc_phi", "error_type": ""} and ask["reason"] == {"label": "hoi_hoc_phi"}


def test_production_trace_keeps_the_branch_reason_without_profile_values():
    _, text = traced("production")
    data = json.loads(text)
    known = next(item for item in data["node_runs"] if item["node_id"] == "known")
    parts = known["reason"]["parts"]
    assert parts[0] == {"operator": "==", "operands": [{"path": "profile.entry_level", "present": True},
                                                       {"path": None, "value": "cao_dang"}], "matched": True}
    assert parts[1]["operands"][0] == {"path": "conv.stage", "value": "welcome"}


def test_production_trace_records_only_presence_for_a_string_variable_or_the_query():
    flow = workflow(
        [{"id": "start", "type": "start"},
         {"id": "check", "type": "if_else", "config": {"condition": {"or": [
             {"==": [{"var": "conv.note"}, "x"]}, {"==": [{"var": "sys.query"}, "y"]}]}}},
         {"id": "reply", "type": "answer", "config": {"text": "ok"}}],
        [("start", "next", "check"), ("check", "true", "reply"), ("check", "false", "reply")],
        variables=[{"name": "note", "type": "string", "default": SENTINEL}])
    _, text = traced("production", flow)
    assert SENTINEL not in text
    parts = json.loads(text)["node_runs"][1]["reason"]["parts"]
    assert [part["operands"][0] for part in parts] == [{"path": "conv.note", "present": True},
                                                       {"path": "sys.query", "present": True}]


class KbPort:
    def fields(self, kb_ids):
        return {kb_id: () for kb_id in kb_ids}

    def retrieve(self, request, *, required=None):
        record = Record(content=f"Nội dung {SENTINEL}", score=0.9, title="Trường A", metadata={
            "document_id": "a", "revision": 1, "chunk": 0, "updated_at": "2026-10-27T03:00:00Z"})
        return RetrievalResult(records=(record,))


def test_production_trace_of_a_knowledge_search_keeps_refs_but_not_the_query_or_chunks():
    flow = workflow(
        [{"id": "start", "type": "start"},
         {"id": "kb", "type": "knowledge_retrieval", "config": {"knowledge_base_id": "kb1", "query": "{{sys.query}}"}},
         {"id": "reply", "type": "answer", "config": {"text": "ok"}}],
        [("start", "next", "kb"), ("kb", "found", "reply"), ("kb", "empty", "reply"), ("kb", "error", "reply")])
    run, text = traced("production", flow, knowledge=KbPort(), knowledge_fields={"kb1": ()})
    assert run.records[1].handle == "found" and run.records[1].input  # the raw record does carry the query
    assert SENTINEL not in text and "XQ-7731" not in text
    kb = json.loads(text)["node_runs"][1]
    assert kb["input"] is None and kb["output"]["refs"] == ["k1"] and kb["output"]["chunks"] == {"items": 1}


def test_production_trace_of_a_profile_proposal_keeps_field_names_but_not_values():
    flow = workflow(
        [{"id": "start", "type": "start"},
         {"id": "pp", "type": "profile_propose", "config": {"fields": ["display_name"]}},
         {"id": "reply", "type": "answer", "config": {"text": "ok"}}],
        [("start", "next", "pp"), ("pp", "proposed", "reply"), ("pp", "none", "reply")])
    profile = type("Profile", (), {"snapshot": lambda self: {}, "accept": lambda self, found: found})()
    run, text = traced("production", flow, ModelReply(text='{"display_name": "Lan XQ-7731"}'), profile=profile)
    assert run.records[1].handle == "proposed"
    assert "Lan" not in text and "XQ-7731" not in text
    pp = json.loads(text)["node_runs"][1]
    assert pp["input"] is None and pp["output"]["fields"] == ["display_name"]
    assert pp["reason"] == {"fields": ["display_name"]}


def test_production_redaction_shrinks_every_unknown_output_value():
    record = NodeRecord("t", "tool", 1, "success", 3, {"tool": "x", "extra": SENTINEL}, SENTINEL,
                        {"note": SENTINEL, "items": [SENTINEL], "nested": {"a": SENTINEL}, "count": 2,
                         "error_type": "", "handoff": "start_assessment"}, 0, (0, 0), (), None)
    run = WorkflowRun("completed", (record,), (), (), {})
    trace = build_trace(run, redaction=Redaction("production", {}), agent_release_id=None, content_hash=None,
                        mode="chatflow", budget=Budget(FLOW.budget))
    data = trace.model_dump(mode="json")
    assert SENTINEL not in json.dumps(data, ensure_ascii=False)
    item = data["node_runs"][0]
    assert item["input"] is None and item["reason"] == {"tool": "x"}
    assert item["output"] == {"note": {"chars": len(SENTINEL)}, "items": {"items": 1}, "nested": {"keys": 1},
                              "count": {"kind": "int"}, "error_type": "", "handoff": "start_assessment"}


def test_full_trace_keeps_values_for_the_admins_debug_run():
    _, text = traced("full")
    assert SENTINEL in text and "cao_dang" in text


def test_trace_records_order_handles_tokens_and_the_last_node():
    run, text = traced("production")
    data = json.loads(text)
    assert [item["node_id"] for item in data["node_runs"]] == list(run.path)
    assert [item["order"] for item in data["node_runs"]] == list(range(1, len(run.path) + 1))
    assert data["last_node"] == "reply" and data["fallback_reason"] is None and data["budget"]["llm_calls"] == 2
    assert data["budget"]["nodes"] == len(run.path)


def test_redaction_mode_is_checked():
    with pytest.raises(ValueError):
        Redaction("debug", {})
