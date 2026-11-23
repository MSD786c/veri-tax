"""Synthetic fixtures so both frontends have data on day one. All names/TRNs are fake.

Run directly: `uv run python -m app.seed` (wipes nothing; skips if data exists).
"""
from datetime import date, timedelta

from sqlmodel import Session, select

from app import pipeline
from app.db import engine, init_db
from app.models import Application, ConfirmationRequest, ConsiderationStatus, SupplierResponse
from app.schemas import IngestApplication, IngestInvoice

SUPPLIERS = {
    "100111111100003": "Al Noor Building Contracting LLC",
    "100222222200003": "Gulf Steel & Cement Trading",
    "100333333300003": "Desert Rose Electrical Works",
    "100444444400003": "Emirates Home Furnishing LLC",
}
# Test logins for the supplier portal: use any TRN above as X-Supplier-TRN.


def _inv(trn: str, no: str, days_before: int, taxable: float, plot: str, desc: str, **kw) -> IngestInvoice:
    completion = date.today() - timedelta(days=60)
    vat = round(taxable * 0.05, 2)
    return IngestInvoice(supplier_trn=trn, supplier_name=SUPPLIERS[trn], invoice_no=no,
                         invoice_date=completion - timedelta(days=days_before), taxable_amount=taxable,
                         vat_amount=kw.pop("vat", vat), total=kw.pop("total", round(taxable + vat, 2)),
                         plot_no=plot, description=desc, **kw)


def fixtures() -> list[IngestApplication]:
    completion = date.today() - timedelta(days=60)
    t1, t2, t3, t4 = SUPPLIERS
    return [
        IngestApplication(maskan_ref="MSK-2026-0001", applicant_name="Ahmed Al Mansoori", emirates_id="784-1985-1234567-1",
                          plot_no="DXB-345-112", emirate="Dubai", completion_date=completion, invoices=[
                              _inv(t1, "ANB-1001", 200, 450000, "DXB-345-112", "Construction of villa structure - stage 2"),
                              _inv(t2, "GSC-77", 180, 82000, "DXB-345-112", "Reinforcement steel and cement supply"),
                              _inv(t3, "DRE-501", 90, 36000, "DXB-345-112", "Electrical wiring and DB installation"),
                          ]),
        IngestApplication(maskan_ref="MSK-2026-0002", applicant_name="Fatima Al Ketbi", emirates_id="784-1990-7654321-2",
                          plot_no="AUH-12-0098", emirate="Abu Dhabi", completion_date=completion, invoices=[
                              _inv(t1, "ANB-1044", 150, 300000, "AUH-12-0098", "Block work and plastering"),
                              _inv(t4, "EHF-9", 30, 25000, "AUH-12-0098", "Living room furniture and sofa set"),
                              _inv(t2, "GSC-80", 120, 40000, "AUH-12-0098", "Cement supply", vat=2500.0, total=42500.0),
                          ]),
        IngestApplication(maskan_ref="MSK-2026-0003", applicant_name="Khalid Al Shamsi", emirates_id="784-1979-1112223-3",
                          plot_no="SHJ-7-301", emirate="Sharjah", completion_date=completion, invoices=[
                              _inv(t1, "ANB-1001", 200, 450000, "SHJ-7-301", "Construction of villa structure - stage 2"),  # duplicate of MSK-0001
                              _inv(t3, "DRE-530", 100, 28000, "SHJ-7-301", "Lighting and switchgear installation"),
                          ]),
    ]


def seed() -> None:
    init_db()
    with Session(engine) as session:
        if session.exec(select(Application)).first():
            return
        for app in fixtures():
            pipeline.ingest(session, app)
        # Answer a few requests so the FTA dashboard shows every outcome.
        reqs = session.exec(select(ConfirmationRequest).order_by(ConfirmationRequest.id)).all()
        answers = [
            dict(issued=True, particulars_confirmed=True, consideration_status=ConsiderationStatus.RECEIVED, vat_return_period="2026-Q3"),
            dict(issued=True, particulars_confirmed=False, corrections={"taxable_amount": 80000}, consideration_status=ConsiderationStatus.RECEIVED, vat_return_period="2026-Q3"),
            dict(issued=False, particulars_confirmed=False),
        ]
        for req, ans in zip(reqs, answers):
            resp = SupplierResponse(request_id=req.id, declared_by="seed@supplier.example", **ans)
            session.add(resp)
            session.flush()
            pipeline.reconcile(session, req, resp)
        session.commit()


if __name__ == "__main__":
    seed()
    print("seeded")
