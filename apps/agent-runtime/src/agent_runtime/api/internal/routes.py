"""Nine synchronous operations; FastAPI dispatches all service/DB work to its pool."""
import re

from fastapi import APIRouter, Request
from pydantic import ValidationError
from starlette.responses import StreamingResponse

from agent_runtime.infrastructure.http.strict_json import read_strict_json
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import ServiceResponse
from agent_runtime.sessions.schemas.conversation import CreateConversationInput, EndConversationInput
from agent_runtime.sessions.services.turn_input import parse_message_input

from .dependencies import PREFIX
from .envelopes import success
from .sse import stream_turn

router = APIRouter(prefix=PREFIX)
SSE_HEADERS = {"X-Accel-Buffering": "no"}


def _service(request, name):
    service = getattr(request.state.runtime, name)
    if service is None:
        raise RuntimeSessionError(503, "SERVICE_UNAVAILABLE", {"kind": "not_configured"})
    return service


def _input(request, model):
    data = read_strict_json(request.state.raw_body)
    try:
        return model.model_validate(data)
    except ValidationError:
        raise RuntimeSessionError(422, "INVALID_INPUT") from None


def _wants_stream(request):
    return "text/event-stream" in request.headers.get("accept", "")


def _id(value):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value):
        raise RuntimeSessionError(422, "INVALID_INPUT")
    return value


def _query(request, allowed):
    pairs = request.query_params.multi_items()
    if any(key not in allowed for key, _ in pairs) or len({key for key, _ in pairs}) != len(pairs):
        raise RuntimeSessionError(422, "INVALID_INPUT")
    return dict(pairs)


def _integer(value):
    # Leave malformed values to the service so owner/lifecycle guards win.
    if isinstance(value, str) and re.fullmatch(r"[0-9]{1,16}", value):
        return int(value)
    return value


@router.post("/conversations", status_code=201, operation_id="internalCreateConversation")
def create_conversation(request: Request):
    _query(request, ())
    data = _input(request, CreateConversationInput)
    response = _service(request, "conversations").create(request.state.caller, data)
    return success(response, *request.state.meta)


@router.get("/conversations/{conversation_id}", operation_id="internalReadConversation")
def read_conversation(request: Request, conversation_id: str):
    _query(request, ())
    response = _service(request, "conversations").read(request.state.caller, _id(conversation_id))
    return success(response, *request.state.meta)


@router.get("/conversations/{conversation_id}/messages", operation_id="internalListConversationMessages")
def read_messages(request: Request, conversation_id: str):
    query = _query(request, ("cursor", "limit"))
    response = _service(request, "history").read(request.state.caller, _id(conversation_id),
        cursor=query.get("cursor"), limit=_integer(query.get("limit", 20)))
    return success(response, *request.state.meta)


@router.post("/conversations/{conversation_id}/messages", operation_id="internalCreateConversationMessage")
def create_message(request: Request, conversation_id: str):
    _query(request, ())
    data = parse_message_input(read_strict_json(request.state.raw_body))
    turns, caller = _service(request, "turns"), request.state.caller
    if not _wants_stream(request):
        return success(turns.submit(caller, _id(conversation_id), data), *request.state.meta)
    begun = turns.begin(caller, _id(conversation_id), data)  # guard errors stay JSON
    if isinstance(begun, ServiceResponse):
        body = stream_turn(begun.data, None)
    else:
        body = stream_turn(begun.response.model_dump(mode="json"),
                           lambda on_event: turns.finish(caller, begun, on_event).model_dump(mode="json"))
    return StreamingResponse(body, media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/responses/{response_id}", operation_id="internalReadResponse")
def read_response(request: Request, response_id: str):
    _query(request, ())
    return success(_service(request, "responses").read(request.state.caller, _id(response_id)), *request.state.meta)


@router.post("/responses/{response_id}/cancel", operation_id="internalCancelResponse")
def cancel_response(request: Request, response_id: str):
    _query(request, ())
    return success(_service(request, "responses").cancel(request.state.caller, _id(response_id)),
                   *request.state.meta)


@router.post("/conversations/{conversation_id}:end", operation_id="internalEndConversation")
def end_conversation(request: Request, conversation_id: str):
    _query(request, ())
    data = _input(request, EndConversationInput)
    response = _service(request, "lifecycle").end(request.state.caller, _id(conversation_id), data)
    return success(response, *request.state.meta)


@router.get("/activities/{activity_id}/result", operation_id="internalReadActivityResult")
def read_result(request: Request, activity_id: str):
    query = _query(request, ("expected_result_revision",))
    response = _service(request, "results").read_result(request.state.caller, _id(activity_id),
        expected_result_revision=_integer(query.get("expected_result_revision")))
    return success(response, *request.state.meta)


@router.get("/results/{result_id}/share-card", operation_id="internalReadShareCard")
def read_share_card(request: Request, result_id: str):
    query = _query(request, ("expected_result_revision",))
    response = _service(request, "results").read_share_card(request.state.caller, _id(result_id),
        expected_result_revision=_integer(query.get("expected_result_revision")))
    return success(response, *request.state.meta)
