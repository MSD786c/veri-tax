"""Original documents end to end (LLM mocked): upload link -> vision extraction -> auto-link ->
EX-01 + Article 59 particulars -> rating -> supplier -> agents. Each test ingests its own application."""
import io
from datetime import date

import pypdfium2 as pdfium
from PIL import Image

from app import agent, documents, llm
from tests.conftest import officer_sees_everything

OFF = {"X-Officer-Id": "officer-1"}
U = "/maskan/portal/test-token"
TRN = "100555555500003"  # seeded, registry-verified (TI-03 PASS)
COMPLETION = date(2026, 9, 24)


def png(seed: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (60, 40), (seed, 120, 200)).save(buf, "PNG")
    return buf.getvalue()


def ingest(client, ref: str, invoice_no: str) -> dict:
    # Maskan captured no supplier address or recipient: those particulars must come from the document.
    r = client.post("/maskan/applications", json={
        "maskan_ref": ref, "applicant_name": "Mariam Al Hammadi", "emirates_id": "784-1",
        "plot_no": "DXB-9", "emirate": "Dubai", "completion_date": str(COMPLETION), "invoices": [{
            "supplier_trn": TRN, "supplier_name": "Falcon Pools & Landscaping LLC", "invoice_no": invoice_no,
            "invoice_date": "2026-06-01", "taxable_amount": 1000, "vat_amount": 50, "total": 1050,
            "plot_no": "DXB-9", "description": "Concrete and block work"}]})
    assert r.status_code == 201, r.text
    assert client.get(f"/fta/applications/{r.json()['id']}", headers=OFF).status_code == 404  # no document yet: not the FTA's
    with officer_sees_everything():  # these tests inspect extraction/linking before the supplier step closes
        return client.get(f"/fta/applications/{r.json()['id']}", headers=OFF).json()["invoices"][0]


def reading(invoice_no: str, document_type: str = "TAX_INVOICE", **over) -> dict:
    f = {"title": "Tax Invoice", "invoice_type": "FULL", "supplier_name": "Falcon Pools & Landscaping LLC",
         "supplier_address": "Al Quoz 3, Dubai", "supplier_trn": TRN, "invoice_no": invoice_no, "invoice_date": "01/06/2026",
         "recipient_name": "Mariam Al Hammadi", "recipient_address": "Plot DXB-9, Dubai", "plot_no": "DXB-9",
         "description": "Concrete and block work", "taxable_amount": "AED 1,000.00", "vat_rate": "5%", "vat_amount": 50,
         "total": "1,050.00", "currency": "AED",
         "line_items": [{"description": "Concrete and block work", "quantity": 1, "unit_price": 1000, "amount": 1000}], **over}
    return {"document_type": document_type, "fields": {k: {"value": v, "confidence": 0.95} for k, v in f.items()}}


def latest(row: dict) -> dict:
    return {r["rule_id"]: r for r in row["rule_results"]}  # results append; the last per rule counts


def find(client, ref: str) -> dict:
    with officer_sees_everything():
        app = next(a for a in client.get("/fta/applications", headers=OFF).json() if a["maskan_ref"] == ref)
        return client.get(f"/fta/applications/{app['id']}", headers=OFF).json()["invoices"][0]


def use_agent(monkeypatch, read):
    monkeypatch.setenv("AGENT_PROVIDER", "groq")
    monkeypatch.setattr(llm, "API_KEY", "test")
    monkeypatch.setattr(documents, "read_invoice", read)
    monkeypatch.setattr(llm, "chat_json", lambda system, user, model=None: (
        {"recommendations": [{"rule_id": "NR-02", "recommendation": "PASS", "reason": "block work"}], "eligible_goods": True}
        if "assist UAE Federal Tax Authority" in system else
        {"recommended_decision": "APPROVED", "recommended_amount": 50, "summary": "ok", "reasons": [], "risks": []}))


def test_pdf_pages_render():
    pdf = pdfium.PdfDocument.new()
    pdf.new_page(595, 842)
    pdf.new_page(14400, 14400)  # huge page: rendered at a capped size, not 28800 px
    buf = io.BytesIO()
    pdf.save(buf)
    pages = documents.page_images(buf.getvalue(), "application/pdf")
    assert len(pages) == 2 and pages[0][:2] == b"\xff\xd8"
    assert max(Image.open(io.BytesIO(pages[1])).size) <= documents.MAX_SIDE


def test_parse_json_strips_reasoning():
    assert llm.parse_json('<think>{"no": 1}</think>```json\n{"a": 2}\n```') == {"a": 2}


def test_agent_switch(monkeypatch):
    monkeypatch.setenv("AGENT_PROVIDER", "")
    assert agent.get_agent() is None
    monkeypatch.setenv("AGENT_PROVIDER", "groq")
    assert isinstance(agent.get_agent(), agent.GroqAgent)


def test_upload_link_extracts_links_and_reverifies(client, monkeypatch):
    assert client.get("/maskan/portal/wrong-token").status_code == 404
    assert "Upload invoices" in client.get(U).text

    good_row = ingest(client, "MSK-DOC-1", "DOC-1")
    ingest(client, "MSK-DOC-2", "DOC-2")
    assert latest(good_row)["EX-01"]["result"] == "NOT_APPLICABLE"  # no document yet
    assert latest(good_row)["TI-08"]["result"] == "UNCERTAIN"  # recipient not captured by Maskan

    readings = iter([reading("DOC-1"), reading("DOC-2", total=99999)])
    use_agent(monkeypatch, lambda data, ct: next(readings))

    r = client.post(f"{U}/documents", files=[("files", ("a.txt", b"hi", "text/plain"))])
    assert "unsupported" in r.json()[0]["error"]
    r = client.post(f"{U}/documents", data={"label": "batch 1"}, files=[("files", ("doc1.png", png(1), "image/png"))])
    assert r.json()[0]["duplicate"] is False
    d = next(x for x in client.get(f"{U}/documents").json() if x["document"]["filename"] == "doc1.png")
    assert d["document"]["status"] == "EXTRACTED", d["document"]["error"]
    assert d["linked_invoices"][0]["invoice_no"] == "DOC-1"
    assert client.post(f"{U}/documents", files=[("files", ("again.png", png(1), "image/png"))]).json()[0]["duplicate"]

    row = find(client, "MSK-DOC-1")
    res = latest(row)
    # dd/mm/yyyy and "AED 1,000.00" compare correctly; missing particulars filled from the document
    assert res["EX-01"]["result"] == "PASS", res["EX-01"]
    for rid in ("TI-02", "TI-08", "TI-09"):
        assert res[rid]["result"] == "PASS", (rid, res[rid])
    assert row["invoice"]["supplier_address"] == "Al Quoz 3, Dubai"
    assert row["invoice"]["status"] == "AWAITING_SUPPLIER" and row["invoice"]["rating"] is None
    assert row["agent_runs"][0]["kind"] == "compliance"

    # Supplier confirms -> STRONG + VERIFIED
    req_id = row["confirmation_request"]["id"]
    r = client.post(f"/supplier/requests/{req_id}/respond", headers={"X-Supplier-TRN": TRN}, json={
        "issued": True, "particulars_confirmed": True, "consideration_status": "RECEIVED",
        "vat_return_period": "2026-Q3", "declared_by": "finance@doctest.example", "declaration": True})
    assert r.json()["invoice"]["status"] == "VERIFIED" and "rating" not in r.json()["invoice"]
    assert find(client, "MSK-DOC-1")["invoice"]["rating"] == "STRONG"

    # Document disagrees with Maskan (total) -> EX-01 FAIL -> rating FAIL -> FLAGGED, supplier request cancelled
    client.post(f"{U}/documents", files=[("files", ("doc2.png", png(2), "image/png"))])
    bad = find(client, "MSK-DOC-2")
    assert latest(bad)["EX-01"]["result"] == "FAIL"
    assert latest(bad)["EX-01"]["evidence"]["mismatches"]["total"]["document"] == 99999
    assert bad["invoice"]["rating"] == "FAIL" and bad["invoice"]["status"] == "FLAGGED"
    assert bad["confirmation_request"]["status"] == "CANCELLED"
    assert any("EX-01" in reason for reason in bad["invoice"]["rating_reasons"])

    # Manual agent endpoints + officer document list
    assert client.post(f"/fta/invoices/{bad['invoice']['id']}/compliance", headers=OFF).json()["output"]["eligible_goods"] is True
    app_id = bad["invoice"]["application_id"]
    assert client.post(f"/fta/applications/{app_id}/summary", headers=OFF).json()["output"]["recommended_decision"] == "APPROVED"
    assert any(x["document"]["filename"] == "doc2.png" for x in client.get("/fta/documents", headers=OFF).json())


def test_quotation_document_fails_ti01(client, monkeypatch):
    ingest(client, "MSK-DOC-3", "DOC-3")
    use_agent(monkeypatch, lambda data, ct: reading("DOC-3", document_type="QUOTATION", title="Quotation"))
    client.post(f"{U}/documents", files=[("files", ("q.png", png(3), "image/png"))])
    row = find(client, "MSK-DOC-3")
    assert latest(row)["TI-01"]["result"] == "FAIL" and row["invoice"]["rating"] == "FAIL"


def test_low_confidence_reading_never_links(client, monkeypatch):
    ingest(client, "MSK-DOC-4", "DOC-4")
    low = reading("DOC-4")
    low["fields"]["invoice_no"]["confidence"] = 0.3
    use_agent(monkeypatch, lambda data, ct: low)
    client.post(f"{U}/documents", files=[("files", ("low.png", png(5), "image/png"))])
    d = next(x for x in client.get(f"{U}/documents").json() if x["document"]["filename"] == "low.png")
    assert d["document"]["status"] == "EXTRACTED" and d["linked_invoices"] == []


def test_extraction_without_agent_is_recorded(client, monkeypatch):
    monkeypatch.setenv("AGENT_PROVIDER", "")
    client.post(f"{U}/documents", files=[("files", ("noagent.png", png(4), "image/png"))])
    d = next(x for x in client.get(f"{U}/documents").json() if x["document"]["filename"] == "noagent.png")
    assert d["document"]["status"] == "FAILED" and "AGENT_PROVIDER" in d["document"]["error"]


def test_model_invoice_type_guess_never_fails_ti09(client, monkeypatch):
    """Live-run bug: the model labelled full invoices SIMPLIFIED and TI-09 failed them. Only a printed
    'Simplified Tax Invoice' title may set the type."""
    ingest(client, "MSK-DOC-5", "DOC-5")
    ingest(client, "MSK-DOC-6", "DOC-6")
    readings = iter([reading("DOC-5", invoice_type="SIMPLIFIED"),
                     reading("DOC-6", invoice_type="SIMPLIFIED", title="Simplified Tax Invoice")])
    use_agent(monkeypatch, lambda data, ct: next(readings))
    client.post(f"{U}/documents", files=[("files", ("guess.png", png(6), "image/png"))])
    client.post(f"{U}/documents", files=[("files", ("printed.png", png(7), "image/png"))])
    guessed, printed = find(client, "MSK-DOC-5"), find(client, "MSK-DOC-6")
    assert guessed["invoice"]["invoice_type"] is None and latest(guessed)["TI-09"]["result"] != "FAIL"
    assert printed["invoice"]["invoice_type"] == "SIMPLIFIED" and latest(printed)["TI-09"]["result"] == "FAIL"


def test_upload_flags_furniture_as_not_eligible():
    """IKEA-style invoice: the portal flags furniture at upload time, before any Maskan claim is matched."""
    from app.api.maskan_portal import _not_eligible
    from app.models import ExtractedInvoice
    lines = [{"description": "3-seat residential sofa sets"}, {"description": "Residential wardrobe units"}]
    ikea = ExtractedInvoice(document_id=1, document_type="TAX_INVOICE", model="m", prompt_version="p",
                            fields={"line_items": {"value": lines, "confidence": 0.9}})
    assert "Furniture is not included in the refund programme" in _not_eligible(ikea)
    cement = ExtractedInvoice(document_id=2, document_type="TAX_INVOICE", model="m", prompt_version="p",
                              fields={"description": {"value": "Cement", "confidence": 0.9}})
    assert _not_eligible(cement) is None
