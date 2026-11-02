"""vLLM (or a LiteLLM proxy in front of it) over the OpenAI Chat Completions dialect.

OpenAILike keeps the `system` role (OpenAIChat sends `developer`, which open-model chat templates reject), and
Qwen3-style thinking is switched off: like Gemini's minimal thinking, it only adds latency to short tool loops.
"""
from agno.models.openai.like import OpenAILike

from agent_runtime.infrastructure.llm.openai_model import OpenAIChatModel


class VllmChatModel(OpenAIChatModel):
    default_factory = OpenAILike
    request_options = {"extra_body": {"chat_template_kwargs": {"enable_thinking": False}}}
