"""Load the 60-invoice test set (`invoice test/`, answer key from PR #4) into the LOCAL database so all
three portals show realistic data. Nothing leaves this machine: rows go into veritax.db (DATABASE_URL)
and the PDFs into data/documents/, both git-ignored. No LLM is called; the rule engine runs locally.

    uv run python scripts/load_test_data.py            # safe to re-run: skips applications already loaded

What it does, in the real pipeline order:
  1. registers the 11 test suppliers in the FTA registry data (TI-03),
  2. ingests the 6 applications as Maskan would send them (Good copies of duplicates first: MSK-2026-0101),
  3. for MSK-2026-0101..0103 ("history"): attaches each original PDF (stored, not read) and answers the supplier
     requests as the answer key assumes, so the FTA portal has rated cases to review,
  4. MSK-2026-0104..0106 ("live"): Maskan data only. Upload their PDFs in the Maskan portal to watch the whole
     flow: local extraction -> Gemini scoring -> EmaraTax supplier dashboard -> FTA officer -> audit trail.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlmodel import Session, select  # noqa: E402

from app import db, documents, pipeline  # noqa: E402
from app.models import (Application, ConfirmationRequest, ConsiderationStatus, DocumentStatus, Invoice,  # noqa: E402
                        RequestStatus, Supplier, SupplierResponse)
from app.schemas import IngestApplication, IngestInvoice, LineItem  # noqa: E402

TRUTH = ROOT / "invoice test" / "invoice test answers" / "ground_truth.json"
PDFS = ROOT / "invoice test" / "invoices"
LIVE_APPS = {"MSK-2026-0104", "MSK-2026-0105", "MSK-2026-0106"}  # left for the live upload flow
LABEL = "local test set"


def emirates_id(maskan_ref: str) -> str:
    return f"784-1990-{maskan_ref[-4:]}000-1"  # synthetic, for the applicant status view


def main() -> None:
    truth = json.loads(TRUTH.read_text())
    db.init_db()
    with Session(db.engine) as s:
        for sup in truth["suppliers"]:
            row = s.get(Supplier, sup["trn"]) or Supplier(trn=sup["trn"], legal_name=sup["legal_name"])
            row.address, row.registry_verified = sup["address"], True
            s.add(row)
        s.commit()

        loaded = 0
        for app in sorted(truth["applications"], key=lambda a: a["maskan"]):
            if s.exec(select(Application).where(Application.maskan_ref == app["maskan"])).first():
                print(f"skip {app['maskan']} (already loaded)")
                continue
            cases = sorted((i for i in truth["invoices"] if i["maskan_ref"] == app["maskan"]),
                           key=lambda i: (i["folder"] != "Good invoices", i["file"]))
            items = []
            for c in cases:
                f = c["fields"]
                items.append(IngestInvoice(
                    supplier_trn=f["supplier_trn"], supplier_name=f["supplier_name"], invoice_no=f["invoice_no"],
                    invoice_date=f["invoice_date"], title=f["title"], taxable_amount=f["taxable_amount"],
                    vat_amount=f["vat_amount"], total=f["total"], currency=f["currency"], plot_no=f["plot_no"],
                    description=f["description"], invoice_type=f.get("invoice_type"), supplier_address=f["supplier_address"],
                    recipient_name=f["recipient_name"], recipient_address=f["recipient_address"], supply_date=f.get("supply_date"),
                    for_applicant_statement=bool(f.get("for_applicant_statement")),
                    line_items=[LineItem(description=li["description"], quantity=li.get("quantity"),
                                         unit_price=li.get("unit_price"), amount=li.get("amount")) for li in f["line_items"]]))
            a = pipeline.ingest(s, IngestApplication(
                maskan_ref=app["maskan"], applicant_name=app["name"], emirates_id=emirates_id(app["maskan"]),
                plot_no=app["plot"], emirate=app["emirate"], completion_date=app["completion_date"],
                permit_date=app["permit_date"], invoices=items))

            invs = s.exec(select(Invoice).where(Invoice.application_id == a.id).order_by(Invoice.id)).all()
            for inv, c in zip(invs, [] if app["maskan"] in LIVE_APPS else cases):
                data = (PDFS / c["folder"] / c["file"]).read_bytes()
                doc, _ = documents.store(s, data, c["file"], "application/pdf", "maskan", LABEL)
                if doc.status == DocumentStatus.UPLOADED:
                    doc.status = DocumentStatus.STORED  # stored locally, not read: no extraction job queued
                inv.document_hash = doc.sha256
                req = s.exec(select(ConfirmationRequest).where(ConfirmationRequest.invoice_id == inv.id)).first()
                if req and req.status == RequestStatus.PENDING:
                    q = (inv.invoice_date.month - 1) // 3 + 1
                    resp = SupplierResponse(request_id=req.id, issued=True, particulars_confirmed=True,
                                            consideration_status=ConsiderationStatus.RECEIVED, received_date=inv.invoice_date,
                                            vat_return_period=f"{inv.invoice_date.year}-Q{q}", declared_by="finance@supplier.example")
                    s.add(resp)
                    s.flush()
                    pipeline.reconcile(s, req, resp)
            s.commit()
            loaded += 1
            print(f"loaded {app['maskan']} ({app['name']}): {len(invs)} invoices, applicant Emirates ID {emirates_id(app['maskan'])}")

        rows = s.exec(select(Invoice.rating, Invoice.status)).all()
        from collections import Counter
        print(f"\n{loaded} application(s) loaded. All invoices by rating: {dict(Counter(str(r or 'PENDING') for r, _ in rows))}")


if __name__ == "__main__":
    main()
