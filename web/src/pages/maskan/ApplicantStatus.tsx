import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { ApiError, get } from "../../api/client.ts";
import type { ApplicantStatus as Status } from "../../api/types.ts";
import { Card, Chip, Empty, ErrorBanner, Field, PageHeader, TableWrap } from "../../components/ui.tsx";
import { aed } from "../../lib/format.ts";
import { statusInfo } from "../../lib/status.ts";

/**
 * What the applicant sees in Maskan (GET /maskan/applications/{ref}/status): where each invoice
 * stands and what would fix it, with no supplier tax data and no internal rule evidence.
 * The Emirates ID travels only in a header and in memory, never in the URL.
 */
export default function ApplicantStatus() {
  const passed = (useLocation().state ?? {}) as { ref?: string; emiratesId?: string };
  const [ref, setRef] = useState(passed.ref ?? "");
  const [eid, setEid] = useState(passed.emiratesId ?? "");
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(r = ref, e = eid) {
    if (!r.trim() || !e.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setData(await get<Status>(`/maskan/applications/${encodeURIComponent(r.trim())}/status`, { "X-Emirates-Id": e.trim() }));
    } catch (err) {
      setData(null);
      setError(err instanceof ApiError && err.status === 404 ? new Error("No application matches that reference and Emirates ID.") : (err as Error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (passed.ref && passed.emiratesId) load(passed.ref, passed.emiratesId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        title="Applicant status"
        subtitle="The view Maskan shows the applicant: where each invoice stands and what they can do about it. Suppliers' tax declarations and rule evidence are never shown here."
      />
      <Card>
        <form
          className="form-grid"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            load();
          }}
        >
          <Field label="Maskan reference" htmlFor="st-ref">
            <input id="st-ref" required value={ref} onChange={(e) => setRef(e.target.value)} placeholder="MSK-2026-0002" />
          </Field>
          <Field label="Emirates ID" htmlFor="st-eid" hint="Seed applicants: 784-1985-1234567-1, 784-1990-7654321-2, 784-1979-1112223-3">
            <input id="st-eid" required value={eid} onChange={(e) => setEid(e.target.value)} autoComplete="off" />
          </Field>
          <div className="form-actions span-all">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Looking up…" : "Show status"}
            </button>
          </div>
        </form>
      </Card>
      <ErrorBanner error={error} />
      {data && (
        <Card title={data.maskan_ref} actions={<Chip {...statusInfo.application(data.status)} />} flush>
          {data.invoices.length === 0 ? (
            <Empty title="No invoices" />
          ) : (
            <TableWrap>
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th className="num">VAT</th>
                    <th>Where it stands</th>
                    <th>What you can do</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((i) => (
                    <tr key={`${i.supplier_trn}-${i.invoice_no}`}>
                      <td>
                        {i.invoice_no}
                        <div className="cell-sub">Supplier TRN {i.supplier_trn}</div>
                      </td>
                      <td className="num">{aed(i.vat_amount)}</td>
                      <td>
                        {i.status}
                        {i.decided_by_officer && <div className="cell-sub">Decided by an FTA officer</div>}
                      </td>
                      <td>
                        {i.what_you_can_do.length ? (
                          <ul className="reasons">
                            {i.what_you_can_do.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="muted">Nothing needed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}
    </>
  );
}
