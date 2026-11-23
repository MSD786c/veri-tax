import { useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { post } from "../../api/client.ts";
import type { RequestView } from "../../api/types.ts";
import { Banner, Card, Chip, Empty, ErrorBanner, Field, Loading, PageHeader, TableWrap } from "../../components/ui.tsx";
import { buildTemplate, parseBulkCsv, type ParseResult } from "../../lib/bulkCsv.ts";
import { useDeclarant } from "../../lib/declarant.ts";
import { statusInfo } from "../../lib/status.ts";
import { useApi } from "../../lib/useApi.ts";

function saveText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BulkUpload() {
  const { data, error, loading, reload } = useApi<RequestView[]>("/supplier/requests?status=PENDING");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [declaredBy, setDeclaredBy] = useDeclarant();
  const [declaration, setDeclaration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const [saved, setSaved] = useState<RequestView[] | null>(null);

  const pending = data ?? [];
  const pendingIds = new Set(pending.map((p) => p.request.id));
  const byId = new Map(pending.map((p) => [p.request.id, p]));

  function downloadTemplate() {
    saveText(
      buildTemplate(
        pending.map((p) => ({
          request_id: p.request.id,
          invoice_no: p.invoice.invoice_no,
          invoice_date: p.invoice.invoice_date,
          applicant: p.application.applicant_name,
          total: p.invoice.total,
        })),
      ),
      "veri-tax-confirmations.csv",
    );
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSaved(null);
    setSubmitError(null);
    setFileName(file.name);
    setParsed(parseBulkCsv(await file.text(), pendingIds));
  }

  const rows = parsed?.rows ?? [];
  const answered = rows.filter((r) => !r.skipped);
  const bad = answered.filter((r) => r.errors.length);
  const good = answered.filter((r) => r.answer);
  const canSubmit = !parsed?.fileError && good.length > 0 && bad.length === 0 && declaration && declaredBy.trim() !== "";

  async function submit() {
    setBusy(true);
    setSubmitError(null);
    try {
      const items = good.map((r) => ({ ...r.answer!, declared_by: declaredBy.trim(), declaration }));
      setSaved(await post<RequestView[]>("/supplier/requests/bulk-respond", { items }));
      setParsed(null);
      setFileName(null);
      setDeclaration(false);
      reload();
    } catch (err) {
      setSubmitError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        back={{ to: "/supplier", label: "All confirmations" }}
        title="Respond by CSV"
        subtitle="For contractors with many invoices: download your pending requests, fill in the answers, and upload the file. Every row is checked before anything is saved, and the upload is saved in full or not at all."
      />
      <ErrorBanner error={error} />
      {saved && (
        <Banner tone="good" title={`${saved.length} response${saved.length === 1 ? "" : "s"} saved`}>
          {saved.filter((v) => v.invoice.status === "VERIFIED").length} verified,{" "}
          {saved.filter((v) => v.invoice.status !== "VERIFIED").length} sent to the FTA for review. <Link to="/supplier">Back to confirmations</Link>
        </Banner>
      )}

      <div className="split">
        <Card title="1. Download the template" subtitle={loading && !data ? undefined : `${pending.length} pending request${pending.length === 1 ? "" : "s"} included.`}>
          {loading && !data ? (
            <Loading />
          ) : (
            <>
              <button className="btn btn-secondary" onClick={downloadTemplate} disabled={!pending.length}>
                Download CSV template
              </button>
              <table className="table compact legend-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>What to enter</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td><code>issued</code></td><td><code>yes</code> or <code>no</code>. Leave blank to skip the row.</td></tr>
                  <tr><td><code>particulars_match</code></td><td><code>yes</code>. If anything differs, answer that invoice on its own page.</td></tr>
                  <tr><td><code>consideration</code></td><td><code>received</code> or <code>retention</code></td></tr>
                  <tr><td><code>amount_received</code></td><td>Optional for <code>received</code>; amount paid so far for <code>retention</code></td></tr>
                  <tr><td><code>received_date</code></td><td><code>YYYY-MM-DD</code>, required for <code>received</code></td></tr>
                  <tr><td><code>retention_amount</code>, <code>retention_release_date</code></td><td>Required for <code>retention</code></td></tr>
                  <tr><td><code>vat_return_period</code></td><td><code>2026-Q2</code> (quarterly) or <code>Apr-2026</code> (monthly)</td></tr>
                </tbody>
              </table>
            </>
          )}
        </Card>

        <Card title="2. Upload your answers">
          <label className="dropzone">
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
            <strong>{fileName ?? "Choose a CSV file"}</strong>
            <span>{fileName ? "Choose another file to replace it" : "The file stays in your browser until you submit"}</span>
          </label>
          {parsed?.fileError && <Banner tone="critical" title="This file can't be used">{parsed.fileError}</Banner>}
          {parsed && !parsed.fileError && (
            <p className="summary-line">
              <Chip tone="good" label={`${good.length} ready`} />
              {bad.length > 0 && <Chip tone="critical" label={`${bad.length} with problems`} />}
              {rows.length - answered.length > 0 && <Chip tone="neutral" label={`${rows.length - answered.length} left blank`} />}
            </p>
          )}
        </Card>
      </div>

      {parsed && !parsed.fileError && (
        <Card title="3. Check and submit" flush>
          {answered.length === 0 ? (
            <Empty title="No answers in this file">Fill in the issued column for the invoices you want to answer.</Empty>
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Invoice</th>
                    <th>Answer</th>
                    <th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {answered.map((r) => {
                    const view = r.requestId !== null ? byId.get(r.requestId) : undefined;
                    const a = r.answer;
                    return (
                      <tr key={r.line} className={r.errors.length ? "row-error" : ""}>
                        <td className="num">{r.line}</td>
                        <td>
                          {view?.invoice.invoice_no ?? r.invoiceNo ?? "—"}
                          <div className="cell-sub">Request {r.requestId ?? "?"}</div>
                        </td>
                        <td>
                          {a
                            ? a.issued
                              ? `${a.consideration_status === "RECEIVED" ? "Received" : "Retention"} · ${a.vat_return_period}`
                              : "Not issued by us"
                            : "—"}
                        </td>
                        <td>
                          {r.errors.length ? (
                            <ul className="error-list">
                              {r.errors.map((e) => (
                                <li key={e}>{e}</li>
                              ))}
                            </ul>
                          ) : (
                            <Chip {...statusInfo.rule("PASS")} label="Ready" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <div className="card-body">
            <ErrorBanner error={submitError} />
            {bad.length > 0 && <Banner tone="warning" title="Fix the rows marked above and upload the file again">Nothing is saved while any row has a problem.</Banner>}
            <Field label="Declared by (EmaraTax user)" htmlFor="csv-declarant">
              <input id="csv-declarant" placeholder="Name or email" value={declaredBy} onChange={(e) => setDeclaredBy(e.target.value)} />
            </Field>
            <label className="check declaration">
              <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} />
              <span>I declare that the {good.length === 1 ? "answer" : `${good.length} answers`} in this file {good.length === 1 ? "is" : "are"} correct and complete, and shared with the Federal Tax Authority.</span>
            </label>
            <div className="form-actions">
              <button className="btn btn-primary" disabled={!canSubmit || busy} onClick={submit}>
                {busy ? "Submitting…" : `Submit ${good.length} response${good.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
