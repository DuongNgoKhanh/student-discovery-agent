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
    assert not any(p.startswith(("/api/v1", "/auth", "/users")) for p in paths)
