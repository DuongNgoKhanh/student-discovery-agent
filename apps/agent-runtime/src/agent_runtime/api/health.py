import inspect
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

if TYPE_CHECKING:
    from agent_runtime.api.internal.dependencies import RuntimeContainer

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/healthz", include_in_schema=False)
def healthz() -> dict[str, str]:
    return {"status": "ok"}


def _overall(checks: dict[str, str]) -> str:
    if "down" in checks.values():
        return "down"
    if "degraded" in checks.values():
        return "degraded"
    return "ok"


def runtime_readiness(runtime: "RuntimeContainer | None") -> dict[str, Any]:
    if runtime is None:
        return {"status": "down", "checks": {"db": "down", "product": "down", "engine": "down"}}

    if runtime.engine is None:
        db_status = "down"
    else:
        try:
            with runtime.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            db_status = "ok"
        except Exception:
            db_status = "down"

    product_status = "ok" if runtime.product_ready else "degraded"
    engine_impl = getattr(getattr(getattr(runtime.turns, "handler", None), "engine", None), "registry", None)
    engine_status = "ok" if engine_impl else ("down" if runtime.turns is None else "degraded")
    checks = {"db": db_status, "product": product_status, "engine": engine_status}
    return {"status": _overall(checks), "checks": checks}


def readiness_response(snapshot: dict[str, Any]) -> JSONResponse:
    return JSONResponse(
        status_code=200 if snapshot["status"] == "ok" else 503,
        content=snapshot,
        headers={"cache-control": "no-store"},
    )


@router.get("/ready", include_in_schema=False)
async def ready(request: Request) -> JSONResponse:
    probe = getattr(request.app.state, "readiness_probe", runtime_readiness)
    snapshot = probe(getattr(request.app.state, "runtime", None))
    if inspect.isawaitable(snapshot):
        snapshot = await snapshot
    return readiness_response(snapshot)
