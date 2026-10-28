"""Grant only the execution tables, to roles provisioned by the operator."""

from sqlalchemy import Connection, text

MUTABLE_TABLES = ("conversations", "activities", "messages", "result_snapshots", "operation_outcomes", "responses",
                  "runtime_traces")


def grant_execution_roles(connection: Connection, runtime_role: str, cleanup_role: str) -> None:
    for role in (runtime_role, cleanup_role):
        if not connection.execute(text("SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :role"), {"role": role}).scalar():
            raise ValueError("execution role must already exist")
    quote = connection.dialect.identifier_preparer.quote_identifier
    runtime, cleanup = quote(runtime_role), quote(cleanup_role)
    connection.exec_driver_sql(f"REVOKE ALL ON SCHEMA execution FROM {runtime}, {cleanup}")
    connection.exec_driver_sql(f"GRANT USAGE ON SCHEMA execution TO {runtime}, {cleanup}")
    connection.exec_driver_sql(f"REVOKE ALL ON ALL TABLES IN SCHEMA execution FROM {runtime}, {cleanup}")
    for table in MUTABLE_TABLES:
        connection.exec_driver_sql(f"GRANT SELECT, INSERT, UPDATE, DELETE ON execution.{table} TO {runtime}")
        connection.exec_driver_sql(f"GRANT SELECT, UPDATE, DELETE ON execution.{table} TO {cleanup}")
    connection.exec_driver_sql(f"GRANT SELECT, INSERT ON execution.release_snapshots TO {runtime}")
    connection.exec_driver_sql(f"GRANT SELECT, DELETE ON execution.release_snapshots TO {cleanup}")


def grant_knowledge_roles(connection: Connection, runtime_role: str, indexer_role: str,
                          studio_role: str | None = None) -> None:
    """Runtime reads; the indexer writes chunks/embeddings and index state; Studio writes content columns only."""
    roles = (runtime_role, indexer_role) + ((studio_role,) if studio_role else ())
    for role in roles:
        if not connection.execute(text("SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :role"), {"role": role}).scalar():
            raise ValueError("knowledge role must already exist")
    quote = connection.dialect.identifier_preparer.quote_identifier
    indexer = quote(indexer_role)
    everyone = ", ".join(quote(role) for role in roles)
    connection.exec_driver_sql(f"REVOKE ALL ON SCHEMA knowledge FROM {everyone}")
    connection.exec_driver_sql(f"GRANT USAGE ON SCHEMA knowledge TO {everyone}")
    connection.exec_driver_sql(f"REVOKE ALL ON ALL TABLES IN SCHEMA knowledge FROM {everyone}")
    connection.exec_driver_sql(f"GRANT SELECT ON ALL TABLES IN SCHEMA knowledge TO {everyone}")
    connection.exec_driver_sql(f"GRANT INSERT, DELETE ON knowledge.chunks TO {indexer}")
    connection.exec_driver_sql(f"GRANT INSERT ON knowledge.embeddings TO {indexer}")
    connection.exec_driver_sql(
        f"GRANT UPDATE (index_status, error, claimed_at) ON knowledge.document_revisions TO {indexer}")
    connection.exec_driver_sql(f"GRANT UPDATE (active_revision_id) ON knowledge.documents TO {indexer}")
    if studio_role:
        studio = quote(studio_role)
        connection.exec_driver_sql(
            f"GRANT INSERT, UPDATE (name, description, updated_at) ON knowledge.knowledge_bases TO {studio}")
        connection.exec_driver_sql(
            f"GRANT INSERT, DELETE, UPDATE (label, filterable, ordinal) ON knowledge.metadata_fields TO {studio}")
        connection.exec_driver_sql(
            "GRANT INSERT (id, kb_id), UPDATE (status, revision, latest_revision_id, updated_at) "
            f"ON knowledge.documents TO {studio}")
        # No index_status/error/claimed_at: a new revision always starts pending, only the indexer moves it on.
        connection.exec_driver_sql(
            "GRANT INSERT (id, document_id, revision, title, body, source_url, metadata, content_hash) "
            f"ON knowledge.document_revisions TO {studio}")
        connection.exec_driver_sql(f"GRANT INSERT ON knowledge.imports TO {studio}")
        connection.exec_driver_sql(f"GRANT EXECUTE ON FUNCTION knowledge.retry_revision(text) TO {studio}")
