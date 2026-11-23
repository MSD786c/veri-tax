import { Link } from "react-router-dom";
import { query } from "../../api/client.ts";
import type { SupplierStats } from "../../api/types.ts";
import { FilterBar, SearchInput, useFilters } from "../../components/Filters.tsx";
import { Card, Chip, Empty, ErrorBanner, Loading, PageHeader, TableWrap } from "../../components/ui.tsx";
import { aed, num, pct } from "../../lib/format.ts";
import { EMIRATES } from "../../lib/status.ts";
import { useApi } from "../../lib/useApi.ts";

const KEYS = ["q", "emirate", "sort"] as const;
const SORTS: Record<string, [string, (a: SupplierStats, b: SupplierStats) => number]> = {
  claimed: ["Most VAT claimed", (a, b) => b.vat_claimed - a.vat_claimed],
  rejected: ["Most VAT rejected", (a, b) => b.vat_rejected - a.vat_rejected],
  response: ["Lowest response rate", (a, b) => (a.response_rate ?? 2) - (b.response_rate ?? 2)],
  name: ["Name", (a, b) => a.legal_name.localeCompare(b.legal_name)],
};

export function needsAttention(s: SupplierStats): boolean {
  return s.risk_flag || s.vat_rejected > 0 || (s.response_rate !== null && s.response_rate < 0.5);
}

export default function Suppliers() {
  const { values: f, set, clear, active } = useFilters(KEYS);
  const { data, error, loading } = useApi<SupplierStats[]>(`/fta/suppliers${query({ q: f.q, emirate: f.emirate })}`);
  const sort = SORTS[f.sort] ?? SORTS.claimed;
  const rows = [...(data ?? [])].sort(sort[1]);

  return (
    <>
      <PageHeader title="Suppliers" subtitle="Vendors whose tax invoices appear in refund applications, with what each one's invoices add up to." />
      <ErrorBanner error={error} />
      <FilterBar onClear={clear} active={active}>
        <SearchInput placeholder="Name or TRN" label="Search suppliers" value={f.q} onChange={(q) => set({ q })} />
        <select aria-label="Emirate" value={f.emirate} onChange={(e) => set({ emirate: e.target.value })}>
          <option value="">All emirates</option>
          {EMIRATES.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
        <select aria-label="Sort" value={f.sort || "claimed"} onChange={(e) => set({ sort: e.target.value === "claimed" ? "" : e.target.value })}>
          {Object.entries(SORTS).map(([k, [label]]) => (
            <option key={k} value={k}>
              Sort: {label}
            </option>
          ))}
        </select>
      </FilterBar>
      <Card flush>
        {loading && !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="No suppliers match">Try another name, TRN or emirate.</Empty>
        ) : (
          <TableWrap busy={loading}>
            <table className="table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Emirate</th>
                  <th className="num">Applications</th>
                  <th className="num">Invoices</th>
                  <th className="num">VAT claimed</th>
                  <th className="num">Verified</th>
                  <th className="num">Rejected</th>
                  <th className="num">Response rate</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.trn}>
                    <td>
                      <Link className="row-link" to={`/fta/suppliers/${s.trn}`}>
                        {s.legal_name}
                      </Link>
                      <div className="cell-sub">TRN {s.trn}</div>
                    </td>
                    <td>{s.emirate || "—"}</td>
                    <td className="num">{num(s.application_count)}</td>
                    <td className="num">{num(s.invoice_count)}</td>
                    <td className="num">{aed(s.vat_claimed)}</td>
                    <td className="num">{aed(s.vat_verified)}</td>
                    <td className="num">{s.vat_rejected ? aed(s.vat_rejected) : "—"}</td>
                    <td className="num">{pct(s.response_rate)}</td>
                    <td>{needsAttention(s) ? <Chip tone="warning" label={s.risk_flag ? "Flagged" : "Review"} hint="Rejected VAT, a low response rate or a risk flag" /> : <Chip tone="neutral" label="None" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
