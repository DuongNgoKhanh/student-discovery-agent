"""Structured turn orchestration: preflight UoW, engine outside transactions, guarded commit UoW."""
from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.schemas.turn import ConversationTurnInput
from agent_runtime.sessions.services.turn_handlers import TurnHandler
from agent_runtime.sessions.services.turn_store import TurnStore
from agent_runtime.sessions.trace import observed


class TurnService:
    def __init__(self, store: TurnStore, handler: TurnHandler, *, trace_sink=None):
        self.store = store
        self.handler = handler
        self.trace_sink = trace_sink

    @observed("conversation.turn")
    def submit(self, caller: VerifiedCaller, conversation_id: str, request: ConversationTurnInput) -> ServiceResponse:
        prepared = self.store.preflight(caller, conversation_id, request)
        if isinstance(prepared, ServiceResponse):
            return prepared
        # preflight returns a snapshot only for supported interactions.
        draft = self.handler.prepare(prepared, request)
        return self.store.commit(caller, conversation_id, request, prepared, draft)
