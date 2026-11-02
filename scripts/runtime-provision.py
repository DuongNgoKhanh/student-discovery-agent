"""Provision the runtime database of the full local stack; runs inside the agent-runtime image, idempotent.

Creates the database, the knowledge roles (Studio logs in as kb_studio and may write content columns only),
migrates and grants via knowledge_provision, then loads the IHRD demo knowledge base.
"""
import os
import sys

import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url

from agent_runtime.cli import knowledge_provision, knowledge_seed

admin_url = os.environ["ADMIN_DATABASE_URL"]
db_name = os.environ["RUNTIME_DATABASE_NAME"]
runtime_url = make_url(admin_url).set(database=db_name)

with psycopg.connect(admin_url, autocommit=True) as conn:
    if not conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,)).fetchone():
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))
        print(f"Created database {db_name}")

with psycopg.connect(runtime_url.render_as_string(hide_password=False), autocommit=True) as conn:
    for role in ("kb_runtime", "kb_indexer"):
        if not conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).fetchone():
            conn.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(role)))
    verb = "ALTER" if conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'kb_studio'").fetchone() else "CREATE"
    conn.execute(sql.SQL(verb + " ROLE kb_studio LOGIN PASSWORD {}").format(sql.Literal(os.environ["KB_STUDIO_PASSWORD"])))

sa_url = runtime_url.set(drivername="postgresql+psycopg").render_as_string(hide_password=False)
os.environ["RUNTIME_MIGRATION_DATABASE_URL"] = sa_url
status = knowledge_provision.main(["--runtime-role", "kb_runtime", "--indexer-role", "kb_indexer", "--studio-role", "kb_studio"])
if status:
    sys.exit(status)
print("Runtime migrated; knowledge roles granted")

os.environ["RUNTIME_KNOWLEDGE_SEED_DATABASE_URL"] = sa_url
seed_args = ["--embedding-model", "fake-embedding"] if os.environ.get("KNOWLEDGE_EMBEDDING_MODEL") == "fake-embedding" else []
sys.exit(knowledge_seed.main(seed_args))
