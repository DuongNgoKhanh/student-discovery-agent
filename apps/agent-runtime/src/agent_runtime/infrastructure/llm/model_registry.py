"""Map a snapshot's model provider to a configured adapter; secrets come from runtime settings only."""
from agent_runtime.agent.model import ModelPort, UnconfiguredModel
from agent_runtime.config.settings import settings
from agent_runtime.infrastructure.http.logging import logger
from agent_runtime.infrastructure.llm.agno_model import AgnoChatModel
from agent_runtime.infrastructure.llm.gemini_model import GeminiChatModel
from agent_runtime.infrastructure.llm.openai_model import OpenAIChatModel
from agent_runtime.infrastructure.llm.vllm_model import VllmChatModel

# provider -> (adapter, settings field holding its API key, settings field holding its base URL or None);
# keys must match catalog.SUPPORTED_MODEL_PROVIDERS.
MODEL_PROVIDERS: dict[str, tuple[type[AgnoChatModel], str, str | None]] = {
    "gemini": (GeminiChatModel, "GOOGLE_API_KEY", None),
    "openai": (OpenAIChatModel, "OPENAI_API_KEY", None),
    "vllm": (VllmChatModel, "VLLM_API_KEY", "VLLM_BASE_URL"),
}


def build_model_port(provider: str, *, config=settings) -> ModelPort:
    entry = MODEL_PROVIDERS.get(provider)
    if entry is None:
        logger.error("unknown model provider: {}", provider)
        return UnconfiguredModel()
    adapter, key_field, url_field = entry
    required = (key_field, url_field) if url_field else (key_field,)
    if empty := [field for field in required if not getattr(config, field, "")]:
        logger.warning("model provider {} is not configured: {} is empty", provider, ", ".join(empty))
        return UnconfiguredModel()
    endpoint = {"base_url": getattr(config, url_field)} if url_field else {}
    return adapter(getattr(config, key_field), proxy_url=config.PROXY_URL, **endpoint)
