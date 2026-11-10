import os

import pytest


def pytest_addoption(parser):
    parser.addoption("--require-runtime-db", action="store_true", help="Fail if the dedicated test DB is unavailable")


def pytest_configure(config):
    config.addinivalue_line("markers", "integration: requires a disposable PostgreSQL 16 database")
    if config.getoption("--require-runtime-db") and not os.environ.get("RUNTIME_TEST_ADMIN_DATABASE_URL"):
        raise pytest.UsageError("--require-runtime-db requires RUNTIME_TEST_ADMIN_DATABASE_URL")


@pytest.fixture
def fresh_agent_runtime_imports():
    """Let a test purge and re-import agent_runtime modules, then restore the originals.

    Without the restore, later tests keep references to classes from the old modules while
    new imports resolve to reloaded copies, which breaks isinstance checks and app wiring.
    """
    import sys

    saved = {
        name: mod for name, mod in sys.modules.items() if name == "agent_runtime" or name.startswith("agent_runtime.")
    }
    attrs = {name: dict(vars(mod)) for name, mod in saved.items()}
    yield
    for name in [n for n in sys.modules if n == "agent_runtime" or n.startswith("agent_runtime.")]:
        del sys.modules[name]
    sys.modules.update(saved)
    for name, mod in saved.items():
        vars(mod).clear()
        vars(mod).update(attrs[name])
