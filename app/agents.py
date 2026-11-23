"""LLM agents. They RECOMMEND; only an FTA officer decides (README "Human in the loop").

- compliance_review: second opinion on an invoice's UNCERTAIN rules and goods eligibility (NR-02).
- reconciliation_summary: per-application recommended outcome with reasons, for the officer.
Every run is stored as an AgentRun with model + prompt version.
"""
import json

from sqlmodel import Session, col, select

from app import db, llm, pipeline
from app.agent import get_agent
from app.assessment import TEXT, latest_results
from app.models import AgentRun, Application, Invoice, RuleOutcome

COMPLIANCE_VERSION = "compliance-2026.11-2"
SUMMARY_VERSION = "reconcile-2026.11-2"

COMPLIANCE_SYSTEM = """You assist UAE Federal Tax Authority officers reviewing VAT refund claims by UAE nationals
building a new residence (FTA guide VATGRH1). Eligible: building works and materials for the residence.
Not eligible: furniture, electrical appliances, and anything not part of the building.
You recommend; you never decide. Return ONLY compact single-line JSON:
{"recommendations": [{"rule_id": "...", "recommendation": "PASS"|"FAIL"|"UNCERTAIN", "reason": "..."}],
 "eligible_goods": true|false|null, "notes": "..."}
Include NR-02 and every rule you were given. Be concise and cite the evidence."""

SUMMARY_SYSTEM = """You prepare a decision brief for a UAE FTA officer on a New Residence VAT refund application.
You recommend; the officer decides. Use only the data given. Return ONLY compact single-line JSON:
{"recommended_decision": "APPROVED"|"PARTIALLY_APPROVED"|"REJECTED",
 "recommended_amount": <AED number>, "summary": "<2-3 sentences>",
 "reasons": ["..."], "risks": ["..."], "follow_up": ["..."]}"""


def _run(session: Session, kind: str, entity: str, version: str, system: str, payload: dict) -> AgentRun:
    run = AgentRun(kind=kind, entity=entity, model=llm.MODEL, prompt_version=version)
    try:
        run.output = llm.chat_json(system, json.dumps(payload, default=str))
    except llm.LLMError as e:
        run.error = str(e)[:500]
    session.add(run)
    db.audit(session, f"agent:{kind}", "recommend", entity, model=llm.MODEL, ok=run.error is None)
    session.commit()
    session.refresh(run)
    return run


def compliance_review(session: Session, inv: Invoice) -> AgentRun:
    app = session.get(Application, inv.application_id)
    results = latest_results(session, inv.id).values()
    review = [r for r in results if r.result == RuleOutcome.UNCERTAIN or r.rule_id == "NR-02"]
    ext = pipeline.extraction_for(session, inv)
    payload = {
        "application": {"applicant": app.applicant_name, "plot_no": app.plot_no, "completion_date": app.completion_date, "claim_type": app.claim_type},
        "invoice": inv.model_dump(include={"invoice_no", "invoice_date", "supplier_trn", "description", "plot_no", "taxable_amount", "vat_amount", "total"}),
        "document_extraction": ext.model_dump(include={"document_type", "fields"}) if ext else None,
        "agent_rating": inv.rating,
        "rules_to_review": [{"rule_id": r.rule_id, "rule": TEXT.get(r.rule_id, (r.rule_id,))[0], "engine_result": r.result, "evidence": r.evidence} for r in review],
    }
    return _run(session, "compliance", f"invoice:{inv.id}", COMPLIANCE_VERSION, COMPLIANCE_SYSTEM, payload)


def reconciliation_summary(session: Session, app: Application) -> AgentRun:
    invoices = []
    for inv in session.exec(select(Invoice).where(Invoice.application_id == app.id)).all():
        req, resp = pipeline.request_for(session, inv)
        results = latest_results(session, inv.id).values()
        invoices.append({
            "invoice": inv.model_dump(include={"invoice_no", "supplier_trn", "description", "vat_amount", "eligible_vat_amount",
                                               "suggested_eligible_vat", "status", "rating", "rating_reasons"}),
            "non_passing_rules": [{"rule_id": r.rule_id, "rule": TEXT.get(r.rule_id, (r.rule_id,))[0], "result": r.result, "evidence": r.evidence}
                                  for r in results if r.result not in (RuleOutcome.PASS, RuleOutcome.NOT_APPLICABLE)],
            "supplier_response": resp.model_dump(exclude={"id", "request_id"}) if resp else None,
        })
    payload = {
        "application": app.model_dump(exclude={"emirates_id_hash"}),
        "total_vat_claimed": round(sum(i["invoice"]["vat_amount"] for i in invoices), 2),
        "total_vat_eligible_by_rules": round(sum(i["invoice"]["eligible_vat_amount"] for i in invoices), 2),
        "invoices": invoices,
    }
    return _run(session, "reconciliation", f"application:{app.id}", SUMMARY_VERSION, SUMMARY_SYSTEM, payload)


def enabled() -> bool:
    return get_agent() is not None and llm.enabled()


# Background wrappers: own session, skip silently when no agent is configured.
def compliance_review_background(invoice_id: int) -> None:
    if not enabled():
        return
    with Session(db.engine) as session:
        compliance_review(session, session.get(Invoice, invoice_id))


def compliance_for_application_background(app_id: int) -> None:
    if not enabled():
        return
    with Session(db.engine) as session:
        for inv in session.exec(select(Invoice).where(Invoice.application_id == app_id)).all():
            compliance_review(session, inv)


def summary_background(app_id: int) -> None:
    if not enabled():
        return
    with Session(db.engine) as session:
        reconciliation_summary(session, session.get(Application, app_id))


def runs_for(session: Session, entity: str) -> list[AgentRun]:
    return list(session.exec(select(AgentRun).where(AgentRun.entity == entity).order_by(col(AgentRun.at).desc())).all())
