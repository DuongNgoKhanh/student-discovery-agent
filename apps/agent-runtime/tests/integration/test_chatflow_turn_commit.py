import pytest

from agent_runtime.agent.model import ModelReply, ModelUnavailable
from agent_runtime.sessions.schemas.release import AgentTemplates
from tests.helpers.chat import build_chat
from tests.helpers.chatflow import FLOW, chatflow_content

pytestmark = pytest.mark.integration


@pytest.fixture
def flow(test_database, valid_v2_doc, validator):
    rigs = []

    def make(workflow=FLOW):
        rigs.append(build_chat(test_database, valid_v2_doc, validator, agent_content=chatflow_content(workflow)))
        return rigs[-1]

    yield make
    for rig in rigs:
        rig.dispose()


def test_conv_vars_are_committed_with_the_turn_and_survive_the_next_one(flow):
    rig = flow()
    rig.model._outcomes += [ModelReply(text="hoi_hoc_phi"), ModelReply(text="other")]
    first = rig.send("học phí", revision=0, key="m1").data
    assert first["output"]["blocks"][0]["content"] == "Giai đoạn explore" and rig.conv_vars() == {"stage": "explore"}
    rig.send("còn gì nữa", revision=1, key="m2")
    assert rig.conv_vars() == {"stage": "explore"} and rig.revision() == 2


def test_replay_returns_the_stored_response_without_running_the_graph_again(flow):
    rig = flow()
    rig.model._outcomes.append(ModelReply(text="other"))
    first = rig.send("xin chào", revision=0, key="same")
    again = rig.send("xin chào", revision=0, key="same")
    assert again.replayed and again.data == first.data and len(rig.model.calls) == 1


def test_a_budget_overrun_commits_the_template_and_none_of_the_graphs_effects(flow):
    workflow = {**FLOW, "budget": {"max_nodes": 2, "max_llm_calls": 6, "turn_timeout_ms": 25000}}
    rig = flow(workflow)
    data = rig.send("xin chào", revision=0, key="m1").data
    assert data["status"] == "completed" and rig.model.calls == []
    assert data["output"]["blocks"][0]["content"] == AgentTemplates().busy_message
    # The assign ran before the overrun but none of it was committed: conv is still the declared default.
    assert rig.conv_vars() == {"stage": "welcome"}


def test_a_node_failure_without_an_error_edge_uses_the_template_and_keeps_conv_unchanged(flow):
    rig = flow()
    rig.model._outcomes.append(ModelUnavailable("provider_error"))
    data = rig.send("xin chào", revision=0, key="m1").data
    assert data["status"] == "completed" and rig.conv_vars() == {"stage": "welcome"}
    assert data["output"]["blocks"][0]["type"] == "text"


def test_a_cancelled_turn_writes_nothing(flow):
    rig = flow()
    before = rig.message_count()
    rig.model._outcomes.append(lambda messages: (_ for _ in ()).throw(AssertionError("must not be called")))
    original = rig.service._should_stop
    rig.service._should_stop = lambda caller, response_id: (lambda: True)
    try:
        rig.send("xin chào", revision=0, key="m1")
    finally:
        rig.service._should_stop = original
    assert rig.conv_vars() == {} and rig.message_count() == before and rig.revision() == 0


def test_a_turn_cancelled_after_an_assign_ran_leaves_conv_vars_untouched(flow):
    rig = flow()
    polls = []

    def stop_after_the_assign():
        polls.append(1)
        return len(polls) > 2  # let start and the assign run, then cancel before the classifier

    rig.model._outcomes.append(lambda messages: (_ for _ in ()).throw(AssertionError("must not be called")))
    rig.service._should_stop = lambda caller, response_id: stop_after_the_assign
    rig.send("xin chào", revision=0, key="m1")
    assert len(polls) > 2 and rig.model.calls == []
    assert rig.conv_vars() == {} and rig.revision() == 0
