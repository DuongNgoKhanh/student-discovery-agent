"""Own all created resources; never migrate or clean the supplied admin database."""

import os
import re
from dataclasses import dataclass, field
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from sqlalchemy.engine import URL


@dataclass(repr=False)
class TestDatabase:
    url: str = field(repr=False)
    runtime_role: str
    cleanup_role: str


@pytest.fixture
def test_database(request):
    supplied = os.environ.get("RUNTIME_TEST_ADMIN_DATABASE_URL")
    if not supplied:
        if request.config.getoption("--require-runtime-db"):
            pytest.fail("dedicated PostgreSQL test configuration is required")
        pytest.skip("RUNTIME_TEST_ADMIN_DATABASE_URL is not configured")
    try:
        options = conninfo_to_dict(supplied)
    except psycopg.Error:
        pytest.fail("invalid dedicated PostgreSQL test configuration", pytrace=False)
    # Only an explicitly configured administrative/test database is eligible.
    database = options.get("dbname", "")
    if database != "postgres" and not database.startswith("sda_b01_"):
        pytest.fail("dedicated test admin database must be postgres or sda_b01_*", pytrace=False)
    suffix = uuid4().hex
    name = f"sda_b01_test_{suffix}"
    roles = (f"sda_b01_runtime_{suffix}", f"sda_b01_cleanup_{suffix}")
    created_roles = {}
    database_oid = None
    admin = None
    try:
        try:
            admin = psycopg.connect(supplied, autocommit=True, connect_timeout=5)
        except psycopg.Error:
            pytest.fail("cannot connect to the dedicated PostgreSQL test server", pytrace=False)
        if admin.info.server_version // 10000 != 16:
            pytest.fail("integration tests require PostgreSQL 16", pytrace=False)
        for role in roles:
            admin.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(role)))
            created_roles[role] = admin.execute("SELECT oid FROM pg_roles WHERE rolname = %s", (role,)).fetchone()[0]
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        database_oid = admin.execute("SELECT oid FROM pg_database WHERE datname = %s", (name,)).fetchone()[0]
        test_options = {**options, "dbname": name}
        test_conninfo = make_conninfo(**test_options)
        with psycopg.connect(test_conninfo) as connection:
            connection.execute("CREATE SCHEMA product")
            connection.execute("CREATE TABLE product.sentinel (value text NOT NULL)")
            connection.execute("INSERT INTO product.sentinel VALUES ('preserve me')")
        known = {key: test_options.pop(key, None) for key in ("user", "password", "host", "port", "dbname")}
        url = URL.create(
            "postgresql+psycopg", username=known["user"], password=known["password"], host=known["host"],
            port=int(known["port"]) if known["port"] else None, database=known["dbname"], query=test_options,
        ).render_as_string(hide_password=False)
        yield TestDatabase(url, *roles)
    finally:
        if admin is not None:
            try:
                if database_oid is not None:
                    actual = admin.execute("SELECT oid FROM pg_database WHERE datname = %s", (name,)).fetchone()
                    assert re.fullmatch(r"sda_b01_test_[0-9a-f]{32}", name)
                    assert actual is not None and actual[0] == database_oid, "test DB identity changed; refusing cleanup"
                    admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
                for role, oid in created_roles.items():
                    actual = admin.execute("SELECT oid FROM pg_roles WHERE rolname = %s", (role,)).fetchone()
                    assert role in roles and role.endswith(suffix) and actual is not None and actual[0] == oid
                    admin.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(role)))
            finally:
                admin.close()
