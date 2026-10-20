import os

import pytest


def pytest_addoption(parser):
    parser.addoption("--require-runtime-db", action="store_true", help="Fail if the dedicated test DB is unavailable")


def pytest_configure(config):
    config.addinivalue_line("markers", "integration: requires a disposable PostgreSQL 16 database")
    if config.getoption("--require-runtime-db") and not os.environ.get("RUNTIME_TEST_ADMIN_DATABASE_URL"):
        raise pytest.UsageError("--require-runtime-db requires RUNTIME_TEST_ADMIN_DATABASE_URL")
