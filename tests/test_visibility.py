"""Officer visibility + projects: a case reaches the FTA only once an original document is linked AND the
supplier has answered (or the request expired, or the invoice is rated FAIL). Projects are keyed by permit number."""
import io
from urllib.parse import quote

from PIL import Image

OFF = {"X-Officer-Id": "officer-vis"}
TRN = "100555555500003"  # seeded Falcon Pools, registry-verified
SUP = {"X-Supplier-TRN": TRN}
PERMIT = "DXB/BP-2026/0042"  # slashes: the frontend URL-encodes it
CONFIRM = {"issued": True, "particulars_confirmed": True, "consideration_status": "RECEIVED",
           "declared_by": "accounts@falcon.example", "declaration": True}


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (12, 12), (1, 2, 3)).save(buf, "PNG")
    return buf.getvalue()


def refs(client, path: str) -> set[str]:
    return {a["maskan_ref"] for a in client.get(path, headers=OFF).json()}


def test_hidden_until_document_and_supplier_response_then_shown_as_project(client):
    r = client.post("/maskan/applications", json={
        "maskan_ref": "MSK-VIS-1", "applicant_name": "Noura Al Zaabi", "emirates_id": "784-1", "plot_no": "DXB-42",
        "emirate": "Dubai", "completion_date": "2026-09-24", "permit_no": PERMIT, "invoices": [{
            "supplier_trn": TRN, "supplier_name": "Falcon Pools & Landscaping LLC", "invoice_no": "VIS-1",
            "invoice_date": "2026-06-01", "taxable_amount": 1000, "vat_amount": 50, "total": 1050,
            "plot_no": "DXB-42", "description": "Block work"}]})
    assert r.status_code == 201, r.text
    app_id, project_url = r.json()["id"], f"/fta/projects/{quote(PERMIT, safe='')}"
    assert r.json()["permit_no"] == PERMIT

    def hidden():
        assert "MSK-VIS-1" not in refs(client, "/fta/applications") | refs(client, "/fta/projects")
        assert client.get(f"/fta/applications/{app_id}", headers=OFF).status_code == 404
        assert client.get(project_url, headers=OFF).status_code == 404

    hidden()  # just ingested
    reqs = client.get("/supplier/requests", headers=SUP).json()
    req = next(p for p in reqs if p["invoice"]["invoice_no"] == "VIS-1")
    r = client.post(f"/maskan/invoices/{req['invoice']['id']}/document", files={"file": ("vis.png", png(), "image/png")})
    assert r.status_code == 201
    hidden()  # document linked, supplier not answered yet
    assert "vis.png" not in {d["document"]["filename"] for d in client.get("/fta/documents", headers=OFF).json()}

    # A VAT return period the rules cannot read is refused with a clear 422 (nothing saved)
    url = f"/supplier/requests/{req['request']['id']}/respond"
    for bad in ("2026-11", "November 2026", "2026-Q5"):
        r = client.post(url, headers=SUP, json={**CONFIRM, "vat_return_period": bad})
        assert r.status_code == 422 and "2026-Q4 or a month like Nov-2026" in r.text, (bad, r.text)
    r = client.post(url, headers=SUP, json={**CONFIRM, "vat_return_period": "Nov-2026"})
    assert r.status_code == 200, r.text

    assert "MSK-VIS-1" in refs(client, "/fta/applications") and "MSK-VIS-1" in refs(client, "/fta/projects")
    assert client.get(f"/fta/applications/{app_id}", headers=OFF).status_code == 200
    assert "vis.png" in {d["document"]["filename"] for d in client.get("/fta/documents", headers=OFF).json()}
    project = next(p for p in client.get("/fta/projects", headers=OFF).json() if p["permit_no"] == PERMIT)
    assert project["application_id"] == app_id and project["invoice_count"] == 1 and project["vat_claimed"] == 50
    assert set(project["invoices_by_rating"]) == {"STRONG", "WEAK", "FAIL", "PENDING"}

    body = client.get(project_url, headers=OFF).json()
    assert body["project"] == project
    [inv] = body["invoices"]
    assert inv["invoice_no"] == "VIS-1" and inv["supplier_name"] == "Falcon Pools & Landscaping LLC"
    assert inv["has_document"] is True and inv["supplier_responded"] is True


def test_unknown_project_404(client):
    assert client.get("/fta/projects/NO-SUCH-PERMIT", headers=OFF).status_code == 404
    assert client.get(f"/fta/projects/{quote('X/Y/1', safe='')}", headers=OFF).status_code == 404


def test_officer_sees_no_supplier_or_actions_before_a_case_is_visible(client):
    """Absolutely clear officer view: a freshly ingested claim leaks no supplier, decision, agent or file access."""
    OFF = {"X-Officer-Id": "o1"}
    r = client.post("/maskan/applications", json={
        "maskan_ref": "MSK-CLEAR-1", "applicant_name": "Clear Test", "emirates_id": "784-9", "plot_no": "P-9",
        "permit_no": "BP/CLEAR-1", "emirate": "Dubai", "completion_date": "2026-09-24", "invoices": [{
            "supplier_trn": "100123123100003", "supplier_name": "Hidden Supplier LLC", "invoice_no": "HS-1",
            "invoice_date": "2026-06-01", "taxable_amount": 100, "vat_amount": 5, "total": 105, "description": "Concrete"}]})
    assert r.status_code == 201
    app_id = r.json()["id"]
    assert all(s["trn"] != "100123123100003" for s in client.get("/fta/suppliers", headers=OFF).json())
    assert client.get("/fta/suppliers/100123123100003", headers=OFF).status_code == 404
    assert client.post(f"/fta/applications/{app_id}/decision", headers=OFF,
                       json={"decision": "REJECTED", "approved_amount": 0}).status_code == 404
    assert client.post(f"/fta/applications/{app_id}/summary", headers=OFF).status_code in (404, 503)
