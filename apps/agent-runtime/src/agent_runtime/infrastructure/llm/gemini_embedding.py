"""gemini-embedding-2 behind EmbeddingPort: task instructions are text prefixes (the model rejects task_type)."""
import time
from collections.abc import Callable, Sequence

import httpx
from google.genai import errors, types

from agent_runtime.knowledge.embedding import EMBEDDING_DIMENSIONS, DocumentText, EmbeddingUnavailable

RETRY_BACKOFF_SECONDS = 0.5


def _document(item: DocumentText) -> str:
    content = f"{item.heading_path}\n{item.text}" if item.heading_path else item.text
    return f"title: {item.title or 'none'} | text: {content}"


class GeminiEmbedding:
    def __init__(self, api_key: str, model: str = "gemini-embedding-2", *, timeout_ms: int = 10000,
                 max_retries: int = 2, batch_size: int = 50, proxy_url: str | None = None, client=None,
                 sleep: Callable[[float], None] = time.sleep):
        self.model = model
        self._max_retries = max_retries
        self._batch_size = batch_size
        self._sleep = sleep
        if client is None and api_key:
            from google import genai

            transport = {"transport": httpx.HTTPTransport(proxy=proxy_url)} if proxy_url else None
            client = genai.Client(api_key=api_key, http_options=types.HttpOptions(
                timeout=timeout_ms, client_args=transport))
        self._client = client

    def embed_documents(self, items: Sequence[DocumentText]) -> list[list[float]] | EmbeddingUnavailable:
        vectors: list[list[float]] = []
        for start in range(0, len(items), self._batch_size):
            batch = self._embed([_document(item) for item in items[start:start + self._batch_size]])
            if isinstance(batch, EmbeddingUnavailable):
                return batch
            vectors.extend(batch)
        return vectors

    def embed_query(self, text: str) -> list[float] | EmbeddingUnavailable:
        result = self._embed([f"task: search result | query: {text}"])
        return result if isinstance(result, EmbeddingUnavailable) else result[0]

    def _embed(self, texts: list[str]) -> list[list[float]] | EmbeddingUnavailable:
        if self._client is None:
            return EmbeddingUnavailable("not_configured")
        config = types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMENSIONS)
        for attempt in range(self._max_retries + 1):
            try:
                # One Content per text: gemini-embedding-2 treats a list of plain strings as ONE multi-part input.
                contents = [types.Content(parts=[types.Part(text=item)]) for item in texts]
                response = self._client.models.embed_content(model=self.model, contents=contents, config=config)
            except errors.APIError as error:
                reason = "rate_limited" if error.code == 429 else "provider_error"
                retryable = error.code is None or error.code == 429 or error.code >= 500
            except httpx.TimeoutException:
                reason, retryable = "timeout", True
            except httpx.HTTPError:
                reason, retryable = "provider_error", True
            else:
                vectors = [list(item.values or []) for item in response.embeddings or []]
                if len(vectors) != len(texts) or any(len(vector) != EMBEDDING_DIMENSIONS for vector in vectors):
                    return EmbeddingUnavailable("invalid_response")
                return vectors
            if not retryable or attempt == self._max_retries:
                return EmbeddingUnavailable(reason)
            self._sleep(RETRY_BACKOFF_SECONDS * 2 ** attempt)
        return EmbeddingUnavailable("provider_error")


def build_embedding_port(settings, *, timeout_ms: int | None = None, max_retries: int | None = None) -> GeminiEmbedding:
    """Indexer defaults unless overridden; the query path passes a tight timeout and no retries."""
    options = {}
    if timeout_ms is not None:
        options["timeout_ms"] = timeout_ms
    if max_retries is not None:
        options["max_retries"] = max_retries
    return GeminiEmbedding(settings.GOOGLE_API_KEY, settings.KNOWLEDGE_EMBEDDING_MODEL,
                           proxy_url=settings.PROXY_URL, **options)
