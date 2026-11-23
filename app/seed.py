"""Synthetic fixtures so both frontends have data on day one. All names/TRNs are fake.

Run directly: `uv run python -m app.seed` (wipes nothing; skips if data exists).

What the seed shows, by invoice:
  STRONG  ANB-1044, FPL-210 (pool: eligible from 1 Jan 2026)
  WEAK    ANB-1001 in MSK-0001 (same invoice later claimed in MSK-0003), GSC-77 (supplier corrected
          the amount), OSS-15 (CCTV: unclear in the guide), MAG-91 (supplier never responded)
  FAIL    EHF-9 (furniture), GSC-80 (VAT arithmetic), MAG-88 (simplified tax invoice),
          ANB-1001 in MSK-0003 (duplicate), SPL-3 (supplier deregistered), FPL-233 (supplier disputes it)
  open    DRE-501, DRE-530 (waiting for Desert Rose Electrical to confirm in the supplier portal)
"""
from datetime import date, timedelta

from sqlmodel import Session, select

from app import pipeline
from app.db import engine, init_db
from app.models import (
    Application,
    ConfirmationRequest,
    ConsiderationStatus,
    Invoice,
    InvoiceType,
    Supplier,
    SupplierResponse,
    SupplierStatus,
    now,
)
from app.schemas import IngestApplication, IngestInvoice, LineItem

# TRN -> (legal name, address, emirate)
SUPPLIERS = {
    "100111111100003": ("Al Noor Building Contracting LLC", "Al Quoz Industrial Area 3, Dubai", "Dubai"),
    "100222222200003": ("Gulf Steel & Cement Trading", "Mussafah M-14, Abu Dhabi", "Abu Dhabi"),
    "100333333300003": ("Desert Rose Electrical Works", "Industrial Area 6, Sharjah", "Sharjah"),
    "100444444400003": ("Emirates Home Furnishing LLC", "Sheikh Zayed Road, Dubai", "Dubai"),
    "100555555500003": ("Falcon Pools & Landscaping LLC", "Al Barsha South, Dubai", "Dubai"),
    "100666666600003": ("Oasis Security Systems LLC", "Electra Street, Abu Dhabi", "Abu Dhabi"),
    "100777777700003": ("Marina Aluminium & Glass LLC", "Ajman Industrial 2, Ajman", "Ajman"),
    "100888888800003": ("Sahara Plumbing Services", "Industrial Area 11, Sharjah", "Sharjah"),
}
T1, T2, T3, T4, T5, T6, T7, T8 = SUPPLIERS
DEREGISTERED = T8
# Test logins for the supplier portal: use any TRN above as X-Supplier-TRN.

# Pinned so fixtures/invoices/*.png keep matching the seed (EX-01). NR-04 fails after 2027-09-24.
COMPLETION = date(2026, 9, 24)


def _inv(trn: str, no: str, days_before: int, taxable: float, plot: str, applicant: str, desc: str, **kw) -> IngestInvoice:
    vat = round(taxable * 0.05, 2)
    simplified = kw.get("invoice_type") == InvoiceType.SIMPLIFIED
    return IngestInvoice(
        supplier_trn=trn, supplier_name=SUPPLIERS[trn][0], supplier_address=SUPPLIERS[trn][1], invoice_no=no,
        invoice_date=COMPLETION - timedelta(days=days_before), taxable_amount=taxable,
        vat_amount=kw.pop("vat", vat), total=kw.pop("total", round(taxable + vat, 2)),
        plot_no=plot, description=desc,
        recipient_name="" if simplified else applicant,
        recipient_address="" if simplified else f"Plot {plot}",
        line_items=[] if simplified else kw.pop("line_items", [LineItem(description=desc, quantity=1, unit_price=taxable, amount=taxable)]),
        **kw)


def fixtures() -> list[IngestApplication]:
    permit = COMPLETION - timedelta(days=330)
    a1, a2, a3 = "Ahmed Al Mansoori", "Fatima Al Ketbi", "Khalid Al Shamsi"
    p1, p2, p3 = "DXB-345-112", "AUH-12-0098", "SHJ-7-301"
    return [
        IngestApplication(maskan_ref="MSK-2026-0001", applicant_name=a1, emirates_id="784-1985-1234567-1",
                          plot_no=p1, emirate="Dubai", completion_date=COMPLETION, permit_date=permit, contract_value=1_200_000, invoices=[
                              _inv(T1, "ANB-1001", 200, 450000, p1, a1, "Construction of villa structure - stage 2"),
                              _inv(T2, "GSC-77", 180, 82000, p1, a1, "Reinforcement steel and cement supply"),
                              _inv(T3, "DRE-501", 90, 36000, p1, a1, "Electrical wiring and DB installation"),
                              _inv(T5, "FPL-210", 40, 120000, p1, a1, "Swimming pool construction and tiling"),
                          ]),
        IngestApplication(maskan_ref="MSK-2026-0002", applicant_name=a2, emirates_id="784-1990-7654321-2",
                          plot_no=p2, emirate="Abu Dhabi", completion_date=COMPLETION, permit_date=permit, contract_value=900_000, invoices=[
                              _inv(T1, "ANB-1044", 150, 300000, p2, a2, "Block work and plastering"),
                              _inv(T4, "EHF-9", 30, 25000, p2, a2, "Living room furniture and sofa set"),
                              _inv(T2, "GSC-80", 120, 40000, p2, a2, "Cement supply", vat=2500.0, total=42500.0),
                              _inv(T6, "OSS-15", 25, 18000, p2, a2, "CCTV cameras and integrated smart security system"),
                              _inv(T7, "MAG-88", 70, 9000, p2, a2, "Window frames and glazing", invoice_type=InvoiceType.SIMPLIFIED),
                              _inv(T5, "FPL-233", 20, 15000, p2, a2, "Fountain and water feature installation"),
                          ]),
        IngestApplication(maskan_ref="MSK-2026-0003", applicant_name=a3, emirates_id="784-1979-1112223-3",
                          plot_no=p3, emirate="Sharjah", completion_date=COMPLETION, permit_date=permit, contract_value=800_000, invoices=[
                              _inv(T1, "ANB-1001", 200, 450000, p3, a3, "Construction of villa structure - stage 2"),  # duplicate of MSK-0001
                              _inv(T3, "DRE-530", 100, 28000, p3, a3, "Lighting and switchgear installation"),
                              _inv(T8, "SPL-3", 110, 22000, p3, a3, "Plumbing pipes and sanitary units"),
                              _inv(T7, "MAG-91", 80, 64000, p3, a3, "Aluminium window frames and glazing"),
                          ]),
    ]


COMPLETION_QUARTER = f"{COMPLETION.year}-Q{(COMPLETION.month - 1) // 3 + 1}"
CONFIRMED = dict(issued=True, particulars_confirmed=True, consideration_status=ConsiderationStatus.RECEIVED, vat_return_period=COMPLETION_QUARTER)
# What suppliers have already answered, by invoice number. Anything not listed stays open.
ANSWERS = {
    "ANB-1001": CONFIRMED,
    "ANB-1044": CONFIRMED,
    "FPL-210": CONFIRMED,
    "OSS-15": CONFIRMED,
    "GSC-77": {**CONFIRMED, "particulars_confirmed": False, "corrections": {"taxable_amount": 80000}},
    "FPL-233": dict(issued=False, particulars_confirmed=False),
}
SILENT = "MAG-91"  # request sent long ago and never answered


def seed() -> None:
    init_db()
    with Session(engine) as session:
        if session.exec(select(Application)).first():
            return
        for trn, (name, address, emirate) in SUPPLIERS.items():
            dereg = trn == DEREGISTERED
            session.add(Supplier(trn=trn, legal_name=name, address=address, emirate=emirate, registry_verified=True,
                                 registered_from=date(2018, 1, 1),
                                 status=SupplierStatus.DEREGISTERED if dereg else SupplierStatus.ACTIVE,
                                 deregistered_on=date(2025, 6, 30) if dereg else None))
        session.commit()
        for app in fixtures():
            pipeline.ingest(session, app)

        # Answer some requests and let one lapse, so the FTA dashboard shows every outcome.
        reqs = session.exec(select(ConfirmationRequest).order_by(ConfirmationRequest.id)).all()
        for req in reqs:
            inv = session.get(Invoice, req.invoice_id)
            if inv.invoice_no == SILENT:
                req.sent_at = now() - timedelta(days=12)
                req.due_at = now() - timedelta(days=3)
            elif inv.invoice_no in ANSWERS:
                resp = SupplierResponse(request_id=req.id, declared_by="seed@supplier.example", **ANSWERS[inv.invoice_no])
                session.add(resp)
                session.flush()
                pipeline.reconcile(session, req, resp)
        session.commit()
        pipeline.expire_overdue(session)


if __name__ == "__main__":
    seed()
    print("seeded")
