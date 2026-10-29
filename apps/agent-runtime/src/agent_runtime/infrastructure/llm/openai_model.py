"""OpenAI Chat Completions dialect: one tool message per result, keyed by tool_call_id."""
from functools import cached_property

import httpx
from agno.models.openai import OpenAIChat

from agent_runtime.agent.model import ModelSettings
from agent_runtime.infrastructure.llm.agno_model import AgnoChatModel


class OpenAIChatModel(AgnoChatModel):
    default_factory = OpenAIChat
    request_options: dict = {}  # extra factory kwargs a compatible server needs

    def __init__(self, api_key: str, *, base_url: str | None = None, **kwargs):
        super().__init__(api_key, **kwargs)
        self._base_url = base_url

    @cached_property
    def _http_client(self) -> httpx.Client | None:
        """One pooled proxy client per adapter; without a proxy agno shares its global client."""
        return httpx.Client(proxy=self._proxy_url) if self._proxy_url else None

    def build(self, settings: ModelSettings) -> OpenAIChat:
        # The port owns retries; the SDK's own retries would multiply max_retries.
        endpoint = {"base_url": self._base_url} if self._base_url else {}
        return self._factory(id=settings.model_id, api_key=self._api_key, temperature=settings.temperature,
                             max_completion_tokens=settings.max_output_tokens, timeout=settings.timeout_ms / 1000,
                             max_retries=0, http_client=self._http_client, **endpoint, **self.request_options)

    def _merge_tool_calls(self, chunks: list) -> list[dict]:
        """OpenAI streams fragments keyed by index; agno's own merger aliases one dict across indices."""
        merged: dict[int, dict] = {}
        for chunk in chunks:
            for part in chunk:
                entry = merged.setdefault(part.index or 0, {"id": None, "type": "function",
                                                           "function": {"name": "", "arguments": ""}})
                entry["id"] = part.id or entry["id"]
                if part.function is not None:
                    entry["function"]["name"] += part.function.name or ""
                    entry["function"]["arguments"] += part.function.arguments or ""
        return [merged[index] for index in sorted(merged)]
