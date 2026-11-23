import os
from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine

from app.models import AuditEvent

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./veritax.db")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)


def init_db() -> None:
    # ponytail: create_all, no migrations. Add Alembic once the schema stops moving.
    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def audit(session: Session, actor: str, action: str, entity: str, **detail) -> None:
    """Append-only audit trail. Caller commits."""
    session.add(AuditEvent(actor=actor, action=action, entity=entity, detail=detail))
