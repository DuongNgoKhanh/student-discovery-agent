"""Adapter between a turn (message or handled interaction) and the workflow engine: scope, ports and plan."""
from dataclasses import replace
from typing import Any

from agent_runtime.agent.catalog import KnowledgeShowParams
from agent_runtime.sessions.schemas.turn import MessageTurnInput
from agent_runtime.sessions.schemas.turn_execution import TurnDraft
from agent_runtime.sessions.schemas.workflow import Workflow
from agent_runtime.sessions.services.message_turns import (
    EXPLAIN_REQUEST_TEXT,
    MessagePlan,
    MessageSnapshot,
    SnapshotToolExecutor,
    agent_context,
    chat_history,
    explain_fallback,
    interaction_summary,
    plan_handoff,
)
from agent_runtime.workflow.budget import Budget
from agent_runtime.workflow.executor import WorkflowRun, run_workflow
from agent_runtime.workflow.implicit import implicit_workflow
from agent_runtime.workflow.ports import NullProfilePort, Ports, ProfilePort
from agent_runtime.workflow.scope import Scope

_OUTCOMES = {"set_name": "name_set", "submit_answer": "answer_recorded", "confirm_answer": "answer_confirmed",
             "edit_answer": "answer_edited"}


def interaction_outcome(request, draft) -> str:
    """``sys.interaction_outcome`` of a handled interaction: what the fixed handler just did."""
    if draft.completion is not None:
        return "assessment_completed"
    return _OUTCOMES.get(request.action, "none")


def _result_of(snapshot: MessageSnapshot) -> dict | None:
    card = snapshot.result_card
    if card is None or snapshot.current_result is None:
        return None
    return {"house_id": card["house"]["house_id"], "career_groups": card["career_groups"],
            "revision": snapshot.current_result[1]}


def _execute(snapshot: MessageSnapshot, *, query: str, interaction: str | None, outcome: str, explain: bool,
             result: dict | None, user_text: str, model, executor, tool_context, knowledge_port,
             profile: ProfilePort | None, emit, should_stop, deadline, clock,
             knowledge_fields: dict | None) -> tuple[WorkflowRun, Budget, Workflow]:
    """``mode = agent`` runs the implicit start -> agent -> answer graph, keeping the agent's own fallbacks.

    Returns the run, the Budget it used (its counters feed the trace) and the workflow that ran.
    """
    agent = snapshot.agent
    implicit = agent.mode == "agent"
    workflow = implicit_workflow(agent) if implicit else agent.workflow
    profile = profile or NullProfilePort()
    activity = snapshot.activity
    sys_values: dict[str, Any] = {
        "query": query, "interaction": interaction, "interaction_outcome": outcome,
        "turn_index": sum(1 for view in snapshot.history if view.role == "user"),
        "client_blocks": [block.type for block in snapshot.parent.capability_snapshot.supported_blocks],
        "activity_status": activity.state.status if activity else None}
    scope = Scope(sys=sys_values, conv=snapshot.parent.conv_vars, profile=profile.snapshot(), result=result,
                  variables=workflow.variables)
    show = agent.tool("knowledge.show")
    ports = Ports(agent=agent, model=model, tools=executor, tool_context=tool_context, knowledge=knowledge_port,
                  knowledge_fields={**tool_context.knowledge_fields, **(knowledge_fields or {})},
                  show_params=KnowledgeShowParams.model_validate(show.params) if show else None, profile=profile,
                  agent_context=agent_context(snapshot, explain=explain), history=chat_history(snapshot.history),
                  user_text=user_text)
    budget = Budget(workflow.budget, clock=clock, deadline=deadline)
    run = run_workflow(workflow, scope, ports, budget=budget, on_event=emit, should_stop=should_stop,
                       implicit=implicit)
    return run, budget, workflow


def run_message_turn(snapshot: MessageSnapshot, request: MessageTurnInput, *, model, executor, tool_context,
                     knowledge_port, knowledge_fields: dict | None = None, profile: ProfilePort | None = None,
                     emit=None, should_stop=None, deadline=None,
                     clock) -> tuple[WorkflowRun, Budget, Workflow]:
    explain = request.explain is not None
    return _execute(snapshot, query="" if explain else request.content.text,
                    interaction="explain_result" if explain else None,
                    outcome="explain_requested" if explain else "none", explain=explain, result=_result_of(snapshot),
                    user_text=EXPLAIN_REQUEST_TEXT if explain else request.content.text, model=model,
                    executor=executor, tool_context=tool_context, knowledge_port=knowledge_port, profile=profile,
                    emit=emit, should_stop=should_stop, deadline=deadline, clock=clock,
                    knowledge_fields=knowledge_fields)


def run_interaction_turn(chat: MessageSnapshot, request, draft: TurnDraft, *, model, tool_context, knowledge_port,
                         knowledge, profile: ProfilePort | None = None, emit=None, should_stop=None, deadline=None,
                         clock, knowledge_fields: dict | None = None) -> tuple[WorkflowRun, Budget, Workflow]:
    """The graph sees the state after the fixed handler ran; the handler's own blocks are never its business."""
    post = replace(chat, activity=chat.activity.model_copy(update={"state": draft.next_state}))
    result = _result_of(chat)
    if draft.completion is not None:
        result = {"house_id": draft.completion.card.house.house_id,
                  "career_groups": list(draft.completion.card.career_groups),
                  "revision": draft.completion.result_revision}
    # sys.query stays empty (the student typed nothing); the model's user turn is the code-owned summary.
    summary = interaction_summary(request.action, display_name=draft.next_state.display_name,
                                  option_id=getattr(getattr(request, "payload", None), "option_id", None))
    return _execute(post, query="", interaction=request.action, outcome=interaction_outcome(request, draft),
                    explain=False, result=result, user_text=summary, model=model,
                    executor=SnapshotToolExecutor(post, knowledge), tool_context=tool_context,
                    knowledge_port=knowledge_port, profile=profile, emit=emit, should_stop=should_stop,
                    deadline=deadline, clock=clock, knowledge_fields=knowledge_fields)


def plan_from_run(snapshot: MessageSnapshot, run: WorkflowRun, request: MessageTurnInput, *, handler,
                  persistence) -> MessagePlan:
    """What commit writes for a finished (completed or fallback) run; a cancelled run is never committed."""
    if request.explain is not None and run.fallback is not None:
        plan = MessagePlan((explain_fallback(snapshot.result_card, snapshot.activity.state.display_name),))
    else:
        plan = plan_handoff(snapshot, run.handoff, run.blocks, request, handler=handler, persistence=persistence)
    # mode = agent has no conversation variables: its plan never writes them.
    return replace(plan, conv_vars=None if snapshot.agent.mode == "agent" else run.conv)
