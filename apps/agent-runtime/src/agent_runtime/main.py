from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from agent_runtime.api import health
from agent_runtime.api.internal.dependencies import InternalBoundary, RuntimeContainer, build_runtime
from agent_runtime.api.internal.envelopes import failure
from agent_runtime.api.internal.routes import router
from agent_runtime.sessions.errors import RuntimeSessionError


def create_app(
    runtime: RuntimeContainer | None = None,
    readiness_probe: Callable[[RuntimeContainer | None], dict] | Callable[[RuntimeContainer | None], Awaitable[dict]] | None = None,
) -> FastAPI:
    if runtime is None:
        try:
            from agent_runtime.config.settings import Settings

            runtime = build_runtime(Settings())
        except Exception:
            runtime = None
    app = FastAPI(title="Agent Runtime", redirect_slashes=False)
    app.state.runtime = runtime
    if readiness_probe is not None:
        app.state.readiness_probe = readiness_probe
    app.include_router(health.router)
    app.include_router(router)
    app.add_middleware(InternalBoundary, runtime=runtime)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException):
        if hasattr(request.state, "meta"):
            code = {404: "RESOURCE_NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(error.status_code, "INVALID_REQUEST")
            return failure(RuntimeSessionError(error.status_code, code), *request.state.meta)
        return JSONResponse(status_code=error.status_code, content={"detail": error.detail}, headers=error.headers)

    @app.exception_handler(RequestValidationError)
    async def input_error(request: Request, error: RequestValidationError):
        return failure(RuntimeSessionError(422, "INVALID_INPUT"), *request.state.meta)

    return app


app = create_app()
