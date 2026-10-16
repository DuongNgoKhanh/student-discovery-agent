from fastapi import FastAPI

from agent_runtime.api import health


def create_app() -> FastAPI:
    app = FastAPI(title="Agent Runtime")
    app.include_router(health.router)
    return app


app = create_app()
