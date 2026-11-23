"""Local demo: the test supplier for the MMB sample invoices + a Maskan application that claims them.

    uv run python scripts/load_demo_supplier.py      # safe to re-run

Then: upload the MMB_2026_00x PDFs in the Maskan portal -> they are read and linked here -> log in to EmaraTax as
TRN 100000000000003 (Mumtaz Building Materials) to confirm -> follow the case in the FTA portal (MSK-2026-9001).
Data stays in the local database (git-ignored).
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlmodel import Session, select  # noqa: E402

from app import db, pipeline  # noqa: E402
from app.models import Application, Supplier  # noqa: E402
from app.schemas import IngestApplication, IngestInvoice, LineItem  # noqa: E402

TRN = "100000000000003"
REF = "MSK-2026-9001"


def inv(no, desc, taxable, vat, total, title="Tax Invoice", name="Mumtaz Building Materials"):
    return IngestInvoice(supplier_trn=TRN, supplier_name=name, invoice_no=no, invoice_date="2026-11-23", supply_date="2026-11-23",
                         title=title, taxable_amount=taxable, vat_amount=vat, total=total, description=desc,
                         supplier_address="Ras Al Khaimah, UAE", recipient_name="Tarek Mohammed", recipient_address="Ras Al Khaimah, UAE",
                         line_items=[LineItem(description=desc, quantity=1, unit_price=taxable, amount=taxable)])


def main() -> None:
    db.init_db()
    with Session(db.engine) as s:
        sup = s.get(Supplier, TRN) or Supplier(trn=TRN, legal_name="Mumtaz Building Materials")
        sup.legal_name, sup.address, sup.emirate, sup.registry_verified = (
            "Mumtaz Building Materials", "Ras Al Khaimah, UAE", "Ras Al Khaimah", True)
        s.add(sup)
        s.commit()
        if s.exec(select(Application).where(Application.maskan_ref == REF)).first():
            print(f"{REF} already loaded")
            return
        # What the applicant entered in Maskan for the three sample invoices.
        pipeline.ingest(s, IngestApplication(
            maskan_ref=REF, applicant_name="Tarek Mohammed", emirates_id="784-1988-9001000-1", plot_no="RAK-21-0450",
            emirate="Ras Al Khaimah", completion_date=date(2026, 11, 23), permit_date=date(2025, 12, 1), contract_value=750_000,
            invoices=[inv("MMB/2026/001", "Cement", 14285.71, 714.29, 15000.00),
                      inv("MMB/2026/002", "Sanitary ware", 7619.05, 380.95, 8000.00, title="Invoice", name="Vinay Building Materials"),
                      inv("MMB/2026/003", "Cement", 952380.95, 47619.05, 1000000.00)]))
        print(f"test supplier {TRN} (Mumtaz Building Materials) + {REF} (Tarek Mohammed, 3 invoices) loaded")


if __name__ == "__main__":
    main()
