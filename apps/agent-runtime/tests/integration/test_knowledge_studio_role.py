"""The Studio content role writes content columns only and retries failed revisions through one function."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from agent_runtime.infrastructure.db.grants import grant_knowledge_roles
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import build_engine
from tests.helpers.knowledge import role_engine

pytestmark = pytest.mark.integration
HASH = "sha256:" + "b" * 64


@pytest.fixture
def engines(test_database):
    upgrade_database(test_database.url)
    owner = build_engine(test_database.url)
    with owner.begin() as connection:
        grant_knowledge_roles(connection, test_database.runtime_role, test_database.indexer_role,
                              test_database.studio_role)
    studio = role_engine(test_database.url, test_database.studio_role)
    yield owner, studio
    studio.dispose()
    owner.dispose()


def write_content(engine):
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO knowledge.knowledge_bases (id, name, embedding_model) "
                                "VALUES ('kb1', 'KB', 'fake-embedding')"))
        connection.execute(text("INSERT INTO knowledge.metadata_fields (id, kb_id, name, type) "
                                "VALUES ('f1', 'kb1', 'province', 'string')"))
        connection.execute(text("INSERT INTO knowledge.documents (id, kb_id) VALUES ('d1', 'kb1')"))
        connection.execute(text("INSERT INTO knowledge.document_revisions "
                                "(id, document_id, revision, title, body, content_hash) "
                                "VALUES ('r1', 'd1', 1, 'T', 'B', :hash)"), {"hash": HASH})
        connection.execute(text("UPDATE knowledge.documents SET revision = 1, latest_revision_id = 'r1', "
                                "updated_at = clock_timestamp() WHERE id = 'd1'"))
        connection.execute(text("INSERT INTO knowledge.imports "
                                "(id, kb_id, idempotency_key, request_hash, report, created_by) "
                                "VALUES ('i1', 'kb1', 'k1', :hash, '{}', 'admin')"), {"hash": HASH})


def sqlstate(engine, statement):
    with pytest.raises(DBAPIError) as error:
        with engine.begin() as connection:
            connection.exec_driver_sql(statement)
    return error.value.orig.sqlstate


def test_studio_writes_content_columns(engines):
    _, studio = engines
    write_content(studio)
    with studio.begin() as connection:
        connection.execute(text("UPDATE knowledge.knowledge_bases SET name = 'KB 2', description = 'x', "
                                "updated_at = clock_timestamp() WHERE id = 'kb1'"))
        connection.execute(text("UPDATE knowledge.metadata_fields SET label = 'Tỉnh', filterable = true, "
                                "ordinal = 2 WHERE id = 'f1'"))
        connection.execute(text("SELECT id FROM knowledge.documents WHERE id = 'd1' FOR UPDATE"))
        connection.execute(text("UPDATE knowledge.documents SET status = 'archived' WHERE id = 'd1'"))
        connection.execute(text("DELETE FROM knowledge.metadata_fields WHERE id = 'f1'"))


@pytest.mark.parametrize("statement", [
    "UPDATE knowledge.documents SET active_revision_id = 'r1' WHERE id = 'd1'",
    "UPDATE knowledge.document_revisions SET index_status = 'ready' WHERE id = 'r1'",
    f"INSERT INTO knowledge.chunks (revision_id, ordinal, text, chunk_hash) VALUES ('r1', 0, 'x', '{HASH}')",
    "DELETE FROM knowledge.documents WHERE id = 'd1'",
    "UPDATE knowledge.metadata_fields SET name = 'other' WHERE id = 'f1'",
    "UPDATE knowledge.knowledge_bases SET embedding_model = 'other' WHERE id = 'kb1'",
    "UPDATE knowledge.imports SET report = '{}' WHERE id = 'i1'",
])
def test_studio_cannot_touch_index_state_or_identity(engines, statement):
    _, studio = engines
    write_content(studio)
    assert sqlstate(studio, statement) == "42501"


def test_import_keys_are_unique_per_knowledge_base(engines):
    _, studio = engines
    write_content(studio)
    assert sqlstate(studio, "INSERT INTO knowledge.imports (id, kb_id, idempotency_key, request_hash, report, "
                            f"created_by) VALUES ('i2', 'kb1', 'k1', '{HASH}', '{{}}', 'admin')") == "23505"


def test_retry_moves_only_failed_revisions_back_to_pending(engines):
    owner, studio = engines
    write_content(studio)
    with studio.begin() as connection:
        assert connection.execute(text("SELECT knowledge.retry_revision('r1')")).scalar_one() is False
    with owner.begin() as connection:
        connection.execute(text("UPDATE knowledge.document_revisions SET index_status = 'error', error = 'boom', "
                                "claimed_at = clock_timestamp() WHERE id = 'r1'"))
    with studio.begin() as connection:
        assert connection.execute(text("SELECT knowledge.retry_revision('r1')")).scalar_one() is True
        row = connection.execute(text("SELECT index_status, error, claimed_at FROM knowledge.document_revisions "
                                      "WHERE id = 'r1'")).one()
    assert tuple(row) == ("pending", None, None)


def test_only_studio_may_retry(engines, test_database):
    write_content(engines[1])
    for role in (test_database.runtime_role, test_database.indexer_role):
        engine = role_engine(test_database.url, role)
        try:
            assert sqlstate(engine, "SELECT knowledge.retry_revision('r1')") == "42501"
        finally:
            engine.dispose()
