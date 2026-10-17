from collections.abc import AsyncIterator
from typing import Any, Dict, Iterator, List, Optional, Type

import httpx
from agno.exceptions import ModelProviderError
from agno.models.base import RetryableModelProviderError
from agno.models.google import Gemini
from agno.models.message import Message
from agno.models.response import ModelResponse
from agno.run.agent import RunOutput
from chonkie import GeminiEmbeddings
from google.genai import types
from google.genai.errors import ClientError, ServerError
from pydantic import BaseModel

from agent_runtime.config.settings import settings
from agent_runtime.infrastructure.http.logging import logger
from agent_runtime.infrastructure.llm.copilot import CopilotChat


class GeminiCustom(Gemini):
    """Override Gemini to add proxy support."""

    def get_client(self):
        """Returns GeminiClient with proxy configuration."""
        if self.client:
            return self.client

        client_params: Dict[str, Any] = {}
        vertexai = self.vertexai or False

        if not vertexai:
            # Standard API mode with proxy
            self.api_key = self.api_key or settings.GOOGLE_API_KEY
            if not self.api_key:
                logger.error("GOOGLE_API_KEY not set")
            client_params["api_key"] = self.api_key

            # Add proxy support
            proxy_url = settings.PROXY_URL  # Use settings.PROXY_URL if you want to make it configurable
            logger.debug(f"[GEMINI] Using proxy: {proxy_url}")
            http_options = types.HttpOptions(
                client_args={
                    "transport": httpx.HTTPTransport(proxy=proxy_url),
                },
                async_client_args={
                    "transport": httpx.AsyncHTTPTransport(proxy=proxy_url),
                },
            )
            client_params["http_options"] = http_options
        else:
            logger.info("Using Vertex AI API")
            client_params["vertexai"] = True
            project_id = self.project_id or settings.GOOGLE_CLOUD_PROJECT
            if not project_id:
                logger.error("GOOGLE_CLOUD_PROJECT not set")
            location = self.location or settings.GOOGLE_CLOUD_LOCATION
            if not location:
                logger.error("GOOGLE_CLOUD_LOCATION not set")
            client_params["project"] = project_id
            client_params["location"] = location
            if self.credentials:
                client_params["credentials"] = self.credentials

        client_params = {k: v for k, v in client_params.items() if v is not None}

        if self.client_params:
            client_params.update(self.client_params)

        from google import genai

        self.client = genai.Client(**client_params)
        return self.client

    def invoke(
        self,
        messages: List[Message],
        assistant_message: Message,
        response_format: Optional[Dict | Type[BaseModel]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str | Dict[str, Any]] = None,
        run_response: Optional[RunOutput] = None,
        compress_tool_results: bool = False,
        retry_with_guidance: bool = False,
    ) -> ModelResponse:
        """
        Invokes the model with a list of messages and returns the response.
        """
        formatted_messages, system_message = self._format_messages(messages, compress_tool_results)
        request_kwargs = self.get_request_params(system_message, response_format=response_format, tools=tools, tool_choice=tool_choice)
        try:
            assistant_message.metrics.start_timer()
            # logger.info(f"[GEMINI INVOKE] Sending request to Gemini API with {len(formatted_messages)} messages. Tools: {tools}, Tool choice: {tool_choice}, Retry with guidance: {retry_with_guidance}")
            provider_response = self.get_client().models.generate_content(
                model=self.id,
                contents=formatted_messages,
                **request_kwargs,
            )
            assistant_message.metrics.stop_timer()

            model_response = self._parse_provider_response(provider_response, response_format=response_format, retry_with_guidance=retry_with_guidance)

            # If we were retrying the invoke with guidance, remove the guidance message
            if retry_with_guidance is True:
                self._remove_temporary_messages(messages)

            return model_response

        except (ClientError, ServerError) as e:
            logger.error(f"Error from Gemini API: {e}")
            error_message = str(e)
            if hasattr(e, "response"):
                if hasattr(e.response, "text"):
                    error_message = e.response.text
                else:
                    error_message = str(e.response)
            raise ModelProviderError(
                message=error_message,
                status_code=e.code if hasattr(e, "code") and e.code is not None else 502,
                model_name=self.name,
                model_id=self.id,
            ) from e
        except RetryableModelProviderError:
            raise
        except Exception as e:
            logger.error(f"Unknown error from Gemini API: {e}")
            raise ModelProviderError(message=str(e), model_name=self.name, model_id=self.id) from e

    def invoke_stream(
        self,
        messages: List[Message],
        assistant_message: Message,
        response_format: Optional[Dict | Type[BaseModel]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str | Dict[str, Any]] = None,
        run_response: Optional[RunOutput] = None,
        compress_tool_results: bool = False,
        retry_with_guidance: bool = False,
    ) -> Iterator[ModelResponse]:
        """
        Invokes the model with a list of messages and returns the response as a stream.
        """
        formatted_messages, system_message = self._format_messages(messages, compress_tool_results)

        request_kwargs = self.get_request_params(system_message, response_format=response_format, tools=tools, tool_choice=tool_choice)
        try:
            assistant_message.metrics.start_timer()
            # logger.info(f"[GEMINI INVOKE STREAM] Sending request to Gemini API with {len(formatted_messages)} messages. Tools: {tools}, Tool choice: {tool_choice}, Retry with guidance: {retry_with_guidance}")

            for response in self.get_client().models.generate_content_stream(
                model=self.id,
                contents=formatted_messages,
                **request_kwargs,
            ):
                yield self._parse_provider_response_delta(response, retry_with_guidance=retry_with_guidance)

            # If we were retrying the invoke with guidance, remove the guidance message
            if retry_with_guidance is True:
                self._remove_temporary_messages(messages)

            assistant_message.metrics.stop_timer()

        except (ClientError, ServerError) as e:
            logger.error(f"Error from Gemini API: {e}")
            error_message = str(e)
            if hasattr(e, "response"):
                if hasattr(e.response, "text"):
                    error_message = e.response.text
                else:
                    error_message = str(e.response)
            raise ModelProviderError(
                message=error_message,
                status_code=e.code if hasattr(e, "code") and e.code is not None else 502,
                model_name=self.name,
                model_id=self.id,
            ) from e
        except RetryableModelProviderError:
            raise
        except Exception as e:
            logger.error(f"Unknown error from Gemini API: {e}")
            raise ModelProviderError(message=str(e), model_name=self.name, model_id=self.id) from e

    async def ainvoke(
        self,
        messages: List[Message],
        assistant_message: Message,
        response_format: Optional[Dict | Type[BaseModel]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str | Dict[str, Any]] = None,
        run_response: Optional[RunOutput] = None,
        compress_tool_results: bool = False,
        retry_with_guidance: bool = False,
    ) -> ModelResponse:
        """
        Invokes the model with a list of messages and returns the response.
        """
        formatted_messages, system_message = self._format_messages(messages, compress_tool_results)

        request_kwargs = self.get_request_params(system_message, response_format=response_format, tools=tools, tool_choice=tool_choice)

        try:
            assistant_message.metrics.start_timer()
            # logger.info(f"[GEMINI AINVOKE] Sending request to Gemini API with {len(formatted_messages)} messages. Tools: {tools}, Tool choice: {tool_choice}, Retry with guidance: {retry_with_guidance}")
            provider_response = await self.get_client().aio.models.generate_content(
                model=self.id,
                contents=formatted_messages,
                **request_kwargs,
            )
            assistant_message.metrics.stop_timer()

            model_response = self._parse_provider_response(provider_response, response_format=response_format, retry_with_guidance=retry_with_guidance)

            # If we were retrying the invoke with guidance, remove the guidance message
            if retry_with_guidance is True:
                self._remove_temporary_messages(messages)

            return model_response

        except (ClientError, ServerError) as e:
            logger.error(f"Error from Gemini API: {e}")
            error_message = str(e)
            if hasattr(e, "response"):
                if hasattr(e.response, "text"):
                    error_message = e.response.text
                else:
                    error_message = str(e.response)
            raise ModelProviderError(
                message=error_message,
                status_code=e.code if hasattr(e, "code") and e.code is not None else 502,
                model_name=self.name,
                model_id=self.id,
            ) from e
        except RetryableModelProviderError:
            raise
        except Exception as e:
            logger.error(f"Unknown error from Gemini API: {e}")
            raise ModelProviderError(message=str(e), model_name=self.name, model_id=self.id) from e

    async def ainvoke_stream(
        self,
        messages: List[Message],
        assistant_message: Message,
        response_format: Optional[Dict | Type[BaseModel]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[str | Dict[str, Any]] = None,
        run_response: Optional[RunOutput] = None,
        compress_tool_results: bool = False,
        retry_with_guidance: bool = False,
    ) -> AsyncIterator[ModelResponse]:
        """
        Invokes the model with a list of messages and returns the response as a stream.
        """
        formatted_messages, system_message = self._format_messages(messages, compress_tool_results)

        request_kwargs = self.get_request_params(system_message, response_format=response_format, tools=tools, tool_choice=tool_choice)

        try:
            assistant_message.metrics.start_timer()
            # logger.info(f"[GEMINI AINVOKE STREAM] Sending request to Gemini API with {len(formatted_messages)} messages. Tools: {tools}, Tool choice: {tool_choice}, Retry with guidance: {retry_with_guidance}")

            async_stream = await self.get_client().aio.models.generate_content_stream(
                model=self.id,
                contents=formatted_messages,
                **request_kwargs,
            )
            async for chunk in async_stream:
                yield self._parse_provider_response_delta(chunk, retry_with_guidance=retry_with_guidance)

            # If we were retrying the invoke with guidance, remove the guidance message
            if retry_with_guidance is True:
                self._remove_temporary_messages(messages)

            assistant_message.metrics.stop_timer()

        except (ClientError, ServerError) as e:
            logger.error(f"Error from Gemini API: {e}")
            error_message = str(e)
            if hasattr(e, "response"):
                if hasattr(e.response, "text"):
                    error_message = e.response.text
                else:
                    error_message = str(e.response)
            raise ModelProviderError(
                message=error_message,
                status_code=e.code if hasattr(e, "code") and e.code is not None else 502,
                model_name=self.name,
                model_id=self.id,
            ) from e
        except RetryableModelProviderError:
            raise
        except Exception as e:
            logger.error(f"Unknown error from Gemini API: {e}")
            raise ModelProviderError(message=str(e), model_name=self.name, model_id=self.id) from e


class GeminiEmbeddingsCustom(GeminiEmbeddings):
    """Override GeminiEmbeddings to add proxy support."""

    def __init__(
        self,
        model: str = GeminiEmbeddings.DEFAULT_MODEL,
        api_key: Optional[str] = None,
        task_type: str = "SEMANTIC_SIMILARITY",
        max_retries: int = 3,
        batch_size: int = 100,
        show_warnings: bool = True,
    ):
        """Initialize Gemini embeddings with proxy support."""
        import os
        import warnings

        from chonkie.embeddings.base import BaseEmbeddings

        # Call parent init without client setup
        BaseEmbeddings.__init__(self)

        self._import_dependencies()

        self.model = model if model else self.DEFAULT_MODEL
        self.task_type = task_type
        self._max_retries = max_retries
        self._batch_size = batch_size
        self._show_warnings = show_warnings
        self._chars_per_token = 6.5

        if self.model in self.AVAILABLE_MODELS:
            self._dimension, self._max_tokens = self.AVAILABLE_MODELS[self.model]
        else:
            self._dimension, self._max_tokens = self.AVAILABLE_MODELS[self.DEFAULT_MODEL]
            if show_warnings:
                warnings.warn(
                    f"Model {self.model} not in known models list. Using default model '{self.DEFAULT_MODEL}'",
                    stacklevel=2,
                )

        self._api_key = api_key or os.getenv("GEMINI_API_KEY") or settings.GOOGLE_API_KEY
        if self._api_key is None:
            raise ValueError("Gemini API key not found")

        from google import genai

        proxy_url = settings.PROXY_URL  # Use settings.PROXY_URL if you want to make it configurable
        logger.debug(f"[GEMINI_EMBEDDINGS] Using proxy: {proxy_url}")
        http_options = types.HttpOptions(
            client_args={
                "transport": httpx.HTTPTransport(proxy=proxy_url),
            },
            async_client_args={
                "transport": httpx.AsyncHTTPTransport(proxy=proxy_url),
            },
        )
        self.client = genai.Client(api_key=self._api_key, http_options=http_options)


def _get_model() -> CopilotChat:
    return CopilotChat(
        id="gpt-4.1",
        github_token=settings.GOOGLE_API_KEY,
    )


def _get_embeddings() -> GeminiEmbeddings:
    return GeminiEmbeddings(
        api_key=settings.GOOGLE_API_KEY,
        model=settings.GOOGLE_EMBEDDING_MODEL,
    )


async def embed_query(query: str) -> List[float]:
    embeddings = _get_embeddings()
    vector = embeddings.embed(query)
    return list(vector)


async def embed_documents(docs: List[str]) -> List[List[float]]:
    if not docs:
        return []
    embeddings = _get_embeddings()
    vectors = embeddings.embed_batch(docs)
    return [list(v) for v in vectors]


async def chat_complete(system_prompt: str, user_prompt: str) -> str:
    model = _get_model()
    messages = [
        Message(role="system", content=system_prompt),
        Message(role="user", content=user_prompt),
    ]
    assistant_message = Message(role="assistant", content="")
    response = await model.ainvoke(messages, assistant_message)
    return response.content


# async def optimize_contexts_with_llm(query: str, history: str, context_block: str, desired_count: int = 3) -> Optional[str]:
#     system_prompt = (
#         textwrap.dedent(
#             """
#         Bạn là một hệ thống đánh giá mức độ liên quan của tài liệu.

#         Dưới đây là câu hỏi của người dùng, lịch sử hội thoại,
#         và danh sách các đoạn tài liệu có thể liên quan đến câu hỏi.

#         Hãy chọn ra tối đa {desired_count} đoạn phù hợp nhất để hỗ trợ trả lời.
#         """
#         )
#         .strip()
#         .format(desired_count=desired_count)
#     )

#     user_prompt = textwrap.dedent(
#         f"""
#         Câu hỏi:
#         {query}

#         Lịch sử hội thoại (tóm tắt):
#         {history}

#         Các đoạn tài liệu:
#         {context_block}

#         Yêu cầu:
#         - Chỉ chọn các đoạn thực sự liên quan đến câu hỏi và bối cảnh hội thoại.
#         - Trả về kết quả ở định dạng JSON, chỉ gồm id và lý do.
#         Ví dụ:
#         [
#           {{"id": "file1:chunk2", "reason": "phân tích lỗi Redis timeout"}},
#           {{"id": "file1:chunk3", "reason": "mô tả nguyên nhân connection refused"}}
#         ]
#         """
#     ).strip()

#     try:
#         response = await chat_complete(system_prompt, user_prompt)
#     except Exception as error:
#         print(f"[optimize_contexts_with_llm] LLM call failed: {error}")
#         return None

#     if not response:
#         return None

#     candidate = response.strip()
#     if not candidate:
#         return None

#     try:
#         json.loads(candidate)
#     except json.JSONDecodeError as error:
#         print(f"[optimize_contexts_with_llm] Invalid JSON payload: {error}")
#         return None

#     return candidate


# async def expand_query_with_llm(query: str, num_expansions: int = 3) -> List[str]:
#     """
#     Generate multiple reformulated queries using LLM for query expansion.

#     Args:
#         query: Original user query
#         num_expansions: Number of expanded queries to generate (default: 3)

#     Returns:
#         List of expanded queries (includes original query)
#     """
#     try:
#         system_prompt = """Bạn là một chuyên gia về mở rộng truy vấn tìm kiếm.
# Nhiệm vụ của bạn là tạo ra các phiên bản khác nhau của câu truy vấn để tìm kiếm hiệu quả hơn trong cơ sở dữ liệu tài liệu.

# Quy tắc:
# 1. Tạo ra các câu truy vấn có nghĩa tương tự nhưng diễn đạt khác nhau
# 2. Thêm từ đồng nghĩa và các thuật ngữ liên quan
# 3. Trích xuất và mở rộng các thực thể chính (tên, địa điểm, khái niệm)
# 4. Giữ nguyên ngôn ngữ của câu truy vấn gốc (tiếng Việt hoặc tiếng Anh)
# 5. Mỗi câu truy vấn mở rộng trên một dòng riêng biệt
# 6. KHÔNG thêm số thứ tự, dấu đầu dòng, hoặc ký tự đặc biệt
# 7. KHÔNG giải thích hoặc thêm bất kỳ văn bản nào khác"""

#         user_prompt = f"""Hãy tạo {num_expansions} phiên bản mở rộng của câu truy vấn sau:

# "{query}"

# Trả về CHỈ {num_expansions} câu truy vấn mở rộng, mỗi câu trên một dòng."""

#         response = await chat_complete(system_prompt, user_prompt)

#         # Parse response - each line is an expanded query
#         expanded_queries = [line.strip() for line in response.strip().split("\n") if line.strip()]

#         # Filter out empty strings and ensure we have valid queries
#         expanded_queries = [q for q in expanded_queries if q and len(q) > 3]

#         # Always include original query
#         if query not in expanded_queries:
#             expanded_queries.insert(0, query)

#         # Limit to requested number + original
#         expanded_queries = expanded_queries[: num_expansions + 1]

#         print(f"🟢 \033[92mGenerated {len(expanded_queries)} expanded queries from original query\033[0m")
#         return expanded_queries

#     except Exception as e:
#         print(f"🔴 \033[91mQuery expansion failed: {e}. Using original query.\033[0m")
#         # Fallback to original query
#         return [query]
