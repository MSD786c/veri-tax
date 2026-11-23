"""End-to-end: seed -> supplier responds -> officer decides. Fails if the pipeline breaks."""
import os
import tempfile

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["SEED"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

SUP = {"X-Supplier-TRN": "100333333300003"}
OFF = {"X-Officer-Id": "officer-1"}


def test_full_flow():
    with TestClient(app) as c:
        assert c.get("/health").json()["status"] == "ok"

        # Seeded auto-rejections: furniture (NR-02), bad VAT maths (TI-07), duplicate (NR-05)
        failed = {r for row in c.get("/fta/rejections", headers=OFF).json() for r in row["failed_rules"]}
        assert {"NR-02", "TI-07", "NR-05"} <= failed

        assert c.get("/supplier/requests", headers={"X-Supplier-TRN": "999"}).status_code == 401
        pending = c.get("/supplier/requests?status=PENDING", headers=SUP).json()
        assert pending and all(p["invoice"]["supplier_trn"] == SUP["X-Supplier-TRN"] for p in pending)

        for p in pending:
            r = c.post(f"/supplier/requests/{p['request']['id']}/respond", headers=SUP, json={
                "issued": True, "particulars_confirmed": True, "consideration_status": "RECEIVED",
                "vat_return_period": "2026-Q4", "declared_by": "finance@dre.example", "declaration": True})
            assert r.status_code == 200, r.text
            assert r.json()["invoice"]["status"] == "VERIFIED"
        # Responding twice is refused
        assert c.post(f"/supplier/requests/{pending[0]['request']['id']}/respond", headers=SUP, json={
            "issued": True, "declared_by": "x", "declaration": True}).status_code == 409

        apps = c.get("/fta/applications", headers=OFF).json()
        ready = [a for a in apps if a["status"] == "READY_FOR_DECISION"]
        assert ready
        d = c.post(f"/fta/applications/{ready[0]['id']}/decision", headers=OFF,
                   json={"decision": "APPROVED", "approved_amount": ready[0]["vat_eligible"]})
        assert d.status_code == 200, d.text
        detail = c.get(f"/fta/applications/{ready[0]['id']}", headers=OFF).json()
        assert detail["application"]["status"] == "APPROVED"
        assert any(e["action"] == "decide" for e in detail["audit"])

        ov = c.get("/fta/overview", headers=OFF).json()
        assert ov["refund_verified_aed"] > 0
        assert c.get("/fta/suppliers?q=steel", headers=OFF).json()[0]["trn"] == "100222222200003"
