"""Migrations require an explicitly supplied connection from the migration entry point."""

from alembic import context

connection = context.config.attributes.get("connection")
if connection is None:
    raise RuntimeError("Use python -m agent_runtime.infrastructure.db.migrate upgrade")

context.configure(connection=connection, version_table_schema="execution", include_schemas=True)
with context.begin_transaction():
    context.run_migrations()
