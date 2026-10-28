"""Knowledge schema on real PostgreSQL: extensions, immutable revisions, queue notify and role grants."""

import psycopg
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from agent_runtime.infrastructure.db.grants import grant_knowledge_roles
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import build_engine
from tests.helpers.knowledge import psycopg_conninfo, role_engine

pytestmark = pytest.mark.integration
HASH = "sha256:" + "a" * 64


@pytest.fixture
def engine(test_database):
    upgrade_database(test_database.url)
    engine = build_engine(test_database.url)
    with engine.begin() as connection:
        grant_knowledge_roles(connection, test_database.runtime_role, test_database.indexer_role)
    yield engine
    engine.dispose()


SEED = (  # one statement per execute: psycopg cannot prepare several commands with parameters
    "INSERT INTO knowledge.knowledge_bases (id, name, embedding_model) VALUES ('kb1', 'KB', 'fake-embedding')",
    "INSERT INTO knowledge.metadata_fields (id, kb_id, name, type, filterable) "
    "VALUES ('f1', 'kb1', 'houses', 'string_list', true)",
    "INSERT INTO knowledge.documents (id, kb_id, revision, latest_revision_id) VALUES ('d1', 'kb1', 1, 'r1')",
    "INSERT INTO knowledge.document_revisions (id, document_id, revision, title, body, metadata, content_hash) "
    "VALUES ('r1', 'd1', 1, 'Học phí', 'Nội dung', '{\"f1\": [\"house_s\"]}', :hash)",
    "INSERT INTO knowledge.chunks (revision_id, ordinal, heading_path, text, chunk_hash) "
    "VALUES ('r1', 0, 'Học phí', 'Học phí năm nhất', :hash)",
)


def seed(connection):
    for statement in SEED:
        connection.execute(text(statement), {"hash": HASH})


def denied(engine, statement):
    with pytest.raises(DBAPIError) as error:
        with engine.begin() as connection:
            connection.exec_driver_sql(statement)
    return error.value.orig.sqlstate


def test_tables_and_unaccented_search_vector(engine):
    with engine.begin() as connection:
        seed(connection)
        assert connection.execute(text(
            "SELECT count(*) FROM knowledge.chunks WHERE tsv @@ to_tsquery('simple', 'hoc & phi')")).scalar_one() == 1
        assert connection.execute(text(
            "SELECT format_type(atttypid, atttypmod) FROM pg_attribute "
            "WHERE attrelid = 'knowledge.embeddings'::regclass AND attname = 'embedding'")).scalar_one() == "vector"


def test_revision_content_is_immutable_but_status_is_not(engine):
    with engine.begin() as connection:
        seed(connection)
    assert denied(engine, "UPDATE knowledge.document_revisions SET body = 'x' WHERE id = 'r1'") == "P0001"
    with engine.begin() as connection:
        connection.execute(text("UPDATE knowledge.document_revisions SET index_status = 'ready' WHERE id = 'r1'"))


def test_field_type_cannot_change(engine):
    with engine.begin() as connection:
        seed(connection)
    assert denied(engine, "UPDATE knowledge.metadata_fields SET type = 'string' WHERE id = 'f1'") == "P0001"
    with engine.begin() as connection:
        connection.execute(text("UPDATE knowledge.metadata_fields SET name = 'fit_houses' WHERE id = 'f1'"))


def test_pending_revision_notifies_the_queue_channel(engine, test_database):
    with psycopg.connect(psycopg_conninfo(test_database.url), autocommit=True) as listener:
        listener.execute("LISTEN knowledge_index")
        with engine.begin() as connection:
            seed(connection)
        payloads = [notify.payload for notify in listener.notifies(timeout=2, stop_after=1)]
    assert payloads == ["r1"]


def test_runtime_role_only_reads(engine, test_database):
    with engine.begin() as connection:
        seed(connection)
    runtime = role_engine(test_database.url, test_database.runtime_role)
    try:
        with runtime.begin() as connection:
            assert connection.execute(text("SELECT count(*) FROM knowledge.chunks")).scalar_one() == 1
        for statement in ("DELETE FROM knowledge.chunks",
                          "UPDATE knowledge.documents SET active_revision_id = 'r1'",
                          "INSERT INTO knowledge.knowledge_bases (id, name, embedding_model) VALUES ('x', 'x', 'x')"):
            assert denied(runtime, statement) == "42501"
    finally:
        runtime.dispose()


def test_indexer_role_writes_index_state_only(engine, test_database):
    with engine.begin() as connection:
        seed(connection)
    indexer = role_engine(test_database.url, test_database.indexer_role)
    try:
        with indexer.begin() as connection:
            connection.execute(text("UPDATE knowledge.document_revisions SET index_status = 'indexing', "
                                    "claimed_at = clock_timestamp() WHERE id = 'r1'"))
            connection.execute(text("UPDATE knowledge.documents SET active_revision_id = 'r1' WHERE id = 'd1'"))
            connection.execute(text("DELETE FROM knowledge.chunks WHERE revision_id = 'r1'"))
            connection.execute(text(
                "INSERT INTO knowledge.embeddings (chunk_hash, embedding_model, embedding) "
                "VALUES (:hash, 'fake-embedding', CAST(:vector AS vector))"),
                {"hash": HASH, "vector": "[" + ",".join(["0.1"] * 768) + "]"})
        assert denied(indexer, "UPDATE knowledge.documents SET status = 'archived'") == "42501"
        assert denied(indexer, "INSERT INTO knowledge.document_revisions (id, document_id, revision, title, body, "
                               f"content_hash) VALUES ('r2', 'd1', 2, 't', 'b', '{HASH}')") == "42501"
    finally:
        indexer.dispose()
