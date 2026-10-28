"""Knowledge embedding models a KB may pick (Studio's KNOWLEDGE_EMBEDDING_MODELS lists a subset of these ids).

Ids are stored on knowledge.knowledge_bases and knowledge.embeddings, so renaming one orphans its vectors.
Prefixes follow each model card; vLLM models are served under the proxy's `hosted_vllm/` names.
"""
from dataclasses import dataclass
from typing import Literal

from agent_runtime.infrastructure.http.logging import logger
from agent_runtime.knowledge.embedding import EmbeddingPort


@dataclass(frozen=True)
class EmbeddingSpec:
    provider: Literal["gemini", "vllm"]
    remote_model: str
    dimensions: int
    document_prefix: str = ""
    query_prefix: str = ""


EMBEDDING_MODELS: dict[str, EmbeddingSpec] = {
    # Task prefixes are built into GeminiEmbedding.
    "gemini-embedding-2": EmbeddingSpec("gemini", "gemini-embedding-2", 768),
    "nomic-embed-text-v1.5": EmbeddingSpec("vllm", "hosted_vllm/nomic-ai/nomic-embed-text-v1.5", 768,
                                           "search_document: ", "search_query: "),
    "multilingual-e5-large": EmbeddingSpec("vllm", "hosted_vllm/intfloat/multilingual-e5-large", 1024,
                                           "passage: ", "query: "),
}


def _build(model: str, spec: EmbeddingSpec, settings, options: dict) -> EmbeddingPort | None:
    if spec.provider == "gemini":
        if not settings.GOOGLE_API_KEY:
            return None
        from agent_runtime.infrastructure.llm.gemini_embedding import GeminiEmbedding
        return GeminiEmbedding(settings.GOOGLE_API_KEY, spec.remote_model, proxy_url=settings.PROXY_URL, **options)
    if not settings.VLLM_API_KEY or not settings.VLLM_BASE_URL:
        return None
    from agent_runtime.infrastructure.llm.openai_embedding import OpenAICompatibleEmbedding
    return OpenAICompatibleEmbedding(settings.VLLM_API_KEY, settings.VLLM_BASE_URL, model,
                                     remote_model=spec.remote_model, dimensions=spec.dimensions,
                                     document_prefix=spec.document_prefix, query_prefix=spec.query_prefix,
                                     proxy_url=settings.PROXY_URL, **options)


def build_embedding_ports(settings, *, timeout_ms: int | None = None, max_retries: int | None = None
                          ) -> dict[str, EmbeddingPort]:
    """Configured ports by model id. Indexer defaults unless overridden; the query path passes a tight timeout and
    no retries. A listed model that is unknown or lacks credentials is left out, so its KBs search by keyword."""
    options = {}
    if timeout_ms is not None:
        options["timeout_ms"] = timeout_ms
    if max_retries is not None:
        options["max_retries"] = max_retries
    ports: dict[str, EmbeddingPort] = {}
    for model in settings.KNOWLEDGE_EMBEDDING_MODEL_IDS:
        spec = EMBEDDING_MODELS.get(model)
        if spec is None:
            logger.error("unknown knowledge embedding model: {}", model)
            continue
        port = _build(model, spec, settings, options)
        if port is None:
            logger.warning("knowledge embedding model {} is not configured: {} credentials are empty", model,
                           spec.provider)
            continue
        ports[model] = port
    return ports
