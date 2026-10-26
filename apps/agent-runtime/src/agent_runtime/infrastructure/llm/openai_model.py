"""OpenAI Chat Completions dialect: one tool message per result, keyed by tool_call_id."""
from functools import cached_property

import httpx
from agno.models.openai import OpenAIChat

from agent_runtime.agent.model import ModelSettings
from agent_runtime.infrastructure.llm.agno_model import AgnoChatModel


class OpenAIChatModel(AgnoChatModel):
    default_factory = OpenAIChat

    @cached_property
    def _http_client(self) -> httpx.Client | None:
        """One pooled proxy client per adapter; without a proxy agno shares its global client."""
        return httpx.Client(proxy=self._proxy_url) if self._proxy_url else None

    def build(self, settings: ModelSettings) -> OpenAIChat:
        # The port owns retries; the SDK's own retries would multiply max_retries.
        return self._factory(id=settings.model_id, api_key=self._api_key, temperature=settings.temperature,
                             max_completion_tokens=settings.max_output_tokens, timeout=settings.timeout_ms / 1000,
                             max_retries=0, http_client=self._http_client)
