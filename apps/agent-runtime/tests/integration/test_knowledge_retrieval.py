import pytest
from sqlalchemy import text

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


def test_keyword_only_unaccented_query_matches_accented_text(rig):
    result = ask(rig, "hoc phi", retrieval_setting={"top_k": 4, "score_threshold": 0, "semantic_weight": 0})
    assert result.records[0].metadata["document_id"] == "cntt" and result.records[0].score > 0
    rig.embedding.fail_queries = True
    degraded = ask(rig, "hoc phi")
    assert degraded.degraded and degraded.records[0].metadata["document_id"] == "cntt"
    assert degraded.records[0].score > 0


def test_metadata_filter_and_top_k(rig):
    result = ask(rig, "ngành học", metadata_condition={"conditions": [
        {"name": "houses", "comparison_operator": "contains", "value": "house_s"}]},
        retrieval_setting={"top_k": 1, "score_threshold": 0, "semantic_weight": 0.7})
    assert [record.metadata["document_id"] for record in result.records] == ["ctxh"]


def test_top_k_limits_unfiltered_results(rig):
    setting = {"top_k": 4, "score_threshold": 0, "semantic_weight": 0.7}
    both = ask(rig, "ngành", retrieval_setting=setting)
    assert {r.metadata["document_id"] for r in both.records} == {"cntt", "ctxh"}
    one = ask(rig, "ngành", retrieval_setting=setting | {"top_k": 1})
    assert len(one.records) == 1


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
    keyword_only = ask(rig, "công tác xã hội",
                       retrieval_setting={"top_k": 4, "score_threshold": 0, "semantic_weight": 0})
    # Degraded must use weight 0 (pure keyword), not the default 0.7 scaling the keyword part by 0.3.
    assert result.records[0].score == keyword_only.records[0].score


def test_unknown_knowledge_base_and_bad_filters(rig):
    unknown = rig.knowledge.retrieve(RetrievalRequest.model_validate({"knowledge_id": "nope", "query": "x"}))
    assert unknown == KnowledgeUnavailable("not_found")
    with pytest.raises(FilterError):
        ask(rig, "x", metadata_condition={"conditions": [
            {"name": "missing", "comparison_operator": "is", "value": "x"}]})


def test_threshold_drops_weak_matches(rig):
    assert ask(rig, "ký túc xá", retrieval_setting={"top_k": 4, "score_threshold": 0.9,
                                                    "semantic_weight": 0.7}).records == ()


def test_unexpected_embedding_errors_degrade_to_keyword_search(rig):
    class Exploding:
        model = "fake-embedding"

        def embed_query(self, text):
            raise RuntimeError("boom")

    rig.knowledge._embedding = Exploding()
    result = ask(rig, "hoc phi")
    assert result.degraded and result.records[0].metadata["document_id"] == "cntt"


def test_stored_data_that_cannot_be_cast_is_a_filter_error(rig):
    rig.writer.put_field("kb1", "when", "string", filterable=True)
    rig.writer.put_document("kb1", "bad", title="Bad", body="# Học phí\nHọc phí lạ.", metadata={"when": "garbage"})
    rig.indexer.run_once()
    with rig.engine.begin() as connection:  # simulates drift the write path would never produce
        connection.execute(text("SET LOCAL session_replication_role = replica"))  # skip the immutability trigger
        connection.execute(text("UPDATE knowledge.metadata_fields SET type = 'time' WHERE name = 'when'"))
    with pytest.raises(FilterError):
        ask(rig, "hoc phi", metadata_condition={"logical_operator": "and", "conditions": [
            {"name": "when", "comparison_operator": "after", "value": "2026-01-01"}]})
