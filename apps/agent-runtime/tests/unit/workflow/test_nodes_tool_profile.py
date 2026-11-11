import pytest
from pydantic import ValidationError

from agent_runtime.agent.model import FakeModel, ModelReply
from agent_runtime.workflow.effects import ActivityChange, ProfileProposal
from agent_runtime.workflow.nodes.base import NodeError, RunState
from tests.unit.workflow.helpers import run_node, scope_for, workflow


class Tools:
    def __init__(self, result):
        self.result, self.calls = result, []

    def execute(self, name, arguments):
        self.calls.append((name, arguments))
        return self.result


def tool_node(tool="assessment.start", arguments=None):
    return {"id": "t", "type": "tool", "config": {"tool": tool, "arguments": arguments or {}}}


def test_tool_node_calls_an_enabled_tool_with_resolved_arguments():
    node = tool_node("assessment.start", {"experience_id": "{{conv.exp}}"})
    wf = workflow([node], [], variables=[{"name": "exp", "type": "string", "default": "logical-experience"}])
    tools, state = Tools({"status": "started"}), RunState()
    _, result, _, _ = run_node(node, wf, scope=scope_for(wf), tools=tools, state=state)
    assert (result.handle, result.output) == ("success", {"status": "started"})
    assert tools.calls[0][0] == "assessment.start" and tools.calls[0][1].experience_id == "logical-experience"
    assert state.handoff.name == "assessment.start" and isinstance(result.effects[0], ActivityChange)


def test_tool_node_rejects_a_tool_that_is_not_enabled_or_has_bad_arguments():
    for node, kind in ((tool_node("handoff.request"), "tool_error"), (tool_node("assessment.start", {}), "invalid_output")):
        with pytest.raises(NodeError) as error:
            run_node(node, tools=Tools({"status": "started"}))
        assert error.value.error_type == kind


def test_a_tool_error_result_goes_to_the_error_handle():
    with pytest.raises(NodeError) as error:
        run_node(tool_node("assessment.start", {"experience_id": "x"}), tools=Tools({"error": "assessment_in_progress"}))
    assert error.value.error_type == "tool_error"


class Profile:
    def snapshot(self):
        return {}

    def accept(self, fields):
        levels = {"thpt_grade_10", "thpt_grade_11", "thpt_grade_12", "cao_dang"}
        return {key: value for key, value in fields.items() if key == "entry_level" and value in levels}


PROPOSE = {"id": "p", "type": "profile_propose", "config": {"fields": ["entry_level"], "target_step": "level"}}


def test_profile_propose_turns_a_valid_extraction_into_a_proposal_effect():
    model = FakeModel(ModelReply(text='{"entry_level": "thpt_grade_10"}'))
    wf = workflow([PROPOSE], [])
    _, result, _, _ = run_node(PROPOSE, wf, model=model, profile=Profile(), scope=scope_for(wf, query="em lớp 10"))
    assert result.handle == "proposed" and result.output["fields"] == ["entry_level"]
    assert result.effects == (ProfileProposal((("entry_level", "thpt_grade_10"),), "level"),)


@pytest.mark.parametrize("said", ["{}", '{"entry_level": "tiến sĩ"}', '{"phone": "0900"}', "không rõ"])
def test_profile_propose_with_nothing_valid_goes_to_none_and_never_writes(said):
    _, result, _, _ = run_node(PROPOSE, model=FakeModel(ModelReply(text=said)), profile=Profile())
    assert result.handle == "none" and result.effects == ()


def test_profile_propose_with_the_null_port_always_goes_to_none():
    _, result, _, _ = run_node(PROPOSE, model=FakeModel(ModelReply(text='{"entry_level": "cao_dang"}')))
    assert result.handle == "none"


def test_profile_propose_takes_at_most_two_fields():
    spec, _, _, _ = run_node(PROPOSE, model=FakeModel(ModelReply(text="{}")))
    with pytest.raises(ValidationError):
        spec.config_model.model_validate({"fields": ["a", "b", "c"]})
