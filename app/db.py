import os
from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine

from app.models import AuditEvent

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./veritax.db")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)


SCHEMA_VERSION = 2  # bump when a table changes


def init_db() -> None:
    # ponytail: create_all, no migrations. Add Alembic once the schema stops moving.
    # Until then a local SQLite file from an older schema is rebuilt (it only ever holds seed data).
    if DATABASE_URL.startswith("sqlite"):
        with engine.connect() as conn:
            version = conn.exec_driver_sql("PRAGMA user_version").scalar()
            has_tables = conn.exec_driver_sql("SELECT count(*) FROM sqlite_master WHERE type='table'").scalar()
        if has_tables and version != SCHEMA_VERSION:
            SQLModel.metadata.drop_all(engine)
        SQLModel.metadata.create_all(engine)
        with engine.connect() as conn:
            conn.exec_driver_sql(f"PRAGMA user_version = {SCHEMA_VERSION}")
        return
    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def audit(session: Session, actor: str, action: str, entity: str, **detail) -> None:
    """Append-only audit trail. Caller commits."""
    session.add(AuditEvent(actor=actor, action=action, entity=entity, detail=detail))
