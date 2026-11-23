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
