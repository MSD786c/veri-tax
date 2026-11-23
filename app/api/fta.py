"""FTA officer dashboard API. Read-mostly; the decision endpoint is the only write.

ponytail: identity is the X-Officer-Id header. Replace with FTA SSO before real data.
ponytail: aggregates computed in Python over full scans — move to SQL GROUP BY when volumes grow.
"""
import csv
import io
from collections import Counter

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, col, or_, select

from app.db import audit, get_session
from app.models import (
    Application,
    ApplicationStatus,
    AuditEvent,
    ConfirmationRequest,
    Invoice,
    InvoiceStatus,
    OfficerDecision,
    RequestStatus,
    RuleOutcome,
    RuleResult,
    Supplier,
    SupplierResponse,
)
from app.schemas import DecisionIn

router = APIRouter(prefix="/fta", tags=["FTA dashboard"])
REJECTED_INV = {InvoiceStatus.REJECTED, InvoiceStatus.AUTO_REJECTED, InvoiceStatus.DISPUTED}


def officer(x_officer_id: str = Header()) -> str:
    return x_officer_id


@router.get("/overview")
def overview(_: str = Depends(officer), session: Session = Depends(get_session)):
    apps = session.exec(select(Application)).all()
    invs = session.exec(select(Invoice)).all()
    reqs = session.exec(select(ConfirmationRequest)).all()
    fails = session.exec(select(RuleResult.rule_id).where(RuleResult.result == RuleOutcome.FAIL)).all()
    responded = [r for r in reqs if r.status == RequestStatus.RESPONDED]
    return {
        "applications_total": len(apps),
        "applications_by_status": Counter(a.status for a in apps),
        "refund_requested_aed": round(sum(i.vat_amount for i in invs), 2),
        "refund_verified_aed": round(sum(i.eligible_vat_amount for i in invs), 2),
        "rejected_applications": sum(a.status == ApplicationStatus.REJECTED for a in apps),
        "rejected_refund_aed": round(sum(i.vat_amount for i in invs if i.status in REJECTED_INV), 2),
        "supplier_response_rate": round(len(responded) / len(reqs), 3) if reqs else None,
        "top_rule_failures": Counter(fails).most_common(5),
    }


@router.get("/applications")
def list_applications(status: ApplicationStatus | None = None, emirate: str | None = None, _: str = Depends(officer), session: Session = Depends(get_session)):
    q = select(Application)
    if status:
        q = q.where(Application.status == status)
    if emirate:
        q = q.where(Application.emirate == emirate)
    out = []
    for a in session.exec(q.order_by(col(Application.submitted_at).desc())).all():
        invs = session.exec(select(Invoice).where(Invoice.application_id == a.id)).all()
        out.append({**a.model_dump(exclude={"emirates_id_hash"}), "invoice_count": len(invs),
                    "vat_claimed": round(sum(i.vat_amount for i in invs), 2),
                    "vat_eligible": round(sum(i.eligible_vat_amount for i in invs), 2)})
    return out


@router.get("/applications/{app_id}")
def get_application(app_id: int, _: str = Depends(officer), session: Session = Depends(get_session)):
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(404, "application not found")
    invoices = []
    for inv in session.exec(select(Invoice).where(Invoice.application_id == app_id)).all():
        req = session.exec(select(ConfirmationRequest).where(ConfirmationRequest.invoice_id == inv.id)).first()
        resp = req and session.exec(select(SupplierResponse).where(SupplierResponse.request_id == req.id)).first()
        invoices.append({
            "invoice": inv,
            "supplier": session.get(Supplier, inv.supplier_trn),
            "rule_results": session.exec(select(RuleResult).where(RuleResult.invoice_id == inv.id)).all(),
            "confirmation_request": req,
            "supplier_response": resp,
        })
    entities = [f"application:{app_id}"] + [f"invoice:{i['invoice'].id}" for i in invoices]
    return {
        "application": app.model_dump(exclude={"emirates_id_hash"}),
        "invoices": invoices,
        "decision": session.exec(select(OfficerDecision).where(OfficerDecision.application_id == app_id)).first(),
        "audit": session.exec(select(AuditEvent).where(col(AuditEvent.entity).in_(entities)).order_by(AuditEvent.at)).all(),
    }


@router.post("/applications/{app_id}/decision", response_model=OfficerDecision)
def decide(app_id: int, body: DecisionIn, officer_id: str = Depends(officer), session: Session = Depends(get_session)):
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(404, "application not found")
    if app.status != ApplicationStatus.READY_FOR_DECISION:
        raise HTTPException(409, f"application is {app.status}, not READY_FOR_DECISION")
    decision = OfficerDecision(application_id=app_id, officer_id=officer_id, **body.model_dump())
    app.status = ApplicationStatus(body.decision.value)
    session.add(decision)
    audit(session, f"officer:{officer_id}", "decide", f"application:{app_id}", decision=body.decision, amount=body.approved_amount)
    session.commit()
    session.refresh(decision)
    return decision


def _supplier_stats(session: Session, s: Supplier) -> dict:
    invs = session.exec(select(Invoice).where(Invoice.supplier_trn == s.trn)).all()
    reqs = session.exec(select(ConfirmationRequest).where(ConfirmationRequest.supplier_trn == s.trn)).all()
    return {
        **s.model_dump(),
        "application_count": len({i.application_id for i in invs}),
        "invoice_count": len(invs),
        "vat_claimed": round(sum(i.vat_amount for i in invs), 2),
        "vat_verified": round(sum(i.eligible_vat_amount for i in invs), 2),
        "vat_rejected": round(sum(i.vat_amount for i in invs if i.status in REJECTED_INV), 2),
        "response_rate": round(sum(r.status == RequestStatus.RESPONDED for r in reqs) / len(reqs), 3) if reqs else None,
    }


@router.get("/suppliers")
def list_suppliers(q: str | None = None, emirate: str | None = None, _: str = Depends(officer), session: Session = Depends(get_session)):
    stmt = select(Supplier)
    if q:
        stmt = stmt.where(or_(col(Supplier.legal_name).icontains(q), col(Supplier.trn).contains(q)))
    if emirate:
        stmt = stmt.where(Supplier.emirate == emirate)
    return [_supplier_stats(session, s) for s in session.exec(stmt).all()]


@router.get("/suppliers/{trn}")
def get_supplier(trn: str, _: str = Depends(officer), session: Session = Depends(get_session)):
    s = session.get(Supplier, trn)
    if not s:
        raise HTTPException(404, "supplier not found")
    invs = session.exec(select(Invoice).where(Invoice.supplier_trn == trn)).all()
    reqs = {r.invoice_id: r for r in session.exec(select(ConfirmationRequest).where(ConfirmationRequest.supplier_trn == trn)).all()}
    responses = session.exec(select(SupplierResponse).where(col(SupplierResponse.request_id).in_([r.id for r in reqs.values()]))).all()
    return {
        **_supplier_stats(session, s),
        "invoices": invs,
        "declared_vat_periods": sorted({r.vat_return_period for r in responses if r.vat_return_period}),
        "retention_outstanding": round(sum(r.retention_amount or 0 for r in responses), 2),
    }


@router.get("/rejections")
def rejections(_: str = Depends(officer), session: Session = Depends(get_session)):
    invs = session.exec(select(Invoice).where(col(Invoice.status).in_(REJECTED_INV | {InvoiceStatus.FLAGGED}))).all()
    out = []
    for inv in invs:
        failed = session.exec(select(RuleResult.rule_id).where(RuleResult.invoice_id == inv.id, RuleResult.result != RuleOutcome.PASS)).all()
        out.append({"invoice": inv, "supplier_name": session.get(Supplier, inv.supplier_trn).legal_name, "failed_rules": failed})
    return out


@router.get("/export/applications.csv")
def export_csv(_: str = Depends(officer), session: Session = Depends(get_session)):
    rows = list_applications(None, None, _, session)
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=applications.csv"})
