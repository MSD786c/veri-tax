"""FTA officer dashboard API. Read-mostly; the decision endpoints are the only writes.

ponytail: identity is the X-Officer-Id header. Replace with FTA SSO before real data.
ponytail: aggregates computed in Python over full scans — move to SQL GROUP BY when volumes grow.
"""
import csv
import io
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from sqlmodel import Session, col, or_, select

from app import agents, pipeline
from app.api.maskan_portal import document_view
from app.assessment import precedents, trust_tier
from app.db import audit, get_session
from app.models import (
    Application,
    ApplicationStatus,
    AuditEvent,
    ConfirmationRequest,
    Decision,
    Document,
    Invoice,
    InvoiceDecision,
    InvoiceDecisionValue,
    InvoiceStatus,
    OfficerDecision,
    Rating,
    RequestStatus,
    RuleOutcome,
    RuleResult,
    Supplier,
    SupplierResponse,
)
from app.schemas import DecisionIn, InvoiceDecisionIn

router = APIRouter(prefix="/fta", tags=["FTA dashboard"])
REJECTED_INV = {InvoiceStatus.REJECTED, InvoiceStatus.AUTO_REJECTED, InvoiceStatus.DISPUTED}
NEEDS_ATTENTION = REJECTED_INV | {InvoiceStatus.FLAGGED, InvoiceStatus.NO_SUPPLIER_RESPONSE}
TOLERANCE = 0.01  # AED


def _not_refundable(inv: Invoice) -> bool:
    """Rejected by an officer, disputed by the supplier, or rated FAIL and not yet decided."""
    return inv.status in REJECTED_INV or (inv.rating == Rating.FAIL and inv.officer_decision is None)


def _utc(dt: datetime) -> datetime:
    """SQLite hands back naive datetimes (stored as UTC); Postgres hands back aware ones."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _failed_rules(session: Session, invoice_id: int) -> list[str]:
    """Rules whose latest result on this invoice is FAIL or UNCERTAIN (rules re-run as evidence arrives)."""
    rows = session.exec(select(RuleResult).where(RuleResult.invoice_id == invoice_id).order_by(RuleResult.id)).all()
    latest = {r.rule_id: r.result for r in rows}
    return sorted(r for r, res in latest.items() if res in (RuleOutcome.FAIL, RuleOutcome.UNCERTAIN))


def officer(x_officer_id: str = Header()) -> str:
    return x_officer_id


@router.get("/overview")
def overview(_: str = Depends(officer), session: Session = Depends(get_session)):
    pipeline.expire_overdue(session)
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
        "invoices_by_rating": Counter(i.rating or "PENDING" for i in invs),
        "refund_requested_aed": round(sum(i.vat_amount for i in invs), 2),
        "refund_verified_aed": round(sum(i.eligible_vat_amount for i in invs), 2),
        "refund_approved_aed": round(sum(d.approved_amount for d in decisions), 2),
        "rejected_applications": sum(a.status == ApplicationStatus.REJECTED for a in apps),
        "rejected_refund_aed": round(sum(i.vat_amount for i in invs if _not_refundable(i)), 2),
        "officer_overrides": len(session.exec(select(InvoiceDecision).where(InvoiceDecision.overrode_agent)).all()),
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
    pipeline.expire_overdue(session)
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
                    "invoices_by_rating": Counter(i.rating or "PENDING" for i in invs),
                    "vat_claimed": claimed,
                    "vat_eligible": round(sum(i.eligible_vat_amount for i in invs), 2),
                    "issue_count": sum(i.status in NEEDS_ATTENTION for i in invs),
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
            "supplier_trust": trust_tier(session, inv.supplier_trn, exclude_invoice_id=inv.id),
            "precedents": precedents(session, inv),
            "officer_decision": session.exec(select(InvoiceDecision).where(InvoiceDecision.invoice_id == inv.id)
                                             .order_by(col(InvoiceDecision.decided_at).desc())).first(),
            "document": session.exec(select(Document).where(Document.sha256 == inv.document_hash)).first() if inv.document_hash else None,
            "extraction": pipeline.extraction_for(session, inv),
            "agent_runs": agents.runs_for(session, f"invoice:{inv.id}"),
        })
    entities = ([f"application:{app_id}"] + [f"invoice:{i['invoice'].id}" for i in invoices]
                + [f"request:{i['confirmation_request'].id}" for i in invoices if i["confirmation_request"]])
    return {
        "application": app.model_dump(exclude={"emirates_id_hash"}),
        "invoices": invoices,
        "decision": session.exec(select(OfficerDecision).where(OfficerDecision.application_id == app_id)).first(),
        "audit": session.exec(select(AuditEvent).where(col(AuditEvent.entity).in_(entities)).order_by(AuditEvent.at)).all(),
        "agent_runs": agents.runs_for(session, f"application:{app_id}")
    }


@router.post("/applications/{app_id}/decision", response_model=OfficerDecision)
def decide(app_id: int, body: DecisionIn, officer_id: str = Depends(officer), session: Session = Depends(get_session)):
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(404, "application not found")
    if app.status != ApplicationStatus.READY_FOR_DECISION:
        raise HTTPException(409, f"application is {app.status}, not READY_FOR_DECISION")
    claimed = round(sum(i.vat_amount for i in session.exec(select(Invoice).where(Invoice.application_id == app_id)).all()), 2)
    if body.decision == Decision.REJECTED and body.approved_amount != 0:
        raise HTTPException(422, "a rejection approves AED 0")
    if body.decision != Decision.REJECTED and body.approved_amount <= 0:
        raise HTTPException(422, "an approval needs an approved amount above 0")
    if body.approved_amount > claimed + TOLERANCE:
        raise HTTPException(422, f"approved amount exceeds the VAT claimed (AED {claimed})")
    decision = OfficerDecision(application_id=app_id, officer_id=officer_id, **body.model_dump())
    app.status = ApplicationStatus(body.decision.value)
    session.add(decision)
    audit(session, f"officer:{officer_id}", "decide", f"application:{app_id}", decision=body.decision, amount=body.approved_amount)
    session.commit()
    session.refresh(decision)
    return decision


@router.post("/invoices/{invoice_id}/decision", response_model=InvoiceDecision)
def decide_invoice(invoice_id: int, body: InvoiceDecisionIn, officer_id: str = Depends(officer), session: Session = Depends(get_session)):
    """Approve or reject one invoice. The agent's rating is a recommendation; this is the decision."""
    inv = session.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(404, "invoice not found")
    app = session.get(Application, inv.application_id)
    if app.status in pipeline.DECIDED:
        raise HTTPException(409, f"application is already {app.status}")
    if body.approved_vat_amount is not None and body.approved_vat_amount > inv.vat_amount + TOLERANCE:
        raise HTTPException(422, f"approved amount exceeds the VAT on the invoice (AED {inv.vat_amount})")
    record = pipeline.decide_invoice(session, inv, officer_id, body.decision, body.comment, body.approved_vat_amount)
    session.commit()
    session.refresh(record)
    return record


@router.post("/requests/expire-overdue")
def expire_overdue(as_of: datetime | None = None, officer_id: str = Depends(officer), session: Session = Depends(get_session)):
    """Close supplier requests past their time limit; those invoices go forward rated WEAK.

    Runs automatically when the dashboard loads. `as_of` lets a demo move the clock forward.
    """
    expired = pipeline.expire_overdue(session, as_of)
    if expired:
        audit(session, f"officer:{officer_id}", "expire-overdue", "requests", expired=expired, as_of=str(as_of))
        session.commit()
    return {"expired": expired}


def _supplier_stats(session: Session, s: Supplier) -> dict:
    invs = session.exec(select(Invoice).where(Invoice.supplier_trn == s.trn)).all()
    reqs = session.exec(select(ConfirmationRequest).where(ConfirmationRequest.supplier_trn == s.trn)).all()
    return {
        **s.model_dump(),
        "application_count": len({i.application_id for i in invs}),
        "invoice_count": len(invs),
        "vat_claimed": round(sum(i.vat_amount for i in invs), 2),
        "vat_verified": round(sum(i.eligible_vat_amount for i in invs), 2),
        "vat_rejected": round(sum(i.vat_amount for i in invs if _not_refundable(i)), 2),
        "trust": trust_tier(session, s.trn),
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
               status: InvoiceStatus | None = None, rating: Rating | None = None,
               _: str = Depends(officer), session: Session = Depends(get_session)):
    """Invoices that need an officer: rejected, disputed, flagged or without a supplier response."""
    pipeline.expire_overdue(session)
    stmt = select(Invoice).where(col(Invoice.status).in_(NEEDS_ATTENTION))
    if status:
        stmt = stmt.where(Invoice.status == status)
    if rating:
        stmt = stmt.where(Invoice.rating == rating)
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
        w.writerows({**r, "failed_rules": " ".join(r["failed_rules"]), "flags": " | ".join(r.get("flags") or []),
                     "invoices_by_rating": " ".join(f"{k}:{v}" for k, v in sorted(r["invoices_by_rating"].items()))}
                    for r in rows)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=applications.csv"})


@router.get("/documents")
def list_documents(_: str = Depends(officer), session: Session = Depends(get_session)):
    """Every original document (upload link and Maskan), with its extraction and linked invoices."""
    return [document_view(session, d) for d in session.exec(select(Document).order_by(col(Document.uploaded_at).desc())).all()]


@router.get("/documents/{doc_id}/file")
def document_file(doc_id: int, _: str = Depends(officer), session: Session = Depends(get_session)):
    doc = session.get(Document, doc_id)
    if not doc:
        raise HTTPException(404, "document not found")
    return FileResponse(doc.path, media_type=doc.content_type, filename=doc.filename)


def _need_agent():
    if not agents.enabled():
        raise HTTPException(503, "No agent configured: set AGENT_PROVIDER=groq and GROQ_API_KEY")


@router.post("/invoices/{invoice_id}/compliance")
def run_compliance(invoice_id: int, _: str = Depends(officer), session: Session = Depends(get_session)):
    """Ask the compliance agent for a second opinion now (synchronous). Advisory only."""
    _need_agent()
    inv = session.get(Invoice, invoice_id)
    if not inv:
        raise HTTPException(404, "invoice not found")
    return agents.compliance_review(session, inv)


@router.post("/applications/{app_id}/summary")
def run_summary(app_id: int, _: str = Depends(officer), session: Session = Depends(get_session)):
    """Generate the reconciliation agent's decision brief now (synchronous). Advisory only."""
    _need_agent()
    app = session.get(Application, app_id)
    if not app:
        raise HTTPException(404, "application not found")
    return agents.reconciliation_summary(session, app)


@router.get("/analytics")
def analytics(emirate: str | None = None, date_from: date | None = None, date_to: date | None = None,
              _: str = Depends(officer), session: Session = Depends(get_session)):
    """Everything the dashboard and reports charts need, filtered by emirate and invoice-date range.

    ponytail: computed in Python over full scans, like /overview. Move to SQL GROUP BY when volumes grow.
    """
    pipeline.expire_overdue(session)
    apps = {a.id: a for a in session.exec(select(Application)).all()}
    suppliers = {s.trn: s for s in session.exec(select(Supplier)).all()}
    all_invs = session.exec(select(Invoice)).all()

    def in_range(i: Invoice) -> bool:
        return (date_from is None or i.invoice_date >= date_from) and (date_to is None or i.invoice_date <= date_to)

    invs = [i for i in all_invs if in_range(i) and (not emirate or apps[i.application_id].emirate == emirate)]
    inv_ids = {i.id for i in invs}
    app_ids = {i.application_id for i in invs} if (date_from or date_to) else {a.id for a in apps.values() if not emirate or a.emirate == emirate}

    months: dict[str, dict] = {}
    for i in invs:
        m = months.setdefault(i.invoice_date.strftime("%Y-%m"), {"month": i.invoice_date.strftime("%Y-%m"), "claimed": 0.0, "verified": 0.0, "rejected": 0.0, "invoices": 0})
        m["claimed"] += i.vat_amount
        m["verified"] += i.eligible_vat_amount
        m["rejected"] += i.vat_amount if _not_refundable(i) else 0
        m["invoices"] += 1
    monthly = [{**m, "claimed": round(m["claimed"], 2), "verified": round(m["verified"], 2), "rejected": round(m["rejected"], 2)} for _, m in sorted(months.items())]

    ratings = Counter(i.rating or "PENDING" for i in invs)
    decided = session.exec(select(InvoiceDecision).where(col(InvoiceDecision.invoice_id).in_(inv_ids or {-1}))).all()
    status = Counter(apps[a].status for a in app_ids)

    by_emirate: dict[str, dict] = {}
    for i in all_invs:
        if not in_range(i):
            continue
        e = apps[i.application_id].emirate
        row = by_emirate.setdefault(e, {"emirate": e, "claimed": 0.0, "verified": 0.0, "invoices": 0})
        row["claimed"] += i.vat_amount
        row["verified"] += i.eligible_vat_amount
        row["invoices"] += 1
    by_emirate_rows = sorted(({**r, "claimed": round(r["claimed"], 2), "verified": round(r["verified"], 2)} for r in by_emirate.values()), key=lambda r: -r["claimed"])

    per_supplier: dict[str, dict] = {}
    for i in invs:
        row = per_supplier.setdefault(i.supplier_trn, {"trn": i.supplier_trn, "name": suppliers[i.supplier_trn].legal_name, "claimed": 0.0, "rejected": 0.0, "invoices": 0})
        row["claimed"] += i.vat_amount
        row["rejected"] += i.vat_amount if _not_refundable(i) else 0
        row["invoices"] += 1
    top_suppliers = sorted(({**r, "claimed": round(r["claimed"], 2), "rejected": round(r["rejected"], 2)} for r in per_supplier.values()), key=lambda r: (-r["rejected"], -r["claimed"]))[:6]

    fails = Counter(r for r in session.exec(select(RuleResult.rule_id).where(
        col(RuleResult.invoice_id).in_(inv_ids or {-1}), col(RuleResult.result).in_([RuleOutcome.FAIL, RuleOutcome.UNCERTAIN]))).all())

    days: dict[str, dict] = {}
    for d in decided:
        row = days.setdefault(d.decided_at.date().isoformat(), {"day": d.decided_at.date().isoformat(), "approved": 0, "rejected": 0})
        row["approved" if d.decision == InvoiceDecisionValue.APPROVED else "rejected"] += 1

    reqs = [r for r in session.exec(select(ConfirmationRequest)).all() if r.invoice_id in inv_ids]
    responded = [r for r in reqs if r.status == RequestStatus.RESPONDED]
    return {
        "filters": {"emirate": emirate, "date_from": date_from, "date_to": date_to, "emirates": sorted({a.emirate for a in apps.values() if a.emirate})},
        "totals": {"applications": len(app_ids), "invoices": len(invs), "claimed": round(sum(i.vat_amount for i in invs), 2),
                   "verified": round(sum(i.eligible_vat_amount for i in invs), 2),
                   "not_refundable": round(sum(i.vat_amount for i in invs if _not_refundable(i)), 2),
                   "officer_decisions": len(decided), "overrides": sum(1 for d in decided if d.overrode_agent),
                   "supplier_response_rate": round(len(responded) / len(reqs), 3) if reqs else None},
        "monthly": monthly,
        "ratings": {k: ratings.get(k, 0) for k in ("STRONG", "WEAK", "FAIL", "PENDING")},
        "application_status": {k.value: status.get(k, 0) for k in ApplicationStatus},
        "by_emirate": by_emirate_rows,
        "top_suppliers": top_suppliers,
        "rule_failures": [{"rule": r, "count": n} for r, n in fails.most_common(8)],
        "decisions_daily": sorted(days.values(), key=lambda r: r["day"]),
    }
