import logging

from agent_runtime.knowledge.embedding import EmbeddingUnavailable
from agent_runtime.knowledge.retrieval import PgKnowledge


class Rejected:
    model = "vllm/e5"

    def embed_query(self, text):
        return EmbeddingUnavailable("provider_error", "http 401")


class Exploding:
    model = "vllm/e5"

    def embed_query(self, text):
        raise RuntimeError("socket closed")


def test_a_rejected_key_says_why_search_degraded(caplog):
    with caplog.at_level(logging.WARNING):
        result = PgKnowledge(None, {"vllm/e5": Rejected()})._embed_query("vllm/e5", "học phí")
    assert result == EmbeddingUnavailable("provider_error", "http 401")
    assert "falls back to keywords: model=vllm/e5 reason=provider_error http 401" in caplog.text


def test_unconfigured_model_and_provider_exception_are_logged(caplog):
    with caplog.at_level(logging.WARNING):
        knowledge = PgKnowledge(None, {"vllm/e5": Exploding()})
        assert knowledge._embed_query("gemini-embedding-2", "x") == EmbeddingUnavailable("not_configured")
        assert knowledge._embed_query("vllm/e5", "x") == EmbeddingUnavailable("provider_error", "RuntimeError")
    assert "model=gemini-embedding-2 reason=not_configured" in caplog.text
    assert "model=vllm/e5 reason=provider_error RuntimeError" in caplog.text
    assert "socket closed" not in caplog.text
