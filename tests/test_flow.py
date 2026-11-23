"""End-to-end: seed -> rating -> supplier responds -> officer decides. Fails if the pipeline breaks."""
import os
import tempfile
from datetime import date, timedelta

os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["SEED"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.seed import COMPLETION, COMPLETION_QUARTER, SUPPLIERS  # noqa: E402

SUP = {"X-Supplier-TRN": "100333333300003"}
OFF = {"X-Officer-Id": "officer-1"}


def _officer_invoice(c, invoice_id: int) -> dict:
    """The invoice as an FTA officer sees it (with rating); suppliers never get these fields."""
    for a in c.get("/fta/applications", headers=OFF).json():
        for row in c.get(f"/fta/applications/{a['id']}", headers=OFF).json()["invoices"]:
            if row["invoice"]["id"] == invoice_id:
                return row["invoice"]
    raise AssertionError(f"invoice {invoice_id} not found")
CONFIRM = {"issued": True, "particulars_confirmed": True, "consideration_status": "RECEIVED",
           "vat_return_period": COMPLETION_QUARTER, "declared_by": "finance@dre.example", "declaration": True}


def _invoices(c: TestClient) -> dict[tuple[str, str], dict]:
    """(maskan_ref, invoice_no) -> invoice, across every application."""
    out = {}
    for a in c.get("/fta/applications", headers=OFF).json():
        for row in c.get(f"/fta/applications/{a['id']}", headers=OFF).json()["invoices"]:
            out[(a["maskan_ref"], row["invoice"]["invoice_no"])] = row
    return out


def _results(row: dict) -> dict[str, str]:
    return {r["rule_id"]: r["result"] for r in sorted(row["rule_results"], key=lambda r: r["id"])}


def _new_application(ref: str, invoices: list[dict], **kw) -> dict:
    return {"maskan_ref": ref, "applicant_name": "Mariam Al Nuaimi", "emirates_id": f"784-1988-{ref[-7:]}-9",
            "plot_no": "RAK-9-77", "emirate": "Ras Al Khaimah", "completion_date": str(COMPLETION), **kw, "invoices": invoices}


def _invoice(no: str, desc: str, taxable: float = 10000, trn: str = "100222222200003", **kw) -> dict:
    return {"supplier_trn": trn, "supplier_name": SUPPLIERS[trn][0], "supplier_address": SUPPLIERS[trn][1],
            "invoice_no": no, "invoice_date": str(COMPLETION - timedelta(days=50)), "taxable_amount": taxable,
            "vat_amount": round(taxable * 0.05, 2), "total": round(taxable * 1.05, 2), "plot_no": "RAK-9-77",
            "description": desc, "recipient_name": "Mariam Al Nuaimi", "recipient_address": "Plot RAK-9-77",
            "line_items": [{"description": desc, "quantity": 1, "unit_price": taxable, "amount": taxable}], **kw}


def test_full_flow():
    with TestClient(app) as c:
        assert c.get("/health").json()["status"] == "ok"

        # --- Seeded ratings: every outcome is present -------------------------------------
        inv = _invoices(c)
        rating = {k: v["invoice"]["rating"] for k, v in inv.items()}
        assert rating[("MSK-2026-0002", "ANB-1044")] == "STRONG"
        assert rating[("MSK-2026-0001", "FPL-210")] == "STRONG"  # pool: eligible from 1 Jan 2026
        assert rating[("MSK-2026-0001", "GSC-77")] == "WEAK"  # supplier corrected the amount
        assert rating[("MSK-2026-0002", "OSS-15")] == "WEAK"  # CCTV: unclear in the guide
        assert rating[("MSK-2026-0003", "MAG-91")] == "WEAK"  # supplier never responded
        assert inv[("MSK-2026-0003", "MAG-91")]["invoice"]["status"] == "NO_SUPPLIER_RESPONSE"
        for key, rule in {("MSK-2026-0002", "EHF-9"): "NR-02", ("MSK-2026-0002", "GSC-80"): "TI-07",
                          ("MSK-2026-0002", "MAG-88"): "TI-09", ("MSK-2026-0003", "SPL-3"): "TI-03",
                          ("MSK-2026-0003", "ANB-1001"): "NR-05"}.items():
            assert rating[key] == "FAIL", key
            assert _results(inv[key])[rule] == "FAIL", key
            # A FAIL is a recommendation: nothing is rejected until an officer decides.
            assert inv[key]["invoice"]["status"] == "FLAGGED" and inv[key]["invoice"]["officer_decision"] is None
        assert rating[("MSK-2026-0002", "FPL-233")] == "FAIL" and inv[("MSK-2026-0002", "FPL-233")]["invoice"]["status"] == "DISPUTED"
        # Duplicate: the later claim fails, and the earlier claim of the same invoice is flagged too.
        assert rating[("MSK-2026-0001", "ANB-1001")] == "WEAK"
        assert _results(inv[("MSK-2026-0001", "ANB-1001")])["NR-05"] == "UNCERTAIN"
        assert inv[("MSK-2026-0002", "EHF-9")]["invoice"]["fix_guidance"]  # "what would make this strong"

        failed = {r for row in c.get("/fta/rejections", headers=OFF).json() for r in row["failed_rules"]}
        assert {"NR-02", "TI-07", "NR-05", "TI-09", "TI-03"} <= failed

        # --- Supplier portal --------------------------------------------------------------
        assert c.get("/supplier/requests", headers={"X-Supplier-TRN": "999"}).status_code == 401
        pending = c.get("/supplier/requests?status=PENDING", headers=SUP).json()
        assert pending and all(p["invoice"]["supplier_trn"] == SUP["X-Supplier-TRN"] for p in pending)
        assert all("rating" not in p["invoice"] and "fix_guidance" not in p["invoice"] for p in pending)  # FTA-internal
        for p in pending:
            r = c.post(f"/supplier/requests/{p['request']['id']}/respond", headers=SUP, json=CONFIRM)
            assert r.status_code == 200, r.text
            assert r.json()["invoice"]["status"] == "VERIFIED" and "rating" not in r.json()["invoice"]
            assert _officer_invoice(c, r.json()["invoice"]["id"])["rating"] == "STRONG"
        # Responding twice is refused
        assert c.post(f"/supplier/requests/{pending[0]['request']['id']}/respond", headers=SUP, json={
            "issued": True, "declared_by": "x", "declaration": True}).status_code == 409

        # --- Officer decides: per invoice, then the application ----------------------------
        apps = {a["maskan_ref"]: a for a in c.get("/fta/applications", headers=OFF).json()}
        ready = apps["MSK-2026-0001"]
        assert ready["status"] == "READY_FOR_DECISION"
        weak = _invoices(c)[("MSK-2026-0001", "GSC-77")]["invoice"]
        d = c.post(f"/fta/invoices/{weak['id']}/decision", headers=OFF,
                   json={"decision": "APPROVED", "approved_vat_amount": 4000, "comment": "Supplier's corrected amount accepted"})
        assert d.status_code == 200 and d.json()["agent_rating"] == "WEAK" and d.json()["signature"] == "SC-02"
        assert c.post(f"/fta/invoices/{weak['id']}/decision", headers=OFF,
                      json={"decision": "APPROVED", "approved_vat_amount": 999999}).status_code == 422

        eligible = c.get("/fta/applications", headers=OFF).json()
        eligible = next(a for a in eligible if a["maskan_ref"] == "MSK-2026-0001")["vat_eligible"]
        assert c.post(f"/fta/applications/{ready['id']}/decision", headers=OFF,
                      json={"decision": "APPROVED", "approved_amount": 10**9}).status_code == 422
        d = c.post(f"/fta/applications/{ready['id']}/decision", headers=OFF,
                   json={"decision": "PARTIALLY_APPROVED", "approved_amount": eligible})
        assert d.status_code == 200, d.text
        detail = c.get(f"/fta/applications/{ready['id']}", headers=OFF).json()
        assert detail["application"]["status"] == "PARTIALLY_APPROVED"
        assert {"decide", "decide-invoice"} <= {e["action"] for e in detail["audit"]}
        assert c.post(f"/fta/invoices/{weak['id']}/decision", headers=OFF, json={"decision": "REJECTED"}).status_code == 409

        ov = c.get("/fta/overview", headers=OFF).json()
        assert ov["refund_verified_aed"] > 0 and ov["invoices_by_rating"]["FAIL"] >= 6
        steel = c.get("/fta/suppliers?q=steel", headers=OFF).json()[0]
        assert steel["trn"] == "100222222200003" and steel["trust"]["tier"] == "STANDARD"


def test_applicant_status_hides_supplier_data():
    with TestClient(app) as c:
        url = "/maskan/applications/MSK-2026-0002/status"
        assert c.get(url, headers={"X-Emirates-Id": "784-0000-0000000-0"}).status_code == 404
        body = c.get(url, headers={"X-Emirates-Id": "784-1990-7654321-2"}).json()
        by_no = {i["invoice_no"]: i for i in body["invoices"]}
        assert by_no["EHF-9"]["what_you_can_do"] and by_no["MAG-88"]["what_you_can_do"]
        text = str(body)
        assert "vat_return_period" not in text and "rating" not in text and "Q3" not in text


def test_supplier_silence_becomes_weak_after_five_business_days():
    with TestClient(app) as c:
        r = c.post("/maskan/applications", json=_new_application("MSK-2026-9001", [_invoice("SIL-1", "Cement supply")]))
        assert r.status_code == 201, r.text
        row = _invoices(c)[("MSK-2026-9001", "SIL-1")]
        assert row["invoice"]["status"] == "AWAITING_SUPPLIER" and row["invoice"]["rating"] is None
        sent, due = row["confirmation_request"]["sent_at"][:10], row["confirmation_request"]["due_at"][:10]
        business_days = sum((date.fromisoformat(sent) + timedelta(days=n)).weekday() < 5
                            for n in range(1, (date.fromisoformat(due) - date.fromisoformat(sent)).days + 1))
        assert business_days == 5
        later = (date.fromisoformat(due) + timedelta(days=1)).isoformat() + "T00:00:00"
        assert c.post(f"/fta/requests/expire-overdue?as_of={later}", headers=OFF).json()["expired"] == 1
        row = _invoices(c)[("MSK-2026-9001", "SIL-1")]
        assert row["invoice"]["status"] == "NO_SUPPLIER_RESPONSE" and row["invoice"]["rating"] == "WEAK"
        apps = {a["maskan_ref"]: a for a in c.get("/fta/applications", headers=OFF).json()}
        assert apps["MSK-2026-9001"]["status"] == "READY_FOR_DECISION"  # the applicant is not blocked


def test_common_sense_and_invoice_particulars():
    with TestClient(app) as c:
        over = _invoice("BIG-1", "Construction of villa structure", taxable=600000, trn="100111111100003")
        bare = {k: v for k, v in _invoice("BARE-1", "Block work").items()
                if k not in ("recipient_name", "recipient_address", "line_items", "supplier_address")}
        third = _invoice("THIRD-1", "Plastering", recipient_name="Al Noor Building Contracting LLC")
        unknown = _invoice("UNK-1", "Miscellaneous items")
        bad_trn = _invoice("TRN-1", "Cement supply") | {"supplier_trn": "12345", "supplier_name": "No Such Trader"}
        r = c.post("/maskan/applications", json=_new_application(
            "MSK-2026-9002", [over, bare, third, unknown, bad_trn], contract_value=500000))
        assert r.status_code == 201, r.text
        assert any(f.startswith("CS-01") for f in r.json()["flags"])
        inv = _invoices(c)
        res = {no: _results(inv[("MSK-2026-9002", no)]) for no in ("BIG-1", "BARE-1", "THIRD-1", "UNK-1", "TRN-1")}
        assert res["BIG-1"]["CS-02"] == "UNCERTAIN"  # one invoice larger than the whole contract
        assert res["BARE-1"]["TI-09"] == "UNCERTAIN" and res["BARE-1"]["TI-08"] == "UNCERTAIN"  # not captured, not guessed
        assert res["THIRD-1"]["TI-08"] == "FAIL"  # issued to the contractor without the required statement
        assert res["UNK-1"]["NR-02"] == "UNCERTAIN"  # not recognised: a person decides
        assert res["TRN-1"]["TI-03"] == "FAIL"  # TRN is not 15 digits
