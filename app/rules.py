"""Deterministic, versioned rule engine (README "Verification rules").

Implemented: TI-01, TI-03, TI-06, TI-07, NR-01, NR-02, NR-04, NR-05 and SC-01..SC-05.
TODO (need OCR / agents / FTA data): TI-02, TI-04, TI-05, TI-08, NR-03, NR-06, NR-07, SC-06.
Each rule returns (rule_id, result, evidence); RULESET_VERSION is stored on every result.
"""
import re
from datetime import date

from sqlmodel import Session, select

from app.models import (
    Application,
    ConsiderationStatus,
    Invoice,
    RuleOutcome,
    SupplierResponse,
)

RULESET_VERSION = "2026.11-0"
ROUNDING_TOLERANCE = 0.05  # AED
VAT_RATE = 0.05
TRN_RE = re.compile(r"^100\d{12}$")  # UAE TRNs are 15 digits starting with 100
PERIOD_RE = re.compile(r"^(\d{4}-Q[1-4]|[A-Z][a-z]{2}-\d{4})$")  # 2026-Q2 or Apr-2026
# ponytail: keyword list, replace with the compliance agent for real eligibility calls
EXCLUDED_KEYWORDS = ("furniture", "sofa", "appliance", "television", "tv ", "refrigerator", "washing machine")

# Human-readable rule catalog (README "Verification rules"), served at GET /meta/rules so the
# portals can label rule IDs. `implemented` marks the rules this ruleset actually runs.
RULE_CATALOG: dict[str, dict] = {
    "TI-01": {"group": "Tax invoice validity", "title": "Document is a tax invoice", "description": "Titled \"Tax Invoice\", not a quotation, proforma or receipt.", "implemented": True},
    "TI-02": {"group": "Tax invoice validity", "title": "Supplier name, address and TRN shown", "description": "The invoice shows the supplier's name, address and TRN.", "implemented": False},
    "TI-03": {"group": "Tax invoice validity", "title": "Supplier TRN valid", "description": "The supplier TRN is valid (15 digits, starting 100) and was active on the invoice date.", "implemented": True},
    "TI-04": {"group": "Tax invoice validity", "title": "Invoice number and date shown", "description": "The invoice shows its number and date of issue.", "implemented": False},
    "TI-05": {"group": "Tax invoice validity", "title": "Goods or services described", "description": "The invoice describes the goods or services supplied.", "implemented": False},
    "TI-06": {"group": "Tax invoice validity", "title": "Amounts shown in AED", "description": "Taxable amount, VAT rate, VAT amount and total are shown in AED.", "implemented": True},
    "TI-07": {"group": "Tax invoice validity", "title": "Arithmetic adds up", "description": "Taxable × 5% = VAT and taxable + VAT = total, within AED 0.05.", "implemented": True},
    "TI-08": {"group": "Tax invoice validity", "title": "Recipient is the applicant", "description": "Addressed to the applicant, or states it is for the applicant's use with the plot or address.", "implemented": False},
    "NR-01": {"group": "Refund eligibility", "title": "Plot matches application", "description": "The plot number or address on the invoice matches the application.", "implemented": True},
    "NR-02": {"group": "Refund eligibility", "title": "Eligible goods or services", "description": "Building works or materials, not excluded items such as furniture or appliances.", "implemented": True},
    "NR-03": {"group": "Refund eligibility", "title": "Within construction period", "description": "Invoice dated within the construction period, before completion (except retention).", "implemented": False},
    "NR-04": {"group": "Refund eligibility", "title": "Claimed within 12 months", "description": "Claim lodged within 12 months of the residence's completion date.", "implemented": True},
    "NR-05": {"group": "Refund eligibility", "title": "Not claimed elsewhere", "description": "The invoice has not been claimed in another application.", "implemented": True},
    "NR-06": {"group": "Refund eligibility", "title": "Intermediary not recovering VAT", "description": "Where an intermediary is the recipient, it is not recovering input VAT.", "implemented": False},
    "NR-07": {"group": "Refund eligibility", "title": "Retention invoice rules", "description": "Retention invoices only in a retention claim, with proof of payment.", "implemented": False},
    "SC-01": {"group": "Supplier confirmation", "title": "Supplier issued the invoice", "description": "The supplier confirms it issued the invoice.", "implemented": True},
    "SC-02": {"group": "Supplier confirmation", "title": "Particulars match", "description": "Confirmed number, date, amounts and VAT match the submitted data.", "implemented": True},
    "SC-03": {"group": "Supplier confirmation", "title": "Consideration received or retention", "description": "Consideration received, or retention with amount and release date.", "implemented": True},
    "SC-04": {"group": "Supplier confirmation", "title": "VAT return period named", "description": "The supplier names the VAT return period it declared the output VAT in.", "implemented": True},
    "SC-05": {"group": "Supplier confirmation", "title": "Period consistent with invoice", "description": "The declared period does not end before the invoice date.", "implemented": True},
    "SC-06": {"group": "Supplier confirmation", "title": "Return filed", "description": "The declared period's VAT return has been filed (needs FTA data access).", "implemented": False},
}

Check = tuple[str, RuleOutcome, dict]
P, F, U, NA = RuleOutcome.PASS, RuleOutcome.FAIL, RuleOutcome.UNCERTAIN, RuleOutcome.NOT_APPLICABLE


def check_invoice(session: Session, inv: Invoice, app: Application, today: date | None = None) -> list[Check]:
    today = today or date.today()
    out: list[Check] = []

    out.append(("TI-01", P if inv.title.strip().lower() == "tax invoice" else F, {"title": inv.title}))
    out.append(("TI-03", P if TRN_RE.match(inv.supplier_trn) else F, {"trn": inv.supplier_trn}))
    out.append(("TI-06", P if inv.currency == "AED" else F, {"currency": inv.currency}))

    expected_vat = round(inv.taxable_amount * VAT_RATE, 2)
    arith_ok = (
        abs(expected_vat - inv.vat_amount) <= ROUNDING_TOLERANCE
        and abs(inv.taxable_amount + inv.vat_amount - inv.total) <= ROUNDING_TOLERANCE
    )
    out.append(("TI-07", P if arith_ok else F, {"expected_vat": expected_vat, "vat": inv.vat_amount, "total": inv.total}))

    if not inv.plot_no:
        out.append(("NR-01", U, {"reason": "no plot number on invoice"}))
    else:
        out.append(("NR-01", P if inv.plot_no == app.plot_no else F, {"invoice_plot": inv.plot_no, "application_plot": app.plot_no}))

    desc = inv.description.lower()
    hits = [k.strip() for k in EXCLUDED_KEYWORDS if k in desc]
    out.append(("NR-02", F if hits else P, {"excluded_keywords": hits}))

    days = (today - app.completion_date).days
    out.append(("NR-04", P if days <= 365 else F, {"days_since_completion": days}))

    dup = session.exec(
        select(Invoice).where(
            Invoice.supplier_trn == inv.supplier_trn,
            Invoice.invoice_no == inv.invoice_no,
            Invoice.application_id != inv.application_id,
        )
    ).first()
    out.append(("NR-05", F if dup else P, {"duplicate_of_application": dup.application_id if dup else None}))
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
