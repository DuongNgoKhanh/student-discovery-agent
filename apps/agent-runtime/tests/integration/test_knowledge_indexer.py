import pytest
from sqlalchemy import text

from agent_runtime.knowledge.fake import FakeEmbedding
from tests.helpers.knowledge import knowledge_rig

pytestmark = pytest.mark.integration
BODY = "# Học phí\nKhoảng 25 triệu/năm.\n\n# Ký túc xá\nCó 500 chỗ."


@pytest.fixture
def rig(test_database):
    rig = knowledge_rig(test_database)
    yield rig
    rig.dispose()


def state(rig):
    with rig.engine.connect() as connection:
        active = connection.execute(text(
            "SELECT r.revision FROM knowledge.documents d "
            "LEFT JOIN knowledge.document_revisions r ON r.id = d.active_revision_id WHERE d.id = 'doc1'")).scalar()
        statuses = connection.execute(text(
            "SELECT revision, index_status FROM knowledge.document_revisions ORDER BY revision")).all()
        chunks = connection.execute(text(
            "SELECT r.revision, c.text FROM knowledge.chunks c "
            "JOIN knowledge.document_revisions r ON r.id = c.revision_id ORDER BY r.revision, c.ordinal")).all()
    return active, [tuple(row) for row in statuses], [tuple(row) for row in chunks]


def test_pending_revision_is_indexed_and_activated(rig):
    rig.writer.put_document("kb1", "doc1", title="Trường A", body=BODY)
    report = rig.indexer.run_once()
    assert (report.indexed, report.failed, report.embedded) == (1, 0, 2)
    assert state(rig) == (1, [(1, "ready")], [(1, "Khoảng 25 triệu/năm."), (1, "Có 500 chỗ.")])


def test_old_revision_stays_active_until_the_new_one_is_ready(rig):
    rig.writer.put_document("kb1", "doc1", title="Trường A", body=BODY)
    rig.indexer.run_once()
    rig.writer.put_document("kb1", "doc1", title="Trường A", body=BODY.replace("500", "800"))
    assert state(rig)[0] == 1
    report = rig.indexer.run_once()
    assert (report.embedded, report.reused) == (1, 1)
    assert rig.embedding.document_calls == [2, 1]
    assert state(rig) == (2, [(1, "ready"), (2, "ready")], [(2, "Khoảng 25 triệu/năm."), (2, "Có 800 chỗ.")])


def test_embedding_failure_keeps_the_previous_revision(test_database):
    rig = knowledge_rig(test_database)
    try:
        rig.writer.put_document("kb1", "doc1", title="Trường A", body=BODY)
        rig.indexer.run_once()
        rig.embedding.fail_documents = True
        rig.writer.put_document("kb1", "doc1", title="Trường A", body="# Mới\nNội dung mới.")
        assert rig.indexer.run_once().failed == 1
        active, statuses, _ = state(rig)
        assert active == 1 and statuses == [(1, "ready"), (2, "error")]
        with rig.engine.connect() as connection:
            assert connection.execute(text(
                "SELECT error FROM knowledge.document_revisions WHERE revision = 2")).scalar_one() == (
                "embedding provider_error")
    finally:
        rig.dispose()


def test_a_late_older_revision_never_replaces_a_newer_active_one(rig):
    rig.writer.put_document("kb1", "doc1", title="T", body="# A\nbản 1")
    rig.writer.put_document("kb1", "doc1", title="T", body="# A\nbản 2")
    first, second = rig.indexer.claim(), rig.indexer.claim()
    assert (first.revision, second.revision) == (1, 2)
    rig.indexer.index(second)
    rig.indexer.index(first)
    assert state(rig) == (2, [(1, "ready"), (2, "ready")], [(2, "bản 2")])


def test_claims_skip_locked_rows_and_stale_claims_are_reclaimed(rig):
    rig.writer.put_document("kb1", "doc1", title="T", body="# A\nx")
    rig.writer.put_document("kb1", "doc2", title="T", body="# A\ny")
    with rig.engine.connect() as locker:
        locker.execute(text("SELECT 1 FROM knowledge.document_revisions r JOIN knowledge.documents d "
                            "ON d.id = r.document_id WHERE d.id = 'doc1' FOR UPDATE OF r"))
        claimed = rig.indexer.claim()
        assert claimed.document_id == "doc2"
        locker.rollback()
    with rig.engine.begin() as connection:
        connection.execute(text("UPDATE knowledge.document_revisions SET claimed_at = clock_timestamp() "
                                "- interval '1 hour' WHERE id = :id"), {"id": claimed.revision_id})
    assert rig.indexer.reclaim_stale() == 1


def test_archived_documents_lose_their_chunks_and_requeue_reindexes(rig):
    rig.writer.put_document("kb1", "doc1", title="T", body=BODY)
    rig.writer.put_document("kb1", "doc2", title="T", body="# B\nz")
    rig.indexer.run_once()
    rig.writer.archive("doc2")
    assert rig.indexer.run_once().purged == 1
    assert rig.indexer.requeue_knowledge_base("kb1") == 1
    report = rig.indexer.run_once()
    assert (report.indexed, report.embedded, report.reused) == (1, 0, 2)
    assert state(rig)[0] == 1


def test_a_knowledge_base_on_another_model_fails_loudly(test_database):
    rig = knowledge_rig(test_database, embedding=FakeEmbedding())
    try:
        rig.writer.create_knowledge_base("kb2", "KB2", "gemini-embedding-2")
        rig.writer.put_document("kb2", "doc9", title="T", body="# A\nx")
        assert rig.indexer.run_once().failed == 1
    finally:
        rig.dispose()
