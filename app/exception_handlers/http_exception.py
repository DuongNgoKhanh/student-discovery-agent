from typing import Any, Optional

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from app.modules.common.utils.logging import logger
from app.modules.common.utils.response import error_response, get_request_id, get_trace_id

# ============================================================================
# Custom Exception inheriting from HTTPException
# ============================================================================


class AppException(HTTPException):
    """
    Custom exception class that inherits from FastAPI's HTTPException.
    Supports status_code, error_code, message, and retryable in the response.
    """

    def __init__(
        self,
        status_code: int,
        message: str,
        error_code: Optional[str] = None,
        retryable: Optional[bool] = None,
        details: Optional[dict] = None,
        data: Optional[Any] = None,
        headers: Optional[dict] = None,
    ):
        self.message = message
        self.error_code = error_code
        self.retryable = retryable
        self.details = details
        self.data = data
        detail = {
            "message": message,
            "data": data,
        }
        super().__init__(status_code=status_code, detail=detail, headers=headers)


# ============================================================================
# Exception Handlers
# ============================================================================


async def custom_http_exception_handler(request: Request, exc: HTTPException):
    """
    Global HTTP exception handler that logs and formats all HTTPException responses.
    Handles authentication failures and AppException with structured error details.

    Response format:
    {
        "status": 400,
        "success": false,
        "data": null,
        "error": {
            "code": "SYS_401",
            "message": "error message",
            "retryable": false,
            "details": {...}
        },
        "meta": {
            "request_id": "...",
            "trace_id": "...",
            "timestamp": "2025-10-13T10:00:00Z"
        }
    }
    """
    request_id = get_request_id()
    trace_id = get_trace_id()

    # Extract from request state if middleware set them
    if hasattr(request.state, "request_id"):
        request_id = request.state.request_id
    if hasattr(request.state, "trace_id"):
        trace_id = request.state.trace_id

    # Handle authentication failures
    if exc.status_code == 401:
        logger.warning(
            f"Authentication failed: {request.method} {request.url.path}",
            extra={
                "request_id": request_id,
                "trace_id": trace_id,
            },
        )
        response = error_response(
            status_code=401,
            error_code="AUTH_INVALID_TOKEN",
            error_message="You are not logged in or your session has expired. Please log in again.",
            retryable=False,
            request_id=request_id,
            trace_id=trace_id,
        )
        return JSONResponse(
            status_code=401,
            content=response.model_dump(),
        )

    # Extract message, error_code, retryable from AppException or generic detail
    message = str(exc.detail)
    error_code = None
    retryable = None
    details = None
    data = None

    if isinstance(exc, AppException):
        message = exc.message
        error_code = exc.error_code
        retryable = exc.retryable
        details = exc.details
        data = exc.data
    elif isinstance(exc.detail, dict):
        message = exc.detail.get("message", str(exc.detail))
        error_code = exc.detail.get("error_code")
        details = exc.detail.get("details") or exc.detail.get("current_state")
        data = exc.detail.get("data")

    logger.error(
        f"HTTP Exception: {exc.status_code} - {request.method} {request.url.path}",
        extra={
            "status_code": exc.status_code,
            "message": str(message),
            "path": request.url.path,
            "request_id": request_id,
            "trace_id": trace_id,
        },
    )

    response = error_response(
        status_code=exc.status_code,
        error_code=error_code,
        error_message=str(message),
        retryable=retryable,
        details=details,
        data=data,
        request_id=request_id,
        trace_id=trace_id,
    )

    return JSONResponse(
        status_code=exc.status_code,
        content=response.model_dump(),
    )


async def general_exception_handler(request: Request, exc: Exception):
    """
    General exception handler for unhandled exceptions.
    Converts any uncaught exception to a standardized 500 error response.

    Response format (500 Internal Server Error):
    {
        "status": 500,
        "success": false,
        "data": null,
        "error": {
            "code": "SYS_500",
            "message": "Internal Server Error",
            "retryable": true,
            "details": {"exception": "..."}
        },
        "meta": {...}
    }
    """
    request_id = get_request_id()
    trace_id = get_trace_id()

    if hasattr(request.state, "request_id"):
        request_id = request.state.request_id
    if hasattr(request.state, "trace_id"):
        trace_id = request.state.trace_id

    # Log the unhandled exception
    logger.exception(
        f"Unhandled exception in {request.method} {request.url.path}: {type(exc).__name__}",
        extra={
            "request_id": request_id,
            "trace_id": trace_id,
            "exception_type": type(exc).__name__,
        },
    )

    # Create error response
    response = error_response(
        status_code=500,
        error_code="SYS_INTERNAL_ERROR",
        error_message="Internal Server Error",
        retryable=True,
        details={"exception": type(exc).__name__},
        request_id=request_id,
        trace_id=trace_id,
    )

    return JSONResponse(
        status_code=500,
        content=response.model_dump(),
    )
