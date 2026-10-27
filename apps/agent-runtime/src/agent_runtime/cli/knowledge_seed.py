"""Load the fictional IHRD demo knowledge base; idempotent, uses the content-owner credentials."""
import argparse
import os

from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.knowledge.authoring import KnowledgeWriter
from agent_runtime.knowledge.fixtures.ihrd_demo import IHRD_DEMO, load_dataset


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "KNOWLEDGE_SEED_INVALID_ARGUMENTS\n")


def main(argv=None) -> int:
    parser = SafeArgumentParser(description="Load the demo knowledge base")
    parser.add_argument("--embedding-model", help="Override the dataset's embedding model (e.g. fake-embedding)")
    args = parser.parse_args(argv)
    url = os.environ.get("RUNTIME_KNOWLEDGE_SEED_DATABASE_URL")
    if not url:
        print("KNOWLEDGE_SEED_CONFIGURATION_REQUIRED")
        return 2
    engine = build_engine(url)
    try:
        writer = KnowledgeWriter(RuntimeUnitOfWork(engine))
        created = load_dataset(writer, IHRD_DEMO, embedding_model=args.embedding_model)
        print(f"created={created}")
        return 0
    except Exception:
        print("KNOWLEDGE_SEED_FAILURE")
        return 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
