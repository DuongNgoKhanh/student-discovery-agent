"""Isolated chatflow debug run (FR-WFL-14): same executor, other ports. No unit of work, no repository, no writes.

The run is the Admin's own: the request carries a draft and a made-up state, the result goes back to Studio and
is never stored here, so its node runs use the ``full`` redaction. The production trace path is not involved.
"""
import json
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Annotated, Any
from uuid import uuid4

from pydantic import Field, ValidationError, model_validator

from agent_runtime.agent.catalog import (
    NO_CONTEXT,
    KnowledgeSearchParams,
    KnowledgeShowParams,
    ToolContext,
)
from agent_runtime.agent.knowledge_tools import KnowledgeTools
from agent_runtime.agent.loop import TextDelta
from agent_runtime.agent.model import ModelReply, ModelUnavailable, UnconfiguredModel
from agent_runtime.agent.prompt import AgentContext
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import ContractModel, JsonObject
from agent_runtime.sessions.schemas.release import AgentSnapshotV1

# The tool checks and the button-press summary are shared with real turns so a debug run behaves like one.
from agent_runtime.sessions.services.message_turns import SnapshotToolExecutor, interaction_summary
from agent_runtime.workflow.budget import Budget
from agent_runtime.workflow.effects import ActivityChange, AssignConv, KbRefsUsed, ProfileProposal
from agent_runtime.workflow.events import NodeFinished, NodeStarted
from agent_runtime.workflow.executor import WorkflowRun, run_workflow
from agent_runtime.workflow.ports import NullProfilePort, Ports
from agent_runtime.workflow.scope import Scope
from agent_runtime.workflow.trace import NodeRunTrace, Redaction

KEEP_SECONDS = 24 * 3600
_OUTCOMES = {"set_name": "name_set", "submit_answer": "answer_recorded", "confirm_answer": "answer_confirmed",
             "edit_answer": "answer_edited", "explain_result": "explain_requested"}
_BLOCK_TYPES = ["text", "markdown", "suggestions", "assessment_question", "assessment_clarification",
                "personality_card", "knowledge_card"]

Emit = Callable[[str, dict], None]
StopCheck = Callable[[], bool]


class DebugInteraction(ContractModel):
    action: str
    outcome: str | None = None
    option_id: str | None = None


class DebugState(ContractModel):
    profile: JsonObject = Field(default_factory=dict)
    result: JsonObject | None = None
    conv: JsonObject = Field(default_factory=dict)
    activity: JsonObject | None = None


class DebugRequest(ContractModel):
    message: Annotated[str, Field(min_length=1, max_length=4000)] | None = None
    interaction: DebugInteraction | None = None
    state: DebugState = DebugState()
    llm_stubs: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def one_input(self) -> "DebugRequest":
        if (self.message is None) == (self.interaction is None):
            raise ValueError("exactly one of message or interaction")
        return self


class StubModel:
    """A fixed answer for a model node: a string is the reply text, anything else a JSON reply; no tokens spent."""

    def __init__(self, stub: Any):
        self._stub = stub

    def invoke(self, messages, tools, settings, on_text_delta=None):
        text = self._stub if isinstance(self._stub, str) else json.dumps(self._stub, ensure_ascii=False)
        if on_text_delta is not None and text and on_text_delta(text) is False:
            return ModelUnavailable("cancelled")
        return ModelReply(text=text)


def _text_or_none(value: Any) -> bool:
    return value is None or isinstance(value, str)


def _activity_view(activity: dict | None):
    """(duck-typed activity for the tool executor, phase, display name, AgentContext question) of the fake state."""
    if not activity:
        return None, "not_started", None, None
    question = activity.get("current_question")
    if question is not None and not isinstance(question, dict):
        raise RuntimeSessionError(422, "INVALID_INPUT")
    options = question.get("options", []) if question else []
    if not isinstance(options, list) or not all(isinstance(item, dict) and isinstance(item.get("id"), str)
                                                and _text_or_none(item.get("label")) for item in options):
        raise RuntimeSessionError(422, "INVALID_INPUT")
    status, display_name = activity.get("status"), activity.get("display_name")
    if not (_text_or_none(status) and _text_or_none(display_name)
            and _text_or_none(question.get("title") if question else None)):
        raise RuntimeSessionError(422, "INVALID_INPUT")
    state = SimpleNamespace(
        status=status or "not_started", display_name=display_name,
        current_question=SimpleNamespace(options=[SimpleNamespace(id=item["id"]) for item in options])
        if question else None)
    context_question = ({"title": question.get("title") or "", "options": [
        {"id": item["id"], "label": item.get("label") or item["id"]} for item in options]} if question else None)
    phase = state.status if state.status in {"collecting_name", "in_progress", "completed"} else "not_started"
    return SimpleNamespace(state=state), phase, state.display_name, context_question


def _effect(effect) -> dict[str, Any]:
    if isinstance(effect, AssignConv):
        return {"kind": "assign_conv", "variable": effect.variable, "value": effect.value, "operation": effect.operation}
    if isinstance(effect, ActivityChange):
        return {"kind": "activity_change", "tool": effect.handoff.name}
    if isinstance(effect, ProfileProposal):
        return {"kind": "profile_proposal", "fields": dict(effect.fields), "target_step": effect.target_step}
    if isinstance(effect, KbRefsUsed):
        return {"kind": "kb_refs_used", "kb_id": effect.kb_id, "refs": list(effect.refs)}
    return {"kind": type(effect).__name__}


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds").replace("+00:00", "Z")


class DebugRunService:
    def __init__(self, models: Callable[[str], Any], knowledge=None, *, clock: Callable[[], float] = time.monotonic,
                 now: Callable[[], datetime] = lambda: datetime.now(UTC)):
        self.models, self.knowledge, self._clock, self._now = models, knowledge, clock, now

    def run(self, content: dict, request: dict, emit: Emit | None = None, should_stop: StopCheck | None = None) -> dict:
        return self.prepare(content, request)(emit, should_stop)

    def prepare(self, content: dict, request: dict) -> Callable[..., dict]:
        """Validates now (so a bad request is a plain 422); the returned ``work(emit, should_stop)`` does the run."""
        try:
            agent = AgentSnapshotV1.model_validate(content)
            parsed = DebugRequest.model_validate(request)
        except ValidationError:
            raise RuntimeSessionError(422, "INVALID_INPUT") from None
        if agent.mode != "chatflow" or agent.workflow is None:
            raise RuntimeSessionError(422, "INVALID_INPUT")
        view = _activity_view(parsed.state.activity)

        def work(emit: Emit | None = None, should_stop: StopCheck | None = None) -> dict:
            return self._execute(agent, parsed, view, emit, should_stop)
        return work

    def _fields(self, kb_ids) -> dict:
        if self.knowledge is None or not kb_ids:
            return {}
        try:
            return self.knowledge.fields(sorted(kb_ids))
        except Exception:  # an unreachable knowledge store degrades the run, as in a real turn
            return {}

    def _knowledge(self, agent: AgentSnapshotV1):
        search = agent.tool("knowledge.search")
        if search is None:
            return NO_CONTEXT, None
        params = KnowledgeSearchParams.model_validate(search.params)
        show = agent.tool("knowledge.show")
        fields = self._fields([params.knowledge_base_id])
        tools = KnowledgeTools(self.knowledge, params, KnowledgeShowParams.model_validate(show.params) if show else None,
                               fields.get(params.knowledge_base_id, ()), allowed_domains=agent.links.allowed_domains)
        return ToolContext(knowledge_fields=fields), tools

    def _execute(self, agent: AgentSnapshotV1, request: DebugRequest, view, emit: Emit | None,
                 should_stop: StopCheck | None) -> dict:
        created = self._now()
        sink = emit or (lambda name, data: None)
        workflow = agent.workflow
        deadline = self._clock() + agent.limits.turn_timeout_ms / 1000
        base = self.models(agent.model.provider) if agent.model else UnconfiguredModel()
        stubs = request.llm_stubs
        activity, phase, display_name, question = view
        interaction = request.interaction
        outcome = "none"
        user_text = request.message or ""
        if interaction is not None:
            outcome = interaction.outcome or _OUTCOMES.get(interaction.action, "none")
            user_text = interaction_summary(interaction.action, display_name=display_name,
                                            option_id=interaction.option_id)
        scope = Scope(sys={"query": request.message or "", "interaction": interaction.action if interaction else None,
                           "interaction_outcome": outcome, "turn_index": 0, "client_blocks": _BLOCK_TYPES,
                           "activity_status": activity.state.status if activity else None},
                      conv=request.state.conv, profile=request.state.profile, result=request.state.result,
                      variables=workflow.variables)
        tool_context, knowledge_tools = self._knowledge(agent)
        wanted = {node.config["knowledge_base_id"] for node in workflow.nodes
                  if node.type == "knowledge_retrieval" and isinstance(node.config.get("knowledge_base_id"), str)}
        fields = {**self._fields(wanted - set(tool_context.knowledge_fields)), **tool_context.knowledge_fields}
        state_view = SimpleNamespace(agent=agent, activity=activity, result_card=request.state.result)
        show = agent.tool("knowledge.show")
        ports = Ports(agent=agent, model=base,
                      model_for=lambda node_id: StubModel(stubs[node_id]) if node_id in stubs else base,
                      tools=SnapshotToolExecutor(state_view, knowledge_tools), tool_context=tool_context,
                      knowledge=self.knowledge, knowledge_fields=fields,
                      show_params=KnowledgeShowParams.model_validate(show.params) if show else None,
                      profile=NullProfilePort(),
                      agent_context=AgentContext(today=date.today(), phase=phase, display_name=display_name,
                                                 current_question=question),
                      user_text=user_text)
        budget = Budget(workflow.budget, clock=self._clock, deadline=deadline)
        current: dict[str, Any] = {"type": None, "held": []}

        def on_event(event) -> None:
            if isinstance(event, NodeStarted):
                current.update(type=event.type, held=[])
                sink("workflow.node_started", {"event": "workflow.node_started", "node_id": event.node_id,
                                               "type": event.type, "order": event.order,
                                               "started_at": _iso(self._now())})
            elif isinstance(event, NodeFinished):
                sink("workflow.node_finished", {"event": "workflow.node_finished", "node_id": event.node_id,
                                                "handle": event.handle, "duration_ms": event.duration_ms,
                                                "llm_calls": event.llm_calls,
                                                "tokens": {"input": event.input_tokens, "output": event.output_tokens},
                                                "error": event.error})
                for text in current["held"]:  # an answer's text is the reply: it follows the node that wrote it
                    sink("delta", {"event": "delta", "text": text})
                current.update(type=None, held=[])
            elif isinstance(event, TextDelta):
                if current["type"] == "answer":
                    current["held"].append(event.text)
                else:  # model nodes stream live, inside their started/finished pair
                    sink("delta", {"event": "delta", "text": event.text})

        run = run_workflow(workflow, scope, ports, budget=budget, on_event=on_event, should_stop=should_stop,
                           reply_required=interaction is None)
        return self._result(run, workflow, created, stubs)

    def _result(self, run: WorkflowRun, workflow, created: datetime, stubs: dict[str, Any]) -> dict:
        # The Admin's own run, never persisted by the runtime: node inputs and values are shown in full.
        full = Redaction("full", {variable.name: variable for variable in workflow.variables})
        node_runs = []
        for record in run.records:
            item = NodeRunTrace(node_id=record.node_id, type=record.type, order=record.order, handle=record.handle,
                                duration_ms=record.duration_ms, reason=full.reason(record),
                                input=full.input(record.input), output=full.io(record.type, record.output),
                                llm_calls=record.llm_calls, tokens={"input": record.tokens[0], "output": record.tokens[1]},
                                refs=record.refs, error=record.error).model_dump(mode="json")
            node_runs.append({key: value for key, value in item.items()
                              if value is not None or key in {"handle", "error"}})
        return {"run_id": "dbg_" + uuid4().hex[:24],
                "status": "completed" if run.status == "completed" else "fallback",
                "fallback_reason": run.fallback if run.fallback in {"workflow_budget", "workflow_node_error"} else None,
                "path": list(run.path), "node_runs": node_runs,
                "blocks": [block.model_dump(mode="json") for block in run.blocks],
                "effects": [_effect(effect) for effect in run.effects], "llm_calls": run.llm_calls,
                "live_llm_calls": sum(record.llm_calls for record in run.records if record.node_id not in stubs),
                "tokens": {"input": run.usage.input_tokens, "output": run.usage.output_tokens},
                "created_at": _iso(created), "expires_at": _iso(created + timedelta(seconds=KEEP_SECONDS))}
