import importlib
import sys

import httpx
import pytest


def test_adapters_import_without_outbound_http(monkeypatch):
    def blocked(*args, **kwargs):
        pytest.fail("outbound HTTP attempted during import/startup")

    monkeypatch.setattr(httpx.Client, "send", blocked)
    monkeypatch.setattr(httpx.AsyncClient, "send", blocked)
    for mod in [m for m in sys.modules if m.startswith("agent_runtime")]:
        del sys.modules[mod]

    providers = importlib.import_module("agent_runtime.infrastructure.llm.providers")
    copilot = importlib.import_module("agent_runtime.infrastructure.llm.copilot")
    logging_mod = importlib.import_module("agent_runtime.infrastructure.http.logging")
    main = importlib.import_module("agent_runtime.main")

    for name in ("GeminiCustom", "GeminiEmbeddingsCustom", "embed_query", "embed_documents", "chat_complete"):
        assert hasattr(providers, name), name
    assert hasattr(copilot, "CopilotChat")
    assert hasattr(logging_mod, "logger") and callable(logging_mod.setup_logging)
    assert main.app is not None
