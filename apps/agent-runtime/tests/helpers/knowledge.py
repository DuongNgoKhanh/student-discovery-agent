"""Knowledge test helpers: role-scoped engines and raw psycopg connection strings."""

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url


def psycopg_conninfo(url: str) -> str:
    return make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)


def role_engine(url: str, role: str) -> Engine:
    """Every pooled connection runs as ``role``; the admin login must be a member (superuser in tests)."""
    return create_engine(make_url(url).set(drivername="postgresql+psycopg"), isolation_level="READ COMMITTED",
                         connect_args={"options": f"-c timezone=UTC -c role={role}"})
