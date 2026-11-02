"""Knowledge test helpers: role-scoped engines, raw psycopg connection strings and an indexer rig."""

from dataclasses import dataclass

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url

from agent_runtime.infrastructure.db.grants import grant_knowledge_roles
from agent_runtime.infrastructure.db.migrate import upgrade_database
from agent_runtime.infrastructure.db.session import RuntimeUnitOfWork, build_engine
from agent_runtime.knowledge.authoring import KnowledgeWriter
from agent_runtime.knowledge.embedding import by_model
from agent_runtime.knowledge.fake import FakeEmbedding
from agent_runtime.knowledge.indexer import IndexerService


def psycopg_conninfo(url: str) -> str:
    return make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)


def role_engine(url: str, role: str) -> Engine:
    """Every pooled connection runs as ``role``; the admin login must be a member (superuser in tests)."""
    return create_engine(make_url(url).set(drivername="postgresql+psycopg"), isolation_level="READ COMMITTED",
                         connect_args={"options": f"-c timezone=UTC -c role={role}"})


@dataclass
class KnowledgeRig:
    engine: Engine
    indexer_engine: Engine
    uow: RuntimeUnitOfWork
    writer: KnowledgeWriter
    indexer: IndexerService
    embedding: FakeEmbedding

    def dispose(self) -> None:
        self.engine.dispose()
        self.indexer_engine.dispose()


def knowledge_rig(test_database, *, embedding: FakeEmbedding | None = None) -> KnowledgeRig:
    """Writer as the owner, indexer as the least-privileged indexer role; KB 'kb1' with a 'houses' field."""
    upgrade_database(test_database.url)
    engine = build_engine(test_database.url)
    with engine.begin() as connection:
        grant_knowledge_roles(connection, test_database.runtime_role, test_database.indexer_role)
    embedding = embedding or FakeEmbedding()
    indexer_engine = role_engine(test_database.url, test_database.indexer_role)
    uow = RuntimeUnitOfWork(engine)
    writer = KnowledgeWriter(uow)
    writer.create_knowledge_base("kb1", "KB", embedding.model)
    writer.put_field("kb1", "houses", "string_list", filterable=True)
    writer.put_field("kb1", "province", "string", filterable=True)
    return KnowledgeRig(engine, indexer_engine, uow, writer,
                        IndexerService(RuntimeUnitOfWork(indexer_engine), by_model(embedding)), embedding)
