from types import SimpleNamespace

from agent_runtime.infrastructure.llm.embedding_registry import build_embedding_ports


def config(models, **keys):
    return SimpleNamespace(**{"KNOWLEDGE_EMBEDDING_MODEL_IDS": models, "PROXY_URL": None, "GOOGLE_API_KEY": "",
                              "VLLM_API_KEY": "", "VLLM_BASE_URL": "", **keys})


def test_every_listed_model_with_credentials_gets_its_own_port():
    ports = build_embedding_ports(config(("gemini-embedding-2", "nomic-embed-text-v1.5", "multilingual-e5-large"),
                                         GOOGLE_API_KEY="g", VLLM_API_KEY="v", VLLM_BASE_URL="http://vllm/v1"))
    assert {model: port.model for model, port in ports.items()} == {
        "gemini-embedding-2": "gemini-embedding-2", "nomic-embed-text-v1.5": "nomic-embed-text-v1.5",
        "multilingual-e5-large": "multilingual-e5-large"}
    assert ports["multilingual-e5-large"]._dimensions == 1024


def test_unknown_or_unconfigured_models_are_left_out():
    ports = build_embedding_ports(config(("mystery", "nomic-embed-text-v1.5", "gemini-embedding-2"),
                                         GOOGLE_API_KEY="g", VLLM_API_KEY="v"))
    assert list(ports) == ["gemini-embedding-2"]


def test_query_path_overrides_pass_through():
    settings = config(("gemini-embedding-2", "nomic-embed-text-v1.5"), GOOGLE_API_KEY="g", VLLM_API_KEY="v",
                      VLLM_BASE_URL="http://vllm/v1")
    default = build_embedding_ports(settings)
    tuned = build_embedding_ports(settings, timeout_ms=1500, max_retries=0)
    assert [port._max_retries for port in default.values()] == [2, 2]
    assert [port._max_retries for port in tuned.values()] == [0, 0]


def test_settings_parse_a_comma_separated_model_list():
    from agent_runtime.config.settings import Settings

    settings = Settings(KNOWLEDGE_EMBEDDING_MODELS=" nomic-embed-text-v1.5, gemini-embedding-2,,nomic-embed-text-v1.5")
    assert settings.KNOWLEDGE_EMBEDDING_MODEL_IDS == ("nomic-embed-text-v1.5", "gemini-embedding-2")
