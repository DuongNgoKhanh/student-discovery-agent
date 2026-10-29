"""OpenAI-compatible /embeddings (vLLM, LiteLLM proxy) behind EmbeddingPort; task prefixes are per model."""
import time
from collections.abc import Callable, Sequence

import httpx

from agent_runtime.knowledge.embedding import DocumentText, EmbeddingUnavailable

RETRY_BACKOFF_SECONDS = 0.5


class OpenAICompatibleEmbedding:
    def __init__(self, api_key: str, base_url: str, model: str, *, remote_model: str, dimensions: int,
                 document_prefix: str = "", query_prefix: str = "", timeout_ms: int = 10000, max_retries: int = 2,
                 batch_size: int = 32, proxy_url: str | None = None, client: httpx.Client | None = None,
                 sleep: Callable[[float], None] = time.sleep):
        self.model = model
        self._remote_model = remote_model
        self._dimensions = dimensions
        self._document_prefix = document_prefix
        self._query_prefix = query_prefix
        self._max_retries = max_retries
        self._batch_size = batch_size
        self._sleep = sleep
        self._client = client or httpx.Client(base_url=base_url.rstrip("/") + "/", timeout=timeout_ms / 1000,
                                              headers={"Authorization": f"Bearer {api_key}"}, proxy=proxy_url)

    def _document(self, item: DocumentText) -> str:
        parts = [part for part in (item.title, item.heading_path, item.text) if part]
        return self._document_prefix + "\n".join(parts)

    def embed_documents(self, items: Sequence[DocumentText]) -> list[list[float]] | EmbeddingUnavailable:
        vectors: list[list[float]] = []
        for start in range(0, len(items), self._batch_size):
            batch = self._embed([self._document(item) for item in items[start:start + self._batch_size]])
            if isinstance(batch, EmbeddingUnavailable):
                return batch
            vectors.extend(batch)
        return vectors

    def embed_query(self, text: str) -> list[float] | EmbeddingUnavailable:
        result = self._embed([self._query_prefix + text])
        return result if isinstance(result, EmbeddingUnavailable) else result[0]

    def _embed(self, texts: list[str]) -> list[list[float]] | EmbeddingUnavailable:
        for attempt in range(self._max_retries + 1):
            try:
                response = self._client.post("embeddings", json={"model": self._remote_model, "input": texts})
            except httpx.TimeoutException:
                reason, retryable = "timeout", True
            except httpx.HTTPError:
                reason, retryable = "provider_error", True
            else:
                status = response.status_code
                if status < 400:
                    return self._vectors(response, len(texts))
                reason = "rate_limited" if status == 429 else "provider_error"
                retryable = status == 429 or status >= 500
            if not retryable or attempt == self._max_retries:
                return EmbeddingUnavailable(reason)
            self._sleep(RETRY_BACKOFF_SECONDS * 2 ** attempt)
        return EmbeddingUnavailable("provider_error")

    def _vectors(self, response: httpx.Response, count: int) -> list[list[float]] | EmbeddingUnavailable:
        try:
            data = sorted(response.json()["data"], key=lambda item: item["index"])
            vectors = [[float(value) for value in item["embedding"]] for item in data]
        except (ValueError, KeyError, TypeError):
            return EmbeddingUnavailable("invalid_response")
        if len(vectors) != count or any(len(vector) != self._dimensions for vector in vectors):
            return EmbeddingUnavailable("invalid_response")
        return vectors
