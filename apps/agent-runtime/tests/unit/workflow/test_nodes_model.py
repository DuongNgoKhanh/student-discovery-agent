import pytest
from pydantic import ValidationError

from agent_runtime.agent.model import FakeModel, ModelReply, ModelUnavailable, SystemMessage, UserMessage
from agent_runtime.workflow.nodes.base import NodeCancelled, NodeError
from tests.unit.workflow.helpers import agent, run_node, scope_for, workflow

LABELS = [{"id": "hoi_hoc_phi", "description": "Hỏi học phí, lệ phí", "examples": ["học phí bao nhiêu"]},
          {"id": "lam_bai", "description": "Muốn làm bài khám phá"}]
CLASSIFIER = {"id": "intent", "type": "intent_classifier", "config": {"labels": LABELS}}


def test_classifier_returns_the_chosen_label_as_the_handle():
    model = FakeModel(ModelReply(text="hoi_hoc_phi"))
    wf = workflow([CLASSIFIER], [])
    spec, result, _, _ = run_node(CLASSIFIER, wf, model=model, scope=scope_for(wf, query="học phí MTU"))
    assert (result.handle, result.output) == ("hoi_hoc_phi", {"label": "hoi_hoc_phi"})
    messages = model.calls[0][0]
    assert UserMessage("học phí MTU") in messages  # student text is a user message, never part of the instructions
    assert "học phí MTU" not in next(m.text for m in messages if isinstance(m, SystemMessage))


@pytest.mark.parametrize("said", ["hoc_bong", "", "  `lam_bai`  \n", '"other"'])
def test_classifier_maps_anything_outside_the_list_to_other(said):
    _, result, _, _ = run_node(CLASSIFIER, model=FakeModel(ModelReply(text=said)))
    assert result.handle == ("lam_bai" if "lam_bai" in said else "other")


def test_classifier_handles_include_every_label_other_and_error():
    spec, _, _, _ = run_node(CLASSIFIER, model=FakeModel(ModelReply(text="other")))
    config = spec.config_model.model_validate(CLASSIFIER["config"])
    assert spec.handles(config) == ("hoi_hoc_phi", "lam_bai", "other", "error")


def test_classifier_rejects_a_label_named_other_or_duplicated():
    spec, _, _, _ = run_node(CLASSIFIER, model=FakeModel(ModelReply(text="other")))
    for labels in ([{"id": "other", "description": "x"}, LABELS[0]], [LABELS[0], LABELS[0]]):
        with pytest.raises(ValidationError):
            spec.config_model.model_validate({"labels": labels})


def test_classifier_uses_only_the_requested_recent_history():
    history = [UserMessage(f"u{i}") for i in range(5)]
    node = {**CLASSIFIER, "config": {**CLASSIFIER["config"], "history_messages": 2}}
    model = FakeModel(ModelReply(text="other"))
    run_node(node, model=model, history=history)
    assert [m.text for m in model.calls[0][0] if isinstance(m, UserMessage)] == ["u3", "u4", "xin chào"]


def test_classifier_history_is_capped_by_the_agent_limit():
    snapshot = agent(limits={**agent().limits.model_dump(), "history_messages": 1})
    node = {**CLASSIFIER, "config": {**CLASSIFIER["config"], "history_messages": 6}}
    model = FakeModel(ModelReply(text="other"))
    run_node(node, model=model, history=[UserMessage("a"), UserMessage("b")], snapshot=snapshot)
    assert [m.text for m in model.calls[0][0] if isinstance(m, UserMessage)] == ["b", "xin chào"]


def test_classifier_model_failure_is_a_typed_node_error():
    with pytest.raises(NodeError) as error:
        run_node(CLASSIFIER, model=FakeModel(ModelUnavailable("rate_limited")))
    assert (error.value.error_type, error.value.cause) == ("model_unavailable", "rate_limited")
    with pytest.raises(NodeCancelled):
        run_node(CLASSIFIER, model=FakeModel(ModelUnavailable("cancelled")))


def test_classifier_needs_a_configured_model():
    with pytest.raises(NodeError) as error:
        run_node(CLASSIFIER, model=FakeModel(), snapshot=agent(model=None))
    assert error.value.cause == "not_configured"


def test_llm_text_output_and_error_type_is_empty_on_success():
    node = {"id": "reply", "type": "llm", "config": {"prompt": "Trả lời ngắn về {{conv.stage}}"}}
    wf = workflow([node], [], variables=[{"name": "stage", "type": "string", "default": "welcome"}])
    model = FakeModel(ModelReply(text=" Học phí là 15 triệu. "))
    _, result, _, events = run_node(node, wf, model=model, scope=scope_for(wf))
    assert (result.handle, result.output["text"]) == ("success", "Học phí là 15 triệu.")
    assert any("welcome" in m.text for m in model.calls[0][0] if isinstance(m, SystemMessage))


def test_llm_json_output_is_checked_against_the_schema():
    schema = {"type": "object", "required": ["fee"], "properties": {"fee": {"type": "number"}}}
    node = {"id": "x", "type": "llm", "config": {"prompt": "p", "output": "json", "json_schema": schema}}
    _, result, _, _ = run_node(node, model=FakeModel(ModelReply(text='```json\n{"fee": 15}\n```')))
    assert result.output["json"] == {"fee": 15}
    for bad in ('{"fee": "nhiều"}', "không phải json", "{}"):
        with pytest.raises(NodeError) as error:
            run_node(node, model=FakeModel(ModelReply(text=bad)))
        assert error.value.error_type == "invalid_output"


def test_llm_json_config_requires_a_schema():
    spec, _, _, _ = run_node({"id": "x", "type": "llm", "config": {"prompt": "p"}}, model=FakeModel(ModelReply(text="a")))
    with pytest.raises(ValidationError):
        spec.config_model.model_validate({"prompt": "p", "output": "json"})


def test_llm_drops_refs_that_no_context_node_produced():
    schema = {"type": "object", "properties": {"refs": {"type": "array", "items": {"type": "string"}}}}
    node = {"id": "x", "type": "llm", "config": {"prompt": "p", "output": "json", "json_schema": schema}}
    _, result, _, _ = run_node(node, model=FakeModel(ModelReply(text='{"refs": ["kb.k1", "kb.k9", "evil.k1"]}')))
    assert result.output["refs"] == []  # no context_refs were declared, so every ref is foreign


def test_llm_empty_text_is_an_invalid_output():
    node = {"id": "x", "type": "llm", "config": {"prompt": "p"}}
    with pytest.raises(NodeError) as error:
        run_node(node, model=FakeModel(ModelReply(text="   ")))
    assert error.value.error_type == "invalid_output"


class _Views:
    def views(self):
        return ({"ref": "k1", "title": "Học phí", "content": "15 triệu", "fields": {}, "updated_at": "2026-01-01"},)


def test_llm_keeps_only_refs_from_declared_context_nodes_and_shows_them_to_the_model():
    from agent_runtime.workflow.nodes.base import RunState
    schema = {"type": "object", "properties": {"refs": {"type": "array", "items": {"type": "string"}}}}
    node = {"id": "x", "type": "llm", "config": {"prompt": "p", "output": "json", "json_schema": schema,
                                                  "context_refs": ["kb"]}}
    model = FakeModel(ModelReply(text='{"refs": ["kb.k1", "kb.k9", "evil.k1"]}'))
    state = RunState(knowledge={"kb": _Views()})
    _, result, _, _ = run_node(node, model=model, state=state)
    assert result.output["refs"] == ["kb.k1"]
    assert any("kb.k1" in m.text and "15 triệu" in m.text for m in model.calls[0][0] if isinstance(m, SystemMessage))
