"""Expense eligibility for the New Residences Refund Scheme (rule NR-02).

Source: FTA VAT Guide VATGRH1, June 2026 — section 3.4.2 and Appendix 1, including the
items FTA Decision No. 5 of 2026 added with effect from 1 January 2026.

This is a deterministic catalogue. It returns ELIGIBLE or NOT_ELIGIBLE only when the guide is
clear, and REVIEW whenever the text is mixed, ambiguous or not recognised, so a person decides.
`app/agent.py` is the hook for a reasoning agent to give a second opinion on REVIEW cases.
"""
import re
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum

DECISION_5_EFFECTIVE = date(2026, 1, 1)
APPX = "VATGRH1 Appendix 1"
APPX_2026 = "VATGRH1 Appendix 1 (FTA Decision No. 5 of 2026, effective 1 Jan 2026)"


class Verdict(StrEnum):
    ELIGIBLE = "ELIGIBLE"
    NOT_ELIGIBLE = "NOT_ELIGIBLE"
    REVIEW = "REVIEW"


@dataclass(frozen=True)
class Entry:
    item: str
    verdict: Verdict
    patterns: tuple[str, ...]
    citation: str = APPX
    since_2026: bool = False
    # Guide section 3.2: not refundable if the work started after the residence was completed.
    post_completion_risk: bool = False
    # Generic service words ("installation", "labour") never rescue an item that is not eligible.
    generic: bool = False


def _e(item: str, *patterns: str) -> Entry:
    return Entry(item, Verdict.ELIGIBLE, patterns)


def _n(item: str, *patterns: str) -> Entry:
    return Entry(item, Verdict.NOT_ELIGIBLE, patterns)


def _new(item: str, *patterns: str, post_completion_risk: bool = False) -> Entry:
    return Entry(item, Verdict.ELIGIBLE, patterns, APPX_2026, True, post_completion_risk)


def _r(item: str, citation: str, *patterns: str) -> Entry:
    return Entry(item, Verdict.REVIEW, patterns, citation)


CATALOGUE: tuple[Entry, ...] = (
    # --- Ambiguous in the guide itself: always a human call -------------------------------
    _r("CCTV (listed as not eligible, but a fixed, integrated security system is eligible from 2026)",
       "VATGRH1 Appendix 1 and section 3.4.2", r"cctv", r"surveillance camera", r"security camera"),
    _r("Intelligent lighting (listed as not eligible, but light fittings and integrated smart systems are eligible)",
       "VATGRH1 Appendix 1", r"intelligent light", r"smart light"),
    _r("Carpet (loose carpets are not eligible, fixed flooring is)", APPX, r"carpet"),
    # --- Not eligible ---------------------------------------------------------------------
    _n("Furniture not affixed to the building", r"furniture", r"sofa", r"\bchairs?\b", r"\btables?\b", r"\bbeds?\b",
       r"wardrobe", r"curtain", r"mattress"),
    _n("Electrical and gas appliances", r"appliance", r"\bovens?\b", r"cooker", r"fridge", r"refrigerator", r"freezer",
       r"dishwasher", r"microwave", r"washing machine", r"\bdryers?\b", r"coffee machine"),
    _n("Audio and TV equipment", r"\btvs?\b", r"television", r"speaker", r"audio", r"satellite", r"freeview",
       r"remote control", r"telephone"),
    _n("Children's play equipment", r"play equipment", r"playground", r"trampoline"),
    _n("Garden furniture, ornaments and sheds", r"garden furniture", r"ornament", r"\bsheds?\b"),
    # --- Eligible from 1 January 2026 (FTA Decision No. 5 of 2026) -------------------------
    _new("Swimming pools, fountains and decorative water features", r"swimming pool", r"\bpools?\b", r"fountain",
         r"water feature"),
    _new("Gym or play room", r"\bgym", r"play ?room"),
    _new("Garage and carports attached to the residence", r"garage", r"car ?port", post_completion_risk=True),
    _new("Doors, including electronic or smart doors and gates", r"smart door", r"electronic door", r"\bgates?\b"),
    _new("Landscaped agricultural areas within the plot", r"landscap", r"\btrees?\b", r"irrigation",
         post_completion_risk=True),
    _new("Fixed and integrated smart and security systems", r"security system", r"smart home", r"smart system",
         r"access control", r"home automation", post_completion_risk=True),
    _new("Reconstruction works, including demolition and rebuilding", r"demolition", r"reconstruction", r"rebuild"),
    _new("Dedicated extension for a security guard's, driver's or domestic maid's room", r"guard'?s? room",
         r"driver'?s? room", r"maid'?s? room"),
    # --- Eligible -------------------------------------------------------------------------
    _e("Building materials that make up the structure", r"brick", r"block ?work", r"cement", r"concrete", r"steel",
       r"rebar", r"reinforcement", r"\btiles?\b", r"tiling", r"timber", r"aggregate", r"gypsum", r"marble",
       r"roof", r"waterproof", r"insulation", r"foundation", r"excavation", r"structure", r"screed"),
    _e("Built-in kitchen, sinks, work surfaces and fitted cupboards", r"built[- ]in kitchen", r"fitted kitchen",
       r"kitchen cabinet", r"kitchen sink", r"work ?surface", r"worktop", r"fitted cupboard"),
    _e("Burglar alarms", r"burglar alarm"),
    _e("Central air conditioning and split units", r"air[- ]condition", r"split unit", r"\ba/?c\b", r"hvac", r"duct"),
    _e("Decorating materials that become part of the structure", r"paint", r"plaster", r"render"),
    _e("Dust extractors and filters", r"dust extractor"),
    _e("Fencing permanently erected around the boundary", r"fenc", r"boundary wall", r"compound wall"),
    _e("Fire alarms and smoke detectors", r"fire alarm", r"smoke detector", r"fire fighting"),
    _e("Flooring (excluding loose carpets)", r"flooring", r"parquet"),
    _e("Guttering", r"gutter"),
    _e("Lifts and hoists", r"\blifts?\b", r"elevator", r"hoist"),
    _e("Light fittings", r"light fitting", r"lighting", r"\blights?\b"),
    _e("Plumbing materials incorporated into the residence", r"plumbing", r"\bpipes?\b", r"piping", r"drainage",
       r"water heater", r"water tank"),
    _e("Power points", r"power point", r"socket", r"switchgear", r"distribution board", r"\bdb\b"),
    _e("Sanitary units", r"sanitary", r"\bwc\b", r"toilet", r"wash ?basin"),
    _e("Shower units", r"shower"),
    _e("Solar panels", r"solar"),
    _e("Window frames, awnings and glazing", r"window", r"glazing", r"awning", r"alumini?um"),
    _e("Doors", r"\bdoors?\b"),
    _e("Wiring embedded in the structure", r"wiring", r"electrical", r"cabl"),
    Entry("Services of builders", Verdict.ELIGIBLE,
          (r"construction", r"contracting", r"builder", r"labou?r", r"civil work", r"mep\b", r"installation",
           r"masonry", r"supply"), generic=True),
    Entry("Services of architects, engineers and supervision", Verdict.ELIGIBLE,
          (r"architect", r"engineer", r"consultan", r"supervis", r"design fee"), generic=True),
)


@dataclass
class Classification:
    text: str
    verdict: Verdict
    reason: str
    matches: list[dict] = field(default_factory=list)


def classify(text: str, invoice_date: date | None = None, completion_date: date | None = None) -> Classification:
    """Classify one description. Never guesses: anything unclear comes back as REVIEW."""
    lowered = text.lower()
    hits = [e for e in CATALOGUE if any(re.search(p, lowered) for p in e.patterns)]
    matches = [{"item": e.item, "verdict": e.verdict, "citation": e.citation} for e in hits]
    if not hits:
        return Classification(text, Verdict.REVIEW, "Description not recognised against the Appendix 1 list", matches)

    if any(e.verdict == Verdict.NOT_ELIGIBLE for e in hits):
        hits = [e for e in hits if not e.generic]
    verdicts = {e.verdict for e in hits}
    if Verdict.REVIEW in verdicts:
        first = next(e for e in hits if e.verdict == Verdict.REVIEW)
        return Classification(text, Verdict.REVIEW, f"{first.item} ({first.citation})", matches)
    if verdicts == {Verdict.ELIGIBLE, Verdict.NOT_ELIGIBLE}:
        bad = next(e for e in hits if e.verdict == Verdict.NOT_ELIGIBLE)
        return Classification(text, Verdict.REVIEW,
                              f"Mixes eligible items with an item that is not eligible: {bad.item}", matches)
    if verdicts == {Verdict.NOT_ELIGIBLE}:
        return Classification(text, Verdict.NOT_ELIGIBLE, f"{hits[0].item} ({hits[0].citation})", matches)

    # All eligible. Two date conditions can still send it to a person.
    if invoice_date and invoice_date < DECISION_5_EFFECTIVE and all(e.since_2026 for e in hits):
        return Classification(text, Verdict.REVIEW,
                              f"{hits[0].item} is eligible only from 1 January 2026 and the invoice is dated "
                              f"{invoice_date}; confirm which date governs", matches)
    if invoice_date and completion_date and invoice_date > completion_date and any(e.post_completion_risk for e in hits):
        risky = next(e for e in hits if e.post_completion_risk)
        return Classification(text, Verdict.REVIEW,
                              f"{risky.item}: not refundable if the work began after the residence was completed "
                              "(VATGRH1 section 3.2)", matches)
    return Classification(text, Verdict.ELIGIBLE, f"{hits[0].item} ({hits[0].citation})", matches)


@dataclass
class InvoiceEligibility:
    verdict: Verdict
    lines: list[Classification]
    eligible_taxable: float | None  # None when it cannot be worked out from line items

    def evidence(self) -> dict:
        return {
            "verdict": self.verdict,
            "eligible_taxable_amount": self.eligible_taxable,
            "lines": [{"text": c.text, "verdict": c.verdict, "reason": c.reason} for c in self.lines],
        }


def classify_invoice(description: str, line_items: list[dict], taxable_amount: float,
                     invoice_date: date | None = None, completion_date: date | None = None) -> InvoiceEligibility:
    """Classify line by line when line items exist, otherwise on the invoice description."""
    priced = [li for li in line_items if li.get("description")]
    if not priced:
        c = classify(description, invoice_date, completion_date)
        return InvoiceEligibility(c.verdict, [c], taxable_amount if c.verdict == Verdict.ELIGIBLE else None)

    lines = [classify(str(li["description"]), invoice_date, completion_date) for li in priced]
    verdicts = {c.verdict for c in lines}
    amounts = [li.get("amount") for li in priced]
    eligible_taxable = None
    if all(isinstance(a, (int, float)) for a in amounts) and Verdict.REVIEW not in verdicts:
        eligible_taxable = round(sum(a for a, c in zip(amounts, lines) if c.verdict == Verdict.ELIGIBLE), 2)

    if verdicts == {Verdict.ELIGIBLE}:
        overall = Verdict.ELIGIBLE
    elif verdicts == {Verdict.NOT_ELIGIBLE}:
        overall = Verdict.NOT_ELIGIBLE
    else:
        overall = Verdict.REVIEW  # mixed or unclear lines: the officer may amend the amount
    return InvoiceEligibility(overall, lines, eligible_taxable)
