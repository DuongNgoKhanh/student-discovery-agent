import pytest

from agent_runtime.cli import knowledge_indexer, knowledge_seed


def test_indexer_requires_its_own_database_url(monkeypatch, capsys):
    monkeypatch.delenv("RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL", raising=False)
    assert knowledge_indexer.main(["--once"]) == 2
    assert capsys.readouterr().out.strip() == "KNOWLEDGE_INDEXER_CONFIGURATION_REQUIRED"


def test_seed_requires_its_own_database_url(monkeypatch, capsys):
    monkeypatch.delenv("RUNTIME_KNOWLEDGE_SEED_DATABASE_URL", raising=False)
    assert knowledge_seed.main([]) == 2
    assert capsys.readouterr().out.strip() == "KNOWLEDGE_SEED_CONFIGURATION_REQUIRED"


def test_indexer_rejects_bad_arguments():
    with pytest.raises(SystemExit) as exited:  # argparse errors exit, like the cleanup CLI
        knowledge_indexer.main(["--batch-size", "0"])
    assert exited.value.code == 2


def test_indexer_refuses_to_start_without_an_api_key(monkeypatch, capsys):
    monkeypatch.setenv("RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL", "postgresql+psycopg://x:y@127.0.0.1:1/none")
    monkeypatch.setenv("GOOGLE_API_KEY", "")
    assert knowledge_indexer.main(["--once"]) == 2
    assert capsys.readouterr().out.strip() == "KNOWLEDGE_INDEXER_CONFIGURATION_REQUIRED"
