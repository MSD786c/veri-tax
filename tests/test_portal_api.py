"""Endpoints the web portal relies on: rule catalog, bulk supplier responses, FTA filters,
decision guards and serving the built portal. Creates its own data, so it is order-independent."""
import os
import re
import tempfile
from datetime import date, timedelta
from pathlib import Path

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")
os.environ.setdefault("SEED", "1")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session  # noqa: E402

import app.main as main  # noqa: E402
from app.db import engine  # noqa: E402
from app.models import Supplier  # noqa: E402
from app.rules import RULE_CATALOG  # noqa: E402

TRN = "100999999900003"  # not in the seed
SUP = {"X-Supplier-TRN": TRN}
OTHER_SUP = {"X-Supplier-TRN": "100111111100003"}  # Al Noor: has requests in the seed
OFF = {"X-Officer-Id": "officer-portal"}
APPLICANT = "Mariam Al Nuaimi"
CONFIRM = {"issued": True, "particulars_confirmed": True, "consideration_status": "RECEIVED",
           "received_date": str(date.today()), "vat_return_period": f"{date.today().year}-Q{(date.today().month - 1) // 3 + 1}",
           "declared_by": "accounts@falcon.example", "declaration": True}


@pytest.fixture(scope="module")
def c():
    with TestClient(main.app) as client:
        yield client


@pytest.fixture(scope="module")
def ingested(c):
    with Session(engine) as s:  # a supplier the FTA registry knows (TI-03), so clean invoices can rate STRONG
        s.add(Supplier(trn=TRN, legal_name="Falcon Glass & Aluminium LLC", address="Al Jazeera Al Hamra, Ras Al Khaimah",
                       emirate="Ras Al Khaimah", registry_verified=True, registered_from=date(2019, 1, 1)))
        s.commit()
    completion = date.today() - timedelta(days=30)

    def inv(no, taxable, desc):  # a full tax invoice with every Article 59 particular captured
        return {"supplier_trn": TRN, "supplier_name": "Falcon Glass & Aluminium LLC", "invoice_no": no,
                "supplier_address": "Al Jazeera Al Hamra, Ras Al Khaimah", "invoice_type": "FULL",
                "recipient_name": APPLICANT, "recipient_address": "Plot RAK-9-17",
                "line_items": [{"description": desc, "quantity": 1, "unit_price": taxable, "amount": taxable}],
                "invoice_date": str(completion - timedelta(days=40)), "taxable_amount": taxable,
                "vat_amount": round(taxable * 0.05, 2), "total": round(taxable * 1.05, 2), "plot_no": "RAK-9-17", "description": desc}

    r = c.post("/maskan/applications", json={
        "maskan_ref": "MSK-TEST-PORTAL", "applicant_name": APPLICANT, "emirates_id": "784-1992-0000001-1",
        "plot_no": "RAK-9-17", "emirate": "Ras Al Khaimah", "completion_date": str(completion),
        "invoices": [inv("FGA-1", 60000, "Aluminium windows and doors"), inv("FGA-2", 20000, "Waterproofing and roof insulation"),
                     inv("FGA-3", 5000, "Dining table and chairs furniture")]})
    assert r.status_code == 201, r.text
    from tests.conftest import link_stub_documents
    link_stub_documents("MSK-TEST-PORTAL")  # documents linked + FGA-3 rated FAIL: visible to officers
    return r.json()


def test_rule_catalog_covers_every_rule_the_engine_emits(c):
    body = c.get("/meta/rules").json()
    assert body["ruleset_version"] == "2026.11-1"
    assert body["rules"]["TI-09"]["implemented"] is True
    assert body["rules"]["SC-06"]["implemented"] is False
    root = Path(main.__file__).parent
    emitted = set(re.findall(r'"((?:TI|NR|SC|CS|EX)-\d\d)', (root / "rules.py").read_text().split("RULE_CATALOG")[0]
                             + (root / "rules.py").read_text().split("\nCheck = ")[1] + (root / "pipeline.py").read_text()))
    assert emitted <= set(RULE_CATALOG), f"rules missing from the catalog: {emitted - set(RULE_CATALOG)}"


def test_bulk_respond_is_all_or_nothing(c, ingested):
    pending = c.get("/supplier/requests?status=PENDING", headers=SUP).json()
    assert len(pending) == 2  # the furniture invoice is rated FAIL (NR-02) and never sent to the supplier
    ids = [p["request"]["id"] for p in pending]
    foreign = c.get("/supplier/requests", headers=OTHER_SUP).json()[0]["request"]["id"]  # another supplier's, any status

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
    assert [v["invoice"]["status"] for v in r.json()] == ["VERIFIED"] * 2
    assert all("rating" not in v["invoice"] for v in r.json())  # FTA-internal, never sent to suppliers
    from tests.test_flow import _officer_invoice
    assert [_officer_invoice(c, v["invoice"]["id"])["rating"] for v in r.json()] == ["STRONG"] * 2
    assert c.get("/supplier/requests?status=PENDING", headers=SUP).json() == []


def test_fta_filters_and_overview(c, ingested):
    by_supplier = c.get(f"/fta/applications?supplier_trn={TRN}", headers=OFF).json()
    assert [a["maskan_ref"] for a in by_supplier] == ["MSK-TEST-PORTAL"]
    assert by_supplier[0]["invoices_by_rating"]["FAIL"] == 1
    assert c.get("/fta/applications?q=nuaimi", headers=OFF).json()[0]["id"] == ingested["id"]
    assert ingested["id"] in {a["id"] for a in c.get("/fta/applications?rule_failed=NR-02", headers=OFF).json()}
    assert c.get("/fta/applications?min_vat=999999999", headers=OFF).json() == []

    rej = c.get(f"/fta/rejections?rule_id=NR-02&supplier_trn={TRN}", headers=OFF).json()
    assert [(r["invoice"]["invoice_no"], r["invoice"]["status"], r["invoice"]["rating"]) for r in rej] == [("FGA-3", "FLAGGED", "FAIL")]
    assert rej[0]["maskan_ref"] == "MSK-TEST-PORTAL"
    assert c.get(f"/fta/rejections?rating=STRONG&supplier_trn={TRN}", headers=OFF).json() == []

    detail = c.get(f"/fta/suppliers/{TRN}", headers=OFF).json()
    assert {i["maskan_ref"] for i in detail["invoices"]} == {"MSK-TEST-PORTAL"}
    assert CONFIRM["vat_return_period"] in detail["declared_vat_periods"]
    assert detail["trust"]["tier"] in {"STANDARD", "TRUSTED"}

    ov = c.get("/fta/overview", headers=OFF).json()
    assert ov["applications_new"]["month"] >= 1
    assert ov["avg_response_hours"] is not None
    assert ov["invoices_by_status"]["VERIFIED"] >= 2
    assert ov["invoices_by_rating"]["STRONG"] >= 2


def test_decision_guards_and_audit(c, ingested):
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
