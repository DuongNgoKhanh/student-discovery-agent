"""Owner-guarded history with signed, stable snapshot pagination."""
import base64
import hashlib
import hmac
import json
import re

from pydantic import ValidationError

from agent_runtime.infrastructure.auth.caller import VerifiedCaller
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.repositories.activities import ActivityRepository
from agent_runtime.sessions.repositories.messages import MessageRepository
from agent_runtime.sessions.repositories.results import ResultRepository
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.schemas.history import HistoryCursor, MessagePage
from agent_runtime.sessions.services.access import AccessPolicy
from agent_runtime.sessions.services.results import is_current_result
from agent_runtime.sessions.trace import observed


def _base64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


class HistoryCursorCodec:
    def __init__(self, key: bytes):
        if not isinstance(key, bytes) or len(key) < 32:
            raise ValueError("cursor key must contain at least 256 bits")
        self._key = key

    def encode(self, cursor: HistoryCursor) -> str:
        value = HistoryCursor.model_validate(cursor.model_dump())
        payload = _base64(value.model_dump_json().encode("utf-8"))
        signature = hmac.new(self._key, payload.encode("ascii"), hashlib.sha256).digest()
        return payload + "." + _base64(signature)

    def decode(self, token: str) -> HistoryCursor:
        try:
            if not isinstance(token, str) or len(token) > 2048 or not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", token):
                raise ValueError
            payload, signature = token.split(".")
            expected = _base64(hmac.new(self._key, payload.encode("ascii"), hashlib.sha256).digest())
            if not hmac.compare_digest(signature, expected):
                raise ValueError
            raw = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
            if _base64(raw) != payload:
                raise ValueError
            data = json.loads(raw)
            if not isinstance(data, dict) or type(data.get("version")) is not int:
                raise ValueError
            return HistoryCursor.model_validate_json(raw)
        except (ValueError, ValidationError):
            raise RuntimeSessionError(422, "INVALID_INPUT") from None


class HistoryService:
    def __init__(self, uow, codec: HistoryCursorCodec, *, clock=None, trace_sink=None):
        self.trace_sink = trace_sink
        self.uow = uow
        self.codec = codec
        self.access = AccessPolicy(clock=clock)
        self.messages = MessageRepository()
        self.activities = ActivityRepository()
        self.results = ResultRepository()

    def _content_status(self, session, parent, message):
        # History preserves committed cards; it never promotes an old generation
        # to a current/exportable result. Current state remains authoritative.
        for block in message.blocks:
            if block.type != "personality_card":
                continue
            activity = self.activities.get(session, parent.id, block.activity_id)
            result = self.results.get(session, block.activity_id, block.result_id) if activity else None
            if (activity is None or not is_current_result(parent, activity, result)
                    or result.result_revision != block.result_revision):
                return message.model_copy(update={"content_status": "superseded"})
        return message

    @observed("history.read")
    def read(self, caller: VerifiedCaller, conversation_id: str, cursor: str | None = None,
             limit: int = 20) -> ServiceResponse:
        with self.uow.begin() as session:
            parent = self.access.require_read(session, caller, conversation_id)
            if type(limit) is not int or not 1 <= limit <= 100:
                raise RuntimeSessionError(422, "INVALID_INPUT")
            boundary = (HistoryCursor(conversation_id=parent.id, watermark_revision=parent.revision, last_ordinal=0)
                        if cursor is None else self.codec.decode(cursor))
            if boundary.conversation_id != parent.id or boundary.watermark_revision > parent.revision:
                raise RuntimeSessionError(422, "INVALID_INPUT")
            rows = self.messages.page(session, parent.id, boundary.watermark_revision, boundary.last_ordinal, limit + 1)
            next_cursor = None
            if len(rows) > limit:
                next_cursor = self.codec.encode(boundary.model_copy(update={"last_ordinal": rows[limit - 1][0]}))
            page = MessagePage(conversation_id=parent.id,
                               items=tuple(self._content_status(session, parent, item) for _, item in rows[:limit]),
                               next_cursor=next_cursor, snapshot_revision=boundary.watermark_revision)
            response = ServiceResponse(status=200, data=page.model_dump(mode="json"))
        return response
