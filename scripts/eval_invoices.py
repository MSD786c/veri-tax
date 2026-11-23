"""End-to-end evaluation on the 60 synthetic invoices in `invoice test/` (answer key from PR #4).

The PDF is the ONLY input, as in production: the agent reads it, the reading is submitted as the
Maskan invoice data, the pipeline links the document, runs the rules, the supplier confirms
(the answer key assumes it does), and the rating is compared with the expected one.

    uv run python scripts/eval_invoices.py                 # all 60 (about 30 min on Groq on-demand)
    uv run python scripts/eval_invoices.py --limit 6       # quick smoke run
    uv run python scripts/eval_invoices.py --files invoice_001.pdf,invoice_036.pdf

Needs AGENT_PROVIDER=groq and GROQ_API_KEY in .env. Model readings are cached in
data/eval/cache/<sha256>.json, so re-runs (e.g. after a rule change) cost no tokens; delete the
cache to re-read. Results: data/eval/results.csv and a summary on stdout.
"""
import argparse
import csv
import hashlib
import json
import os
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRUTH = ROOT / "invoice test" / "invoice test answers" / "ground_truth.json"
PDFS = ROOT / "invoice test" / "invoices"
OUT = ROOT / "data" / "eval"

# Isolated database: never touches veritax.db. Set before importing the app.
_tmp = tempfile.mkdtemp()
os.environ.update(DATABASE_URL=f"sqlite:///{_tmp}/eval.db", SEED="0", DATA_DIR=f"{_tmp}/data")
sys.path.insert(0, str(ROOT))

from sqlmodel import Session, select  # noqa: E402

from app import db, documents, pipeline, rules  # noqa: E402
from app.agent import get_agent  # noqa: E402
from app.assessment import latest_results  # noqa: E402
from app.models import (ConfirmationRequest, ConsiderationStatus, ExtractedInvoice, Invoice, RequestStatus,  # noqa: E402
                        RuleOutcome, Supplier, SupplierResponse)
from app.schemas import IngestApplication, IngestInvoice, LineItem  # noqa: E402

FIELDS = ["supplier_trn", "invoice_no", "invoice_date", "taxable_amount", "vat_amount", "total", "title",
          "supplier_name", "supplier_address", "recipient_name", "plot_no", "invoice_type"]


def norm_text(v) -> str:
    """Case, spacing and punctuation-insensitive ("UAE P.O. Box" == "UAE, P.O. Box")."""
    return re.sub(r"[^\w]+", " ", str(v or "")).strip().lower()


def field_ok(name: str, got, want) -> bool:
    if want in ("", None):
        return got in ("", None)
    if got in ("", None):
        return False
    if name in ("taxable_amount", "vat_amount", "total"):
        return bool(rules.same(got, float(want)))
    if name == "invoice_date":
        return rules.to_date(got) == rules.to_date(want)
    if name in ("supplier_trn", "invoice_no", "plot_no"):
        return rules.same_ref(got, want)
    return norm_text(got) == norm_text(want)


def read(data: bytes) -> dict:
    """Model reading, cached by file hash."""
    cache = OUT / "cache" / documents.PROMPT_VERSION / f"{hashlib.sha256(data).hexdigest()}.json"
    if cache.exists():
        raw = json.loads(cache.read_text())
    else:
        raw = get_agent().extract_invoice(data, "application/pdf")
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(raw))
    fixed = cache.with_suffix(".trn.json")  # second TRN look for readings cached before it existed
    if fixed.exists():
        return json.loads(fixed.read_text())
    raw = documents.fix_trn(documents.page_images(data, "application/pdf"), raw)
    fixed.write_text(json.dumps(raw))
    return raw


def as_maskan_invoice(ext: dict) -> IngestInvoice | None:
    """What Maskan would submit if the reading were all it had. None when no invoice date could be read."""
    t = lambda n: rules.trusted(ext, n)  # noqa: E731
    inv_date = rules.to_date(t("invoice_date")) if t("invoice_date") else None
    if inv_date is None:
        return None
    lines = t("line_items") if isinstance(t("line_items"), list) else []
    return IngestInvoice(
        supplier_trn=str(t("supplier_trn") or ""), supplier_name=str(t("supplier_name") or ""),
        invoice_no=str(t("invoice_no") or ""), invoice_date=inv_date, title=str(t("title") or ""),
        taxable_amount=rules.to_number(t("taxable_amount") or 0) or 0, vat_amount=rules.to_number(t("vat_amount") or 0) or 0,
        total=rules.to_number(t("total") or 0) or 0, currency=str(t("currency") or "AED"),
        plot_no=str(t("plot_no") or ""), description=str(t("description") or ""),
        supplier_address=str(t("supplier_address") or ""), recipient_name=str(t("recipient_name") or ""),
        recipient_address=str(t("recipient_address") or ""),
        supply_date=rules.to_date(t("supply_date")) if t("supply_date") else None,
        invoice_type="SIMPLIFIED" if "simplified" in str(t("title") or "").lower() else None,
        for_applicant_statement=t("for_applicant_statement") is True,
        line_items=[LineItem(description=str(li.get("description", "")), quantity=rules.to_number(li.get("quantity", "")),
                             unit_price=rules.to_number(li.get("unit_price", "")), amount=rules.to_number(li.get("amount", "")))
                    for li in lines if isinstance(li, dict) and li.get("description")],
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--files", help="comma-separated file names")
    args = ap.parse_args()
    if get_agent() is None:
        sys.exit("Set AGENT_PROVIDER=groq and GROQ_API_KEY in .env")

    truth = json.loads(TRUTH.read_text())
    apps = {a["maskan"]: a for a in truth["applications"]}
    # Good invoices first: the answer key assumes the genuine copy of a duplicate was claimed first.
    cases = sorted(truth["invoices"], key=lambda i: (i["folder"] != "Good invoices", i["file"]))
    if args.files:
        cases = [c for c in cases if c["file"] in args.files.split(",")]
    if args.limit:
        cases = cases[: args.limit]

    db.init_db()
    with Session(db.engine) as s:
        for sup in truth["suppliers"]:  # the FTA registry (TI-03)
            s.add(Supplier(trn=sup["trn"], legal_name=sup["legal_name"], address=sup["address"], registry_verified=True))
        s.commit()

    rows, field_hits = [], Counter()
    for n, case in enumerate(cases, 1):
        data = (PDFS / case["folder"] / case["file"]).read_bytes()
        exp = case["expected"]
        row = {"file": case["file"], "folder": case["folder"], "expected": exp["rating"], "expected_rules": exp["rules"],
               "defect": exp["defect"]}
        try:
            dtype, fields = documents._clean(read(data))
        except Exception as e:  # noqa: BLE001 — record and continue
            rows.append({**row, "got": "ERROR", "detail": str(e)[:200]})
            print(f"[{n}/{len(cases)}] {case['file']}: ERROR {e}")
            continue
        ext = {"document_type": dtype, "fields": fields}
        wrong = [f for f in FIELDS if not field_ok(f, rules.field(ext, f)[0], case["fields"].get(f))]
        field_hits.update(f for f in FIELDS if f not in wrong)

        with Session(db.engine) as s:
            doc, _ = documents.store(s, data, case["file"], "application/pdf", "maskan-portal", "eval")
            if not s.exec(select(ExtractedInvoice).where(ExtractedInvoice.document_id == doc.id)).first():
                s.add(ExtractedInvoice(document_id=doc.id, document_type=dtype, fields=fields, model="eval-cache",
                                       prompt_version=documents.PROMPT_VERSION))
                s.commit()
            item = as_maskan_invoice(ext)
            if item is None:
                rows.append({**row, "got": "NO_DATE", "fields_wrong": ",".join(wrong), "detail": "invoice date not readable"})
                print(f"[{n}/{len(cases)}] {case['file']}: invoice date not readable")
                continue
            a = apps[case["maskan_ref"]]
            app = pipeline.ingest(s, IngestApplication(
                maskan_ref=f"{a['maskan']}/{case['file']}", applicant_name=a["name"], emirates_id=f"eval-{a['maskan']}",
                plot_no=a["plot"], emirate=a["emirate"], completion_date=a["completion_date"], permit_date=a["permit_date"],
                invoices=[item]))
            inv = s.exec(select(Invoice).where(Invoice.application_id == app.id)).one()
            if not inv.document_hash:  # reading's TRN/number not confident enough to auto-link: link explicitly
                inv.document_hash = doc.sha256
                pipeline.reverify(s, inv)
            req = s.exec(select(ConfirmationRequest).where(ConfirmationRequest.invoice_id == inv.id)).first()
            if req and req.status == RequestStatus.PENDING:  # the answer key assumes the supplier confirms
                q = (inv.invoice_date.month - 1) // 3 + 1
                resp = SupplierResponse(request_id=req.id, issued=True, particulars_confirmed=True, declared_by="eval",
                                        consideration_status=ConsiderationStatus.RECEIVED,
                                        vat_return_period=f"{inv.invoice_date.year}-Q{q}")
                s.add(resp)
                s.flush()
                pipeline.reconcile(s, req, resp)
            s.commit()
            res = latest_results(s, inv.id)
            failing = sorted(r for r, x in res.items() if x.result == RuleOutcome.FAIL)
            unsure = sorted(r for r, x in res.items() if x.result == RuleOutcome.UNCERTAIN)
            got = (inv.rating or "NONE").value if hasattr(inv.rating, "value") else str(inv.rating or "NONE")
            want_rules = {r.strip() for r in exp["rules"].split(",") if r.strip()}
            rows.append({**row, "got": got, "failing_rules": ",".join(failing), "uncertain_rules": ",".join(unsure),
                         "rule_hit": want_rules <= set(failing + unsure) if want_rules else not failing,
                         "fields_wrong": ",".join(wrong), "detail": " | ".join(inv.rating_reasons)[:300]})
        print(f"[{n}/{len(cases)}] {case['file']}: expected {exp['rating']:6} got {rows[-1]['got']:6}"
              f" fail={rows[-1].get('failing_rules', '')} unsure={rows[-1].get('uncertain_rules', '')}"
              + (f" fields_wrong={','.join(wrong)}" if wrong else ""), flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    keys = ["file", "folder", "expected", "got", "expected_rules", "failing_rules", "uncertain_rules", "rule_hit",
            "fields_wrong", "defect", "detail"]
    with open(OUT / "results.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    total = len(rows)
    match = sum(r["expected"] == r["got"] for r in rows)
    print(f"\n=== Rating accuracy: {match}/{total} ({match / total:.0%})")
    print("Confusion (expected -> got):", dict(Counter(f"{r['expected']}->{r['got']}" for r in rows)))
    print("Expected rule found:", sum(bool(r.get("rule_hit")) for r in rows), "/", total)
    print("Field accuracy:", {f: f"{field_hits[f]}/{total}" for f in FIELDS})
    for r in rows:
        if r["expected"] != r["got"]:
            print(f"  MISS {r['file']} ({r['folder']}): expected {r['expected']} [{r['expected_rules'] or '-'}] "
                  f"got {r['got']} fail=[{r.get('failing_rules', '')}] unsure=[{r.get('uncertain_rules', '')}] "
                  f"wrong_fields=[{r.get('fields_wrong', '')}] :: {r['defect']}")
    print(f"\nPer-invoice results: {OUT / 'results.csv'}")


if __name__ == "__main__":
    main()
