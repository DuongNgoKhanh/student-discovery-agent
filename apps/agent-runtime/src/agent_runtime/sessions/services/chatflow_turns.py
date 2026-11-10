"""Adapter between a message turn and the workflow engine: builds scope and ports, shapes the plan to commit."""
from dataclasses import replace
from typing import Any

from agent_runtime.agent.catalog import KnowledgeShowParams
from agent_runtime.sessions.schemas.turn import MessageTurnInput
from agent_runtime.sessions.schemas.workflow import Workflow
from agent_runtime.sessions.services.message_turns import (
    EXPLAIN_REQUEST_TEXT,
    MessagePlan,
    MessageSnapshot,
    agent_context,
    chat_history,
    explain_fallback,
    plan_handoff,
)
from agent_runtime.workflow.budget import Budget
from agent_runtime.workflow.executor import WorkflowRun, run_workflow
from agent_runtime.workflow.implicit import implicit_workflow
from agent_runtime.workflow.ports import NullProfilePort, Ports, ProfilePort
from agent_runtime.workflow.scope import Scope


def build_scope(snapshot: MessageSnapshot, request: MessageTurnInput, workflow: Workflow,
                profile: ProfilePort) -> Scope:
    explain = request.explain is not None
    activity = snapshot.activity
    card = snapshot.result_card
    result = None
    if card is not None and snapshot.current_result is not None:
        result = {"house_id": card["house"]["house_id"], "career_groups": card["career_groups"],
                  "revision": snapshot.current_result[1]}
    sys_values: dict[str, Any] = {
        "query": "" if explain else request.content.text,
        "interaction": "explain_result" if explain else None,
        "interaction_outcome": "explain_requested" if explain else "none",
        "turn_index": sum(1 for view in snapshot.history if view.role == "user"),
        "client_blocks": [block.type for block in snapshot.parent.capability_snapshot.supported_blocks],
        "activity_status": activity.state.status if activity else None}
    return Scope(sys=sys_values, conv=snapshot.parent.conv_vars, profile=profile.snapshot(), result=result,
                 variables=workflow.variables)


def run_message_turn(snapshot: MessageSnapshot, request: MessageTurnInput, *, model, executor, tool_context,
                     knowledge_port, knowledge_fields: dict | None = None, profile: ProfilePort | None = None,
                     emit=None, should_stop=None, deadline=None,
                     clock) -> WorkflowRun:
    """``mode = agent`` runs the implicit start -> agent -> answer graph, keeping the agent's own fallbacks."""
    agent = snapshot.agent
    implicit = agent.mode == "agent"
    workflow = implicit_workflow(agent) if implicit else agent.workflow
    profile = profile or NullProfilePort()
    explain = request.explain is not None
    show = agent.tool("knowledge.show")
    ports = Ports(agent=agent, model=model, tools=executor, tool_context=tool_context, knowledge=knowledge_port,
                  knowledge_fields={**tool_context.knowledge_fields, **(knowledge_fields or {})},
                  show_params=KnowledgeShowParams.model_validate(show.params) if show else None, profile=profile,
                  agent_context=agent_context(snapshot, explain=explain), history=chat_history(snapshot.history),
                  user_text=EXPLAIN_REQUEST_TEXT if explain else request.content.text)
    return run_workflow(workflow, build_scope(snapshot, request, workflow, profile), ports,
                        budget=Budget(workflow.budget, clock=clock, deadline=deadline), on_event=emit,
                        should_stop=should_stop, implicit=implicit)


def plan_from_run(snapshot: MessageSnapshot, run: WorkflowRun, request: MessageTurnInput, *, handler,
                  persistence) -> MessagePlan:
    """What commit writes for a finished (completed or fallback) run; a cancelled run is never committed."""
    if request.explain is not None and run.fallback is not None:
        plan = MessagePlan((explain_fallback(snapshot.result_card, snapshot.activity.state.display_name),))
    else:
        plan = plan_handoff(snapshot, run.handoff, run.blocks, request, handler=handler, persistence=persistence)
    return replace(plan, conv_vars=run.conv)
