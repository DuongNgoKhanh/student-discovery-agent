import pytest

from agent_runtime.cli import knowledge_indexer, knowledge_seed
from agent_runtime.infrastructure.db.grants import grant_knowledge_roles
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.knowledge.embedding import by_model
from agent_runtime.knowledge.fake import FakeEmbedding
from agent_runtime.knowledge.retrieval import PgKnowledge
from agent_runtime.knowledge.schemas import RetrievalRequest

pytestmark = pytest.mark.integration


def test_seed_then_index_makes_the_demo_searchable(test_database, monkeypatch, capsys):
    upgrade_database(test_database.url)
    engine = build_engine(test_database.url)
    try:
        with engine.begin() as connection:
            grant_knowledge_roles(connection, test_database.runtime_role, test_database.indexer_role)
        monkeypatch.setenv("RUNTIME_KNOWLEDGE_SEED_DATABASE_URL", test_database.url)
        monkeypatch.setenv("RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL", test_database.url)
        assert knowledge_seed.main(["--embedding-model", "fake-embedding"]) == 0
        assert knowledge_seed.main(["--embedding-model", "fake-embedding"]) == 0
        assert capsys.readouterr().out.splitlines() == ["created=4", "created=0"]
        assert knowledge_indexer.main(["--once", "--fake-embedding"]) == 0
        assert capsys.readouterr().out.strip() == "indexed=4 failed=0 embedded=8 reused=0 reclaimed=0 purged=0"
        result = PgKnowledge(RuntimeUnitOfWork(engine), by_model(FakeEmbedding())).retrieve(RetrievalRequest.model_validate({
            "knowledge_id": "kb_ihrd_demo", "query": "công tác xã hội Đà Nẵng",
            "metadata_condition": {"conditions": [{"name": "kind", "comparison_operator": "is",
                                                   "value": "school_program"}]}}))
        assert result.records[0].metadata["document_id"] == "demo_school_b_social"
    finally:
        engine.dispose()
