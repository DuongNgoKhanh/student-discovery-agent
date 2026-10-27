import pytest

from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork
from agent_runtime.knowledge.filters import FilterError
from agent_runtime.knowledge.retrieval import PgKnowledge
from agent_runtime.knowledge.schemas import KnowledgeUnavailable, RetrievalRequest
from tests.helpers.knowledge import knowledge_rig, role_engine

pytestmark = pytest.mark.integration


@pytest.fixture
def rig(test_database):
    rig = knowledge_rig(test_database)
    rig.writer.put_document("kb1", "cntt", title="Trường Minh Họa A — CNTT",
                            body="# Học phí\nHọc phí ngành công nghệ thông tin khoảng 25 triệu mỗi năm.",
                            metadata={"houses": ["house_i", "house_r"], "province": "Hà Nội"},
                            source_url="https://ihrd.vn/a")
    rig.writer.put_document("kb1", "ctxh", title="Trường Minh Họa B — Công tác xã hội",
                            body="# Giới thiệu\nNgành công tác xã hội đào tạo kỹ năng hỗ trợ cộng đồng.",
                            metadata={"houses": ["house_s"], "province": "Đà Nẵng"})
    rig.indexer.run_once()
    runtime = role_engine(test_database.url, test_database.runtime_role)
    rig.knowledge = PgKnowledge(RuntimeUnitOfWork(runtime), rig.embedding)
    yield rig
    runtime.dispose()
    rig.dispose()


def ask(rig, query, **extra):
    return rig.knowledge.retrieve(RetrievalRequest.model_validate({"knowledge_id": "kb1", "query": query} | extra))


def test_unaccented_query_finds_the_matching_document(rig):
    result = ask(rig, "hoc phi cong nghe thong tin")
    assert not result.degraded
    top = result.records[0]
    assert top.title == "Trường Minh Họa A — CNTT"
    assert top.content == "Học phí\nHọc phí ngành công nghệ thông tin khoảng 25 triệu mỗi năm."
    assert top.metadata["houses"] == ["house_i", "house_r"] and top.metadata["document_id"] == "cntt"
    assert top.metadata["revision"] == 1 and top.metadata["source_url"] == "https://ihrd.vn/a"
    assert 0 < top.score <= 1


def test_metadata_filter_and_top_k(rig):
    result = ask(rig, "ngành học", metadata_condition={"conditions": [
        {"name": "houses", "comparison_operator": "contains", "value": "house_s"}]},
        retrieval_setting={"top_k": 1, "score_threshold": 0, "semantic_weight": 0.7})
    assert [record.metadata["document_id"] for record in result.records] == ["ctxh"]


def test_only_the_active_revision_is_served_and_archive_is_immediate(rig):
    rig.writer.put_document("kb1", "cntt", title="Trường Minh Họa A — CNTT",
                            body="# Học phí\nHọc phí đã đổi thành 30 triệu.",
                            metadata={"houses": ["house_i"], "province": "Hà Nội"})
    assert "25 triệu" in ask(rig, "học phí").records[0].content
    rig.indexer.run_once()
    assert "30 triệu" in ask(rig, "học phí").records[0].content
    rig.writer.archive("cntt")
    assert all(record.metadata["document_id"] != "cntt" for record in ask(rig, "học phí").records)


def test_query_embedding_failure_degrades_to_keywords(rig):
    rig.embedding.fail_queries = True
    result = ask(rig, "công tác xã hội")
    assert result.degraded and result.records[0].metadata["document_id"] == "ctxh"


def test_unknown_knowledge_base_and_bad_filters(rig):
    unknown = rig.knowledge.retrieve(RetrievalRequest.model_validate({"knowledge_id": "nope", "query": "x"}))
    assert unknown == KnowledgeUnavailable("not_found")
    with pytest.raises(FilterError):
        ask(rig, "x", metadata_condition={"conditions": [
            {"name": "missing", "comparison_operator": "is", "value": "x"}]})


def test_threshold_drops_weak_matches(rig):
    assert ask(rig, "ký túc xá", retrieval_setting={"top_k": 4, "score_threshold": 0.9,
                                                    "semantic_weight": 0.7}).records == ()
