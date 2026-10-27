import math
from types import SimpleNamespace

import httpx
from google.genai import errors

from agent_runtime.infrastructure.llm.gemini_embedding import GeminiEmbedding
from agent_runtime.knowledge.embedding import DocumentText, EmbeddingUnavailable, vector_literal
from agent_runtime.knowledge.fake import FakeEmbedding


class StubModels:
    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def embed_content(self, *, model, contents, config):
        self.calls.append((model, list(contents), config.output_dimensionality, config.task_type))
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        size = outcome if isinstance(outcome, int) else 768
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[0.5] * size) for _ in contents])


def adapter(*outcomes, **kwargs):
    models = StubModels(*outcomes)
    return GeminiEmbedding("key", client=SimpleNamespace(models=models), sleep=lambda _: None, **kwargs), models


def test_documents_and_queries_use_gemini_embedding_2_prefixes():
    embedding, models = adapter(768, 768)
    vectors = embedding.embed_documents([DocumentText("Trường A", "Học phí", "25 triệu"),
                                         DocumentText("", "", "Không tiêu đề")])
    assert len(vectors) == 2 and len(vectors[0]) == 768
    assert embedding.embed_query("hoc phi")[:1] == [0.5]
    assert models.calls[0] == ("gemini-embedding-2", [
        "title: Trường A | text: Học phí\n25 triệu", "title: none | text: Không tiêu đề"], 768, None)
    assert models.calls[1][1] == ["task: search result | query: hoc phi"]


def test_documents_are_sent_in_batches():
    embedding, models = adapter(768, 768, batch_size=2)
    assert len(embedding.embed_documents([DocumentText("t", "", str(i)) for i in range(3)])) == 3
    assert [len(call[1]) for call in models.calls] == [2, 1]


def test_rate_limit_and_server_errors_are_retried():
    embedding, models = adapter(errors.APIError(429, {}), errors.APIError(503, {}), 768, max_retries=2)
    assert len(embedding.embed_query("x")) == 768
    assert len(models.calls) == 3


def test_failures_are_normalised():
    assert adapter(errors.APIError(400, {}))[0].embed_query("x") == EmbeddingUnavailable("provider_error")
    assert adapter(httpx.ReadTimeout("slow"), max_retries=0)[0].embed_query("x") == EmbeddingUnavailable("timeout")
    assert adapter(12)[0].embed_query("x") == EmbeddingUnavailable("invalid_response")
    assert GeminiEmbedding("").embed_query("x") == EmbeddingUnavailable("not_configured")


def test_fake_embedding_is_deterministic_unit_length_and_word_sensitive():
    fake = FakeEmbedding()
    first, again = fake.embed_query("học phí"), fake.embed_query("học phí")
    assert first == again and math.isclose(sum(value * value for value in first), 1.0)
    related = fake.embed_documents([DocumentText("t", "", "học phí năm nhất")])[0]
    unrelated = fake.embed_documents([DocumentText("t", "", "ký túc xá")])[0]
    dot = lambda a, b: sum(x * y for x, y in zip(a, b, strict=True))  # noqa: E731
    assert dot(first, related) > dot(first, unrelated)
    assert fake.document_calls == [1, 1] and fake.query_calls == ["học phí", "học phí"]
    assert FakeEmbedding(fail_queries=True).embed_query("x") == EmbeddingUnavailable("provider_error")


def test_vector_literal():
    assert vector_literal([0.5, -1.0]) == "[0.5,-1.0]"


def test_build_embedding_port_passes_query_path_overrides_through():
    from types import SimpleNamespace

    from agent_runtime.infrastructure.llm.gemini_embedding import build_embedding_port

    settings = SimpleNamespace(GOOGLE_API_KEY="", KNOWLEDGE_EMBEDDING_MODEL="m-test", PROXY_URL=None)
    default = build_embedding_port(settings)
    tuned = build_embedding_port(settings, timeout_ms=1500, max_retries=0)
    assert (default._max_retries, tuned._max_retries, tuned.model) == (2, 0, "m-test")
