import { useState } from "react";
import { Link } from "react-router-dom";
import { openFile } from "../../api/client.ts";
import type { ApplicationRow, Extraction, InvoiceDocument } from "../../api/types.ts";
import { Chip, Empty, ErrorBanner, Loading, PageHeader, TableWrap } from "../../components/ui.tsx";
import { aed, fmtDateTime, humanize } from "../../lib/format.ts";
import { useApi } from "../../lib/useApi.ts";

interface DocRow {
  document: InvoiceDocument;
  extraction: Extraction | null;
  linked_invoices: { invoice_id: number; invoice_no: string; status: string; maskan_ref: string; application_id?: number }[];
}

function OpenButton({ doc }: { doc: InvoiceDocument }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openFile(`/fta/documents/${doc.id}/file`).catch((e) => setErr((e as Error).message))}>
        Open original
      </button>
      {err && <p className="error-text">{err}</p>}
    </>
  );
}

export default function Documents() {
  const { data, loading, error } = useApi<DocRow[]>("/fta/documents");
  const { data: apps } = useApi<ApplicationRow[]>("/fta/applications");
  const appId = new Map(apps?.map((a) => [a.maskan_ref, a.id]));
  const val = (r: DocRow, k: string) => r.extraction?.fields?.[k]?.value;
  return (
    <>
      <PageHeader title="Documents" subtitle="Original invoice files and what the vision model read from them." />
      <ErrorBanner error={error} />
      {loading && !data && <Loading />}
      {data && data.length === 0 && <Empty title="No documents yet" />}
      {data && data.length > 0 && (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Source</th>
                <th>Status</th>
                <th>Type</th>
                <th>Invoice no</th>
                <th>Supplier</th>
                <th className="num">Total</th>
                <th>Linked invoices</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const total = val(r, "total");
                return (
                  <tr key={r.document.id}>
                    <td>
                      {r.document.filename}
                      <div className="muted small">{fmtDateTime(r.document.uploaded_at)}</div>
                    </td>
                    <td>{humanize(r.document.source)}</td>
                    <td>
                      <Chip tone={r.document.status === "EXTRACTED" ? "good" : r.document.status === "FAILED" ? "critical" : "info"} label={humanize(r.document.status)} hint={r.document.error ?? undefined} />
                    </td>
                    <td>{r.extraction ? humanize(r.extraction.document_type) : "—"}</td>
                    <td>{String(val(r, "invoice_no") ?? "—")}</td>
                    <td>{String(val(r, "supplier_name") ?? "—")}</td>
                    <td className="num">{typeof total === "number" ? aed(total) : "—"}</td>
                    <td>
                      {r.linked_invoices.length === 0
                        ? <span className="muted">Not linked</span>
                        : r.linked_invoices.map((l) => {
                            const id = l.application_id ?? appId.get(l.maskan_ref);
                            const label = `${l.invoice_no} · ${l.maskan_ref}`;
                            return <div key={l.invoice_id}>{id ? <Link to={`/fta/applications/${id}`}>{label}</Link> : label} <span className="muted small">{humanize(l.status)}</span></div>;
                          })}
                    </td>
                    <td><OpenButton doc={r.document} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
