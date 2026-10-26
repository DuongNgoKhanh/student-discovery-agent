"""Turn orchestration: preflight UoW, engine/agent work outside transactions, guarded commit UoW."""
from collections.abc import Callable

from agent_runtime.agent.loop import run_agent_turn
from agent_runtime.agent.model import ModelPort, UnconfiguredModel
from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.schemas.turn import ConversationTurnInput, MessageTurnInput
from agent_runtime.sessions.services.message_turns import (
    MessageSnapshot,
    SnapshotToolExecutor,
    agent_context,
    chat_history,
    plan_message_turn,
)
from agent_runtime.sessions.services.turn_handlers import TurnHandler
from agent_runtime.sessions.services.turn_store import TurnStore
from agent_runtime.sessions.trace import observed


def describe_turn(response: ServiceResponse) -> dict:
    """Identifiers and revisions of the committed turn; result_id is set once the activity completed."""
    data = response.data
    activity = data["activity"] or {}
    return {"conversation_id": data["conversation_id"], "activity_id": activity.get("id"),
            "result_id": (activity.get("result") or {}).get("result_id"),
            "before_revision": data["revision"] - 1, "after_revision": data["revision"],
            "experience_release_id": activity.get("experience_release_id"),
            "algorithm_profile": activity.get("algorithm_profile")}


class TurnService:
    def __init__(self, store: TurnStore, handler: TurnHandler, *, models: Callable[[str], ModelPort] | None = None,
                 trace_sink=None):
        self.store = store
        self.handler = handler
        self.models = models or (lambda provider: UnconfiguredModel())
        self.trace_sink = trace_sink

    @observed("conversation.turn", describe_turn)
    def submit(self, caller: VerifiedCaller, conversation_id: str, request: ConversationTurnInput) -> ServiceResponse:
        prepared = self.store.preflight(caller, conversation_id, request)
        if isinstance(prepared, ServiceResponse):
            return prepared
        if isinstance(request, MessageTurnInput):
            return self._message(caller, conversation_id, request, prepared)
        # preflight returns a snapshot only for supported interactions.
        draft = self.handler.prepare(prepared, request)
        return self.store.commit(caller, conversation_id, request, prepared, draft)

    def _message(self, caller: VerifiedCaller, conversation_id: str, request: MessageTurnInput,
                 snapshot: MessageSnapshot) -> ServiceResponse:
        agent = snapshot.agent
        model = self.models(agent.model.provider) if agent.model else UnconfiguredModel()
        turn = run_agent_turn(agent, model, SnapshotToolExecutor(snapshot), agent_context(snapshot),
                              chat_history(snapshot.history), request.content.text)
        plan = plan_message_turn(snapshot, turn, request, handler=self.handler, persistence=self.store.persistence)
        return self.store.commit_message(caller, conversation_id, request, snapshot, plan)
