import logging
from contextlib import contextmanager
from datetime import UTC, datetime

from agent_runtime.knowledge.indexer import IndexerService, IndexJob


class Session:
    def __init__(self, log):
        self.log = log

    def execute(self, statement, params=None):
        self.log.append(str(statement))

        class Result:
            rowcount = 0

            def mappings(self):
                return self

            def first(self):
                return None
        return Result()


class Uow:
    def __init__(self):
        self.statements = []

    @contextmanager
    def begin(self):
        yield Session(self.statements)


class Exploding(dict):
    def get(self, key, default=None):
        raise RuntimeError("provider said: secret-api-key body text")


JOB = IndexJob("rev-1", "doc-1", 1, "kb1", "fake-embedding", "T", "secret body", datetime(2026, 1, 1, tzinfo=UTC))


def test_run_once_never_purges_archived_chunks():
    uow = Uow()
    IndexerService(uow, {}).run_once()
    assert not any("DELETE FROM knowledge.chunks" in statement for statement in uow.statements)


def test_index_failure_logs_the_type_and_revision_only(caplog):
    caplog.set_level(logging.DEBUG)
    report = IndexerService(Uow(), Exploding()).index(JOB)
    assert report.failed == 1
    assert "RuntimeError" in caplog.text and "rev-1" in caplog.text
    assert "secret" not in caplog.text and "Traceback" not in caplog.text
    assert all(record.exc_info is None for record in caplog.records)
