// Original documents and the advisory agents (app/documents.py, app/agents.py). Agents recommend;
// officers decide. When no agent is configured the API answers 503 and these panels say so plainly.
import { useState } from "react";
import { ApiError, openFile, post } from "../../api/client.ts";
import type { AgentRun, InvoiceDetail } from "../../api/types.ts";
import { Banner, Card, Chip, TableWrap } from "../../components/ui.tsx";
import { aed, fmtDateTime, humanize } from "../../lib/format.ts";
import { statusInfo } from "../../lib/status.ts";

const NO_AGENT = "No agent is configured on this server. Set AGENT_PROVIDER=groq and GROQ_API_KEY to enable it.";

function latest(runs: AgentRun[], kind: string): AgentRun | undefined {
  return [...runs].filter((r) => r.kind === kind).sort((a, b) => b.id - a.id)[0];
}

function useAgentCall(path: string, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(path, {});
      onDone();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 503 ? NO_AGENT : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error };
}

function fieldValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** The original invoice file, if one is linked, and what the vision model read from it. */
export function OriginalDocument({ detail }: { detail: InvoiceDetail }) {
  const { document: doc, extraction } = detail;
  const [error, setError] = useState<string | null>(null);
  if (!doc)
    return (
      <p className="muted small">
        No original document linked yet. Originals arrive through the Maskan portal (its link is printed when the server starts) or{" "}
        <code>POST /maskan/invoices/{"{id}"}/document</code>; <code>EX-01</code> then compares them with the Maskan data.
      </p>
    );
  const fields = Object.entries(extraction?.fields ?? {}).filter(([, f]) => f && f.value !== null && f.value !== "");
  return (
    <div className="doc-block">
      <div className="doc-head">
        <strong>{doc.filename}</strong>
        <Chip tone={doc.status === "EXTRACTED" ? "good" : doc.status === "FAILED" ? "critical" : "info"} label={humanize(doc.status)} hint={doc.error ?? undefined} />
        <span className="muted small">
          {Math.round(doc.size / 1024)} KB · {humanize(doc.source)} · {fmtDateTime(doc.uploaded_at)}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => openFile(`/fta/documents/${doc.id}/file`).catch((e) => setError((e as Error).message))}
        >
          Open original
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {extraction && (
        <details className="extraction" open>
          <summary>
            What the model read ({humanize(extraction.document_type)}, {fields.length} fields)
          </summary>
          <TableWrap>
            <table className="table compact">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                  <th className="num">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(([k, f]) => (
                  <tr key={k}>
                    <td>{humanize(k)}</td>
                    <td>{fieldValue(f!.value)}</td>
                    <td className="num" style={f!.confidence !== undefined && f!.confidence < 0.7 ? { background: "var(--warning-wash)", fontWeight: 600 } : undefined}>{f!.confidence !== undefined ? `${Math.round(f!.confidence * 100)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </details>
      )}
    </div>
  );
}

/** The compliance agent's second opinion on one invoice. */
export function ComplianceReview({ detail, onRan }: { detail: InvoiceDetail; onRan: () => void }) {
  const run = latest(detail.agent_runs, "compliance");
  const call = useAgentCall(`/fta/invoices/${detail.invoice.id}/compliance`, onRan);
  const recs = run?.output.recommendations ?? [];
  return (
    <div className="agent-block">
      <div className="agent-head">
        <h3>Compliance agent <span className="muted small">Advisory — the officer decides</span></h3>
        <span className="muted small">{run ? `${run.model} · ${fmtDateTime(run.at)}` : "No second opinion yet"}</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={call.busy} onClick={call.run}>
          {call.busy ? "Asking…" : run ? "Ask again" : "Ask for a second opinion"}
        </button>
      </div>
      {call.error && <p className="warn-text">{call.error}</p>}
      {run?.error && <p className="error-text">The last run failed: {run.error}</p>}
      {recs.length > 0 && (
        <ul className="reasons">
          {recs.map((r) => (
            <li key={r.rule_id}>
              <code>{r.rule_id}</code>{" "}
              <Chip {...statusInfo.rule((["PASS", "FAIL", "UNCERTAIN"].includes(r.recommendation) ? r.recommendation : "NOT_APPLICABLE") as "PASS")} /> {r.reason}
            </li>
          ))}
        </ul>
      )}
      {run?.output.notes && <p className="small">{run.output.notes}</p>}
    </div>
  );
}

/** The reconciliation agent's decision brief for the whole application. */
export function DecisionBrief({ appId, runs, onRan }: { appId: number; runs: AgentRun[]; onRan: () => void }) {
  const run = latest(runs, "reconciliation");
  const call = useAgentCall(`/fta/applications/${appId}/summary`, onRan);
  const o = run?.output;
  const list = (title: string, items?: string[]) =>
    items && items.length > 0 ? (
      <>
        <h3>{title}</h3>
        <ul className="reasons">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </>
    ) : null;
  return (
    <Card
      title="Decision brief"
      subtitle={run ? `Reconciliation agent · ${run.model} · ${fmtDateTime(run.at)}. Advisory — the officer decides.` : "Advisory — the officer decides."}
      actions={
        <button type="button" className="btn btn-ghost btn-sm" disabled={call.busy} onClick={call.run}>
          {call.busy ? "Writing…" : run ? "Regenerate" : "Generate brief"}
        </button>
      }
    >
      {call.error && <Banner tone="neutral">{call.error}</Banner>}
      {run?.error && <p className="error-text">The last run failed: {run.error}</p>}
      {o && !run?.error ? (
        <>
          {o.recommended_decision && (
            <p>
              Recommends{" "}
              <Chip {...statusInfo.decision(o.recommended_decision as "APPROVED")} />{" "}
              {o.recommended_amount !== undefined && <strong>{aed(o.recommended_amount)}</strong>}
            </p>
          )}
          {o.summary && <p>{o.summary}</p>}
          {list("Reasons", o.reasons)}
          {list("Risks", o.risks)}
          {list("Follow up", o.follow_up)}
        </>
      ) : (
        !call.error && !run && <p className="muted small">No brief yet.</p>
      )}
    </Card>
  );
}
