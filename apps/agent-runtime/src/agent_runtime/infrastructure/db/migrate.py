"""Explicit migration entry point. Never uses runtime or Product credentials."""

import argparse
import os
from pathlib import Path

from alembic import command
from alembic.config import Config

from .session import build_engine


def upgrade_database(url: str) -> None:
    root = Path(__file__).resolve().parents[4]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    engine = build_engine(url)
    try:
        with engine.begin() as connection:
            # Alembic must find the schema before creating its own version table.
            connection.exec_driver_sql("CREATE SCHEMA IF NOT EXISTS execution")
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
    finally:
        engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description="Explicit execution schema migration")
    parser.add_argument("command", choices=["upgrade"])
    parser.parse_args()
    url = os.environ.get("RUNTIME_MIGRATION_DATABASE_URL")
    if not url:
        parser.exit(2, "RUNTIME_MIGRATION_DATABASE_URL is required\n")
    try:
        upgrade_database(url)
    except Exception:
        # DB exceptions can include connection strings or SQL parameters.
        parser.exit(1, "Execution schema migration failed\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
