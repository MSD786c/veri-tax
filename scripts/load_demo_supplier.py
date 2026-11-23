"""Local demo: two demo supplier companies for the three MMB sample invoices + the Maskan claim for them.

    uv run python scripts/load_demo_supplier.py            # load (safe to re-run)
    uv run python scripts/load_demo_supplier.py --reset    # wipe the demo case (claim, uploads, answers, audit) and load fresh

Demo flow: upload an MMB_2026_00x PDF in the Maskan portal -> it is read locally, scored, linked to MSK-2026-9001
-> sign in to EmaraTax as the supplier and answer the verification questions -> review and approve in the FTA portal.
  Mumtaz Building Materials  TRN 100000000000003  invoices MMB/2026/001 (AED 15,000) and MMB/2026/003 (AED 1,000,000)
  Vinay Building Materials   TRN 100000000000011  invoice MMB/2026/002 (plain "Invoice", no TRN printed -> FAIL)
Data stays in the local database (git-ignored).
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import Session, col, delete, select  # noqa: E402

from app import db, pipeline  # noqa: E402
from app.models import (AgentRun, Application, AuditEvent, ConfirmationRequest, Document, ExtractedInvoice,  # noqa: E402
                        Invoice, InvoiceDecision, OfficerDecision, RuleResult, Supplier, SupplierResponse)
from app.schemas import IngestApplication, IngestInvoice, LineItem  # noqa: E402

REF = "MSK-2026-9001"
COMPANIES = {"100000000000003": "Mumtaz Building Materials", "100000000000011": "Vinay Building Materials"}


def inv(trn, no, desc, taxable, vat, total, title="Tax Invoice"):
    return IngestInvoice(supplier_trn=trn, supplier_name=COMPANIES[trn], invoice_no=no, invoice_date="2026-11-23",
                         supply_date="2026-11-23", title=title, taxable_amount=taxable, vat_amount=vat, total=total,
                         description=desc, supplier_address="Ras Al Khaimah, UAE", recipient_name="Tarek Mohammed",
                         recipient_address="Ras Al Khaimah, UAE",
                         line_items=[LineItem(description=desc, quantity=1, unit_price=taxable, amount=taxable)])


def reset(s: Session) -> None:
    app = s.exec(select(Application).where(Application.maskan_ref == REF)).first()
    if not app:
        return
    invs = s.exec(select(Invoice).where(Invoice.application_id == app.id)).all()
    ids, hashes = [i.id for i in invs], [i.document_hash for i in invs if i.document_hash]
    reqs = [r.id for r in s.exec(select(ConfirmationRequest).where(col(ConfirmationRequest.invoice_id).in_(ids))).all()]
    docs = s.exec(select(Document).where(col(Document.sha256).in_(hashes))).all()
    # also the demo PDFs uploaded through the portal that did not link (so they can be uploaded fresh again)
    docs += [d for d in s.exec(select(Document).where(col(Document.filename).startswith("MMB_2026_"))).all() if d not in docs]
    entities = [f"application:{app.id}"] + [f"invoice:{i}" for i in ids] + [f"request:{r}" for r in reqs] + [f"document:{d.id}" for d in docs]
    s.exec(delete(SupplierResponse).where(col(SupplierResponse.request_id).in_(reqs)))
    s.exec(delete(ConfirmationRequest).where(col(ConfirmationRequest.id).in_(reqs)))
    for model in (RuleResult, InvoiceDecision):
        s.exec(delete(model).where(col(model.invoice_id).in_(ids)))
    s.exec(delete(OfficerDecision).where(OfficerDecision.application_id == app.id))
    s.exec(delete(AgentRun).where(col(AgentRun.entity).in_(entities)))
    s.exec(delete(AuditEvent).where(col(AuditEvent.entity).in_(entities)))
    s.exec(delete(Invoice).where(col(Invoice.id).in_(ids)))
    s.delete(app)
    for d in docs:
        s.exec(delete(ExtractedInvoice).where(ExtractedInvoice.document_id == d.id))
        Path(d.path).unlink(missing_ok=True)
        s.delete(d)
    s.commit()
    print(f"reset: removed {REF}, {len(ids)} invoices, {len(docs)} uploaded documents")


def main() -> None:
    db.init_db()
    with Session(db.engine) as s:
        if "--reset" in sys.argv:
            reset(s)
        for trn, name in COMPANIES.items():
            sup = s.get(Supplier, trn) or Supplier(trn=trn, legal_name=name)
            sup.legal_name, sup.address, sup.emirate, sup.registry_verified = name, "Ras Al Khaimah, UAE", "Ras Al Khaimah", True
            s.add(sup)
        s.commit()
        if s.exec(select(Application).where(Application.maskan_ref == REF)).first():
            print(f"{REF} already loaded (use --reset to start the demo fresh)")
            return
        # What the applicant entered in Maskan for the three sample invoices.
        pipeline.ingest(s, IngestApplication(
            maskan_ref=REF, applicant_name="Tarek Mohammed", emirates_id="784-1988-9001000-1", plot_no="RAK-21-0450",
            emirate="Ras Al Khaimah", completion_date=date(2026, 11, 23), permit_no="RAK-BP-2025-04417", permit_date=date(2025, 12, 1),
            contract_value=750_000,
            invoices=[inv("100000000000003", "MMB/2026/001", "Cement", 14285.71, 714.29, 15000.00),
                      inv("100000000000011", "MMB/2026/002", "Sanitary ware", 7619.05, 380.95, 8000.00, title="Invoice"),
                      inv("100000000000003", "MMB/2026/003", "Cement", 952380.95, 47619.05, 1000000.00)]))
        print(f"loaded {REF} (Tarek Mohammed): Mumtaz 100000000000003 -> MMB/2026/001, 003; Vinay 100000000000011 -> MMB/2026/002")


if __name__ == "__main__":
    main()
