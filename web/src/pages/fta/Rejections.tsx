import { Link } from "react-router-dom";
import { query } from "../../api/client.ts";
import type { InvoiceStatus, RejectionRow, SupplierStats } from "../../api/types.ts";
import { BarList } from "../../components/charts.tsx";
import { FilterBar, useFilters } from "../../components/Filters.tsx";
import { Card, Chip, Empty, ErrorBanner, Loading, PageHeader, RuleChip, StatTile, TableWrap } from "../../components/ui.tsx";
import { aed, aedCompact, fmtDate, num } from "../../lib/format.ts";
import { useRules } from "../../lib/rules.tsx";
import { EMIRATES, statusInfo } from "../../lib/status.ts";
import { useApi } from "../../lib/useApi.ts";

const KEYS = ["rating", "rule_id", "status", "emirate", "supplier_trn"] as const;
const STATUSES: InvoiceStatus[] = ["FLAGGED", "NO_SUPPLIER_RESPONSE", "DISPUTED", "REJECTED"];

export default function Rejections() {
  const { values: f, set, clear, active } = useFilters(KEYS);
  const { data, error, loading } = useApi<RejectionRow[]>(`/fta/rejections${query(f)}`);
  const suppliers = useApi<SupplierStats[]>("/fta/suppliers");
  const { ids, rule } = useRules();
  const rows = data ?? [];

  const bySupplier = new Map<string, { name: string; value: number }>();
  for (const r of rows) {
    const cur = bySupplier.get(r.invoice.supplier_trn) ?? { name: r.supplier_name, value: 0 };
    cur.value += r.invoice.vat_amount;
    bySupplier.set(r.invoice.supplier_trn, cur);
  }
  const total = rows.reduce((s, r) => s + r.invoice.vat_amount, 0);

  return (
    <>
      <PageHeader
        title="Rejections and flags"
        subtitle="Invoices that need an officer: flagged by the agent, without a supplier response, disputed by the supplier, or rejected by an officer."
      />
      <ErrorBanner error={error} />
      <FilterBar onClear={clear} active={active}>
        <select aria-label="Rating" value={f.rating} onChange={(e) => set({ rating: e.target.value })}>
          <option value="">Any rating</option>
          {(["FAIL", "WEAK", "STRONG"] as const).map((r) => (
            <option key={r} value={r}>
              Rated {statusInfo.rating(r).label.toLowerCase()}
            </option>
          ))}
        </select>
        <select aria-label="Rule" value={f.rule_id} onChange={(e) => set({ rule_id: e.target.value })}>
          <option value="">Any rule</option>
          {ids.map((id) => (
            <option key={id} value={id}>
              {id} · {rule(id)?.title}
            </option>
          ))}
        </select>
        <select aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusInfo.invoice(s).label}
            </option>
          ))}
        </select>
        <select aria-label="Supplier" value={f.supplier_trn} onChange={(e) => set({ supplier_trn: e.target.value })}>
          <option value="">All suppliers</option>
          {(suppliers.data ?? []).map((s) => (
            <option key={s.trn} value={s.trn}>
              {s.legal_name}
            </option>
          ))}
        </select>
        <select aria-label="Emirate" value={f.emirate} onChange={(e) => set({ emirate: e.target.value })}>
          <option value="">All emirates</option>
          {EMIRATES.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
      </FilterBar>

      <div className="grid-2 grid-2-wide">
        <div className="stat-row stat-row-stack">
          <StatTile label="Invoices" value={num(rows.length)} tone="critical" />
          <StatTile label="VAT at stake" value={aedCompact(total)} sub={aed(total)} />
          <StatTile label="Awaiting an officer" tone="warning" value={num(rows.filter((r) => !r.invoice.officer_decision && r.invoice.status !== "DISPUTED").length)} sub="Flagged or no response, not yet decided" />
        </div>
        <Card title="VAT at stake by supplier">
          <BarList
            format={aed}
            empty="No rejected invoices"
            rows={[...bySupplier.entries()]
              .sort((a, b) => b[1].value - a[1].value)
              .slice(0, 6)
              .map(([trn, v]) => ({ key: trn, name: v.name, label: v.name, value: v.value, to: `/fta/suppliers/${trn}` }))}
          />
        </Card>
      </div>

      <Card flush>
        {loading && !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="Nothing here">{active ? "No invoices match these filters." : "No invoice has been rejected, disputed or flagged."}</Empty>
        ) : (
          <TableWrap busy={loading}>
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Supplier</th>
                  <th>Application</th>
                  <th className="num">VAT</th>
                  <th>Findings</th>
                  <th>Rating</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.invoice.id}>
                    <td>
                      {r.invoice.invoice_no}
                      <div className="cell-sub">{fmtDate(r.invoice.invoice_date)}</div>
                    </td>
                    <td>
                      <Link className="row-link" to={`/fta/suppliers/${r.invoice.supplier_trn}`}>
                        {r.supplier_name}
                      </Link>
                    </td>
                    <td>
                      <Link className="row-link" to={`/fta/applications/${r.invoice.application_id}`}>
                        {r.maskan_ref}
                      </Link>
                      <div className="cell-sub">
                        {r.applicant_name} · {r.emirate}
                      </div>
                    </td>
                    <td className="num">{aed(r.invoice.vat_amount)}</td>
                    <td>
                      <ul className="reason-list">
                        {r.failed_rules.map((id) => (
                          <li key={id}>
                            <RuleChip id={id} /> {rule(id)?.title}
                          </li>
                        ))}
                        {r.invoice.status === "NO_SUPPLIER_RESPONSE" && <li className="muted">Supplier did not respond within 5 business days</li>}
                      </ul>
                    </td>
                    <td>
                      <Chip {...statusInfo.rating(r.invoice.rating)} />
                    </td>
                    <td>
                      {r.invoice.officer_decision ? <Chip {...statusInfo.invoiceDecision(r.invoice.officer_decision)} /> : <Chip {...statusInfo.invoice(r.invoice.status)} />}
                    </td>
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
