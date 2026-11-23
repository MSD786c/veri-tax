import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { post } from "../../api/client.ts";
import type { ApplicationDetail as Detail, Decision, InvoiceDetail, OfficerDecision, RuleResult } from "../../api/types.ts";
import { Banner, Card, Chip, ErrorBanner, Field, KeyValues, Loading, PageHeader, RuleChip, StatTile, TableWrap } from "../../components/ui.tsx";
import { aed, fmtDate, fmtDateTime, humanize, num, parseUtc } from "../../lib/format.ts";
import { useRules } from "../../lib/rules.tsx";
import { statusInfo } from "../../lib/status.ts";
import { useApi } from "../../lib/useApi.ts";

const GROUPS: [string, string][] = [
  ["TI-", "Tax invoice validity"],
  ["NR-", "Refund eligibility"],
  ["SC-", "Supplier confirmation"],
];

export default function ApplicationDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<Detail>(`/fta/applications/${id}`);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;
  const { application: a, invoices, decision, audit } = data;

  const claimed = invoices.reduce((s, i) => s + i.invoice.vat_amount, 0);
  const eligible = invoices.reduce((s, i) => s + i.invoice.eligible_vat_amount, 0);
  const count = (pred: (i: InvoiceDetail) => boolean) => invoices.filter(pred).length;
  const verified = count((i) => i.invoice.status === "VERIFIED");
  const awaiting = count((i) => i.invoice.status === "AWAITING_SUPPLIER");
  const problems = invoices.length - verified - awaiting;
  const daysSinceCompletion = Math.floor((Date.now() - parseUtc(a.completion_date).getTime()) / 86_400_000);

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
            ["Completion date", `${fmtDate(a.completion_date)} (${num(daysSinceCompletion)} days ago)`],
            ["Submitted", fmtDateTime(a.submitted_at)],
          ]}
        />
      </PageHeader>
      <ErrorBanner error={error} />

      <div className="stat-row">
        <StatTile label="VAT claimed" value={aed(claimed)} sub={`${invoices.length} invoices`} />
        <StatTile label="VAT eligible" tone="good" value={aed(eligible)} sub={`${verified} verified`} />
        <StatTile label="Awaiting suppliers" tone="info" value={awaiting} />
        <StatTile label="Flagged, disputed or rejected" tone={problems ? "critical" : undefined} value={problems} />
      </div>

      <DecisionPanel detail={data} claimed={claimed} eligible={eligible} awaiting={awaiting} decision={decision} onDecided={reload} />

      <h2 className="section-title">Invoices</h2>
      {invoices.map((inv) => (
        <InvoiceCard key={inv.invoice.id} detail={inv} />
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
                      {humanize(k)}: {String(v)}
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
  if (eligible <= 0) return { decision: "REJECTED", amount: 0, why: "No invoice passed verification." };
  if (details.every((d) => d.invoice.status === "VERIFIED")) return { decision: "APPROVED", amount: eligible, why: "Every invoice passed the rules and was confirmed by its supplier." };
  return {
    decision: "PARTIALLY_APPROVED",
    amount: eligible,
    why: "Some invoices were flagged, disputed or rejected; only the verified VAT is recommended.",
  };
}

function DecisionPanel({ detail, claimed, eligible, awaiting, decision, onDecided }: {
  detail: Detail;
  claimed: number;
  eligible: number;
  awaiting: number;
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
        Waiting for {awaiting} supplier confirmation{awaiting === 1 ? "" : "s"}. The application moves to the decision queue when every invoice has an outcome.
      </Banner>
    );
  return <DecisionForm detail={detail} claimed={claimed} eligible={eligible} onDecided={onDecided} />;
}

function DecisionForm({ detail, claimed, eligible, onDecided }: { detail: Detail; claimed: number; eligible: number; onDecided: () => void }) {
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
  else if (value > claimed + 0.05) problem = `Cannot exceed the VAT claimed (${aed(claimed)}).`;
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
    <Card className="decision-card" title="Decision" subtitle="Agents and rules recommend. Only an officer approves or rejects a refund.">
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
  const entries = Object.entries(evidence);
  if (!entries.length) return <span className="muted">—</span>;
  return (
    <span className="evidence">
      {entries.map(([k, v]) => (
        <span key={k}>
          <span className="muted">{humanize(k)}:</span>{" "}
          {v === null || v === undefined || (Array.isArray(v) && !v.length) ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}
        </span>
      ))}
    </span>
  );
}

function RuleTable({ results }: { results: RuleResult[] }) {
  const { rule } = useRules();
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
          const rows = results.filter((r) => r.rule_id.startsWith(prefix));
          if (!rows.length) return null;
          return (
            <tbody key={prefix}>
              <tr className="group-row">
                <th colSpan={4}>{label}</th>
              </tr>
              {rows.map((r) => (
                <tr key={r.id} className={r.result === "FAIL" ? "row-fail" : ""}>
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
  const show = (v: unknown, c: (typeof COMPARE)[number]) =>
    c.money ? aed(Number(v)) : c.date ? fmtDate(String(v)) : String(v);
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
            let supplierCell: ReactNode = <span className="muted">Awaiting response</span>;
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
      <p className="muted small table-note">An OCR column joins this comparison once document extraction (roadmap phase 1) is live.</p>
    </TableWrap>
  );
}

function InvoiceCard({ detail }: { detail: InvoiceDetail }) {
  const { invoice: inv, supplier, supplier_response: r, confirmation_request: req } = detail;
  const failed = detail.rule_results.filter((x) => x.result === "FAIL" || x.result === "UNCERTAIN");
  return (
    <details className="card invoice-card" open={inv.status !== "VERIFIED"}>
      <summary>
        <div className="invoice-summary">
          <div>
            <strong>{inv.invoice_no}</strong>
            <span className="muted">
              {" "}
              · <Link to={`/fta/suppliers/${supplier.trn}`}>{supplier.legal_name}</Link> · {fmtDate(inv.invoice_date)}
            </span>
            <div className="small">{inv.description}</div>
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
            <Chip {...statusInfo.invoice(inv.status)} />
          </div>
        </div>
      </summary>
      <div className="invoice-body">
        <div className="split">
          <div>
            <h3>Rule results</h3>
            <RuleTable results={detail.rule_results} />
          </div>
          <div>
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
                Requested {fmtDateTime(req.sent_at)}, due {fmtDate(req.due_at)}. {req.reminders ? `${req.reminders} reminders sent.` : ""}
              </p>
            ) : (
              <p className="muted">No confirmation was requested: the invoice failed automatic checks.</p>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
