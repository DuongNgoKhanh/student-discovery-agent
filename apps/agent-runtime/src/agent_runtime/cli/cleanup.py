"""Scheduler entry point: one batch per invocation, using only cleanup credentials."""
import argparse
import logging
import os

from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.sessions.services.cleanup import CleanupService


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "CLEANUP_INVALID_ARGUMENTS\n")


def main(argv=None) -> int:
    parser = SafeArgumentParser(description="One execution retention batch")
    parser.add_argument("--once", required=True, action="store_true")
    parser.add_argument("--batch-size", type=int, choices=range(1, 101), default=100)
    args = parser.parse_args(argv)
    logging.basicConfig(format="%(message)s")
    logging.getLogger("agent_runtime.sessions.services.cleanup").setLevel(logging.INFO)
    url = os.environ.get("RUNTIME_CLEANUP_DATABASE_URL")
    if not url:
        print("CLEANUP_CONFIGURATION_REQUIRED")
        return 2
    engine = None
    try:
        engine = build_engine(url)
        report = CleanupService(RuntimeUnitOfWork(engine)).run_once(args.batch_size)
        print(f"expired={report.expired} purged={report.purged} traces_purged={report.traces_purged} "
              f"failed_batches={report.failed_batches}")
        return 1 if report.failed_batches else 0
    except Exception:
        print("CLEANUP_FAILURE")
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
