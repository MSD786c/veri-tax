import { Link, useParams } from "react-router-dom";
import type { SupplierDetail as Detail } from "../../api/types.ts";
import { Card, Chip, Empty, ErrorBanner, KeyValues, Loading, PageHeader, RuleChip, StatTile, TableWrap } from "../../components/ui.tsx";
import { aed, fmtDate, num, pct } from "../../lib/format.ts";
import { statusInfo } from "../../lib/status.ts";
import { useApi } from "../../lib/useApi.ts";
import { needsAttention } from "./Suppliers.tsx";

export default function SupplierDetail() {
  const { trn } = useParams();
  const { data: s, error, loading } = useApi<Detail>(`/fta/suppliers/${trn}`);
  if (loading && !s) return <Loading />;
  if (!s) return <ErrorBanner error={error} />;

  const problems = s.invoices.filter((i) => ["AUTO_REJECTED", "REJECTED", "DISPUTED", "FLAGGED"].includes(i.status));

  return (
    <>
      <PageHeader
        back={{ to: "/fta/suppliers", label: "Suppliers" }}
        title={s.legal_name}
        subtitle={`TRN ${s.trn}${s.emirate ? ` · ${s.emirate}` : ""}`}
        actions={needsAttention(s) ? <Chip tone="warning" label="Needs review" /> : undefined}
      >
        <KeyValues
          items={[
            ["Address", s.address || "—"],
            ["EmaraTax account", s.emaratax_account_id ?? "—"],
            ["Declared VAT periods", s.declared_vat_periods.length ? s.declared_vat_periods.join(", ") : "—"],
            ["Response rate", pct(s.response_rate)],
          ]}
        />
      </PageHeader>

      <div className="stat-row">
        <StatTile label="Applications" value={num(s.application_count)} sub={`${num(s.invoice_count)} invoices`} />
        <StatTile label="VAT claimed on its invoices" value={aed(s.vat_claimed)} />
        <StatTile label="Approx. refunds verified" tone="good" value={aed(s.vat_verified)} />
        <StatTile label="Rejected or disputed" tone={s.vat_rejected ? "critical" : undefined} value={aed(s.vat_rejected)} sub={`${problems.length} invoices need attention`} />
        <StatTile label="Retention outstanding" value={aed(s.retention_outstanding)} />
      </div>

      <Card title="Invoices" subtitle="Every invoice under this TRN, across all applications." flush>
        {s.invoices.length === 0 ? (
          <Empty title="No invoices" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Application</th>
                  <th className="num">VAT</th>
                  <th className="num">Eligible</th>
                  <th>VAT period</th>
                  <th>Failed rules</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {s.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.invoice_no}
                      <div className="cell-sub">{fmtDate(i.invoice_date)}</div>
                    </td>
                    <td>
                      <Link className="row-link" to={`/fta/applications/${i.application_id}`}>
                        {i.maskan_ref}
                      </Link>
                      <div className="cell-sub">{statusInfo.application(i.application_status).label}</div>
                    </td>
                    <td className="num">{aed(i.vat_amount)}</td>
                    <td className="num">{aed(i.eligible_vat_amount)}</td>
                    <td>{i.vat_return_period ?? "—"}</td>
                    <td>
                      <div className="chip-list">
                        {i.failed_rules.length ? i.failed_rules.map((r) => <RuleChip key={r} id={r} />) : <span className="muted">None</span>}
                      </div>
                    </td>
                    <td>
                      <Chip {...statusInfo.invoice(i.status)} />
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
