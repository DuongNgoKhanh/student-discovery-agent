"""Grant only the execution tables, to roles provisioned by the operator."""

from sqlalchemy import Connection, text

MUTABLE_TABLES = ("conversations", "activities", "messages", "result_snapshots", "operation_outcomes", "runtime_traces")


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
