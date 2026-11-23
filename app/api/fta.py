"""FTA officer dashboard API. Read-mostly; the decision endpoint is the only write.

ponytail: identity is the X-Officer-Id header. Replace with FTA SSO before real data.
ponytail: aggregates computed in Python over full scans — move to SQL GROUP BY when volumes grow.
"""
import csv
import io
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, col, or_, select

from app.db import audit, get_session
from app.models import (
    Application,
    ApplicationStatus,
    AuditEvent,
    ConfirmationRequest,
    Decision,
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
TOLERANCE = 0.05  # AED


def _utc(dt: datetime) -> datetime:
    """SQLite hands back naive datetimes (stored as UTC); Postgres hands back aware ones."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _failed_rules(session: Session, invoice_id: int) -> list[str]:
    return list(session.exec(select(RuleResult.rule_id).where(
        RuleResult.invoice_id == invoice_id, col(RuleResult.result).in_([RuleOutcome.FAIL, RuleOutcome.UNCERTAIN]))).all())


def officer(x_officer_id: str = Header()) -> str:
    return x_officer_id


@router.get("/overview")
def overview(_: str = Depends(officer), session: Session = Depends(get_session)):
    apps = session.exec(select(Application)).all()
    invs = session.exec(select(Invoice)).all()
    reqs = session.exec(select(ConfirmationRequest)).all()
    fails = session.exec(select(RuleResult.rule_id).where(RuleResult.result == RuleOutcome.FAIL)).all()
    decisions = session.exec(select(OfficerDecision)).all()
    responded = [r for r in reqs if r.status == RequestStatus.RESPONDED]
    sent = {r.id: r.sent_at for r in responded}
    responses = session.exec(select(SupplierResponse).where(col(SupplierResponse.request_id).in_(list(sent)))).all()
    waits = [(_utc(r.declared_at) - _utc(sent[r.request_id])).total_seconds() / 3600 for r in responses]
    now = datetime.now(timezone.utc)
    since = lambda days: sum(_utc(a.submitted_at) >= now - timedelta(days=days) for a in apps)  # noqa: E731
    return {
        "applications_total": len(apps),
        "applications_new": {"today": sum(_utc(a.submitted_at).date() == now.date() for a in apps), "week": since(7), "month": since(30)},
        "applications_by_status": Counter(a.status for a in apps),
        "invoices_total": len(invs),
        "invoices_by_status": Counter(i.status for i in invs),
        "refund_requested_aed": round(sum(i.vat_amount for i in invs), 2),
        "refund_verified_aed": round(sum(i.eligible_vat_amount for i in invs), 2),
        "refund_approved_aed": round(sum(d.approved_amount for d in decisions), 2),
        "rejected_applications": sum(a.status == ApplicationStatus.REJECTED for a in apps),
        "rejected_refund_aed": round(sum(i.vat_amount for i in invs if i.status in REJECTED_INV), 2),
        "supplier_requests_total": len(reqs),
        "supplier_requests_pending": sum(r.status == RequestStatus.PENDING for r in reqs),
        "supplier_response_rate": round(len(responded) / len(reqs), 3) if reqs else None,
        "avg_response_hours": round(sum(waits) / len(waits), 1) if waits else None,
        "top_rule_failures": Counter(fails).most_common(5),
    }


def _application_rows(session: Session, status: ApplicationStatus | None = None, emirate: str | None = None,
                      q: str | None = None, supplier_trn: str | None = None, rule_failed: str | None = None,
                      submitted_from: date | None = None, submitted_to: date | None = None,
                      min_vat: float | None = None, max_vat: float | None = None) -> list[dict]:
    stmt = select(Application)
    if status:
        stmt = stmt.where(Application.status == status)
    if emirate:
        stmt = stmt.where(Application.emirate == emirate)
    if q:
        stmt = stmt.where(or_(col(Application.applicant_name).icontains(q), col(Application.maskan_ref).icontains(q),
                              col(Application.plot_no).icontains(q)))
    out = []
    for a in session.exec(stmt.order_by(col(Application.submitted_at).desc())).all():
        submitted = _utc(a.submitted_at).date()
        if (submitted_from and submitted < submitted_from) or (submitted_to and submitted > submitted_to):
            continue
        invs = session.exec(select(Invoice).where(Invoice.application_id == a.id)).all()
        if supplier_trn and not any(i.supplier_trn == supplier_trn for i in invs):
            continue
        failed = {r for i in invs for r in _failed_rules(session, i.id)}
        if rule_failed and rule_failed not in failed:
            continue
        claimed = round(sum(i.vat_amount for i in invs), 2)
        if (min_vat is not None and claimed < min_vat) or (max_vat is not None and claimed > max_vat):
            continue
        out.append({**a.model_dump(exclude={"emirates_id_hash"}), "invoice_count": len(invs),
                    "vat_claimed": claimed,
                    "vat_eligible": round(sum(i.eligible_vat_amount for i in invs), 2),
                    "issue_count": sum(i.status not in {InvoiceStatus.VERIFIED, InvoiceStatus.AWAITING_SUPPLIER} for i in invs),
                    "failed_rules": sorted(failed)})
    return out


@router.get("/applications")
def list_applications(status: ApplicationStatus | None = None, emirate: str | None = None, q: str | None = None,
                      supplier_trn: str | None = None, rule_failed: str | None = None,
                      submitted_from: date | None = None, submitted_to: date | None = None,
                      min_vat: float | None = None, max_vat: float | None = None,
                      _: str = Depends(officer), session: Session = Depends(get_session)):
    return _application_rows(session, status, emirate, q, supplier_trn, rule_failed, submitted_from, submitted_to, min_vat, max_vat)


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
    entities = ([f"application:{app_id}"] + [f"invoice:{i['invoice'].id}" for i in invoices]
                + [f"request:{i['confirmation_request'].id}" for i in invoices if i["confirmation_request"]])
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
    claimed = sum(i.vat_amount for i in session.exec(select(Invoice).where(Invoice.application_id == app_id)).all())
    if body.decision == Decision.REJECTED and body.approved_amount != 0:
        raise HTTPException(422, "a rejection approves AED 0")
    if body.decision != Decision.REJECTED and body.approved_amount <= 0:
        raise HTTPException(422, "an approval needs an approved amount above 0")
    if body.approved_amount > claimed + TOLERANCE:
        raise HTTPException(422, f"approved amount exceeds the VAT claimed (AED {claimed:,.2f})")
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
    by_req = {r.request_id: r for r in responses}
    apps = {a.id: a for a in session.exec(select(Application).where(col(Application.id).in_({i.application_id for i in invs}))).all()}
    rows = []
    for i in invs:
        req = reqs.get(i.id)
        resp = by_req.get(req.id) if req else None
        rows.append({**i.model_dump(), "maskan_ref": apps[i.application_id].maskan_ref,
                     "application_status": apps[i.application_id].status, "failed_rules": _failed_rules(session, i.id),
                     "request_status": req.status if req else None,
                     "vat_return_period": resp.vat_return_period if resp else None})
    return {
        **_supplier_stats(session, s),
        "invoices": rows,
        "declared_vat_periods": sorted({r.vat_return_period for r in responses if r.vat_return_period}),
        "retention_outstanding": round(sum(r.retention_amount or 0 for r in responses), 2),
    }


@router.get("/rejections")
def rejections(rule_id: str | None = None, supplier_trn: str | None = None, emirate: str | None = None,
               status: InvoiceStatus | None = None, _: str = Depends(officer), session: Session = Depends(get_session)):
    stmt = select(Invoice).where(col(Invoice.status).in_(REJECTED_INV | {InvoiceStatus.FLAGGED}))
    if status:
        stmt = stmt.where(Invoice.status == status)
    if supplier_trn:
        stmt = stmt.where(Invoice.supplier_trn == supplier_trn)
    out = []
    for inv in session.exec(stmt).all():
        app = session.get(Application, inv.application_id)
        if emirate and app.emirate != emirate:
            continue
        failed = _failed_rules(session, inv.id)
        if rule_id and rule_id not in failed:
            continue
        out.append({"invoice": inv, "supplier_name": session.get(Supplier, inv.supplier_trn).legal_name,
                    "maskan_ref": app.maskan_ref, "applicant_name": app.applicant_name, "emirate": app.emirate,
                    "failed_rules": failed})
    return out


@router.get("/export/applications.csv")
def export_csv(status: ApplicationStatus | None = None, emirate: str | None = None, q: str | None = None,
               supplier_trn: str | None = None, rule_failed: str | None = None,
               submitted_from: date | None = None, submitted_to: date | None = None,
               min_vat: float | None = None, max_vat: float | None = None,
               _: str = Depends(officer), session: Session = Depends(get_session)):
    rows = _application_rows(session, status, emirate, q, supplier_trn, rule_failed, submitted_from, submitted_to, min_vat, max_vat)
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows({**r, "failed_rules": " ".join(r["failed_rules"])} for r in rows)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=applications.csv"})
