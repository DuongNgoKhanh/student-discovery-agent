import pytest
from sqlalchemy import text

from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.knowledge.authoring import KnowledgeWriter
from agent_runtime.knowledge.metadata import MetadataError

pytestmark = pytest.mark.integration


@pytest.fixture
def writer(test_database):
    upgrade_database(test_database.url)
    engine = build_engine(test_database.url)
    writer = KnowledgeWriter(RuntimeUnitOfWork(engine))
    writer.create_knowledge_base("kb1", "KB", "fake-embedding")
    writer.put_field("kb1", "houses", "string_list", filterable=True)
    yield writer, engine
    engine.dispose()


def revisions(engine):
    with engine.connect() as connection:
        return connection.execute(text(
            "SELECT r.revision, r.index_status, r.metadata, d.revision, d.latest_revision_id = r.id "
            "FROM knowledge.document_revisions r JOIN knowledge.documents d ON d.id = r.document_id "
            "ORDER BY r.revision")).all()


def test_same_content_does_not_create_a_revision(writer):
    writer, engine = writer
    first = writer.put_document("kb1", "doc1", title="T", body="B", metadata={"houses": ["house_s"]})
    again = writer.put_document("kb1", "doc1", title="T", body="B", metadata={"houses": ["house_s"]})
    changed = writer.put_document("kb1", "doc1", title="T", body="B2", metadata={"houses": ["house_s"]})
    assert (first.revision, first.created, again.created, changed.revision) == (1, True, False, 2)
    rows = revisions(engine)
    assert [(row[0], row[1]) for row in rows] == [(1, "pending"), (2, "pending")]
    assert rows[1][3] == 2 and rows[1][4] is True
    field_id = writer.fields("kb1")[0].id
    assert rows[0][2] == {field_id: ["house_s"]}


def test_invalid_metadata_and_type_change_are_rejected(writer):
    writer, engine = writer
    with pytest.raises(MetadataError):
        writer.put_document("kb1", "doc1", title="T", body="B", metadata={"houses": "house_s"})
    with pytest.raises(MetadataError):
        writer.put_field("kb1", "houses", "string")
    assert revisions(engine) == []


def test_archive_marks_the_document(writer):
    writer, engine = writer
    writer.put_document("kb1", "doc1", title="T", body="B")
    writer.archive("doc1")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT status FROM knowledge.documents")).scalar_one() == "archived"
