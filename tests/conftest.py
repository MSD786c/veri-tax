"""Isolated env for every test run: temp DB + data dir, fixed portal token, no real LLM calls."""
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
