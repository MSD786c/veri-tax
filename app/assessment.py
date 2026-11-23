"""Turns rule results into the agent's recommendation on one invoice: STRONG, WEAK or FAIL.

The rating is a recommendation with reasons. It never approves or rejects a refund;
only an FTA officer does (see app/api/fta.py).

    STRONG  every check passed and the supplier confirmed the invoice
    WEAK    something needs a person: an unclear item, a supplier correction, no supplier
            response, an invoice also claimed elsewhere, or a supplier on the watch list
    FAIL    a hard rule failed or the supplier says it did not issue the invoice
"""
from sqlmodel import Session, col, select

from app.models import (
    ConfirmationRequest,
    Invoice,
    InvoiceDecision,
    InvoiceStatus,
    Rating,
    RuleOutcome,
    RuleResult,
    Supplier,
    SupplierResponse,
    TrustTier,
)

# A FAIL on these rules is a mismatch to resolve, not proof the claim is invalid.
SOFT_RULES = {"SC-02", "SC-03", "SC-04", "SC-05"}
TRUSTED_MIN_CONFIRMED = 3
PRECEDENT_MIN = 2

# rule_id -> (reason shown to the officer, what the applicant can do about it or None).
# Applicant text never reveals what a supplier declared about its own tax affairs.
TEXT: dict[str, tuple[str, str | None]] = {
    "TI-01": ("Document is not titled as a tax invoice",
              "Ask the supplier for a tax invoice. Quotations, proformas and receipts are not accepted."),
    "TI-02": ("Supplier name, address or TRN is missing", "Ask the supplier to reissue the invoice with its full name, address and TRN."),
    "TI-03": ("Supplier TRN is invalid, not found or not active on the invoice date",
              "Check the supplier's TRN with them. It must be 15 digits and registered on the invoice date."),
    "TI-04": ("Invoice number or date is missing or invalid", "Ask the supplier to reissue the invoice with its number and date of issue."),
    "TI-05": ("No description of the goods or services", "Ask the supplier to describe the goods or services on the invoice."),
    "TI-06": ("Amounts are not in AED", "Ask the supplier to show the amounts and the VAT in AED."),
    "TI-07": ("VAT arithmetic does not add up", "Ask the supplier to correct the VAT amount and total and reissue the invoice."),
    "TI-08": ("Invoice is not in the applicant's name and lacks the third-party conditions",
              "Ask for the invoice in your name, or one stating it is for your use with your plot number."),
    "TI-09": ("Not a full tax invoice", "Ask the supplier for a full tax invoice. Simplified tax invoices are not accepted for this refund."),
    "NR-01": ("Plot number is missing or does not match the application", "Ask the supplier to show your plot number on the invoice."),
    "NR-02": ("Items are not eligible, or eligibility is unclear",
              "Remove items that are not part of the building, such as furniture and appliances, or describe the building work more exactly."),
    "NR-03": ("Invoice date is outside the construction period", "Provide evidence that this work was part of building the residence."),
    "NR-04": ("Claim is later than 12 months after completion", "If you could not apply in time, send evidence of the reason, such as illness, military service or a legal dispute."),
    "NR-05": ("Same invoice is claimed in another application", "Contact the FTA: this invoice also appears in another refund claim."),
    "NR-06": ("Intermediary has not confirmed it is not recovering the VAT",
              "Ask the contractor or agent named on the invoice to confirm in writing that it is not recovering this VAT."),
    "CS-02": ("Single invoice is larger than the construction contract", "Send the construction contract and any variation orders."),
    "CS-03": ("Invoice amount is not plausible", "Check the invoice amount with the supplier."),
    "CS-04": ("Another invoice from the same supplier has the same date and amount", "Confirm that these are two separate supplies, not one invoice entered twice."),
    "EX-01": ("Submitted invoice data differs from the original document, or the document could not be read",
              "Upload a clear copy of the original tax invoice; the details entered must match it."),
    "SC-01": ("Supplier says it did not issue this invoice", "Contact the supplier: it has not confirmed this invoice."),
    "SC-02": ("Supplier reported different particulars from the invoice submitted", "Ask the supplier for the correct invoice and upload it again."),
    "SC-03": ("Supplier has not confirmed that payment was received", None),
    "SC-04": ("Supplier did not name a valid VAT return period", None),
    "SC-05": ("VAT return period the supplier declared is earlier than the invoice date", None),
}
SUPPLIER_STEP_NOTE = "Further verification with the supplier is needed. No action is required from you yet."
NO_RESPONSE_REASON = "Supplier did not respond within the time limit"
NO_RESPONSE_FIX = "Ask your supplier to confirm this invoice in the EmaraTax supplier portal."


def _detail(res: RuleResult) -> str:
    """The specific finding behind a rule result, for the officer."""
    ev = res.evidence or {}
    if res.rule_id == "NR-02":
        unclear = [f"{ln['text']}: {ln['reason']}" for ln in ev.get("lines", []) if ln.get("verdict") != "ELIGIBLE"]
        return "; ".join(unclear[:3])
    return str(ev.get("reason", ""))


def latest_results(session: Session, invoice_id: int) -> dict[str, RuleResult]:
    """Most recent result per rule (rules re-run when a duplicate or a supplier response arrives)."""
    rows = session.exec(select(RuleResult).where(RuleResult.invoice_id == invoice_id).order_by(RuleResult.id)).all()
    return {r.rule_id: r for r in rows}


def trust_tier(session: Session, trn: str, exclude_invoice_id: int | None = None) -> dict:
    """Supplier trust lane, from the supplier's own history in this system.

    A dispute ("we did not issue this") does not count against the supplier: it points at the
    invoice the applicant submitted, not at the supplier's conduct.
    """
    invs = [i for i in session.exec(select(Invoice).where(Invoice.supplier_trn == trn)).all() if i.id != exclude_invoice_id]
    reqs = session.exec(select(ConfirmationRequest).where(ConfirmationRequest.supplier_trn == trn)).all()
    req_ids = [r.id for r in reqs if r.invoice_id != exclude_invoice_id]
    responses = session.exec(select(SupplierResponse).where(col(SupplierResponse.request_id).in_(req_ids))).all() if req_ids else []
    confirmed = sum(i.status == InvoiceStatus.VERIFIED for i in invs)
    disputed = sum(i.status == InvoiceStatus.DISPUTED for i in invs)
    silent = sum(i.status == InvoiceStatus.NO_SUPPLIER_RESPONSE for i in invs)
    corrected = sum(bool(r.corrections) for r in responses)
    supplier = session.get(Supplier, trn)
    if corrected >= 2 or silent >= 2 or (supplier and supplier.risk_flag):
        tier = TrustTier.WATCH
    elif confirmed >= TRUSTED_MIN_CONFIRMED:
        tier = TrustTier.TRUSTED
    else:
        tier = TrustTier.STANDARD
    return {"tier": tier, "confirmed": confirmed, "disputed": disputed, "corrected": corrected, "no_response": silent}


def signature(results: dict[str, RuleResult]) -> str:
    return "|".join(sorted(r for r, res in results.items() if res.result in (RuleOutcome.FAIL, RuleOutcome.UNCERTAIN)))


def precedents(session: Session, inv: Invoice, sig: str | None = None) -> list[InvoiceDecision]:
    """Earlier officer decisions on other invoices with the same findings."""
    sig = signature(latest_results(session, inv.id)) if sig is None else sig
    if not sig:
        return []
    return list(session.exec(
        select(InvoiceDecision)
        .where(InvoiceDecision.signature == sig, InvoiceDecision.invoice_id != inv.id)
        .order_by(col(InvoiceDecision.decided_at).desc())
    ).all())[:5]


def assess(session: Session, inv: Invoice) -> Invoice:
    """Set rating, reasons and fix guidance on the invoice from its current evidence."""
    session.flush()
    results = latest_results(session, inv.id)
    hard = [r for r, res in results.items() if res.result == RuleOutcome.FAIL and r not in SOFT_RULES]
    soft = [r for r, res in results.items()
            if res.result == RuleOutcome.UNCERTAIN or (res.result == RuleOutcome.FAIL and r in SOFT_RULES)]

    reasons = []
    for r in sorted(hard + soft):
        detail = _detail(results[r])
        reasons.append(f"{r}: {TEXT.get(r, (r, None))[0]}" + (f" ({detail})" if detail else ""))
    fixes = [TEXT[r][1] for r in sorted(hard + soft) if r in TEXT and TEXT[r][1]]
    if any(r in SOFT_RULES and not TEXT[r][1] for r in soft):
        fixes.append(SUPPLIER_STEP_NOTE)

    if inv.status == InvoiceStatus.NO_SUPPLIER_RESPONSE:
        reasons.append(NO_RESPONSE_REASON)
        fixes.append(NO_RESPONSE_FIX)

    trust = trust_tier(session, inv.supplier_trn, exclude_invoice_id=inv.id)
    if trust["tier"] == TrustTier.WATCH:
        reasons.append("Supplier is on the watch list (repeated corrections or missed responses, or flagged by an officer)")
    elif trust["tier"] == TrustTier.TRUSTED:
        reasons.append(f"Trusted supplier lane: {trust['confirmed']} earlier invoices confirmed and verified")

    supplier_step_open = inv.status in (InvoiceStatus.AWAITING_SUPPLIER, InvoiceStatus.NEEDS_SUPPLIER,
                                        InvoiceStatus.EXTRACTED, InvoiceStatus.INGESTED)
    if hard:
        inv.rating = Rating.FAIL
    elif supplier_step_open:
        inv.rating = None  # no recommendation until the supplier confirms or the time limit passes
    elif soft or inv.status == InvoiceStatus.NO_SUPPLIER_RESPONSE or trust["tier"] == TrustTier.WATCH:
        inv.rating = Rating.WEAK
    else:
        inv.rating = Rating.STRONG

    past = precedents(session, inv, signature(results))
    if len(past) >= PRECEDENT_MIN and len({p.decision for p in past}) == 1:
        reasons.append(f"Precedent: officers {past[0].decision.value.lower()} {len(past)} earlier invoices with the same findings")

    if inv.rating == Rating.STRONG and not reasons:
        reasons = ["All checks passed and the supplier confirmed the invoice"]
    inv.rating_reasons = reasons
    inv.fix_guidance = list(dict.fromkeys(fixes))
    return inv
