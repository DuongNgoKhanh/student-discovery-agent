"""Turn orchestration: begin UoW, engine/agent work outside transactions, guarded commit UoW."""
import time
from collections.abc import Callable
from typing import Literal

from agent_runtime.agent.loop import TextDelta, run_agent_turn
from agent_runtime.agent.model import ModelPort, UnconfiguredModel
from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.schemas.responses import TurnResponse
from agent_runtime.sessions.schemas.turn import ConversationTurnInput, MessageTurnInput
from agent_runtime.sessions.services.message_turns import (
    SnapshotToolExecutor,
    agent_context,
    chat_history,
    plan_message_turn,
)
from agent_runtime.sessions.services.responses import ResponseService
from agent_runtime.sessions.services.turn_handlers import TurnHandler
from agent_runtime.sessions.services.turn_store import Begun, TurnCancelled, TurnStore
from agent_runtime.sessions.trace import observed

__all__ = ["CANCEL_POLL_SECONDS", "Begun", "StreamEvent", "TurnCancelled", "TurnService", "describe_turn"]

CANCEL_POLL_SECONDS = 0.5
StreamEvent = tuple[Literal["delta"], str] | tuple[Literal["tool_call"], str]


def describe_turn(response: ServiceResponse) -> dict:
    """Identifiers and revisions of the turn's Response; result_id is set once the activity completed."""
    data = response.data
    activity = data.get("activity") or {}
    committed = data["status"] == "completed" and not response.replayed
    return {"conversation_id": data["conversation_id"], "activity_id": activity.get("id"),
            "result_id": (activity.get("result") or {}).get("result_id"),
            "before_revision": data["revision"] - (1 if committed else 0), "after_revision": data["revision"],
            "experience_release_id": None, "algorithm_profile": activity.get("algorithm_profile")}


class TurnService:
    def __init__(self, store: TurnStore, handler: TurnHandler, *, models: Callable[[str], ModelPort] | None = None,
                 responses: ResponseService | None = None, trace_sink=None, clock=time.monotonic):
        self.store = store
        self.handler = handler
        self.models = models or (lambda provider: UnconfiguredModel())
        # Cancel polling reads the same rows the store writes.
        self.responses = responses or ResponseService(store.uow, clock=store.access.clock)
        self.trace_sink = trace_sink
        self._clock = clock

    def begin(self, caller: VerifiedCaller, conversation_id: str,
              request: ConversationTurnInput) -> ServiceResponse | Begun:
        return self.store.begin(caller, conversation_id, request)

    @observed("conversation.turn", describe_turn)
    def submit(self, caller: VerifiedCaller, conversation_id: str, request: ConversationTurnInput) -> ServiceResponse:
        """JSON mode: begin + finish; a finished same-key Response replays."""
        begun = self.begin(caller, conversation_id, request)
        if isinstance(begun, ServiceResponse):
            return begun
        return ServiceResponse(status=200, data=self.finish(caller, begun).model_dump(mode="json"))

    def finish(self, caller: VerifiedCaller, begun: Begun,
               on_event: Callable[[StreamEvent], None] | None = None) -> TurnResponse:
        """Never raises after begin: every outcome is a terminal Response."""
        try:
            return self._run(caller, begun, on_event)
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

    def _run(self, caller: VerifiedCaller, begun: Begun, on_event) -> TurnResponse:
        request, snapshot = begun.request, begun.snapshot
        if not isinstance(request, MessageTurnInput):
            # begin returns a snapshot only for supported interactions.
            draft = self.handler.prepare(snapshot, request)
            return self.store.commit(caller, begun, draft)
        agent = snapshot.agent
        model = self.models(agent.model.provider) if agent.model else UnconfiguredModel()
        emit = None
        if on_event is not None:
            def emit(event):
                on_event(("delta", event.text) if isinstance(event, TextDelta) else ("tool_call", event.name))
        turn = run_agent_turn(agent, model, SnapshotToolExecutor(snapshot), agent_context(snapshot),
                              chat_history(snapshot.history), request.content.text, on_event=emit,
                              should_stop=self._should_stop(caller, begun.response.id),
                              deadline=self._clock() + agent.limits.turn_timeout_ms / 1000, clock=self._clock)
        if turn.cancelled:
            raise TurnCancelled()
        plan = plan_message_turn(snapshot, turn, request, handler=self.handler, persistence=self.store.persistence)
        return self.store.commit_message(caller, begun, plan)
