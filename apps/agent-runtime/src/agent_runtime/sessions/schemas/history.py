"""Stable history pagination DTOs; cursor authenticity belongs to its codec."""
from typing import Literal

from .activity import NewMessage
from .common import ContractModel, JsonSafeInt, OpaqueId, UtcDatetime


class HistoryCursor(ContractModel):
    version: Literal[1] = 1
    conversation_id: OpaqueId
    watermark_revision: JsonSafeInt
    last_ordinal: JsonSafeInt


class MessageView(NewMessage):
    conversation_revision: JsonSafeInt
    created_at: UtcDatetime
    content_status: Literal["current", "superseded"] = "current"


class MessagePage(ContractModel):
    conversation_id: OpaqueId
    items: tuple[MessageView, ...]
    next_cursor: str | None
    snapshot_revision: JsonSafeInt
