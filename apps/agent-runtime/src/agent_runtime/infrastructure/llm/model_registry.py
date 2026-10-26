"""Map a snapshot's model provider to a configured adapter; secrets come from runtime settings only."""
from agent_runtime.agent.model import ModelPort, UnconfiguredModel
from agent_runtime.config.settings import settings
from agent_runtime.infrastructure.llm.gemini_model import GeminiChatModel


def build_model_port(provider: str, *, config=settings) -> ModelPort:
    if provider == "gemini" and config.GOOGLE_API_KEY:
        return GeminiChatModel(config.GOOGLE_API_KEY, proxy_url=config.PROXY_URL)
    return UnconfiguredModel()
