"""Regression tests for the v0.2 review findings that still apply after the merge with main."""
import io
from datetime import date

from PIL import Image
from sqlmodel import Session, select

from app import db, documents, pipeline, rules
from app.models import (ClaimType, ConfirmationRequest, ConsiderationStatus, Invoice, InvoiceStatus,
                        RequestStatus, RuleResult, SupplierResponse, now)

OFF = {"X-Officer-Id": "officer-1"}


def test_same_handles_formats_and_arabic():
    assert rules.same("24/09/2026", date(2026, 9, 24)) is True
    assert rules.same("Dhs 1,050.00", 1050.0) is True
    assert rules.same("١٬٠٥٠٫٠٠", 1050.0) is True
    assert rules.same("garbage", 1050.0) is None  # unparseable -> not read, never a hard mismatch
    assert rules.same_ref("GSC 77", "GSC-77") is True


def test_ex01_unparseable_is_uncertain_not_fail():
    inv = Invoice(application_id=1, supplier_trn="100111111100003", invoice_no="X-1", invoice_date=date(2026, 1, 2),
                  taxable_amount=1000, vat_amount=50, total=1050)
    ext = {"fields": {k: {"value": v, "confidence": 0.95} for k, v in {
        "supplier_trn": "100111111100003", "invoice_no": "X 1", "invoice_date": "02/01/2026",
        "taxable_amount": "AED 1,000", "vat_amount": "fifty", "total": "1050"}.items()}}
    rid, result, ev = rules._ex01(inv, ext)
    assert result == rules.U and ev["unread"] == ["vat_amount"]


def test_clean_normalises_model_output():
    dtype, fields = documents._clean({"document_type": "Tax Invoice", "fields": {
        "total": {"value": "1", "confidence": "95%"}, "vat_amount": {"value": 2, "confidence": "0.8"}}})
    assert dtype == "TAX_INVOICE"
    assert fields["total"]["confidence"] == 0.95 and fields["vat_amount"]["confidence"] == 0.8


def test_nr05_first_claim_never_fails_on_reevaluation(client):
    with Session(db.engine) as s:
        a, b = s.exec(select(Invoice).where(Invoice.invoice_no == "ANB-1001").order_by(Invoice.id)).all()
        ids = (a.id, b.id)
        pipeline.reverify(s, a)  # re-running the rules on the ORIGINAL after the duplicate exists
        res = {r.rule_id: r.result for r in s.exec(select(RuleResult).where(RuleResult.invoice_id == ids[0]).order_by(RuleResult.id)).all()}
        dup = {r.rule_id: r.result for r in s.exec(select(RuleResult).where(RuleResult.invoice_id == ids[1]).order_by(RuleResult.id)).all()}
        s.rollback()
    assert res["NR-05"] == rules.U and dup["NR-05"] == rules.F


def test_retention_answer_in_new_residence_claim_is_uncertain():
    inv = Invoice(application_id=1, supplier_trn="t", invoice_no="n", invoice_date=date(2026, 1, 1),
                  taxable_amount=1, vat_amount=0.05, total=1.05)
    resp = SupplierResponse(request_id=1, issued=True, particulars_confirmed=True, declared_by="x", vat_return_period="2026-Q1",
                            consideration_status=ConsiderationStatus.PARTIAL_OR_RETENTION, retention_amount=1,
                            retention_release_date=date(2027, 1, 1))
    sc03 = lambda ct: {r: v for r, v, _ in rules.check_supplier_response(inv, resp, ct)}["SC-03"]  # noqa: E731
    assert sc03(ClaimType.NEW_RESIDENCE) == rules.U and sc03(ClaimType.RETENTION) == rules.P


def test_cancelled_request_reissued_with_fresh_time_limit(client):
    assert client.post("/maskan/applications", json={
        "maskan_ref": "MSK-TEST-REVIVE", "applicant_name": "Revive Test", "emirates_id": "784-1", "plot_no": "P-1",
        "emirate": "Dubai", "completion_date": "2026-09-24", "invoices": [{
            "supplier_trn": "100666666600003", "supplier_name": "Oasis Security Systems LLC", "invoice_no": "RV-1",
            "invoice_date": "2026-06-01", "taxable_amount": 100, "vat_amount": 5, "total": 105,
            "plot_no": "P-1", "description": "Tiling works"}]}).status_code == 201
    with Session(db.engine) as s:
        inv = s.exec(select(Invoice).where(Invoice.invoice_no == "RV-1")).one()
        req = s.exec(select(ConfirmationRequest).where(ConfirmationRequest.invoice_id == inv.id)).one()
        req.status, req.due_at = RequestStatus.CANCELLED, now().replace(year=2020)
        pipeline.reverify(s, inv)
        assert inv.status == InvoiceStatus.AWAITING_SUPPLIER and req.status == RequestStatus.PENDING
        assert req.due_at.replace(tzinfo=None) > now().replace(tzinfo=None)
        s.rollback()


def test_upload_link_hardening(client):
    assert client.get("/maskan/portal/%C3%A9").status_code == 404  # non-ASCII token: 404, not 500
    r = client.post("/maskan/portal/test-token/documents", files=[("files", ("fake.png", b"not really a png", "image/png"))])
    assert "does not match" in r.json()[0]["error"]
    with Session(db.engine) as s:
        inv_id = s.exec(select(Invoice).where(Invoice.invoice_no == "DRE-501")).first().id
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), (9, 9, 9)).save(buf, "PNG")
    r = client.post(f"/maskan/invoices/{inv_id}/document", files={"file": ("applicant.png", buf.getvalue(), "image/png")})
    assert r.status_code == 201
    # Maskan applicant documents never show on the shared link, only to officers
    assert "applicant.png" not in [d["document"]["filename"] for d in client.get("/maskan/portal/test-token/documents").json()]
    assert client.get(f"/maskan/portal/test-token/documents/{r.json()['document_id']}/file").status_code == 404
    assert any(d["document"]["filename"] == "applicant.png" for d in client.get("/fta/documents", headers=OFF).json())


def test_llm_waits_out_rate_limit_then_succeeds(monkeypatch):
    import httpx
    from app import llm
    calls, slept = [], []

    def fake_post(url, json, timeout, headers):
        calls.append(json["max_completion_tokens"])
        if len(calls) == 1:
            return httpx.Response(429, headers={"retry-after": "7"}, json={"error": {"message": "OTPM"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"ok": 1}'}}]})
    monkeypatch.setattr(llm, "API_KEY", "k")
    monkeypatch.setattr(llm.httpx, "post", fake_post)
    monkeypatch.setattr(llm.time, "sleep", slept.append)
    assert llm.chat_json("s", "u") == {"ok": 1}
    assert slept == [7.0] and calls == [llm.MAX_TOKENS, llm.MAX_TOKENS]


def test_self_check_trn_length_and_line_item_consistency():
    """From the 60-invoice eval: a 16-digit TRN read at confidence 1.0, and bare line-item lists."""
    _, f = documents._clean({"fields": {
        "supplier_trn": {"value": "1004444444400003", "confidence": 1.0},
        "taxable_amount": {"value": "30,510.00", "confidence": 0.95},
        "line_items": [{"description": "Cement", "quantity": 245, "unit_price": 17, "amount": 4165},
                       {"description": "Steel", "quantity": 11, "unit_price": 2395, "amount": 26345}]}})
    assert f["supplier_trn"]["confidence"] <= 0.3  # impossible TRN is never trusted
    assert f["line_items"]["confidence"] == 0.9  # lines sum to the taxable amount
    _, g = documents._clean({"fields": {"taxable_amount": {"value": 99, "confidence": 0.95},
                                        "line_items": {"value": [{"description": "x", "amount": 5}], "confidence": 1.0}}})
    assert g["line_items"]["confidence"] == 0.5  # lines don't add up: not trusted


def test_trn_second_look_and_near_miss_recipient(monkeypatch):
    from app import llm
    raw = {"fields": {"supplier_trn": {"value": "1005555555500003", "confidence": 1.0}}}
    monkeypatch.setattr(llm, "chat_json", lambda s, u, model=None: {"trn_digits": "1 0 0 5 5 5 5 5 5 5 0 0 0 0 3"})
    assert documents.fix_trn([b"img"], raw)["fields"]["supplier_trn"]["value"] == "100555555500003"
    from app.models import Application
    app = Application(maskan_ref="x", applicant_name="Khalid Al Shamsi", emirates_id_hash="h", plot_no="p", emirate="e",
                      completion_date=date(2026, 9, 24))
    inv = Invoice(application_id=1, supplier_trn="t", invoice_no="n", invoice_date=date(2026, 1, 1), taxable_amount=1,
                  vat_amount=0.05, total=1.05, recipient_name="Khalid Al Shamssi")
    out = dict((r, v) for r, v, _ in rules._recipient_checks(inv, app))
    assert out == {"TI-08": rules.U, "NR-06": rules.NA}  # misreading, not a third party -> no NR-06 FAIL
    inv.recipient_name = "Gulf Contracting LLC"
    assert dict((r, v) for r, v, _ in rules._recipient_checks(inv, app))["TI-08"] == rules.F
