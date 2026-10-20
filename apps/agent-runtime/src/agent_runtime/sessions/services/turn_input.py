"""Turn input parsing, display-name policy and canonical replay identity. No DB, no IDs."""
import re
import unicodedata

from pydantic import TypeAdapter, ValidationError

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import JsonObject
from agent_runtime.sessions.schemas.turn import (
    ConversationTurnInput,
    OptionAnswerPayload,
    SetNameInteraction,
    SubmitAnswerInteraction,
)
from agent_runtime.sessions.services.activity import request_fingerprint

MAX_DISPLAY_NAME = 50
_TURN_INPUT = TypeAdapter(ConversationTurnInput)
# Unicode whitespace runs, excluding the C0 separators U+001C..U+001F that str.isspace() also accepts.
_WHITESPACE = re.compile(r"[^\S\x1c-\x1f]+")


def parse_turn_input(value: JsonObject) -> ConversationTurnInput:
    """Structural parse only; semantic name/state validation runs after guards."""
    try:
        return _TURN_INPUT.validate_python(value)
    except ValidationError:
        raise RuntimeSessionError(422, "INVALID_INPUT") from None


def is_supported(request: ConversationTurnInput) -> bool:
    return isinstance(request, SetNameInteraction) or (
        isinstance(request, SubmitAnswerInteraction) and isinstance(request.payload, OptionAnswerPayload))


def normalize_display_name(value: str) -> str:
    return _WHITESPACE.sub(" ", unicodedata.normalize("NFC", value)).strip(" ")


def validate_display_name(value: str) -> str:
    """1..50 code points after NFC/whitespace normalization; letters, attached marks and spaces only."""
    name = normalize_display_name(value)
    if not 1 <= len(name) <= MAX_DISPLAY_NAME:
        raise RuntimeSessionError(422, "INVALID_INPUT")
    previous = None
    for char in name:
        category = unicodedata.category(char)
        if char == " ":
            pass
        elif category.startswith("M"):
            if previous is None or previous == " ":
                raise RuntimeSessionError(422, "INVALID_INPUT")
        elif not category.startswith("L"):
            raise RuntimeSessionError(422, "INVALID_INPUT")
        previous = char
    return name


def turn_fingerprint(request: ConversationTurnInput) -> str:
    """Hash the normalized original request; the key itself is part of the replay identity."""
    canonical = request.model_dump(mode="json", exclude={"idempotency_key"}, exclude_unset=True)
    canonical["schema_version"] = 1
    if isinstance(request, SetNameInteraction):
        canonical["payload"] = {"display_name": normalize_display_name(request.payload.display_name)}
    return request_fingerprint(canonical)
