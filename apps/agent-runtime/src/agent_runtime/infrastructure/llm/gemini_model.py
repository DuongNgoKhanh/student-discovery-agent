"""Gemini dialect: thought signatures replay with their tool calls; parallel tool results form one turn."""
from agno.models.google import Gemini
from google.genai import types

from agent_runtime.agent.model import ModelSettings
from agent_runtime.infrastructure.llm.agno_model import AgnoChatModel


class GeminiChatModel(AgnoChatModel):
    default_factory = Gemini
    replay_keys = ("thought_signature",)
    merge_tool_results = True

    def build(self, settings: ModelSettings) -> Gemini:
        client_args = {"proxy": self._proxy_url} if self._proxy_url else None
        http_options = types.HttpOptions(timeout=settings.timeout_ms, client_args=client_args)  # milliseconds
        # Agent turns are short tool loops: thinking only adds latency and spends the output budget, sometimes leaving
        # an empty reply. "minimal" is the lowest level Gemini 3 accepts (thinking_budget=0 is rejected by flash-lite).
        return self._factory(id=settings.model_id, api_key=self._api_key, temperature=settings.temperature,
                             max_output_tokens=settings.max_output_tokens, thinking_level="minimal",
                             client_params={"http_options": http_options})
