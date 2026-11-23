"""Verification pipeline: ingest -> rules -> supplier requests -> reconcile -> rollup."""
import hashlib
from datetime import timedelta

from sqlmodel import Session, select

from app import rules
from app.db import audit
from app.models import (
    Application,
    ApplicationStatus,
    ConfirmationRequest,
    Invoice,
    InvoiceStatus,
    RequestStatus,
    RuleOutcome,
    RuleResult,
    Supplier,
    SupplierResponse,
    now,
)
from app.schemas import IngestApplication

SUPPLIER_SLA = timedelta(days=14)  # open question in README; tune once FTA agrees an SLA
FINAL = {InvoiceStatus.VERIFIED, InvoiceStatus.FLAGGED, InvoiceStatus.REJECTED, InvoiceStatus.AUTO_REJECTED, InvoiceStatus.DISPUTED}


def _save_results(session: Session, invoice_id: int, checks: list[rules.Check]) -> None:
    for rule_id, result, evidence in checks:
        session.add(RuleResult(invoice_id=invoice_id, rule_id=rule_id, rule_version=rules.RULESET_VERSION, result=result, evidence=evidence))


def ingest(session: Session, payload: IngestApplication, actor: str = "maskan") -> Application:
    app = Application(
        maskan_ref=payload.maskan_ref,
        applicant_name=payload.applicant_name,
        emirates_id_hash=hashlib.sha256(payload.emirates_id.encode()).hexdigest(),
        plot_no=payload.plot_no,
        emirate=payload.emirate,
        completion_date=payload.completion_date,
        claim_type=payload.claim_type,
        status=ApplicationStatus.IN_VERIFICATION,
    )
    session.add(app)
    session.flush()
    audit(session, actor, "ingest", f"application:{app.id}", maskan_ref=app.maskan_ref)

    for item in payload.invoices:
        if not session.get(Supplier, item.supplier_trn):
            session.add(Supplier(trn=item.supplier_trn, legal_name=item.supplier_name, emirate=payload.emirate))
        inv = Invoice(application_id=app.id, status=InvoiceStatus.EXTRACTED, **item.model_dump(exclude={"supplier_name"}))
        session.add(inv)
        session.flush()

        checks = rules.check_invoice(session, inv, app)
        _save_results(session, inv.id, checks)
        if any(r == RuleOutcome.FAIL for _, r, _ in checks):
            inv.status = InvoiceStatus.AUTO_REJECTED
        else:
            # Every invoice still needs supplier confirmation (SC-*), so none stop at AUTO_VERIFIED yet.
            inv.status = InvoiceStatus.AWAITING_SUPPLIER
            session.add(ConfirmationRequest(invoice_id=inv.id, supplier_trn=inv.supplier_trn, due_at=now() + SUPPLIER_SLA))
        audit(session, "rule-engine", "verify", f"invoice:{inv.id}", status=inv.status, ruleset=rules.RULESET_VERSION)

    rollup(session, app)
    session.commit()
    session.refresh(app)
    return app


def reconcile(session: Session, req: ConfirmationRequest, resp: SupplierResponse) -> Invoice:
    inv = session.get(Invoice, req.invoice_id)
    checks = rules.check_supplier_response(inv, resp)
    _save_results(session, inv.id, checks)
    results = [r for _, r, _ in checks]

    if not resp.issued:
        inv.status = InvoiceStatus.DISPUTED
    elif RuleOutcome.FAIL in results:
        inv.status = InvoiceStatus.FLAGGED
    elif RuleOutcome.UNCERTAIN in results:
        inv.status = InvoiceStatus.FLAGGED
    else:
        inv.status = InvoiceStatus.VERIFIED
        inv.eligible_vat_amount = inv.vat_amount
    req.status = RequestStatus.RESPONDED
    audit(session, "reconciliation", "reconcile", f"invoice:{inv.id}", status=inv.status)
    rollup(session, session.get(Application, inv.application_id))
    return inv


def rollup(session: Session, app: Application) -> None:
    if app.status in {ApplicationStatus.APPROVED, ApplicationStatus.PARTIALLY_APPROVED, ApplicationStatus.REJECTED}:
        return
    session.flush()
    statuses = session.exec(select(Invoice.status).where(Invoice.application_id == app.id)).all()
    app.status = ApplicationStatus.READY_FOR_DECISION if all(s in FINAL for s in statuses) else ApplicationStatus.AWAITING_SUPPLIERS
