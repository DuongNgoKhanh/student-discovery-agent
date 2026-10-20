"""Safe transport metadata is generated anew, never persisted in outcomes."""
from datetime import datetime

from starlette.responses import JSONResponse

from agent_runtime.sessions.errors import RuntimeSessionError
from agent_runtime.sessions.schemas.common import ServiceResponse


def _meta(request_id, trace_id, timestamp, replayed=False):
    return {"request_id": request_id, "trace_id": trace_id,
            "timestamp": timestamp.isoformat().replace("+00:00", "Z"), "replayed": replayed}


def success(response: ServiceResponse, request_id: str, trace_id: str, timestamp: datetime) -> JSONResponse:
    return JSONResponse(status_code=response.status, headers={"Cache-Control": "no-store"}, content={
        "status": response.status, "success": True, "data": response.data, "error": None,
        "meta": _meta(request_id, trace_id, timestamp, response.replayed)})


def failure(error: RuntimeSessionError, request_id: str, trace_id: str, timestamp: datetime) -> JSONResponse:
    return JSONResponse(status_code=error.status, headers={"Cache-Control": "no-store"}, content={
        "status": error.status, "success": False, "data": None,
        "error": {"code": error.code, "message": error.code, "retryable": error.status == 503,
                  "details": error.details if error.status == 409 else None},
        "meta": _meta(request_id, trace_id, timestamp)})
