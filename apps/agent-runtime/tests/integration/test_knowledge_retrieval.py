import pytest
from sqlalchemy import text

from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork
from agent_runtime.knowledge.embedding import by_model
from agent_runtime.knowledge.filters import FilterError
from agent_runtime.knowledge.retrieval import PgKnowledge
from agent_runtime.knowledge.schemas import KnowledgeUnavailable, MetadataCondition, RetrievalRequest
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
    rig.knowledge = PgKnowledge(RuntimeUnitOfWork(runtime), by_model(rig.embedding))
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

    rig.knowledge._embeddings = by_model(Exploding())
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


TUITION = """# Danh sách ngành
- Quản trị kinh doanh: Đã tốt nghiệp THPT, Đã tốt nghiệp Trung cấp
- Kế toán: Đã tốt nghiệp THPT, Đã tốt nghiệp Trung cấp
- Marketing: Đã tốt nghiệp THPT, Đã tốt nghiệp Trung cấp

# Quản trị kinh doanh — Đã tốt nghiệp THPT
- Học phí: 500.000 đ/tín chỉ

# Quản trị kinh doanh — Đã tốt nghiệp Trung cấp
- Học phí: 500.000 đ/tín chỉ

# Quản trị kinh doanh — Đã tốt nghiệp Cao đẳng
- Học phí: 500.000 đ/tín chỉ
"""
KEYWORDS_ONLY = {"top_k": 10, "score_threshold": 0, "semantic_weight": 0}


def index_tuition(rig):
    rig.writer.put_document("kb1", "tuition", title="Trường C", body=TUITION)
    rig.indexer.run_once()


def test_a_document_returns_several_chunks_up_to_the_per_document_limit(rig):
    index_tuition(rig)
    result = ask(rig, "học phí quản trị kinh doanh", retrieval_setting=KEYWORDS_ONLY | {"max_chunks_per_doc": 2})
    tuition = [record for record in result.records if record.metadata["document_id"] == "tuition"]
    assert len(tuition) == 2
    assert len({record.metadata["chunk"] for record in tuition}) == 2
    assert len(ask(rig, "học phí quản trị kinh doanh", retrieval_setting=KEYWORDS_ONLY | {
        "max_chunks_per_doc": 3, "top_k": 2}).records) == 2  # top_k counts chunks, not documents


def test_keyword_score_rewards_covering_the_question_not_repeating_words(rig):
    index_tuition(rig)
    top = ask(rig, "hoc phi quan tri kinh doanh da tot nghiep THPT", retrieval_setting=KEYWORDS_ONLY).records[0]
    # The list repeats "tốt nghiệp THPT" but never mentions tuition; the THPT section covers every word.
    assert top.content.startswith("Quản trị kinh doanh — Đã tốt nghiệp THPT")
    assert 0 < top.score <= 1


OPEN = {"retrieval_setting": {"top_k": 4, "score_threshold": 0, "semantic_weight": 0}}
DA_NANG = MetadataCondition.model_validate(
    {"conditions": [{"name": "province", "comparison_operator": "is", "value": "Đà Nẵng"}]})


def test_required_condition_is_anded_with_the_callers_filter(rig):
    def search(required, **extra):
        return rig.knowledge.retrieve(RetrievalRequest.model_validate(
            {"knowledge_id": "kb1", "query": "ngành học phí"} | OPEN | extra), required=required)

    assert {record.metadata["document_id"] for record in search(None).records} == {"cntt", "ctxh"}
    assert {record.metadata["document_id"] for record in search(DA_NANG).records} == {"ctxh"}
    both = search(DA_NANG, metadata_condition={"conditions": [
        {"name": "houses", "comparison_operator": "contains", "value": "house_i"}]})
    assert both.records == ()


def test_a_bad_required_condition_is_a_binding_problem_not_a_caller_error(rig):
    bad = MetadataCondition.model_validate({"conditions": [{"name": "nope", "comparison_operator": "is", "value": "x"}]})
    result = rig.knowledge.retrieve(RetrievalRequest.model_validate({"knowledge_id": "kb1", "query": "ngành"}),
                                    required=bad)
    assert result == KnowledgeUnavailable("invalid_binding")


def test_fields_are_read_for_several_knowledge_bases_at_once(rig):
    fields = rig.knowledge.fields(["kb1", "missing"])
    assert [field.name for field in fields["kb1"]] == ["houses", "province"]
    assert "missing" not in fields and rig.knowledge.fields([]) == {}


def test_base_fields_lists_existing_bases_even_without_fields(rig):
    rig.writer.create_knowledge_base("empty", "Empty", rig.embedding.model)
    found = rig.knowledge.base_fields(["kb1", "empty", "missing"])
    assert found == {"kb1": frozenset({"houses", "province"}), "empty": frozenset()}
    assert rig.knowledge.base_fields([]) == {}
