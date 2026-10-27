"""Migrate, then grant the knowledge roles, for local stacks and cross-app tests; roles must already exist."""
import argparse
import os

from agent_runtime.infrastructure.db.grants import grant_knowledge_roles
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import build_engine


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Migrate, then grant the knowledge roles")
    parser.add_argument("--runtime-role", required=True)
    parser.add_argument("--indexer-role", required=True)
    parser.add_argument("--studio-role", required=True)
    args = parser.parse_args(argv)
    url = os.environ.get("RUNTIME_MIGRATION_DATABASE_URL")
    if not url:
        parser.exit(2, "RUNTIME_MIGRATION_DATABASE_URL is required\n")
    try:
        upgrade_database(url)
        engine = build_engine(url)
        try:
            with engine.begin() as connection:
                grant_knowledge_roles(connection, args.runtime_role, args.indexer_role, args.studio_role)
        finally:
            engine.dispose()
    except Exception:
        # DB exceptions can include connection strings.
        parser.exit(1, "Knowledge provisioning failed\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
