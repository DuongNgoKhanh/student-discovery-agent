import importlib
import sys

from fastapi.testclient import TestClient

PRODUCT_ENV = ["DATABASE_URL", "POSTGRES_SERVER", "REDIS_HOST", "MINIO_ENDPOINT", "SECRET_KEY", "NEO4J_URI"]


def test_health_without_product_dependencies(monkeypatch):
    for name in PRODUCT_ENV:
        monkeypatch.delenv(name, raising=False)
    for mod in [m for m in sys.modules if m.startswith("agent_runtime.main")]:
        del sys.modules[mod]
    main = importlib.import_module("agent_runtime.main")

    with TestClient(main.create_app()) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}

    paths = set(main.create_app().openapi()["paths"])
    allowed = {
        "/api/v1/internal/conversations": {"post"},
        "/api/v1/internal/conversations/{conversation_id}": {"get"},
        "/api/v1/internal/conversations/{conversation_id}/messages": {"get"},
        "/api/v1/internal/conversations/{conversation_id}:end": {"post"},
        "/api/v1/internal/activities/{activity_id}/result": {"get"},
        "/api/v1/internal/results/{result_id}/share-card": {"get"},
    }
    schema = main.create_app().openapi()["paths"]
    assert {path: set(operations) for path, operations in schema.items() if path != "/health"} == allowed
    assert not any(p.startswith(("/auth", "/users", "/api/v1/auth", "/api/v1/users")) for p in paths)
