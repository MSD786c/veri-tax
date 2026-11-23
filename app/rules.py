"""Deterministic, versioned rule engine (README "Verification rules").

Implemented: TI-01..TI-09, NR-01..NR-06, CS-02..CS-04 and SC-01..SC-05.
TODO (needs FTA return data): NR-07, SC-06.
Each rule returns (rule_id, result, evidence); RULESET_VERSION is stored on every result.

Sources: VAT Executive Regulation Article 59 (tax invoice particulars) and Article 66
(new residences refund), and FTA VAT Guide VATGRH1, June 2026.
"""
import re
from datetime import date

from sqlmodel import Session, select

from app import eligibility
from app.models import (
    Application,
    ClaimType,
    ConsiderationStatus,
    Invoice,
    InvoiceType,
    RuleOutcome,
    Supplier,
    SupplierResponse,
    SupplierStatus,
)

RULESET_VERSION = "2026.11-1"
ROUNDING_TOLERANCE = 0.05  # AED
VAT_RATE = 0.05
TRN_LENGTH = 15
TRN_RE = re.compile(r"^100\d{12}$")  # UAE TRNs are 15 digits starting with 100
PERIOD_RE = re.compile(r"^(\d{4}-Q[1-4]|[A-Z][a-z]{2}-\d{4})$")  # 2026-Q2 or Apr-2026
TAX_INVOICE_TITLES = {"tax invoice", "فاتورة ضريبية"}
MAX_PLAUSIBLE_INVOICE_AED = 20_000_000  # CS-03: above this a single villa invoice needs a person

Check = tuple[str, RuleOutcome, dict]
P, F, U, NA = RuleOutcome.PASS, RuleOutcome.FAIL, RuleOutcome.UNCERTAIN, RuleOutcome.NOT_APPLICABLE

# Article 59(2): the five particulars of a simplified tax invoice.
SIMPLIFIED_PARTICULARS = ("words_tax_invoice", "supplier_name_address_trn", "date_of_issue", "description",
                          "total_and_tax_amount")
# Article 59(1): the particulars of a full tax invoice that can be checked from extracted data.
# Discount, exchange rate and the reverse-charge statement apply only in some cases and are not checked here.
FULL_PARTICULARS = (*SIMPLIFIED_PARTICULARS, "recipient_name_address", "invoice_number",
                    "line_unit_price_and_quantity", "tax_rate_and_amount_per_line", "gross_amount_aed")


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9؀-ۿ]+", " ", name.lower()).strip()


def particulars_present(inv: Invoice, supplier: Supplier | None) -> dict[str, bool]:
    """Which Article 59 particulars the extracted invoice data actually carries."""
    lines = inv.line_items or []
    priced = bool(lines) and all(li.get("unit_price") is not None and li.get("quantity") is not None for li in lines)
    return {
        "words_tax_invoice": inv.title.strip().lower() in TAX_INVOICE_TITLES,
        "supplier_name_address_trn": bool(supplier and supplier.legal_name and inv.supplier_address and inv.supplier_trn),
        "date_of_issue": inv.invoice_date is not None,
        "description": len(inv.description.strip()) >= 3,
        "total_and_tax_amount": inv.total > 0 and inv.vat_amount >= 0,
        "recipient_name_address": bool(inv.recipient_name and inv.recipient_address),
        "invoice_number": bool(inv.invoice_no.strip()),
        "line_unit_price_and_quantity": priced,
        "tax_rate_and_amount_per_line": priced,
        "gross_amount_aed": inv.total > 0 and inv.currency == "AED",
    }


def _invoice_type_check(inv: Invoice, supplier: Supplier | None) -> Check:
    """TI-09. The scheme accepts full tax invoices only (VATGRH1 section 5.1)."""
    present = particulars_present(inv, supplier)
    missing_full = [k for k in FULL_PARTICULARS if not present[k]]
    missing_simple = [k for k in SIMPLIFIED_PARTICULARS if not present[k]]
    evidence = {
        "declared_type": inv.invoice_type,
        "full_particulars_present": f"{len(FULL_PARTICULARS) - len(missing_full)} of {len(FULL_PARTICULARS)}",
        "missing_for_full": missing_full,
    }
    if inv.invoice_type == InvoiceType.SIMPLIFIED:
        evidence["simplified_particulars_present"] = (
            f"{len(SIMPLIFIED_PARTICULARS) - len(missing_simple)} of {len(SIMPLIFIED_PARTICULARS)}")
        evidence["reason"] = "Simplified tax invoices are not accepted for this refund (VATGRH1 section 5.1)"
        return ("TI-09", F, evidence)
    if not missing_full:
        return ("TI-09", P, evidence)
    evidence["reason"] = "Full tax invoice particulars not all captured; cannot confirm it is a full tax invoice"
    return ("TI-09", U, evidence)


def _trn_check(inv: Invoice, supplier: Supplier | None) -> Check:
    """TI-03. Format first, then the FTA registry: active on the invoice date."""
    evidence: dict = {"trn": inv.supplier_trn, "length": len(inv.supplier_trn), "required_length": TRN_LENGTH}
    if not TRN_RE.match(inv.supplier_trn):
        return ("TI-03", F, {**evidence, "reason": "TRN must be 15 digits starting with 100"})
    if not supplier or not supplier.registry_verified:
        return ("TI-03", U, {**evidence, "reason": "TRN not found in the FTA registry data available"})
    evidence["registry_status"] = supplier.status
    if supplier.registered_from and inv.invoice_date < supplier.registered_from:
        return ("TI-03", F, {**evidence, "reason": f"Supplier registered from {supplier.registered_from}, after the invoice date"})
    if supplier.status == SupplierStatus.DEREGISTERED and (
            supplier.deregistered_on is None or inv.invoice_date >= supplier.deregistered_on):
        return ("TI-03", F, {**evidence, "reason": f"Supplier deregistered on {supplier.deregistered_on}"})
    return ("TI-03", P, evidence)


def _recipient_checks(inv: Invoice, app: Application) -> list[Check]:
    """TI-08 and NR-06. Invoice must be in the applicant's name, or meet the third-party conditions."""
    if inv.invoice_type == InvoiceType.SIMPLIFIED:
        return [("TI-08", NA, {"reason": "Simplified tax invoices carry no recipient; see TI-09"}), ("NR-06", NA, {})]
    if not inv.recipient_name:
        return [("TI-08", U, {"reason": "Recipient name not captured"}), ("NR-06", NA, {})]
    if _norm(inv.recipient_name) == _norm(app.applicant_name):
        return [("TI-08", P, {"recipient": inv.recipient_name}), ("NR-06", NA, {})]
    evidence = {"recipient": inv.recipient_name, "applicant": app.applicant_name,
                "for_applicant_statement": inv.for_applicant_statement, "plot_on_invoice": inv.plot_no}
    if not (inv.for_applicant_statement and inv.plot_no):
        return [("TI-08", F, {**evidence, "reason": "Issued to another party without the statement that it is for "
                                                   "the applicant's use and the plot number (VATGRH1 section 5.1)"}),
                ("NR-06", NA, {})]
    nr06 = P if inv.intermediary_no_recovery_confirmed else F
    return [("TI-08", P, evidence), ("NR-06", nr06, {"no_recovery_confirmed": inv.intermediary_no_recovery_confirmed})]


def find_duplicates(session: Session, inv: Invoice) -> list[Invoice]:
    """Same supplier TRN and invoice number claimed in a different application."""
    return list(session.exec(
        select(Invoice).where(
            Invoice.supplier_trn == inv.supplier_trn,
            Invoice.invoice_no == inv.invoice_no,
            Invoice.application_id != inv.application_id,
        )
    ).all())


def check_invoice(session: Session, inv: Invoice, app: Application, today: date | None = None) -> list[Check]:
    today = today or date.today()
    supplier = session.get(Supplier, inv.supplier_trn)
    out: list[Check] = []

    # --- A. Tax invoice validity (Article 59) ---------------------------------------------
    out.append(("TI-01", P if inv.title.strip().lower() in TAX_INVOICE_TITLES else F, {"title": inv.title}))
    if not (supplier and supplier.legal_name and inv.supplier_trn):
        out.append(("TI-02", F, {"reason": "Supplier name or TRN missing"}))
    elif not inv.supplier_address:
        out.append(("TI-02", U, {"reason": "Supplier address not captured"}))
    else:
        out.append(("TI-02", P, {"supplier": supplier.legal_name}))
    out.append(_trn_check(inv, supplier))
    out.append(("TI-04", P if inv.invoice_no.strip() and inv.invoice_date <= today else F,
                {"invoice_no": inv.invoice_no, "invoice_date": str(inv.invoice_date)}))
    out.append(("TI-05", P if len(inv.description.strip()) >= 3 else F, {"description": inv.description}))
    out.append(("TI-06", P if inv.currency == "AED" else F, {"currency": inv.currency}))

    expected_vat = round(inv.taxable_amount * VAT_RATE, 2)
    arith_ok = (
        abs(expected_vat - inv.vat_amount) <= ROUNDING_TOLERANCE
        and abs(inv.taxable_amount + inv.vat_amount - inv.total) <= ROUNDING_TOLERANCE
    )
    out.append(("TI-07", P if arith_ok else F, {"expected_vat": expected_vat, "vat": inv.vat_amount, "total": inv.total}))
    out.extend(_recipient_checks(inv, app))
    out.append(_invoice_type_check(inv, supplier))

    # --- B. Refund eligibility (Article 66, VATGRH1) --------------------------------------
    if not inv.plot_no:
        out.append(("NR-01", U, {"reason": "no plot number on invoice"}))
    else:
        out.append(("NR-01", P if inv.plot_no == app.plot_no else F, {"invoice_plot": inv.plot_no, "application_plot": app.plot_no}))

    elig = eligibility.classify_invoice(inv.description, inv.line_items or [], inv.taxable_amount,
                                        inv.invoice_date, app.completion_date)
    inv.suggested_eligible_vat = (
        round(elig.eligible_taxable * VAT_RATE, 2) if elig.eligible_taxable is not None else None)
    nr02 = {eligibility.Verdict.ELIGIBLE: P, eligibility.Verdict.NOT_ELIGIBLE: F, eligibility.Verdict.REVIEW: U}[elig.verdict]
    out.append(("NR-02", nr02, elig.evidence()))

    if app.permit_date and inv.invoice_date < app.permit_date:
        out.append(("NR-03", U, {"reason": "Invoice dated before the building permit", "permit_date": str(app.permit_date)}))
    elif inv.invoice_date > app.completion_date and app.claim_type != ClaimType.RETENTION:
        out.append(("NR-03", U, {"reason": "Invoice dated after completion and this is not a retention claim",
                                 "completion_date": str(app.completion_date)}))
    else:
        out.append(("NR-03", P, {"invoice_date": str(inv.invoice_date)}))

    days = (today - app.completion_date).days
    out.append(("NR-04", P if days <= 365 else F, {"days_since_completion": days}))

    dups = find_duplicates(session, inv)
    out.append(("NR-05", F if dups else P, {"also_claimed_in_applications": sorted({d.application_id for d in dups})}))

    # --- Common-sense checks on the values ------------------------------------------------
    if app.contract_value and inv.total > app.contract_value:
        out.append(("CS-02", U, {"reason": "Single invoice is larger than the whole construction contract",
                                 "invoice_total": inv.total, "contract_value": app.contract_value}))
    else:
        out.append(("CS-02", P if app.contract_value else NA, {}))
    out.append(("CS-03", U if inv.total <= 0 or inv.total > MAX_PLAUSIBLE_INVOICE_AED else P, {"total": inv.total}))

    twin = session.exec(
        select(Invoice).where(
            Invoice.application_id == inv.application_id,
            Invoice.supplier_trn == inv.supplier_trn,
            Invoice.invoice_date == inv.invoice_date,
            Invoice.total == inv.total,
            Invoice.invoice_no != inv.invoice_no,
        )
    ).first()
    out.append(("CS-04", U if twin else P, {"same_supplier_date_amount_as": twin.invoice_no if twin else None}))
    return out


def check_supplier_response(inv: Invoice, resp: SupplierResponse) -> list[Check]:
    out: list[Check] = [("SC-01", P if resp.issued else F, {"issued": resp.issued})]
    if not resp.issued:
        return out
    out.append(("SC-02", P if resp.particulars_confirmed and not resp.corrections else F, {"corrections": resp.corrections}))

    if resp.consideration_status == ConsiderationStatus.RECEIVED:
        out.append(("SC-03", P, {"status": resp.consideration_status, "received_date": str(resp.received_date)}))
    elif resp.consideration_status == ConsiderationStatus.PARTIAL_OR_RETENTION:
        ok = resp.retention_amount is not None and resp.retention_release_date is not None
        out.append(("SC-03", P if ok else U, {"retention_amount": resp.retention_amount}))
    else:
        out.append(("SC-03", F, {"reason": "consideration status missing"}))

    period = resp.vat_return_period or ""
    out.append(("SC-04", P if PERIOD_RE.match(period) else F, {"vat_return_period": period}))
    out.append(("SC-05", _period_consistent(period, inv.invoice_date), {"period": period, "invoice_date": str(inv.invoice_date)}))
    return out


def _period_consistent(period: str, invoice_date: date) -> RuleOutcome:
    """Declared period must not end before the invoice date. ponytail: ignores payment-date rules."""
    m = re.match(r"^(\d{4})-Q([1-4])$", period)
    if m:
        year, q = int(m[1]), int(m[2])
        return P if (year, q) >= (invoice_date.year, (invoice_date.month - 1) // 3 + 1) else F
    m = re.match(r"^([A-Z][a-z]{2})-(\d{4})$", period)
    if m:
        months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        if m[1] not in months:
            return F
        return P if (int(m[2]), months.index(m[1]) + 1) >= (invoice_date.year, invoice_date.month) else F
    return U
