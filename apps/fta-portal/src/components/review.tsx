import type { ReactNode } from "react";
import { askComplianceAction, decisionBriefAction } from "@/app/actions";
import { fdt, money, nice } from "@/lib/format";
import type { AgentRun, BriefOutput, ComplianceOutput, DocumentMeta, Extraction } from "@/lib/types";
import { Badge, Icon } from "./ui";
import { RuleInfo } from "@/components/RuleInfo";

const FIELD: Record<string, string> = {
  supplier_trn: "Supplier TRN", invoice_no: "Invoice number", plot_no: "Plot number", vat_rate: "VAT rate", vat_amount: "VAT amount",
  for_applicant_statement: "Third-party statement", taxable_amount: "Amount excl. VAT",
};
const LOW = 0.7;

function show(name: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (name === "vat_rate") return `${v}%`;
  if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Array.isArray(v)) return v.map((l) => (l && typeof l === "object" && "description" in l ? `${l.description} (${money(Number(l.amount))})` : String(l))).join("; ");
  return String(v);
}

export const SOURCE: Record<string, string> = { "maskan-portal": "Upload link", maskan: "Maskan" };
export const fileHref = (id: number) => `/documents/${id}/file`;

/** The original document an invoice was read from, and what the extraction model saw on it. */
export function DocumentPanel({ doc, extraction }: { doc: DocumentMeta | null; extraction: Extraction | null }) {
  if (!doc) return <><h3 className="sec">Original document</h3><p className="muted small">No original document is linked to this invoice, so EX-01 cannot compare it.</p></>;
  const fields = Object.entries(extraction?.fields ?? {});
  const low = fields.filter(([, f]) => f.confidence < LOW).length;
  return (
    <>
      <h3 className="sec">Original document</h3>
      <div className="doc-card">
        <span className="doc-ic"><Icon n="file" s={20} /></span>
        <div className="doc-main"><b>{doc.filename}</b><small>{SOURCE[doc.source] ?? nice(doc.source)} · {extraction ? nice(extraction.document_type) : nice(doc.status)} · {Math.round(doc.size / 1024)} KB</small></div>
        <a className="btn ghost sm" href={fileHref(doc.id)} target="_blank" rel="noopener"><Icon n="external" s={15} /><span>Open original</span></a>
      </div>
      {doc.error && <p className="err banner">{doc.error}</p>}
      {extraction && (
        <>
          <p className="muted small">Read by <span className="mono">{extraction.model}</span> on {fdt(extraction.created_at)}.{low > 0 && <> <b>{low} {low === 1 ? "field" : "fields"}</b> below {LOW * 100}% confidence are highlighted.</>}</p>
          <table className="fields">
            <thead><tr><th>Field</th><th>Extracted value</th><th className="num">Confidence</th></tr></thead>
            <tbody>
              {fields.map(([k, f]) => (
                <tr key={k} className={f.confidence < LOW ? "low" : undefined}>
                  <th scope="row">{FIELD[k] ?? nice(k)}</th><td>{show(k, f.value)}</td>
                  <td className="num">{f.confidence < LOW ? <Badge kind="referred">{Math.round(f.confidence * 100)}%</Badge> : `${Math.round(f.confidence * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

const latest = <T,>(runs: AgentRun<T>[] | undefined) => (runs ?? []).reduce<AgentRun<T> | null>((a, r) => (!a || r.id > a.id ? r : a), null);
const recTone = (r: string) => (r === "PASS" ? "approved" : r === "FAIL" ? "rejected" : "referred");

function Advisory({ title, run, children, form }: { title: string; run: AgentRun<unknown> | null; children: ReactNode; form: ReactNode }) {
  return (
    <section className="advice" aria-label={title}>
      <header><p className="eyebrow">Advisory — the officer decides</p><h4>{title}</h4>{run && <small>{run.model} · {fdt(run.at)}</small>}</header>
      {run?.error && <p className="err banner">The last run failed: {run.error}</p>}
      {children}
      {form}
    </section>
  );
}

export function ComplianceAdvice({ invoiceId, runs }: { invoiceId: number; runs: AgentRun<ComplianceOutput>[] | undefined }) {
  const run = latest(runs);
  const o = run?.output;
  return (
    <Advisory title="Compliance agent" run={run}
      form={<form action={askComplianceAction}><input type="hidden" name="id" value={invoiceId} /><button className="btn ghost sm"><Icon n="spark" s={15} /><span>Ask compliance agent</span></button></form>}>
      {o ? (
        <>
          {o.eligible_goods !== undefined && <p>Goods eligible for the refund: <b>{o.eligible_goods ? "Yes" : "No"}</b></p>}
          {!!o.recommendations?.length && <ul className="advice-list">{o.recommendations.map((r, k) => <li key={k}><span className="mono">{r.rule_id}<RuleInfo id={r.rule_id} /></span><Badge kind={recTone(r.recommendation)}>{nice(r.recommendation)}</Badge><span>{r.reason}</span></li>)}</ul>}
          {o.notes && <p className="muted">{o.notes}</p>}
        </>
      ) : !run?.error && <p className="muted small">The agent has not reviewed this invoice yet. Its view is a second opinion; the rule checks and your decision stand.</p>}
    </Advisory>
  );
}

export function DecisionBrief({ appId, runs }: { appId: number; runs: AgentRun<BriefOutput>[] | undefined }) {
  const run = latest(runs);
  const o = run?.output;
  const list = (h: string, xs?: string[]) => !!xs?.length && <><h5>{h}</h5><ul className="fixlist">{xs.map((x) => <li key={x}>{x}</li>)}</ul></>;
  return (
    <Advisory title="Decision brief" run={run}
      form={<form action={decisionBriefAction}><input type="hidden" name="id" value={appId} /><button className="btn ghost sm"><Icon n="spark" s={15} /><span>Generate decision brief</span></button></form>}>
      {o ? (
        <>
          {o.recommended_decision && <p className="brief-rec"><Badge kind={o.recommended_decision === "REJECTED" ? "rejected" : "approved"}>{nice(o.recommended_decision)}</Badge>{o.recommended_amount !== undefined && <b>{money(o.recommended_amount)}</b>}</p>}
          {o.summary && <p>{o.summary}</p>}
          {list("Reasons", o.reasons)}
          {list("Risks", o.risks)}
          {list("Follow-up", o.follow_up)}
        </>
      ) : !run?.error && <p className="muted small">No brief yet. The reconciliation agent summarises every invoice into a recommended decision you can accept or overrule.</p>}
    </Advisory>
  );
}
