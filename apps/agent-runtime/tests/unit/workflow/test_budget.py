import pytest

from agent_runtime.agent.model import FakeModel, ModelReply, ModelSettings, ModelUsage
from agent_runtime.sessions.schemas.workflow import WorkflowBudget
from agent_runtime.workflow.budget import HARD_CEILING, Budget, BudgetedModel, BudgetExceeded

SETTINGS = ModelSettings("m", 0.0, 64, 1000, 0)


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def budget(clock=None, **requested):
    return Budget(WorkflowBudget(**requested), clock=clock or Clock())


def test_requested_values_are_clamped_to_the_hard_ceiling():
    b = budget(max_nodes=99, max_llm_calls=99, turn_timeout_ms=99_000)
    assert (b.max_nodes, b.max_llm_calls) == (HARD_CEILING.max_nodes, HARD_CEILING.max_llm_calls) == (40, 8)
    assert b.deadline == pytest.approx(100.0 + 30.0)


def test_node_limit_raises_on_the_node_after_the_last_allowed():
    b = budget(max_nodes=2)
    b.start_node()
    b.start_node()
    with pytest.raises(BudgetExceeded) as error:
        b.start_node()
    assert error.value.kind == "nodes"


def test_deadline_is_checked_before_a_node_and_before_a_model_call():
    clock = Clock()
    b = Budget(WorkflowBudget(turn_timeout_ms=1000), clock=clock)
    clock.now += 2
    with pytest.raises(BudgetExceeded) as error:
        b.start_node()
    assert error.value.kind == "deadline"


def test_an_outer_deadline_can_be_earlier_than_the_workflow_timeout():
    clock = Clock()
    b = Budget(WorkflowBudget(turn_timeout_ms=25000), clock=clock, deadline=clock.now + 1)
    clock.now += 2
    with pytest.raises(BudgetExceeded):
        b.start_llm_call()


def test_budgeted_model_counts_calls_and_tokens_and_stops_at_the_limit():
    b = budget(max_llm_calls=2)
    model = BudgetedModel(FakeModel(ModelReply("a", usage=ModelUsage(3, 4)), ModelReply("b", usage=ModelUsage(1, 1))), b)
    model.invoke([], [], SETTINGS)
    model.invoke([], [], SETTINGS)
    assert (b.llm_calls, b.usage) == (2, ModelUsage(4, 5))
    with pytest.raises(BudgetExceeded) as error:
        model.invoke([], [], SETTINGS)
    assert error.value.kind == "llm_calls"


def test_delta_reports_what_one_node_used():
    b = budget()
    before = b.counters()
    BudgetedModel(FakeModel(ModelReply("a", usage=ModelUsage(2, 5))), b).invoke([], [], SETTINGS)
    assert b.delta(before) == (1, 2, 5)
