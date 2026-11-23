import { useState } from "react";
import { Link } from "react-router-dom";
import { download, query } from "../../api/client.ts";
import type { ApplicationRow } from "../../api/types.ts";
import { DateRange, FilterBar, SearchInput, useFilters } from "../../components/Filters.tsx";
import { Card, Chip, Empty, ErrorBanner, Loading, PageHeader, RuleChip, TableWrap } from "../../components/ui.tsx";
import { aed, fmtDate, num } from "../../lib/format.ts";
import { useRules } from "../../lib/rules.tsx";
import { APPLICATION_ORDER, EMIRATES, statusInfo } from "../../lib/status.ts";
import { useApi } from "../../lib/useApi.ts";

const KEYS = ["q", "status", "emirate", "rule_failed", "submitted_from", "submitted_to", "min_vat", "max_vat"] as const;
const BANDS = [
  ["", "", "Any VAT amount"],
  ["", "10000", "VAT under AED 10K"],
  ["10000", "50000", "VAT AED 10K–50K"],
  ["50000", "", "VAT over AED 50K"],
] as const;

export default function Applications() {
  const { values: f, set, clear, active } = useFilters(KEYS);
  const qs = query(f);
  const { data, error, loading } = useApi<ApplicationRow[]>(`/fta/applications${qs}`);
  const { ids, rule } = useRules();
  const [exportError, setExportError] = useState<Error | null>(null);
  const band = BANDS.findIndex(([min, max]) => min === f.min_vat && max === f.max_vat);

  const rows = data ?? [];
  const totals = rows.reduce((t, r) => ({ claimed: t.claimed + r.vat_claimed, eligible: t.eligible + r.vat_eligible }), { claimed: 0, eligible: 0 });

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle="Refund applications received from Maskan, with the verification result of their invoices."
        actions={
          <button
            className="btn btn-secondary"
            onClick={() => download(`/fta/export/applications.csv${qs}`, "applications.csv").catch((e) => setExportError(e))}
          >
            Export CSV
          </button>
        }
      />
      <ErrorBanner error={error ?? exportError} />
      <FilterBar onClear={clear} active={active}>
        <DateRange from={f.submitted_from} to={f.submitted_to} onChange={(from, to) => set({ submitted_from: from, submitted_to: to })} />
        <SearchInput placeholder="Applicant, Maskan ref or plot" label="Search applications" value={f.q} onChange={(q) => set({ q })} />
        <select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">All statuses</option>
          {APPLICATION_ORDER.map((s) => (
            <option key={s} value={s}>
              {statusInfo.application(s).label}
            </option>
          ))}
        </select>
        <select aria-label="Emirate" value={f.emirate} onChange={(e) => set({ emirate: e.target.value })}>
          <option value="">All emirates</option>
          {EMIRATES.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
        <select aria-label="Rule failure" value={f.rule_failed} onChange={(e) => set({ rule_failed: e.target.value })}>
          <option value="">Any rule result</option>
          {ids.map((id) => (
            <option key={id} value={id}>
              Fails {id} · {rule(id)?.title}
            </option>
          ))}
        </select>
        <select
          aria-label="VAT amount"
          value={band === -1 ? 0 : band}
          onChange={(e) => {
            const [min, max] = BANDS[Number(e.target.value)];
            set({ min_vat: min, max_vat: max });
          }}
        >
          {BANDS.map(([, , label], i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </select>
      </FilterBar>

      <Card flush>
        {loading && !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="No applications match">{active ? "Try removing a filter." : "Applications appear here when Maskan submits them."}</Empty>
        ) : (
          <TableWrap busy={loading}>
            <table className="table">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Applicant</th>
                  <th>Emirate · plot</th>
                  <th>Submitted</th>
                  <th className="num">Invoices</th>
                  <th className="num">VAT claimed</th>
                  <th className="num">VAT eligible</th>
                  <th>Issues</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link className="row-link" to={`/fta/applications/${a.id}`}>
                        {a.maskan_ref}
                      </Link>
                      <div className="cell-sub">{a.claim_type === "NEW_RESIDENCE" ? "New residence" : a.claim_type.toLowerCase()}</div>
                    </td>
                    <td>{a.applicant_name}</td>
                    <td>
                      {a.emirate}
                      <div className="cell-sub">{a.plot_no}</div>
                    </td>
                    <td>{fmtDate(a.submitted_at)}</td>
                    <td className="num">{num(a.invoice_count)}</td>
                    <td className="num">{aed(a.vat_claimed)}</td>
                    <td className="num">{aed(a.vat_eligible)}</td>
                    <td>
                      <div className="chip-list">
                        {a.failed_rules.length ? a.failed_rules.map((r) => <RuleChip key={r} id={r} />) : <span className="muted">None</span>}
                      </div>
                    </td>
                    <td>
                      <Chip {...statusInfo.application(a.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>
                    {num(rows.length)} application{rows.length === 1 ? "" : "s"}
                  </td>
                  <td className="num">{aed(totals.claimed)}</td>
                  <td className="num">{aed(totals.eligible)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
