"""Verification pipeline: ingest -> rules -> supplier requests -> reconcile -> rating -> rollup.

Nothing here approves or rejects a refund. The pipeline produces a rating (STRONG, WEAK, FAIL)
with reasons; the FTA officer decides.
"""
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app import rules
from app.assessment import assess, latest_results, signature
from app.db import audit
from app.models import (
    Application,
    ApplicationStatus,
    ConfirmationRequest,
    Invoice,
    InvoiceDecision,
    InvoiceDecisionValue,
    InvoiceStatus,
    Rating,
    RequestStatus,
    RuleOutcome,
    RuleResult,
    Supplier,
    SupplierResponse,
    now,
)
from app.schemas import IngestApplication

SUPPLIER_SLA_BUSINESS_DAYS = 5  # then the invoice goes forward as WEAK instead of blocking the applicant
CONTRACT_TOLERANCE = 1.10  # CS-01: invoices may exceed the contract by 10% (variation orders) before a flag
FINAL = {InvoiceStatus.VERIFIED, InvoiceStatus.FLAGGED, InvoiceStatus.REJECTED, InvoiceStatus.AUTO_REJECTED,
         InvoiceStatus.DISPUTED, InvoiceStatus.NO_SUPPLIER_RESPONSE}
DECIDED = {ApplicationStatus.APPROVED, ApplicationStatus.PARTIALLY_APPROVED, ApplicationStatus.REJECTED}


def add_business_days(start: datetime, days: int) -> datetime:
    """UAE federal working week: Monday to Friday."""
    current = start
    while days:
        current += timedelta(days=1)
        if current.weekday() < 5:
            days -= 1
    return current


def hash_emirates_id(emirates_id: str) -> str:
    """Keyed hash, so the ID cannot be recovered by hashing every possible Emirates ID.

    ponytail: the key comes from ID_HASH_KEY; the default is for local development only.
    """
    key = os.getenv("ID_HASH_KEY", "dev-only-change-me").encode()
    return hmac.new(key, emirates_id.strip().encode(), hashlib.sha256).hexdigest()


def _save_results(session: Session, invoice_id: int, checks: list[rules.Check]) -> None:
    for rule_id, result, evidence in checks:
        session.add(RuleResult(invoice_id=invoice_id, rule_id=rule_id, rule_version=rules.RULESET_VERSION, result=result, evidence=evidence))


def _flag_earlier_duplicates(session: Session, inv: Invoice) -> None:
    """NR-05 on the other side: the earlier claim of the same invoice is flagged too, as WEAK.

    The later claim is rated FAIL. The earlier one may be the genuine claim, so it is not failed;
    the officer decides which is real.
    """
    for other in rules.find_duplicates(session, inv):
        if other.officer_decision is not None:
            continue
        _save_results(session, other.id, [("NR-05", RuleOutcome.UNCERTAIN, {
            "also_claimed_in_applications": [inv.application_id],
            "reason": "The same supplier invoice was later claimed in another application"})])
        if other.status == InvoiceStatus.VERIFIED:
            other.status = InvoiceStatus.FLAGGED
            other.eligible_vat_amount = 0
        assess(session, other)
        audit(session, "rule-engine", "flag-duplicate", f"invoice:{other.id}", duplicate_of_invoice=inv.id, rating=other.rating)
        rollup(session, session.get(Application, other.application_id))


def ingest(session: Session, payload: IngestApplication, actor: str = "maskan") -> Application:
    app = Application(
        maskan_ref=payload.maskan_ref,
        applicant_name=payload.applicant_name,
        emirates_id_hash=hash_emirates_id(payload.emirates_id),
        plot_no=payload.plot_no,
        emirate=payload.emirate,
        completion_date=payload.completion_date,
        permit_date=payload.permit_date,
        contract_value=payload.contract_value,
        claim_type=payload.claim_type,
        status=ApplicationStatus.IN_VERIFICATION,
    )
    session.add(app)
    session.flush()
    audit(session, actor, "ingest", f"application:{app.id}", maskan_ref=app.maskan_ref)

    for item in payload.invoices:
        if not session.get(Supplier, item.supplier_trn):
            # Not in the registry data: created so the invoice can be stored, but TI-03 stays UNCERTAIN.
            session.add(Supplier(trn=item.supplier_trn, legal_name=item.supplier_name, emirate=payload.emirate))
        inv = Invoice(application_id=app.id, status=InvoiceStatus.EXTRACTED, **item.model_dump(exclude={"supplier_name"}))
        session.add(inv)
        session.flush()

        _save_results(session, inv.id, rules.check_invoice(session, inv, app))
        assess(session, inv)
        if inv.rating == Rating.FAIL:
            # A recommendation to reject. It still goes to the officer; it is not sent to the supplier.
            inv.status = InvoiceStatus.FLAGGED
        else:
            inv.status = InvoiceStatus.AWAITING_SUPPLIER
            session.add(ConfirmationRequest(invoice_id=inv.id, supplier_trn=inv.supplier_trn,
                                            due_at=add_business_days(now(), SUPPLIER_SLA_BUSINESS_DAYS)))
        audit(session, "rule-engine", "verify", f"invoice:{inv.id}", status=inv.status, rating=inv.rating, ruleset=rules.RULESET_VERSION)
        _flag_earlier_duplicates(session, inv)

    claimed = sum(i.total for i in payload.invoices)
    if app.contract_value and claimed > app.contract_value * CONTRACT_TOLERANCE:
        app.flags = [f"CS-01: invoices total AED {claimed:,.2f}, more than the construction contract value of "
                     f"AED {app.contract_value:,.2f}. Check for variation orders."]
        audit(session, "rule-engine", "flag-application", f"application:{app.id}", rule="CS-01", claimed=claimed)

    rollup(session, app)
    session.commit()
    session.refresh(app)
    return app


def reconcile(session: Session, req: ConfirmationRequest, resp: SupplierResponse) -> Invoice:
    """Supplier answered. Its confirmation is evidence, not proof: every earlier check still counts."""
    inv = session.get(Invoice, req.invoice_id)
    _save_results(session, inv.id, rules.check_supplier_response(inv, resp))
    req.status = RequestStatus.RESPONDED
    inv.status = InvoiceStatus.DISPUTED if not resp.issued else InvoiceStatus.SUPPLIER_CONFIRMED
    assess(session, inv)

    if inv.status != InvoiceStatus.DISPUTED:
        if inv.rating == Rating.STRONG:
            inv.status = InvoiceStatus.VERIFIED
            inv.eligible_vat_amount = inv.vat_amount if inv.suggested_eligible_vat is None else inv.suggested_eligible_vat
        else:
            inv.status = InvoiceStatus.FLAGGED
    audit(session, "reconciliation", "reconcile", f"invoice:{inv.id}", status=inv.status, rating=inv.rating)
    rollup(session, session.get(Application, inv.application_id))
    return inv


def expire_overdue(session: Session, as_of: datetime | None = None) -> int:
    """Supplier silent past the time limit: the invoice goes forward as WEAK, the applicant is not blocked."""
    as_of = as_of or now()
    if as_of.tzinfo is None:
        as_of = as_of.replace(tzinfo=timezone.utc)
    overdue = session.exec(select(ConfirmationRequest).where(
        ConfirmationRequest.status == RequestStatus.PENDING, ConfirmationRequest.due_at < as_of)).all()
    for req in overdue:
        req.status = RequestStatus.EXPIRED
        inv = session.get(Invoice, req.invoice_id)
        inv.status = InvoiceStatus.NO_SUPPLIER_RESPONSE
        assess(session, inv)
        audit(session, "supplier-requests", "expire", f"invoice:{inv.id}", request=req.id, rating=inv.rating)
        rollup(session, session.get(Application, inv.application_id))
    if overdue:
        session.commit()
    return len(overdue)


def decide_invoice(session: Session, inv: Invoice, officer_id: str, decision: InvoiceDecisionValue,
                   comment: str = "", approved_vat_amount: float | None = None) -> InvoiceDecision:
    """The officer's decision on one invoice. Stored with the agent's rating, so overrides become precedents."""
    if decision == InvoiceDecisionValue.APPROVED:
        amount = approved_vat_amount if approved_vat_amount is not None else (
            inv.vat_amount if inv.suggested_eligible_vat is None else inv.suggested_eligible_vat)
        inv.status, inv.eligible_vat_amount = InvoiceStatus.VERIFIED, amount
    else:
        amount = 0
        inv.status, inv.eligible_vat_amount = InvoiceStatus.REJECTED, 0
    overrode = (inv.rating == Rating.FAIL and decision == InvoiceDecisionValue.APPROVED) or (
        inv.rating == Rating.STRONG and decision == InvoiceDecisionValue.REJECTED)
    record = InvoiceDecision(invoice_id=inv.id, officer_id=officer_id, decision=decision, approved_vat_amount=amount,
                             comment=comment, agent_rating=inv.rating, overrode_agent=overrode,
                             signature=signature(latest_results(session, inv.id)))
    inv.officer_decision = decision
    session.add(record)
    for req in session.exec(select(ConfirmationRequest).where(
            ConfirmationRequest.invoice_id == inv.id, ConfirmationRequest.status == RequestStatus.PENDING)).all():
        req.status = RequestStatus.EXPIRED  # officer decided without waiting for the supplier
    audit(session, f"officer:{officer_id}", "decide-invoice", f"invoice:{inv.id}", decision=decision,
          agent_rating=inv.rating, overrode_agent=overrode, amount=amount)
    rollup(session, session.get(Application, inv.application_id))
    return record


def rollup(session: Session, app: Application) -> None:
    if app.status in DECIDED:
        return
    session.flush()
    statuses = session.exec(select(Invoice.status).where(Invoice.application_id == app.id)).all()
    app.status = ApplicationStatus.READY_FOR_DECISION if all(s in FINAL for s in statuses) else ApplicationStatus.AWAITING_SUPPLIERS
