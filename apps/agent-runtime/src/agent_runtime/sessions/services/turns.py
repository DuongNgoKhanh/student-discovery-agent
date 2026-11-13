"""Turn orchestration: begin UoW, engine/agent work outside transactions, guarded commit UoW."""
import logging
import time
from collections.abc import Callable
from dataclasses import replace
from time import monotonic_ns
from typing import Literal

from agent_runtime.agent.loop import TextDelta, ToolCallStarted
from agent_runtime.agent.model import ModelPort, UnconfiguredModel
from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.schemas.responses import TurnResponse
from agent_runtime.sessions.schemas.turn import ConversationTurnInput, MessageTurnInput
from agent_runtime.sessions.schemas.turn_execution import TurnDraft
from agent_runtime.sessions.schemas.workflow import Workflow
from agent_runtime.sessions.services.chatflow_turns import (
    knowledge_base_ids_of,
    plan_from_run,
    post_handler,
    run_interaction_turn,
    run_message_turn,
)
from agent_runtime.sessions.services.message_turns import MessageSnapshot
from agent_runtime.sessions.services.responses import ResponseService
from agent_runtime.sessions.services.turn_handlers import TurnHandler
from agent_runtime.sessions.services.turn_store import Begun, TurnCancelled, TurnStore
from agent_runtime.sessions.trace import describe_metadata, emit_trace
from agent_runtime.tools.kit import TurnWorld
from agent_runtime.tools.knowledge import KnowledgePort
from agent_runtime.tools.toolbox import Toolbox, open_turn
from agent_runtime.workflow.budget import Budget
from agent_runtime.workflow.executor import WorkflowRun
from agent_runtime.workflow.ports import ProfilePort
from agent_runtime.workflow.trace import Redaction, build_trace

__all__ = ["CANCEL_POLL_SECONDS", "Begun", "StreamEvent", "TurnCancelled", "TurnService", "describe_response",
           "describe_turn"]

logger = logging.getLogger(__name__)

TRACE_ACTION = "conversation.turn"

CANCEL_POLL_SECONDS = 0.5
StreamEvent = tuple[Literal["delta"], str] | tuple[Literal["tool_call"], str]


def describe_turn(response: ServiceResponse) -> dict:
    """A replayed Response's identifiers and revisions; result_id is set once the activity completed."""
    data = response.data
    activity = data.get("activity") or {}
    return {"conversation_id": data["conversation_id"], "activity_id": activity.get("id"),
            "result_id": (activity.get("result") or {}).get("result_id"),
            "before_revision": data["revision"], "after_revision": data["revision"],
            "experience_release_id": None, "algorithm_profile": activity.get("algorithm_profile")}


def describe_response(subject: tuple[Begun, TurnResponse]) -> dict:
    """A terminal Response's identifiers; the release is the activity's pinned one captured at begin."""
    begun, response = subject
    activity = response.activity or begun.response.activity
    release = getattr(begun.snapshot, "release", None)
    return {"conversation_id": response.conversation_id, "activity_id": activity.id if activity else None,
            "result_id": activity.result.result_id if activity and activity.result else None,
            "before_revision": begun.response.revision, "after_revision": response.revision,
            "experience_release_id": release.release_id if release else None,
            "algorithm_profile": activity.algorithm_profile if activity else None}


class TurnService:
    def __init__(self, store: TurnStore, handler: TurnHandler, *, models: Callable[[str], ModelPort] | None = None,
                 responses: ResponseService | None = None, knowledge: KnowledgePort | None = None,
                 trace_sink=None, clock=time.monotonic, profile: ProfilePort | None = None):
        self.store = store
        self.profile = profile
        self.handler = handler
        self.models = models or (lambda provider: UnconfiguredModel())
        # Cancel polling reads the same rows the store writes.
        self.responses = responses or ResponseService(store.uow, clock=store.access.clock)
        self.knowledge = knowledge
        self.trace_sink = trace_sink
        self._clock = clock

    def begin(self, caller: VerifiedCaller, conversation_id: str,
              request: ConversationTurnInput) -> ServiceResponse | Begun:
        """Traces rejections and replays here; a begun turn is traced once, by ``finish``."""
        start = monotonic_ns()
        try:
            begun = self.store.begin(caller, conversation_id, request)
        except Exception:
            emit_trace(self.trace_sink, TRACE_ACTION, "failure", {}, start)
            raise
        if isinstance(begun, ServiceResponse):
            emit_trace(self.trace_sink, TRACE_ACTION, "replayed", describe_metadata(describe_turn, begun), start)
            return begun
        return replace(begun, started_ns=start)

    def submit(self, caller: VerifiedCaller, conversation_id: str, request: ConversationTurnInput) -> ServiceResponse:
        """JSON mode: begin + finish (each traces its own outcome); a finished same-key Response replays."""
        begun = self.begin(caller, conversation_id, request)
        if isinstance(begun, ServiceResponse):
            return begun
        return ServiceResponse(status=200, data=self.finish(caller, begun).model_dump(mode="json"))

    def finish(self, caller: VerifiedCaller, begun: Begun,
               on_event: Callable[[StreamEvent], None] | None = None) -> TurnResponse:
        """Never raises after begin: every outcome is a terminal Response, traced exactly once."""
        observed: dict = {}  # agent metadata of this turn; validated apart so a bad item never drops the identifiers
        response = self._settle(caller, begun, on_event, observed)
        metadata = describe_metadata(describe_response, (begun, response)) | describe_metadata(dict, observed)
        emit_trace(self.trace_sink, TRACE_ACTION, "failure" if response.status == "failed" else "success",
                   metadata, begun.started_ns)
        return response

    def _settle(self, caller: VerifiedCaller, begun: Begun, on_event, observed: dict) -> TurnResponse:
        try:
            return self._run(caller, begun, on_event, observed)
        except TurnCancelled:
            return self.responses.read_model(caller, begun.response.id)
        except RuntimeSessionError as error:
            return self.store.fail(begun, error.code)
        except Exception:
            return self.store.fail(begun, "INTERNAL_ERROR")

    def _should_stop(self, caller: VerifiedCaller, response_id: str) -> Callable[[], bool]:
        """At most one status read per CANCEL_POLL_SECONDS."""
        last = [self._clock()]

        def check() -> bool:
            if self._clock() - last[0] < CANCEL_POLL_SECONDS:
                return False
            last[0] = self._clock()
            return self.responses.is_finished(caller, response_id)
        return check

    def _read_fields(self, knowledge_base_id: str) -> dict:
        """No knowledge error may fail a turn: unreadable fields degrade to none."""
        if self.knowledge is None:
            return {}
        try:
            return self.knowledge.fields([knowledge_base_id])
        except Exception as error:
            logger.warning("knowledge fields unavailable: %s", type(error).__name__)
            return {}

    def _fields(self, agent: AgentSnapshotV1) -> dict:
        """Metadata fields of every knowledge base this turn may read: once, outside any session transaction."""
        merged: dict = {}
        for kb_id in sorted(knowledge_base_ids_of(agent)):
            merged.update(self._read_fields(kb_id))
        return merged

    def _emitter(self, on_event):
        if on_event is None:
            return None

        def emit(event):
            if isinstance(event, TextDelta):
                on_event(("delta", event.text))
            elif isinstance(event, ToolCallStarted):
                on_event(("tool_call", event.name))
        return emit

    def _observe(self, observed: dict, run: WorkflowRun, used: Budget, workflow: Workflow, snapshot: MessageSnapshot,
                 response_id: str, toolbox: Toolbox, *, activity_conflict: bool = False) -> None:
        observed.update(agent_steps=run.agent_steps, input_tokens=run.usage.input_tokens,
                        output_tokens=run.usage.output_tokens, fallback=run.fallback is not None,
                        fallback_reason=run.fallback)
        observed["response_id"] = response_id
        try:  # a trace that cannot be built is dropped; it never fails the turn
            # Redacted for production: no student text, rendered prompt or profile value reaches the stored trace.
            observed["workflow"] = build_trace(
                run, redaction=Redaction("production", {variable.name: variable for variable in workflow.variables}),
                agent_release_id=snapshot.parent.agent_snapshot.release_id,
                content_hash=snapshot.agent_content_hash, mode=snapshot.agent.mode, budget=used,
                activity_conflict=activity_conflict)
        except Exception as error:
            logger.warning("workflow trace dropped: %s", type(error).__name__)
        searches = (*toolbox.trace(), *run.knowledge)[:8]
        if searches:
            observed["knowledge"] = searches

    def _run(self, caller: VerifiedCaller, begun: Begun, on_event, observed: dict) -> TurnResponse:
        request, snapshot = begun.request, begun.snapshot
        if not isinstance(request, MessageTurnInput):
            # begin returns a snapshot only for supported interactions.
            draft = self.handler.prepare(snapshot, request)  # a rejected interaction raises here; no graph runs
            if begun.chatflow is None:  # mode = agent: a button press never calls the model
                return self.store.commit(caller, begun, draft)
            return self._run_interaction(caller, begun, draft, on_event, observed)
        agent = snapshot.agent
        if agent.model:
            observed["provider"] = agent.model.provider
        model = self.models(agent.model.provider) if agent.model else UnconfiguredModel()
        deadline = self._clock() + agent.limits.turn_timeout_ms / 1000  # field reads count against the turn budget
        fields = self._fields(agent)
        toolbox = open_turn(TurnWorld(snapshot, self.knowledge, fields))
        run, used, workflow = run_message_turn(
            snapshot, request, model=model, toolbox=toolbox, knowledge_port=self.knowledge, knowledge_fields=fields,
            profile=self.profile, emit=self._emitter(on_event),
            should_stop=self._should_stop(caller, begun.response.id), deadline=deadline, clock=self._clock)
        self._observe(observed, run, used, workflow, snapshot, begun.response.id, toolbox)
        if run.status == "cancelled":
            raise TurnCancelled()
        plan = plan_from_run(snapshot, run, request, handler=self.handler, persistence=self.store.persistence)
        return self.store.commit_message(caller, begun, plan)

    def _run_interaction(self, caller: VerifiedCaller, begun: Begun, draft: TurnDraft, on_event,
                         observed: dict) -> TurnResponse:
        """Handler first, then the graph over the post-handler state; both land in the handler's one commit.

        A handoff the graph asks for is dropped (the handler already moved the activity) and only flagged in the
        trace; the graph contributes its blocks (before the handler's block) and its conversation variables.
        """
        chat = begun.chatflow
        agent = chat.agent
        if agent.model:
            observed["provider"] = agent.model.provider
        model = self.models(agent.model.provider) if agent.model else UnconfiguredModel()
        deadline = self._clock() + agent.limits.turn_timeout_ms / 1000
        fields = self._fields(agent)
        toolbox = open_turn(TurnWorld(post_handler(chat, draft), self.knowledge, fields))
        run, used, workflow = run_interaction_turn(
            chat, begun.request, draft, model=model, toolbox=toolbox, knowledge_port=self.knowledge,
            profile=self.profile, emit=self._emitter(on_event),
            should_stop=self._should_stop(caller, begun.response.id), deadline=deadline, clock=self._clock,
            knowledge_fields=fields)
        self._observe(observed, run, used, workflow, chat, begun.response.id, toolbox,
                      activity_conflict=run.handoff is not None)
        if run.status == "cancelled":
            raise TurnCancelled()
        return self.store.commit(caller, begun, draft, lead_blocks=run.blocks, conv_vars=run.conv)
