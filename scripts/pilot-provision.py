"""Provision the free-pilot databases (Neon) from the operator machine; idempotent, never drops or resets.

Run with the agent-runtime virtualenv, after `pnpm db:migrate` has migrated Product with the owner URL:
    PILOT_OWNER_PRODUCT_URL=postgresql://<owner>@<host>/sda_product?sslmode=require \
    PILOT_OWNER_RUNTIME_URL=postgresql://<owner>@<host>/sda_runtime?sslmode=require \
    apps/agent-runtime/.venv/bin/python scripts/pilot-provision.py --check | --apply [--reset-password ROLE]

--apply creates the login roles (random password, printed once as a connection URL), migrates the runtime
database and grants each role only its tables. Existing roles keep their password unless named in
--reset-password. Re-run after every Product or runtime migration so new tables are granted.
"""
import argparse
import os
import secrets
import sys

import psycopg
from psycopg import sql
from sqlalchemy.engine import make_url

from agent_runtime.infrastructure.db.grants import grant_execution_roles, grant_knowledge_roles
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import build_engine

PRODUCT_DB, RUNTIME_DB = "sda_product", "sda_runtime"
# role -> database its connection URL points at.
ROLES = {
    "pilot_product": PRODUCT_DB,
    "pilot_kb_studio": RUNTIME_DB,
    "pilot_runtime": RUNTIME_DB,
    "pilot_indexer": RUNTIME_DB,
    "pilot_cleanup": RUNTIME_DB,
}


class ProvisionError(Exception):
    pass


def target_url(env_name: str, expected_db: str) -> str:
    """Refuse anything but the pilot database names, so a stray URL can never touch another database."""
    raw = os.environ.get(env_name)
    if not raw:
        raise ProvisionError(f"{env_name} is required")
    url = make_url(raw)
    if url.get_backend_name() != "postgresql":
        raise ProvisionError(f"{env_name} must be a PostgreSQL URL")
    if url.database != expected_db:
        raise ProvisionError(f"{env_name} must point at database {expected_db}")
    return url.set(drivername="postgresql").render_as_string(hide_password=False)


def role_url(owner_url: str, role: str, password: str) -> str:
    database = ROLES[role]
    url = make_url(owner_url).set(username=role, password=password, database=database)
    if role != "pilot_product" and role != "pilot_kb_studio":
        url = url.set(drivername="postgresql+psycopg")
    return url.render_as_string(hide_password=False)


def existing_roles(conn) -> set[str]:
    rows = conn.execute("SELECT rolname FROM pg_roles WHERE rolname = ANY(%s)", (list(ROLES),)).fetchall()
    return {row[0] for row in rows}


def check(product_url: str, runtime_url: str) -> int:
    with psycopg.connect(runtime_url) as conn:
        missing = sorted(set(ROLES) - existing_roles(conn))
        extensions = {row[0] for row in conn.execute(
            "SELECT name FROM pg_available_extensions WHERE name IN ('vector', 'unaccent')").fetchall()}
        runtime_schemas = {row[0] for row in conn.execute(
            "SELECT nspname FROM pg_namespace WHERE nspname IN ('execution', 'knowledge')").fetchall()}
        version = conn.execute("SHOW server_version_num").fetchone()[0]
    with psycopg.connect(product_url) as conn:
        product_schema = conn.execute("SELECT 1 FROM pg_namespace WHERE nspname = 'product'").fetchone() is not None
    print(f"PostgreSQL {int(version) // 10000}")
    print(f"extensions available: {', '.join(sorted(extensions)) or 'none'} (need unaccent, vector)")
    print(f"product schema migrated: {'yes' if product_schema else 'no — run pnpm db:migrate first'}")
    print(f"runtime schemas: {', '.join(sorted(runtime_schemas)) or 'none yet'}")
    print(f"missing roles: {', '.join(missing) or 'none'}")
    return 0 if extensions == {"vector", "unaccent"} and product_schema else 1


def ensure_roles(owner_url: str, reset: set[str]) -> dict[str, str]:
    """Create missing login roles; only roles in `reset` get a new password. Returns the new passwords."""
    created = {}
    with psycopg.connect(owner_url, autocommit=True) as conn:
        present = existing_roles(conn)
        for role in ROLES:
            if role in present and role not in reset:
                continue
            password = secrets.token_urlsafe(24)
            verb = "ALTER" if role in present else "CREATE"
            conn.execute(sql.SQL(verb + " ROLE {} LOGIN PASSWORD {}").format(
                sql.Identifier(role), sql.Literal(password)))
            created[role] = password
    return created


def grant_product(product_url: str) -> None:
    """CRUD on Product tables; no ownership, DDL or migration journal access."""
    with psycopg.connect(product_url, autocommit=True) as conn:
        conn.execute("REVOKE ALL ON SCHEMA product FROM pilot_product")
        conn.execute("GRANT USAGE ON SCHEMA product TO pilot_product")
        conn.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA product TO pilot_product")
        conn.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA product TO pilot_product")
        conn.execute("REVOKE ALL ON product.__drizzle_migrations FROM pilot_product")
        conn.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO pilot_product").format(sql.Identifier(PRODUCT_DB)))


def apply(product_url: str, runtime_url: str, reset: set[str]) -> int:
    if check(product_url, runtime_url):
        raise ProvisionError("prerequisites missing; see --check output above")
    created = ensure_roles(runtime_url, reset)
    grant_product(product_url)
    sa_url = make_url(runtime_url).set(drivername="postgresql+psycopg").render_as_string(hide_password=False)
    upgrade_database(sa_url)
    engine = build_engine(sa_url)
    try:
        with engine.begin() as connection:
            grant_execution_roles(connection, "pilot_runtime", "pilot_cleanup")
            grant_knowledge_roles(connection, "pilot_runtime", "pilot_indexer", "pilot_kb_studio")
            connection.exec_driver_sql(
                f"GRANT CONNECT ON DATABASE {RUNTIME_DB} TO pilot_kb_studio, pilot_runtime, pilot_indexer, pilot_cleanup")
    finally:
        engine.dispose()
    print("Runtime migrated; Product and runtime grants applied")
    if created:
        print("\nNew credentials — store them in your password manager now; they are not shown again:")
        for role, password in created.items():
            print(f"  {role}: {role_url(runtime_url, role, password)}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Provision the free-pilot Neon databases")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="read-only report")
    mode.add_argument("--apply", action="store_true", help="create roles, migrate runtime, grant")
    parser.add_argument("--reset-password", action="append", default=[], choices=sorted(ROLES), metavar="ROLE")
    args = parser.parse_args(argv)
    try:
        product_url = target_url("PILOT_OWNER_PRODUCT_URL", PRODUCT_DB)
        runtime_url = target_url("PILOT_OWNER_RUNTIME_URL", RUNTIME_DB)
        if args.check:
            return check(product_url, runtime_url)
        return apply(product_url, runtime_url, set(args.reset_password))
    except ProvisionError as error:
        print(error, file=sys.stderr)
        return 2
    except Exception as error:
        # Driver errors can carry connection strings: report the type only.
        print(f"Provisioning failed: {type(error).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
