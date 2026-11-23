"""Endpoints the web portal relies on: rule catalog, bulk supplier responses, FTA filters,
decision guards and serving the built portal. Creates its own data, so it is order-independent."""
import os
import tempfile
from datetime import date, timedelta

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("SEED", "1")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.main as main  # noqa: E402

TRN = "100555555500003"
SUP = {"X-Supplier-TRN": TRN}
OTHER_SUP = {"X-Supplier-TRN": "100111111100003"}
OFF = {"X-Officer-Id": "officer-portal"}
CONFIRM = {"issued": True, "particulars_confirmed": True, "consideration_status": "RECEIVED",
           "received_date": str(date.today()), "vat_return_period": "2026-Q4",
           "declared_by": "accounts@falcon.example", "declaration": True}


@pytest.fixture(scope="module")
def c():
    with TestClient(main.app) as client:
        yield client


@pytest.fixture(scope="module")
def ingested(c):
    completion = date.today() - timedelta(days=30)
    inv = lambda no, taxable, desc: {  # noqa: E731
        "supplier_trn": TRN, "supplier_name": "Falcon Glass & Aluminium LLC", "invoice_no": no,
        "invoice_date": str(completion - timedelta(days=40)), "taxable_amount": taxable,
        "vat_amount": round(taxable * 0.05, 2), "total": round(taxable * 1.05, 2), "plot_no": "RAK-9-17", "description": desc}
    r = c.post("/maskan/applications", json={
        "maskan_ref": "MSK-TEST-PORTAL", "applicant_name": "Mariam Al Nuaimi", "emirates_id": "784-1992-0000001-1",
        "plot_no": "RAK-9-17", "emirate": "Ras Al Khaimah", "completion_date": str(completion),
        "invoices": [inv("FGA-1", 60000, "Aluminium windows"), inv("FGA-2", 20000, "Glass balustrade"),
                     inv("FGA-3", 5000, "Dining table and chairs furniture")]})
    assert r.status_code == 201, r.text
    return r.json()


def test_rule_catalog(c):
    body = c.get("/meta/rules").json()
    assert body["ruleset_version"]
    assert len(body["rules"]) == 21
    assert body["rules"]["NR-02"]["implemented"] is True
    assert body["rules"]["SC-06"]["implemented"] is False


def test_bulk_respond_is_all_or_nothing(c, ingested):
    pending = c.get("/supplier/requests?status=PENDING", headers=SUP).json()
    assert len(pending) == 2  # the furniture invoice was auto-rejected (NR-02), so it never reaches the supplier
    ids = [p["request"]["id"] for p in pending]
    foreign = c.get("/supplier/requests", headers=OTHER_SUP).json()[0]["request"]["id"]

    r = c.post("/supplier/requests/bulk-respond", headers=SUP,
               json={"items": [{**CONFIRM, "request_id": ids[0]}, {**CONFIRM, "request_id": foreign}]})
    assert r.status_code == 409
    assert r.json()["detail"]["errors"] == [{"request_id": foreign, "error": "request not found"}]
    assert len(c.get("/supplier/requests?status=PENDING", headers=SUP).json()) == 2  # nothing saved

    r = c.post("/supplier/requests/bulk-respond", headers=SUP,
               json={"items": [{**CONFIRM, "request_id": i, "declaration": False} for i in ids]})
    assert r.status_code == 422

    r = c.post("/supplier/requests/bulk-respond", headers=SUP, json={"items": [{**CONFIRM, "request_id": i} for i in ids]})
    assert r.status_code == 200, r.text
    assert [v["invoice"]["status"] for v in r.json()] == ["VERIFIED", "VERIFIED"]
    assert c.get("/supplier/requests?status=PENDING", headers=SUP).json() == []


def test_fta_filters_and_overview(c, ingested):
    by_supplier = c.get(f"/fta/applications?supplier_trn={TRN}", headers=OFF).json()
    assert [a["maskan_ref"] for a in by_supplier] == ["MSK-TEST-PORTAL"]
    assert c.get("/fta/applications?q=nuaimi", headers=OFF).json()[0]["id"] == ingested["id"]
    assert ingested["id"] in {a["id"] for a in c.get("/fta/applications?rule_failed=NR-02", headers=OFF).json()}
    assert c.get("/fta/applications?min_vat=999999999", headers=OFF).json() == []

    rej = c.get(f"/fta/rejections?rule_id=NR-02&supplier_trn={TRN}", headers=OFF).json()
    assert [r["invoice"]["invoice_no"] for r in rej] == ["FGA-3"]
    assert rej[0]["maskan_ref"] == "MSK-TEST-PORTAL"

    detail = c.get(f"/fta/suppliers/{TRN}", headers=OFF).json()
    assert {i["maskan_ref"] for i in detail["invoices"]} == {"MSK-TEST-PORTAL"}
    assert "2026-Q4" in detail["declared_vat_periods"]

    ov = c.get("/fta/overview", headers=OFF).json()
    assert ov["applications_new"]["month"] >= 1
    assert ov["avg_response_hours"] is not None
    assert ov["invoices_by_status"]["VERIFIED"] >= 2


def test_decision_guards(c, ingested):
    app_id = ingested["id"]
    row = next(a for a in c.get("/fta/applications", headers=OFF).json() if a["id"] == app_id)
    assert row["status"] == "READY_FOR_DECISION"
    url = f"/fta/applications/{app_id}/decision"
    assert c.post(url, headers=OFF, json={"decision": "REJECTED", "approved_amount": 10}).status_code == 422
    assert c.post(url, headers=OFF, json={"decision": "APPROVED", "approved_amount": 0}).status_code == 422
    assert c.post(url, headers=OFF, json={"decision": "APPROVED", "approved_amount": row["vat_claimed"] + 1}).status_code == 422
    r = c.post(url, headers=OFF, json={"decision": "PARTIALLY_APPROVED", "approved_amount": row["vat_eligible"], "comments": "FGA-3 excluded"})
    assert r.status_code == 200, r.text
    assert c.post(url, headers=OFF, json={"decision": "APPROVED", "approved_amount": 1}).status_code == 409
    actions = [e["action"] for e in c.get(f"/fta/applications/{app_id}", headers=OFF).json()["audit"]]
    assert {"ingest", "verify", "respond", "reconcile", "decide"} <= set(actions)  # supplier responses included


def test_portal_serving(c, tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PORTAL_DIST", tmp_path)
    assert c.get("/portal/").status_code == 404  # not built yet
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<div id=root></div>")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    assert c.get("/portal/fta/applications/3").text == "<div id=root></div>"  # client-side route
    assert c.get("/portal/assets/app.js").text == "console.log(1)"
    assert c.get("/portal/..%2F..%2Fpyproject.toml").text == "<div id=root></div>"  # no escaping the dist dir
    assert c.get("/", follow_redirects=False).headers["location"] == "/portal/"
