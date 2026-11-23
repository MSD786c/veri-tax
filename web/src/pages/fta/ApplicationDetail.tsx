import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { post } from "../../api/client.ts";
import type {
  ApplicationDetail as Detail,
  Decision,
  InvoiceDecisionValue,
  InvoiceDetail,
  OfficerDecision,
  RuleResult,
} from "../../api/types.ts";
import { Banner, Card, Chip, ErrorBanner, Field, KeyValues, Loading, PageHeader, RuleChip, StatTile, TableWrap } from "../../components/ui.tsx";
import { aed, fmtDate, fmtDateTime, humanize, num, parseUtc, plural } from "../../lib/format.ts";
import { useRules } from "../../lib/rules.tsx";
import { statusInfo } from "../../lib/status.ts";
import { useApi } from "../../lib/useApi.ts";
import { ComplianceReview, DecisionBrief, OriginalDocument } from "./AgentPanels.tsx";

const GROUPS: [string, string][] = [
  ["TI-", "Tax invoice validity"],
  ["EX-", "Original document"],
  ["NR-", "Refund eligibility"],
  ["CS-", "Common-sense checks"],
  ["SC-", "Supplier confirmation"],
];
const DECIDED = new Set(["APPROVED", "PARTIALLY_APPROVED", "REJECTED"]);

export default function ApplicationDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<Detail>(`/fta/applications/${id}`);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;
  const { application: a, invoices, decision, audit } = data;

  const claimed = invoices.reduce((s, i) => s + i.invoice.vat_amount, 0);
  const eligible = invoices.reduce((s, i) => s + i.invoice.eligible_vat_amount, 0);
  const count = (pred: (i: InvoiceDetail) => boolean) => invoices.filter(pred).length;
  const awaiting = count((i) => i.invoice.status === "AWAITING_SUPPLIER");
  const undecided = count((i) => i.invoice.rating !== "STRONG" && i.invoice.rating !== null && !i.invoice.officer_decision);
  const daysSinceCompletion = Math.floor((Date.now() - parseUtc(a.completion_date).getTime()) / 86_400_000);
  const appDecided = DECIDED.has(a.status);

  return (
    <>
      <PageHeader
        back={{ to: "/fta/applications", label: "Applications" }}
        title={
          <>
            {a.maskan_ref} <span className="title-sub">{a.applicant_name}</span>
          </>
        }
        actions={<Chip {...statusInfo.application(a.status)} />}
      >
        <KeyValues
          items={[
            ["Plot", a.plot_no],
            ["Emirate", a.emirate],
            ["Claim type", humanize(a.claim_type)],
            ["Building permit", fmtDate(a.permit_date)],
            ["Completion date", `${fmtDate(a.completion_date)} (${num(daysSinceCompletion)} days ago)`],
            ["Contract value", a.contract_value ? aed(a.contract_value) : "—"],
            ["Submitted", fmtDateTime(a.submitted_at)],
          ]}
        />
      </PageHeader>
      <ErrorBanner error={error} />
      {a.flags.map((f) => (
        <Banner key={f} tone="warning" title="Application flag">
          {f}
        </Banner>
      ))}

      <div className="stat-row">
        <StatTile label="VAT claimed" value={aed(claimed)} sub={plural(invoices.length, "invoice")} />
        <StatTile label="VAT eligible so far" tone="good" value={aed(eligible)} sub={`${count((i) => i.invoice.status === "VERIFIED")} verified`} />
        <StatTile label="Rated strong · weak · fail" value={`${count((i) => i.invoice.rating === "STRONG")} · ${count((i) => i.invoice.rating === "WEAK")} · ${count((i) => i.invoice.rating === "FAIL")}`} sub={awaiting ? `${awaiting} awaiting the supplier` : undefined} />
        <StatTile label="Invoices for you to decide" tone={undecided ? "warning" : undefined} value={undecided} sub="Rated weak or fail, no officer decision yet" />
      </div>

      <DecisionPanel detail={data} claimed={claimed} eligible={eligible} awaiting={awaiting} undecided={undecided} decision={decision} onDecided={reload} />
      {(a.status === "READY_FOR_DECISION" || data.agent_runs.length > 0) && <DecisionBrief appId={a.id} runs={data.agent_runs} onRan={reload} />}

      <h2 className="section-title">Invoices</h2>
      {invoices.map((inv) => (
        <InvoiceCard key={inv.invoice.id} detail={inv} locked={appDecided} onDecided={reload} />
      ))}

      <Card title="Audit trail" subtitle="Append-only record of every automated and human step on this application and its invoices.">
        <ol className="timeline">
          {audit.map((e) => (
            <li key={e.id}>
              <time>{fmtDateTime(e.at)}</time>
              <div>
                <strong>{humanize(e.action)}</strong> <span className="muted">{e.entity}</span>
                <div className="small">
                  by <code>{e.actor}</code>
                  {Object.entries(e.detail).map(([k, v]) => (
                    <span key={k} className="audit-detail">
                      {humanize(k)}: {v === null ? "—" : String(v)}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

function recommend(details: InvoiceDetail[], eligible: number): { decision: Decision; amount: number; why: string } {
  if (eligible <= 0) return { decision: "REJECTED", amount: 0, why: "No invoice is verified or approved." };
  if (details.every((d) => d.invoice.status === "VERIFIED"))
    return { decision: "APPROVED", amount: eligible, why: "Every invoice is verified: rated strong, or approved by an officer." };
  return {
    decision: "PARTIALLY_APPROVED",
    amount: eligible,
    why: "Some invoices are flagged, disputed or rejected; only the verified VAT is recommended.",
  };
}

function DecisionPanel({ detail, claimed, eligible, awaiting, undecided, decision, onDecided }: {
  detail: Detail;
  claimed: number;
  eligible: number;
  awaiting: number;
  undecided: number;
  decision: OfficerDecision | null;
  onDecided: () => void;
}) {
  if (decision)
    return (
      <Card title="Officer decision" actions={<Chip {...statusInfo.decision(decision.decision)} />}>
        <KeyValues
          items={[
            ["Approved amount", aed(decision.approved_amount)],
            ["Decided by", decision.officer_id],
            ["Decided at", fmtDateTime(decision.decided_at)],
            ["Comments", decision.comments || "—"],
          ]}
        />
      </Card>
    );
  if (detail.application.status !== "READY_FOR_DECISION")
    return (
      <Banner tone="info" title="Not ready for a decision yet">
        Waiting for {plural(awaiting, "supplier confirmation")}. Suppliers have 5 business days; after that the invoice comes to you rated weak.
        You can still decide individual invoices below.
      </Banner>
    );
  return <DecisionForm detail={detail} claimed={claimed} eligible={eligible} undecided={undecided} onDecided={onDecided} />;
}

function DecisionForm({ detail, claimed, eligible, undecided, onDecided }: {
  detail: Detail;
  claimed: number;
  eligible: number;
  undecided: number;
  onDecided: () => void;
}) {
  const rec = recommend(detail.invoices, eligible);
  const [decision, setDecision] = useState<Decision>(rec.decision);
  const [amount, setAmount] = useState(rec.amount.toFixed(2));
  const [comments, setComments] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const value = Number(amount);
  const deviates = decision !== rec.decision || Math.abs(value - rec.amount) > 0.005;
  let problem: string | null = null;
  if (decision === "REJECTED" && value !== 0) problem = "A rejection approves AED 0.";
  else if (decision !== "REJECTED" && !(value > 0)) problem = "Enter the amount to approve.";
  else if (value > claimed + 0.01) problem = `Cannot exceed the VAT claimed (${aed(claimed)}).`;
  else if (deviates && !comments.trim()) problem = "Explain why you are departing from the recommendation.";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/fta/applications/${detail.application.id}/decision`, { decision, approved_amount: value, comments: comments.trim() });
      onDecided();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="decision-card" title="Application decision" subtitle="Agents and rules recommend. Only an officer approves or rejects a refund.">
      {undecided > 0 && (
        <Banner tone="warning" title={`${plural(undecided, "invoice")} rated weak or fail without your decision`}>
          Decide them below first if you want their VAT counted; until then only verified VAT is recommended.
        </Banner>
      )}
      <div className="recommendation">
        <span className="stat-label">Recommended</span>
        <div>
          <Chip {...statusInfo.decision(rec.decision)} /> <strong>{aed(rec.amount)}</strong>
        </div>
        <p className="muted small">{rec.why}</p>
      </div>
      <ErrorBanner error={error} />
      <form className="form-grid" onSubmit={submit}>
        <Field label="Decision" htmlFor="decision">
          <select
            id="decision"
            value={decision}
            onChange={(e) => {
              const d = e.target.value as Decision;
              setDecision(d);
              setAmount(d === "REJECTED" ? "0.00" : (d === rec.decision ? rec.amount : eligible || claimed).toFixed(2));
            }}
          >
            <option value="APPROVED">Approve</option>
            <option value="PARTIALLY_APPROVED">Approve in part</option>
            <option value="REJECTED">Reject</option>
          </select>
        </Field>
        <Field label="Approved amount (AED)" htmlFor="amount" hint={`Claimed ${aed(claimed)} · eligible ${aed(eligible)}`}>
          <input id="amount" type="number" step="0.01" min="0" max={claimed} disabled={decision === "REJECTED"} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={deviates ? "Comments (required)" : "Comments"} htmlFor="comments">
          <textarea id="comments" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Reasons, conditions, follow-up" />
        </Field>
        <div className="form-actions span-all">
          {problem && <p className="warn-text">{problem}</p>}
          <button className={`btn ${decision === "REJECTED" ? "btn-danger" : "btn-primary"}`} disabled={!!problem || busy}>
            {busy ? "Saving…" : decision === "REJECTED" ? "Reject application" : `Approve ${aed(value || 0)}`}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Evidence({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).filter(([k]) => k !== "lines");
  const lines = Array.isArray(evidence.lines) ? (evidence.lines as { text?: string; verdict?: string; reason?: string }[]) : [];
  if (!entries.length && !lines.length) return <span className="muted">—</span>;
  return (
    <span className="evidence">
      {entries.map(([k, v]) => (
        <span key={k}>
          <span className="muted">{humanize(k)}:</span>{" "}
          {v === null || v === undefined || (Array.isArray(v) && !v.length) ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}
        </span>
      ))}
      {lines.map((l, i) => (
        <span key={i}>
          <span className="muted">{l.verdict ? humanize(l.verdict) : "Line"}:</span> {l.text}
          {l.reason ? ` (${l.reason})` : ""}
        </span>
      ))}
    </span>
  );
}

/** Rules re-run as evidence arrives (a duplicate, a supplier answer); show the latest result per rule. */
function latest(results: RuleResult[]): RuleResult[] {
  const byRule = new Map<string, RuleResult>();
  for (const r of [...results].sort((x, y) => x.id - y.id)) byRule.set(r.rule_id, r);
  return [...byRule.values()].sort((x, y) => x.rule_id.localeCompare(y.rule_id));
}

function RuleTable({ results }: { results: RuleResult[] }) {
  const { rule } = useRules();
  const rows = latest(results);
  return (
    <TableWrap>
      <table className="table compact">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Check</th>
            <th>Result</th>
            <th>Evidence</th>
          </tr>
        </thead>
        {GROUPS.map(([prefix, label]) => {
          const group = rows.filter((r) => r.rule_id.startsWith(prefix));
          if (!group.length) return null;
          return (
            <tbody key={prefix}>
              <tr className="group-row">
                <th colSpan={4}>{label}</th>
              </tr>
              {group.map((r) => (
                <tr key={r.id} className={r.result === "FAIL" ? "row-fail" : r.result === "UNCERTAIN" ? "row-mismatch" : ""}>
                  <td>
                    <RuleChip id={r.rule_id} />
                  </td>
                  <td>
                    {rule(r.rule_id)?.title ?? r.rule_id}
                    <div className="cell-sub">v{r.rule_version}</div>
                  </td>
                  <td>
                    <Chip {...statusInfo.rule(r.result)} />
                  </td>
                  <td>
                    <Evidence evidence={r.evidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </TableWrap>
  );
}

const COMPARE: { key: "invoice_no" | "invoice_date" | "taxable_amount" | "vat_amount" | "total"; label: string; money?: boolean; date?: boolean }[] = [
  { key: "invoice_no", label: "Invoice number" },
  { key: "invoice_date", label: "Date of issue", date: true },
  { key: "taxable_amount", label: "Taxable amount", money: true },
  { key: "vat_amount", label: "VAT", money: true },
  { key: "total", label: "Total", money: true },
];

function Comparison({ detail }: { detail: InvoiceDetail }) {
  const { invoice, supplier_response: r } = detail;
  const show = (v: unknown, c: (typeof COMPARE)[number]) => (c.money ? aed(Number(v)) : c.date ? fmtDate(String(v)) : String(v));
  return (
    <TableWrap>
      <table className="table compact comparison">
        <thead>
          <tr>
            <th>Particular</th>
            <th>Maskan (submitted)</th>
            <th>Supplier (confirmed)</th>
          </tr>
        </thead>
        <tbody>
          {COMPARE.map((c) => {
            const corrected = r && c.key in r.corrections;
            let supplierCell: ReactNode = <span className="muted">{detail.confirmation_request ? "Awaiting response" : "Not sent to supplier"}</span>;
            if (r && !r.issued) supplierCell = <span className="muted">Not issued</span>;
            else if (corrected) supplierCell = <strong className="mismatch">{show(r.corrections[c.key], c)}</strong>;
            else if (r) supplierCell = r.particulars_confirmed ? show(invoice[c.key], c) : <span className="muted">Not confirmed</span>;
            return (
              <tr key={c.key} className={corrected ? "row-mismatch" : ""}>
                <td>{c.label}</td>
                <td>{show(invoice[c.key], c)}</td>
                <td>
                  {supplierCell}
                  {corrected && <span className="sr-only"> (differs from submitted)</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small table-note">The original document is compared with the Maskan data by rule EX-01.</p>
    </TableWrap>
  );
}

/** The agent's recommendation: rating, reasons, what would fix it, trust lane and precedents. */
function Assessment({ detail }: { detail: InvoiceDetail }) {
  const { invoice: inv, supplier_trust: trust, precedents } = detail;
  const partial = inv.suggested_eligible_vat !== null && Math.abs(inv.suggested_eligible_vat - inv.vat_amount) > 0.005;
  return (
    <div className="assessment">
      <div className="assessment-head">
        <span className="stat-label">Agent rating</span>
        <Chip {...statusInfo.rating(inv.rating)} />
        <span className="muted small">Supplier lane</span>
        <Chip {...statusInfo.trust(trust.tier)} />
        <span className="muted small">
          Other invoices: {trust.confirmed} confirmed · {trust.corrected} corrected · {trust.no_response} no response · {trust.disputed} disputed
        </span>
      </div>
      {inv.rating_reasons.length > 0 && (
        <>
          <h3>Why</h3>
          <ul className="reasons">
            {inv.rating_reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {partial && (
        <p className="small">
          Eligible VAT suggested by the item check: <strong>{aed(inv.suggested_eligible_vat)}</strong> of {aed(inv.vat_amount)}.
        </p>
      )}
      {inv.fix_guidance.length > 0 && (
        <>
          <h3>What the applicant is told they can do</h3>
          <ul className="reasons">
            {inv.fix_guidance.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}
      {precedents.length > 0 && (
        <>
          <h3>Precedents: earlier decisions with the same findings</h3>
          <ul className="reasons">
            {precedents.map((p) => (
              <li key={p.id}>
                <Chip {...statusInfo.invoiceDecision(p.decision)} /> {aed(p.approved_vat_amount)} by {p.officer_id}, {fmtDate(p.decided_at)}
                {p.comment ? ` — “${p.comment}”` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function InvoiceDecisionForm({ detail, onDecided }: { detail: InvoiceDetail; onDecided: () => void }) {
  const inv = detail.invoice;
  const suggested = inv.suggested_eligible_vat ?? inv.vat_amount;
  const [decision, setDecision] = useState<InvoiceDecisionValue>(inv.rating === "FAIL" ? "REJECTED" : "APPROVED");
  const [amount, setAmount] = useState(suggested.toFixed(2));
  const [comment, setComment] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const value = Number(amount);
  const overrides = (inv.rating === "FAIL" && decision === "APPROVED") || (inv.rating === "STRONG" && decision === "REJECTED");
  let problem: string | null = null;
  if (decision === "APPROVED" && !(value >= 0)) problem = "Enter the VAT to approve.";
  else if (decision === "APPROVED" && value > inv.vat_amount + 0.01) problem = `Cannot exceed the VAT on the invoice (${aed(inv.vat_amount)}).`;
  else if ((overrides || decision === "REJECTED") && !comment.trim()) problem = overrides ? "Explain why you are going against the agent's rating." : "Give the reason for rejecting.";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/fta/invoices/${inv.id}/decision`, {
        decision,
        approved_vat_amount: decision === "APPROVED" ? value : null,
        comment: comment.trim(),
      });
      onDecided();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="invoice-decision" onSubmit={submit}>
      <h3>Your decision on this invoice</h3>
      <ErrorBanner error={error} />
      <div className="choice-row" role="radiogroup" aria-label={`Decision on ${inv.invoice_no}`}>
        {(["APPROVED", "REJECTED"] as const).map((d) => (
          <label key={d} className={`choice ${decision === d ? "on" : ""}`}>
            <input type="radio" name={`decide-${inv.id}`} checked={decision === d} onChange={() => setDecision(d)} />
            {d === "APPROVED" ? "Approve" : "Reject"}
          </label>
        ))}
      </div>
      <div className="form-grid">
        {decision === "APPROVED" && (
          <Field label="VAT to approve (AED)" htmlFor={`amt-${inv.id}`} hint={`Invoice VAT ${aed(inv.vat_amount)}`}>
            <input id={`amt-${inv.id}`} type="number" step="0.01" min="0" max={inv.vat_amount} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        )}
        <Field label={overrides || decision === "REJECTED" ? "Comment (required)" : "Comment"} htmlFor={`cmt-${inv.id}`}>
          <input id={`cmt-${inv.id}`} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Stored as a precedent for similar invoices" />
        </Field>
      </div>
      <div className="form-actions">
        {overrides && !problem && <p className="warn-text">This goes against the agent's rating and will be recorded as an override.</p>}
        {problem && <p className="warn-text">{problem}</p>}
        <button className={`btn btn-sm ${decision === "REJECTED" ? "btn-danger" : "btn-primary"}`} disabled={!!problem || busy}>
          {busy ? "Saving…" : decision === "REJECTED" ? "Reject invoice" : `Approve ${aed(value || 0)}`}
        </button>
      </div>
    </form>
  );
}

function InvoiceCard({ detail, locked, onDecided }: { detail: InvoiceDetail; locked: boolean; onDecided: () => void }) {
  const { invoice: inv, supplier, supplier_response: r, confirmation_request: req, officer_decision: od } = detail;
  const failed = latest(detail.rule_results).filter((x) => x.result === "FAIL" || x.result === "UNCERTAIN");
  const needsOfficer = !od && !locked && inv.rating !== "STRONG";
  return (
    <details className="card invoice-card" open={needsOfficer && inv.rating !== null}>
      <summary>
        <div className="invoice-summary">
          <div>
            <strong>{inv.invoice_no}</strong>
            <span className="muted">
              {" "}
              · <Link to={`/fta/suppliers/${supplier.trn}`}>{supplier.legal_name}</Link> · {fmtDate(inv.invoice_date)}
            </span>
            <div className="small">{inv.description}</div>
            {inv.rating_reasons[0] && inv.rating !== "STRONG" && <div className="small muted">{inv.rating_reasons[0]}</div>}
          </div>
          <div className="invoice-figures">
            <span>
              VAT <strong>{aed(inv.vat_amount)}</strong>
            </span>
            <span className="muted">eligible {aed(inv.eligible_vat_amount)}</span>
          </div>
          <div className="chip-list">
            {failed.map((f) => (
              <RuleChip key={f.id} id={f.rule_id} outcome={f.result} />
            ))}
            <Chip {...statusInfo.rating(inv.rating)} />
            {od ? <Chip {...statusInfo.invoiceDecision(od.decision)} /> : <Chip {...statusInfo.invoice(inv.status)} />}
          </div>
        </div>
      </summary>
      <div className="invoice-body">
        <Assessment detail={detail} />
        <ComplianceReview detail={detail} onRan={onDecided} />
        {od ? (
          <div className="officer-record">
            <h3>Officer decision</h3>
            <KeyValues
              items={[
                ["Decision", <Chip key="d" {...statusInfo.invoiceDecision(od.decision)} />],
                ["VAT approved", aed(od.approved_vat_amount)],
                ["Agent rating at the time", od.agent_rating ? statusInfo.rating(od.agent_rating).label : "—"],
                ["Override", od.overrode_agent ? "Yes, against the agent" : "No"],
                ["By", `${od.officer_id} · ${fmtDateTime(od.decided_at)}`],
                ["Comment", od.comment || "—"],
              ]}
            />
          </div>
        ) : (
          !locked && <InvoiceDecisionForm detail={detail} onDecided={onDecided} />
        )}
        <div className="split">
          <div>
            <h3>Rule results</h3>
            <RuleTable results={detail.rule_results} />
          </div>
          <div>
            <h3>Original document</h3>
            <OriginalDocument detail={detail} />
            <h3>Submitted vs confirmed</h3>
            <Comparison detail={detail} />
            <h3>Supplier response</h3>
            {r ? (
              <KeyValues
                items={[
                  ["Issued", r.issued ? "Yes" : "No"],
                  ...(r.issued
                    ? ([
                        ["Consideration", r.consideration_status === "RECEIVED" ? "Received in full" : r.consideration_status ? "Partly received / retention" : "—"],
                        ["Received", r.received_date ? `${fmtDate(r.received_date)}${r.amount_received !== null ? ` · ${aed(r.amount_received)}` : ""}` : r.amount_received !== null ? aed(r.amount_received) : "—"],
                        ["Retention", r.retention_amount !== null ? `${aed(r.retention_amount)} until ${fmtDate(r.retention_release_date)}` : "—"],
                        ["VAT return period", r.vat_return_period ?? "—"],
                      ] as [string, ReactNode][])
                    : []),
                  ["Declared by", `${r.declared_by} · ${fmtDateTime(r.declared_at)}`],
                ]}
              />
            ) : req ? (
              <p className="muted">
                Requested {fmtDateTime(req.sent_at)}, due {fmtDate(req.due_at)} ({statusInfo.request(req.status).label.toLowerCase()}).
                {req.reminders ? ` ${req.reminders} reminders sent.` : ""}
              </p>
            ) : (
              <p className="muted">Not sent to the supplier: the agent rated it fail on the document checks.</p>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
