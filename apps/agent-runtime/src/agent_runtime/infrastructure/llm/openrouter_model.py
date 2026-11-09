"""OpenRouter adapter over the OpenAI Chat Completions dialect."""
from agno.models.openai.like import OpenAILike

from agent_runtime.infrastructure.llm.openai_model import OpenAIChatModel


class OpenRouterChatModel(OpenAIChatModel):
    default_factory = OpenAILike
    request_options = {
        "extra_headers": {
            "HTTP-Referer": "https://github.com/localis/student-discovery-agent",
            "X-Title": "Student Discovery Agent",
        }
    }
