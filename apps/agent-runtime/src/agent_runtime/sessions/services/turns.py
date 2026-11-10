"""Turn orchestration: begin UoW, engine/agent work outside transactions, guarded commit UoW."""
import logging
import time
from collections.abc import Callable
from dataclasses import replace
from time import monotonic_ns
from typing import Literal

from agent_runtime.agent.catalog import NO_CONTEXT, KnowledgeSearchParams, KnowledgeShowParams, ToolContext
from agent_runtime.agent.knowledge_tools import KnowledgePort, KnowledgeTools
from agent_runtime.agent.loop import TextDelta, ToolCallStarted
from agent_runtime.agent.model import ModelPort, UnconfiguredModel
from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.schemas.release import AgentSnapshotV1
from agent_runtime.sessions.schemas.responses import TurnResponse
from agent_runtime.sessions.schemas.turn import ConversationTurnInput, MessageTurnInput
from agent_runtime.sessions.services.chatflow_turns import plan_from_run, run_message_turn
from agent_runtime.sessions.services.message_turns import SnapshotToolExecutor
from agent_runtime.sessions.services.responses import ResponseService
from agent_runtime.sessions.services.turn_handlers import TurnHandler
from agent_runtime.sessions.services.turn_store import Begun, TurnCancelled, TurnStore
from agent_runtime.sessions.trace import describe_metadata, emit_trace
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

    def _knowledge(self, agent: AgentSnapshotV1) -> tuple[ToolContext, KnowledgeTools | None]:
        """Fields are read once per turn, outside any session transaction; search and show share one KnowledgeTools."""
        search = agent.tool("knowledge.search")
        if search is None:
            return NO_CONTEXT, None
        params = KnowledgeSearchParams.model_validate(search.params)
        show = agent.tool("knowledge.show")
        fields = self._read_fields(params.knowledge_base_id)
        show_params = KnowledgeShowParams.model_validate(show.params) if show else None
        tools = KnowledgeTools(self.knowledge, params, show_params, fields.get(params.knowledge_base_id, ()),
                               allowed_domains=agent.links.allowed_domains)
        return ToolContext(knowledge_fields=fields), tools

    def _workflow_fields(self, agent: AgentSnapshotV1, known: dict) -> dict:
        """Metadata fields of every KB a chatflow node reads; read once per turn, outside any transaction."""
        if agent.workflow is None:
            return {}
        wanted = {node.config["knowledge_base_id"] for node in agent.workflow.nodes
                  if node.type == "knowledge_retrieval" and isinstance(node.config.get("knowledge_base_id"), str)}
        merged: dict = {}
        for kb_id in wanted - set(known):
            merged.update(self._read_fields(kb_id))
        return merged

    def _run(self, caller: VerifiedCaller, begun: Begun, on_event, observed: dict) -> TurnResponse:
        request, snapshot = begun.request, begun.snapshot
        if not isinstance(request, MessageTurnInput):
            # begin returns a snapshot only for supported interactions.
            draft = self.handler.prepare(snapshot, request)
            return self.store.commit(caller, begun, draft)
        agent = snapshot.agent
        if agent.model:
            observed["provider"] = agent.model.provider
        model = self.models(agent.model.provider) if agent.model else UnconfiguredModel()
        emit = None
        if on_event is not None:
            def emit(event):
                if isinstance(event, TextDelta):
                    on_event(("delta", event.text))
                elif isinstance(event, ToolCallStarted):
                    on_event(("tool_call", event.name))
        deadline = self._clock() + agent.limits.turn_timeout_ms / 1000  # field reads count against the turn budget
        tool_context, knowledge = self._knowledge(agent)
        executor = SnapshotToolExecutor(snapshot, knowledge)
        run, used, workflow = run_message_turn(
            snapshot, request, model=model, executor=executor, tool_context=tool_context,
            knowledge_port=self.knowledge, knowledge_fields=self._workflow_fields(agent, tool_context.knowledge_fields),
            profile=self.profile, emit=emit, should_stop=self._should_stop(caller, begun.response.id),
            deadline=deadline, clock=self._clock)
        observed.update(agent_steps=run.agent_steps, input_tokens=run.usage.input_tokens,
                        output_tokens=run.usage.output_tokens, fallback=run.fallback is not None,
                        fallback_reason=run.fallback)
        observed["response_id"] = begun.response.id
        try:  # a trace that cannot be built is dropped; it never fails the turn
            # Redacted for production: no student text, rendered prompt or profile value reaches the stored trace.
            observed["workflow"] = build_trace(
                run, redaction=Redaction("production", {variable.name: variable for variable in workflow.variables}),
                agent_release_id=snapshot.parent.agent_snapshot.release_id,
                content_hash=snapshot.agent_content_hash, mode=agent.mode, budget=used)
        except Exception as error:
            logger.warning("workflow trace dropped: %s", type(error).__name__)
        searches = (*(knowledge.trace() if knowledge is not None else ()), *run.knowledge)[:8]
        if searches:
            observed["knowledge"] = searches
        if run.status == "cancelled":
            raise TurnCancelled()
        plan = plan_from_run(snapshot, run, request, handler=self.handler, persistence=self.store.persistence)
        return self.store.commit_message(caller, begun, plan)
