"""Isolated env for every test run: temp DB + data dir, fixed portal token, no real LLM calls."""
import contextlib
import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ.update(DATABASE_URL=f"sqlite:///{_tmp}/test.db", DATA_DIR=f"{_tmp}/data", SEED="1",
                  MASKAN_PORTAL_TOKEN="test-token", GROQ_API_KEY="", AGENT_PROVIDER="")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app import db  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True, scope="module")
def fresh_db():
    """Every test module starts from a freshly seeded database, so modules can't see each other's data."""
    from app.seed import seed
    SQLModel.metadata.drop_all(db.engine)
    db.init_db()
    seed()
    yield


@pytest.fixture(scope="module")
def client(fresh_db):
    with TestClient(app) as c:
        yield c


def link_stub_documents(maskan_ref: str | None = None) -> None:
    """FTA officers only see a case once an original document is linked (pipeline.officer_visible_ids).
    Seeded / API-ingested test cases have none, so attach a stub original to every unlinked invoice
    (of one application, or all). Ratings are untouched: nothing is re-verified."""
    from sqlmodel import Session, col, select

    from app.models import Application, Document, Invoice
    with Session(db.engine) as s:
        q = select(Invoice).where(col(Invoice.document_hash).is_(None))
        if maskan_ref:
            q = q.join(Application, Application.id == Invoice.application_id).where(Application.maskan_ref == maskan_ref)
        for inv in s.exec(q).all():
            inv.document_hash = f"stub-{inv.id}"
            s.add(Document(sha256=inv.document_hash, filename=f"{inv.invoice_no}.pdf", content_type="application/pdf",
                           size=0, path=os.devnull, source="maskan"))
        s.commit()


@contextlib.contextmanager
def officer_sees_everything():
    """For tests that inspect pipeline internals (extraction, linking) through the officer API before the
    supplier step closes. The visibility rule itself is tested in tests/test_visibility.py."""
    from unittest.mock import patch

    from sqlmodel import Session, select

    from app import pipeline
    from app.models import Application
    with patch.object(pipeline, "officer_visible_ids", lambda s: set(s.exec(select(Application.id)).all())):
        yield
