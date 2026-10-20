"""Short synchronous READ COMMITTED units of work and a fresh database clock."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker


def build_engine(url: str) -> Engine:
    parsed = make_url(url)
    if parsed.get_backend_name() != "postgresql":
        raise ValueError("runtime persistence requires PostgreSQL")
    return create_engine(
        parsed.set(drivername="postgresql+psycopg"), isolation_level="READ COMMITTED",
        pool_pre_ping=True, hide_parameters=True, connect_args={"options": "-c timezone=UTC"},
    )


class RuntimeUnitOfWork:
    def __init__(self, engine: Engine):
        self._sessions = sessionmaker(bind=engine, expire_on_commit=False)

    @contextmanager
    def begin(self) -> Iterator[Session]:
        with self._sessions.begin() as session:
            yield session


class DatabaseClock:
    def now(self, session: Session) -> datetime:
        # Call after the parent lock: transaction_timestamp()/now() can predate a lock wait.
        return session.execute(text("SELECT clock_timestamp()")).scalar_one().astimezone(timezone.utc)
