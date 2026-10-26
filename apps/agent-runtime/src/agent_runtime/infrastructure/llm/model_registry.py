"""Map a snapshot's model provider to a configured adapter; secrets come from runtime settings only."""
from agent_runtime.agent.model import ModelPort, UnconfiguredModel
from agent_runtime.config.settings import settings
from agent_runtime.infrastructure.http.logging import logger
from agent_runtime.infrastructure.llm.agno_model import AgnoChatModel
from agent_runtime.infrastructure.llm.gemini_model import GeminiChatModel
from agent_runtime.infrastructure.llm.openai_model import OpenAIChatModel

# provider -> (adapter, settings field holding its API key); keys must match catalog.SUPPORTED_MODEL_PROVIDERS.
MODEL_PROVIDERS: dict[str, tuple[type[AgnoChatModel], str]] = {
    "gemini": (GeminiChatModel, "GOOGLE_API_KEY"),
    "openai": (OpenAIChatModel, "OPENAI_API_KEY"),
}


def build_model_port(provider: str, *, config=settings) -> ModelPort:
    entry = MODEL_PROVIDERS.get(provider)
    if entry is None:
        logger.error("unknown model provider: {}", provider)
        return UnconfiguredModel()
    adapter, key_field = entry
    api_key = getattr(config, key_field, "")
    if not api_key:
        logger.warning("model provider {} is not configured: {} is empty", provider, key_field)
        return UnconfiguredModel()
    return adapter(api_key, proxy_url=config.PROXY_URL)
