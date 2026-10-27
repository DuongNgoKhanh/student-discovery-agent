"""Knowledge indexer: drain pending revisions, then wait on LISTEN knowledge_index with a poll fallback."""
import argparse
import logging
import os

import psycopg
from sqlalchemy.engine import make_url

from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.knowledge.indexer import IndexerService, IndexReport

POLL_SECONDS = 5  # NOTIFY is lost while no worker listens; pending rows are the real queue


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "KNOWLEDGE_INDEXER_INVALID_ARGUMENTS\n")


def drain(service: IndexerService, batch_size: int) -> IndexReport:
    total = IndexReport()
    while True:
        report = service.run_once(batch_size)
        total += report
        if report.indexed + report.failed < batch_size:
            return total


def _embedding(fake: bool):
    if fake:
        from agent_runtime.knowledge.fake import FakeEmbedding
        return FakeEmbedding()
    from agent_runtime.config.settings import Settings
    from agent_runtime.infrastructure.llm.gemini_embedding import build_embedding_port
    return build_embedding_port(Settings())


def main(argv=None) -> int:
    parser = SafeArgumentParser(description="Index pending knowledge revisions")
    parser.add_argument("--once", action="store_true", help="Drain the queue and exit")
    parser.add_argument("--batch-size", type=int, choices=range(1, 101), default=20)
    parser.add_argument("--requeue", metavar="KB_ID", help="Re-embed every active revision of a knowledge base")
    parser.add_argument("--fake-embedding", action="store_true", help="Offline demo embedding (never production)")
    args = parser.parse_args(argv)
    logging.basicConfig(format="%(message)s")
    url = os.environ.get("RUNTIME_KNOWLEDGE_INDEXER_DATABASE_URL")
    if not url:
        print("KNOWLEDGE_INDEXER_CONFIGURATION_REQUIRED")
        return 2
    engine = build_engine(url)
    service = IndexerService(RuntimeUnitOfWork(engine), _embedding(args.fake_embedding))
    try:
        if args.requeue:
            print(f"requeued={service.requeue_knowledge_base(args.requeue)}")
            return 0
        if args.once:
            report = drain(service, args.batch_size)
            print(f"indexed={report.indexed} failed={report.failed} embedded={report.embedded} "
                  f"reused={report.reused} reclaimed={report.reclaimed} purged={report.purged}")
            return 1 if report.failed else 0
        conninfo = make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)
        with psycopg.connect(conninfo, autocommit=True) as listener:
            listener.execute("LISTEN knowledge_index")
            while True:
                drain(service, args.batch_size)
                for _ in listener.notifies(timeout=POLL_SECONDS, stop_after=1):
                    pass
    except KeyboardInterrupt:
        return 0
    except Exception:
        print("KNOWLEDGE_INDEXER_FAILURE")
        return 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
