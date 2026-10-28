import json

import httpx

from agent_runtime.infrastructure.llm.openai_embedding import OpenAICompatibleEmbedding
from agent_runtime.knowledge.embedding import DocumentText, EmbeddingUnavailable


def adapter(*outcomes, dimensions=4, **kwargs):
    """Each outcome is a status code (empty body), an exception, or a vector size answered for every input."""
    queue, requests = list(outcomes), []

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append((request.url.path, request.headers["authorization"], body))
        outcome = queue.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        if outcome >= 400:
            return httpx.Response(outcome)
        data = [{"index": index, "embedding": [float(index)] * outcome} for index in range(len(body["input"]))]
        return httpx.Response(200, json={"data": list(reversed(data))})

    client = httpx.Client(base_url="http://vllm/v1/", headers={"Authorization": "Bearer k"},
                          transport=httpx.MockTransport(handle))
    embedding = OpenAICompatibleEmbedding("k", "http://vllm/v1", "multilingual-e5-large",
                                          remote_model="hosted_vllm/intfloat/multilingual-e5-large",
                                          dimensions=dimensions, document_prefix="passage: ", query_prefix="query: ",
                                          client=client, sleep=lambda _: None, **kwargs)
    return embedding, requests


def test_documents_and_queries_carry_the_model_prefixes_and_keep_input_order():
    embedding, requests = adapter(4, 4)
    vectors = embedding.embed_documents([DocumentText("Trường A", "Học phí", "25 triệu"), DocumentText("", "", "x")])
    assert vectors == [[0.0] * 4, [1.0] * 4]
    assert embedding.embed_query("hoc phi") == [0.0] * 4
    path, auth, body = requests[0]
    assert (path, auth, body["model"]) == ("/v1/embeddings", "Bearer k", "hosted_vllm/intfloat/multilingual-e5-large")
    assert body["input"] == ["passage: Trường A\nHọc phí\n25 triệu", "passage: x"]
    assert requests[1][2]["input"] == ["query: hoc phi"]


def test_documents_are_sent_in_batches():
    embedding, requests = adapter(4, 4, batch_size=2)
    assert len(embedding.embed_documents([DocumentText("", "", str(i)) for i in range(3)])) == 3
    assert [len(body["input"]) for _, _, body in requests] == [2, 1]


def test_server_errors_and_rate_limits_retry_but_client_errors_do_not():
    embedding, requests = adapter(503, 429, 4, max_retries=2)
    assert embedding.embed_query("x") == [0.0] * 4
    embedding, requests = adapter(400, max_retries=2)
    assert embedding.embed_query("x") == EmbeddingUnavailable("provider_error") and len(requests) == 1
    embedding, _ = adapter(429, 429, max_retries=1)
    assert embedding.embed_query("x") == EmbeddingUnavailable("rate_limited")
    embedding, _ = adapter(httpx.ReadTimeout("slow"), max_retries=0)
    assert embedding.embed_query("x") == EmbeddingUnavailable("timeout")


def test_a_vector_of_the_wrong_size_is_an_invalid_response():
    embedding, _ = adapter(3)
    assert embedding.embed_query("x") == EmbeddingUnavailable("invalid_response")
