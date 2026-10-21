"""Safe transport metadata is generated anew, never persisted in outcomes."""
from datetime import datetime

from starlette.responses import JSONResponse

from agent_runtime.api.error_codes import canonical_error_code
from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import ServiceResponse

_MESSAGES = {
    "AUTH_CALLER_CONTEXT_INVALID": "Authentication context is invalid.",
    "AUTH_CALLER_CONTEXT_MISSING": "Authentication context is required.",
    "AUTH_TOKEN_INVALID": "Authentication token is invalid.",
    "AUTH_TOKEN_MISSING": "Authentication token is required.",
    "AUTH_TOKEN_EXPIRED": "Authentication token has expired.",
    "AUTHZ_FORBIDDEN": "You do not have permission to perform this action.",
    "RES_NOT_FOUND": "The requested resource was not found.",
    "RES_CONVERSATION_ENDED": "This conversation has ended.",
    "RES_CONVERSATION_EXPIRED": "This conversation has expired.",
    "SYS_UNAVAILABLE": "The service is temporarily unavailable.",
    "SYS_INTERNAL_ERROR": "Internal server error",
    "VAL_INVALID_INPUT": "The request input is invalid.",
    "VAL_INVALID_REQUEST": "The request is invalid.",
}


def _meta(request_id, trace_id, timestamp, replayed=False):
    return {"request_id": request_id, "trace_id": trace_id,
            "timestamp": timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"), "replayed": replayed}


def success(response: ServiceResponse, request_id: str, trace_id: str, timestamp: datetime) -> JSONResponse:
    return JSONResponse(status_code=response.status, headers={"Cache-Control": "no-store", "X-Request-ID": request_id, "X-Trace-ID": trace_id}, content={
        "status": response.status, "success": True, "message": None, "data": response.data, "error": None,
        "meta": _meta(request_id, trace_id, timestamp, response.replayed)})


def failure(error: RuntimeSessionError, request_id: str, trace_id: str, timestamp: datetime) -> JSONResponse:
    code = canonical_error_code(error.code)
    if code is None:
        error = RuntimeSessionError(500, "SYS_INTERNAL_ERROR")
        code = "SYS_INTERNAL_ERROR"
    headers = {"Cache-Control": "no-store", "X-Request-ID": request_id, "X-Trace-ID": trace_id}
    details = error.details if error.status == 409 else None
    if error.status == 503:
        headers["Retry-After"] = "5"
        kind = (error.details or {}).get("kind")
        details = {"kind": kind if kind in {"not_configured", "dependency_down"} else "dependency_down"}
    message = _MESSAGES.get(code, "The request could not be completed.")
    return JSONResponse(status_code=error.status, headers=headers, content={
        "status": error.status, "success": False, "message": message, "data": None,
        "error": {"code": code, **({"legacy_code": error.code} if code != error.code else {}),
                  "message": message,
                  "retryable": error.status == 503,
                  "details": details},
        "meta": _meta(request_id, trace_id, timestamp)})
