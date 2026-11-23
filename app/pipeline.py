"""Verification pipeline: ingest -> rules -> supplier requests -> reconcile -> rating -> rollup.

Nothing here approves or rejects a refund. The pipeline produces a rating (STRONG, WEAK, FAIL)
with reasons; the FTA officer decides.
"""
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, col, select

from app import rules
from app.assessment import assess, latest_results, signature
from app.db import audit
from app.models import (
    Application,
    ApplicationStatus,
    ConfirmationRequest,
    Document,
    ExtractedInvoice,
    Invoice,
    InvoiceDecision,
    InvoiceDecisionValue,
    InvoiceStatus,
    InvoiceType,
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
        # A base invoice uploaded earlier through the upload link may already match this one.
        inv.document_hash = _find_uploaded_document(session, inv)
        session.add(inv)
        session.flush()

        ext = _ext_dict(extraction_for(session, inv))
        apply_extraction(inv, ext)
        _save_results(session, inv.id, rules.check_invoice(session, inv, app, ext=ext))
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
    app = session.get(Application, inv.application_id)
    _save_results(session, inv.id, rules.check_supplier_response(inv, resp, app.claim_type))
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


# --- Original documents: extraction -> linking -> re-verification --------------------------

def extraction_for(session: Session, inv: Invoice) -> ExtractedInvoice | None:
    if not inv.document_hash:
        return None
    doc = session.exec(select(Document).where(Document.sha256 == inv.document_hash)).first()
    return doc and session.exec(select(ExtractedInvoice).where(ExtractedInvoice.document_id == doc.id)).first()


def _ext_dict(ext: ExtractedInvoice | None) -> dict | None:
    return ext.model_dump(include={"document_type", "fields"}) if ext else None


def request_for(session: Session, inv: Invoice) -> tuple[ConfirmationRequest | None, SupplierResponse | None]:
    req = session.exec(select(ConfirmationRequest).where(ConfirmationRequest.invoice_id == inv.id)).first()
    resp = req and session.exec(select(SupplierResponse).where(SupplierResponse.request_id == req.id)).first()
    return req, resp


def apply_extraction(inv: Invoice, ext: dict | None) -> None:
    """Fill Article 59 particulars Maskan did not capture, from fields the model read confidently.

    Never overwrites data Maskan sent: differences between the two are EX-01's job, not silent edits.
    """
    if not ext:
        return
    t = lambda name: rules.trusted(ext, name)  # noqa: E731
    for name in ("supplier_address", "recipient_name", "recipient_address", "description", "plot_no"):
        if not getattr(inv, name) and t(name):
            setattr(inv, name, str(t(name)))
    # Invoice type only from what is printed: "Simplified Tax Invoice" in the title. The model's own FULL/SIMPLIFIED
    # label is an inference, and TI-09 must never FAIL on a guess; without a title it checks the particulars instead.
    if inv.invoice_type is None and "simplified" in str(t("title") or "").lower():
        inv.invoice_type = InvoiceType.SIMPLIFIED
    if inv.supply_date is None and t("supply_date"):
        inv.supply_date = rules.to_date(t("supply_date"))
    if not inv.for_applicant_statement and t("for_applicant_statement") is True:
        inv.for_applicant_statement = True
    if not inv.line_items and isinstance(t("line_items"), list):
        inv.line_items = [{"description": str(li.get("description", "")), "quantity": rules.to_number(li.get("quantity", "")),
                           "unit_price": rules.to_number(li.get("unit_price", "")), "amount": rules.to_number(li.get("amount", ""))}
                          for li in t("line_items") if isinstance(li, dict) and li.get("description")]


def _matches(ext: dict, inv: Invoice) -> bool:
    """Auto-link only on a confidently read TRN and invoice number."""
    trn, no = rules.trusted(ext, "supplier_trn"), rules.trusted(ext, "invoice_no")
    return bool(trn and no and rules.same_ref(trn, inv.supplier_trn) and rules.same_ref(no, inv.invoice_no))


def _find_uploaded_document(session: Session, inv: Invoice) -> str | None:
    # ponytail: scans every extraction per ingested invoice; index extracted TRN + invoice no when volumes grow.
    for doc, ext in session.exec(select(Document, ExtractedInvoice).join(ExtractedInvoice)).all():
        if _matches(_ext_dict(ext), inv):
            return doc.sha256
    return None


def reverify(session: Session, inv: Invoice, actor: str = "extraction") -> None:
    """Re-run the invoice rules after its original document was read, then set status and rating
    exactly as ingest/reconcile would. Results are appended; the latest per rule counts."""
    app = session.get(Application, inv.application_id)
    if inv.officer_decision is not None or app.status in DECIDED:
        return  # decided cases are frozen
    ext = _ext_dict(extraction_for(session, inv))
    apply_extraction(inv, ext)
    _save_results(session, inv.id, rules.check_invoice(session, inv, app, ext=ext))
    req, resp = request_for(session, inv)
    inv.eligible_vat_amount = 0
    if resp is not None:  # same outcome as reconcile()
        inv.status = InvoiceStatus.DISPUTED if not resp.issued else InvoiceStatus.SUPPLIER_CONFIRMED
        assess(session, inv)
        if inv.status != InvoiceStatus.DISPUTED:
            if inv.rating == Rating.STRONG:
                inv.status = InvoiceStatus.VERIFIED
                inv.eligible_vat_amount = inv.vat_amount if inv.suggested_eligible_vat is None else inv.suggested_eligible_vat
            else:
                inv.status = InvoiceStatus.FLAGGED
    elif req is not None and req.status == RequestStatus.EXPIRED:
        inv.status = InvoiceStatus.NO_SUPPLIER_RESPONSE
        assess(session, inv)
    else:  # supplier step still open: same outcome as ingest()
        inv.status = InvoiceStatus.EXTRACTED
        assess(session, inv)
        if inv.rating == Rating.FAIL:
            inv.status = InvoiceStatus.FLAGGED
            if req is not None and req.status == RequestStatus.PENDING:
                req.status = RequestStatus.CANCELLED  # no point asking the supplier about a failed invoice
        else:
            inv.status = InvoiceStatus.AWAITING_SUPPLIER
            due = add_business_days(now(), SUPPLIER_SLA_BUSINESS_DAYS)
            if req is None:
                session.add(ConfirmationRequest(invoice_id=inv.id, supplier_trn=inv.supplier_trn, due_at=due))
            elif req.status == RequestStatus.CANCELLED:  # re-issued with a fresh time limit
                req.status, req.sent_at, req.due_at = RequestStatus.PENDING, now(), due
    audit(session, actor, "reverify", f"invoice:{inv.id}", status=inv.status, rating=inv.rating,
          document=inv.document_hash, ruleset=rules.RULESET_VERSION)
    rollup(session, app)


def link_document(session: Session, doc: Document, ext: ExtractedInvoice) -> list[Invoice]:
    """After extraction: attach the document to every open invoice it matches, then re-verify them."""
    d = _ext_dict(ext)
    linked = list(session.exec(select(Invoice).where(Invoice.document_hash == doc.sha256)).all())
    open_unlinked = select(Invoice).join(Application, Application.id == Invoice.application_id).where(
        col(Invoice.document_hash).is_(None), col(Application.status).not_in(DECIDED))
    candidates = session.exec(open_unlinked).all()
    for inv in candidates:
        if _matches(d, inv):
            inv.document_hash = doc.sha256
            linked.append(inv)
    no = rules.trusted(d, "invoice_no")
    if not linked and no and not rules.field(d, "supplier_trn")[0]:
        # No TRN printed (itself a TI-02/TI-03 finding): link on the invoice number only when exactly one open
        # invoice carries it, so the officer sees the document; EX-01 then reports the TRN as not read.
        same_no = [i for i in candidates if rules.same_ref(no, i.invoice_no)]
        if len(same_no) == 1:
            same_no[0].document_hash = doc.sha256
            linked.append(same_no[0])
    for inv in linked:
        reverify(session, inv)
    return linked


def ready_applications(session: Session, app_ids) -> list[int]:
    return [i for i in app_ids if (a := session.get(Application, i)) and a.status == ApplicationStatus.READY_FOR_DECISION]
