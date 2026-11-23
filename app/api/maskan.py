"""Maskan connector: ingestion, and the applicant's own view of the result.

ponytail: push endpoint only; polling/webhook auth TBD (README open question).
ponytail: the applicant is identified by the X-Emirates-Id header. Replace with UAE PASS.
"""
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlmodel import Session, select

from app import pipeline
from app.db import get_session
from app.models import Application, Invoice, InvoiceStatus
from app.schemas import IngestApplication

router = APIRouter(prefix="/maskan", tags=["maskan (ingestion + applicant status)"])

APPLICANT_STATUS = {
    InvoiceStatus.AWAITING_SUPPLIER: "Waiting for the supplier to confirm",
    InvoiceStatus.NO_SUPPLIER_RESPONSE: "Supplier did not respond; under review by the FTA",
    InvoiceStatus.VERIFIED: "Verified",
    InvoiceStatus.FLAGGED: "Under review by the FTA",
    InvoiceStatus.DISPUTED: "Not confirmed by the supplier",
    InvoiceStatus.REJECTED: "Not accepted",
}


@router.post("/applications", response_model=Application, status_code=201)
def ingest_application(payload: IngestApplication, session: Session = Depends(get_session)):
    if session.exec(select(Application).where(Application.maskan_ref == payload.maskan_ref)).first():
        raise HTTPException(409, f"application {payload.maskan_ref} already ingested")
    return pipeline.ingest(session, payload)


@router.get("/applications/{maskan_ref}/status")
def applicant_status(maskan_ref: str, x_emirates_id: str = Header(), session: Session = Depends(get_session)):
    """What the applicant sees in Maskan: where each invoice stands and what would fix it.

    Shows nothing a supplier declared about its own tax affairs, and no internal rule evidence.
    """
    app = session.exec(select(Application).where(Application.maskan_ref == maskan_ref)).first()
    if not app or not hmac.compare_digest(app.emirates_id_hash, pipeline.hash_emirates_id(x_emirates_id)):
        raise HTTPException(404, "application not found")
    pipeline.expire_overdue(session)
    invoices = session.exec(select(Invoice).where(Invoice.application_id == app.id)).all()
    return {
        "maskan_ref": app.maskan_ref,
        "status": app.status,
        "invoices": [{
            "invoice_no": inv.invoice_no,
            "supplier_trn": inv.supplier_trn,
            "vat_amount": inv.vat_amount,
            "status": APPLICANT_STATUS.get(inv.status, "In verification"),
            "decided_by_officer": inv.officer_decision is not None,
            "what_you_can_do": inv.fix_guidance if inv.officer_decision is None else [],
        } for inv in invoices],
    }
