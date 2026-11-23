import { Link } from "react-router-dom";
import type { ApplicationRow, Overview as OverviewData } from "../../api/types.ts";
import { BarList, Meter, SegmentedBar, type Segment } from "../../components/charts.tsx";
import { Card, Chip, Empty, ErrorBanner, Loading, PageHeader, StatTile, TableWrap } from "../../components/ui.tsx";
import { aed, aedCompact, fmtDate, hours, num, pct, plural } from "../../lib/format.ts";
import { useRules } from "../../lib/rules.tsx";
import { APPLICATION_ORDER, RATING_ORDER, statusInfo } from "../../lib/status.ts";
import { useApi } from "../../lib/useApi.ts";

// The agent's rating per invoice, as one whole (validated colour order: good, warning, critical, info).
const RATING_PARTS = RATING_ORDER.map((r) => ({ key: r, ...statusInfo.rating(r) }));

export default function Overview() {
  const { data, error, loading } = useApi<OverviewData>("/fta/overview");
  const ready = useApi<ApplicationRow[]>("/fta/applications?status=READY_FOR_DECISION");
  const { rule } = useRules();

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;

  const parts: Segment[] = RATING_PARTS.map((p) => ({ key: p.key, label: p.label, tone: p.tone, value: data.invoices_by_rating[p.key] ?? 0 }));

  const responded = Math.round((data.supplier_response_rate ?? 0) * data.supplier_requests_total);
  const expired = data.supplier_requests_total - data.supplier_requests_pending - responded; // past the 5-business-day limit

  return (
    <>
      <PageHeader title="Overview" subtitle="New Residence VAT refund claims across all emirates. Amounts are approximate until an officer decides." />
      <ErrorBanner error={error} />

      <section className="hero-row" aria-label="Refund totals">
        <div className="hero">
          <span className="stat-label">Refunds requested</span>
          <span className="hero-value">{aedCompact(data.refund_requested_aed)}</span>
          <span className="stat-sub">
            {aed(data.refund_requested_aed)} across {plural(data.invoices_total, "invoice")} in {plural(data.applications_total, "application")}
          </span>
        </div>
        <div className="stat-row stat-row-3">
          <StatTile label="Verified (approx.)" tone="good" value={aedCompact(data.refund_verified_aed)} sub={`${pct(data.refund_requested_aed ? data.refund_verified_aed / data.refund_requested_aed : null)} of requested`} />
          <StatTile label="Approved by officers" value={aedCompact(data.refund_approved_aed)} sub={plural((data.applications_by_status.APPROVED ?? 0) + (data.applications_by_status.PARTIALLY_APPROVED ?? 0), "application")} />
          <StatTile label="Rejected, disputed or rated fail" tone="critical" value={aedCompact(data.rejected_refund_aed)} sub={`${plural(data.rejected_applications, "application")} rejected`} />
        </div>
      </section>

      <div className="stat-row">
        <StatTile label="New applications today" value={num(data.applications_new.today)} />
        <StatTile label="Last 7 days" value={num(data.applications_new.week)} />
        <StatTile label="Last 30 days" value={num(data.applications_new.month)} />
        <StatTile label="Ready for decision" tone="warning" value={num(data.applications_by_status.READY_FOR_DECISION ?? 0)} sub={<Link to="/fta/applications?status=READY_FOR_DECISION">Review queue →</Link>} />
      </div>

      <div className="grid-2">
        <Card title="Applications by status" subtitle="Pipeline order. Select a row to see those applications.">
          <BarList
            rows={APPLICATION_ORDER.filter((s) => s !== "RECEIVED" || data.applications_by_status[s]).map((s) => ({
              key: s,
              name: statusInfo.application(s).label,
              label: statusInfo.application(s).label,
              value: data.applications_by_status[s] ?? 0,
              to: `/fta/applications?status=${s}`,
            }))}
          />
        </Card>

        <Card
          title="Agent ratings"
          subtitle={`${plural(data.invoices_total, "invoice")}. A recommendation only: officers decide.`}
          actions={<Link to="/fta/rejections?rating=FAIL">Fails →</Link>}
        >
          <SegmentedBar parts={parts} unit="invoices" />
          <p className="muted small rating-note">
            {plural(data.officer_overrides, "officer decision")} went against the agent's rating. Those decisions become precedents for similar
            invoices.
          </p>
        </Card>

        <Card title="Most common rule failures" subtitle="Invoices failing each rule. Select a rule to see the rejections.">
          <BarList
            empty="No rule failures yet"
            rows={data.top_rule_failures.map(([id, count]) => ({
              key: id,
              name: `${id} ${rule(id)?.title ?? ""}`.trim(),
              label: (
                <>
                  <code className="rule-id">{id}</code> {rule(id)?.title ?? ""}
                </>
              ),
              value: count,
              to: `/fta/rejections?rule_id=${id}`,
            }))}
          />
        </Card>

        <Card title="Supplier responses" subtitle="Confirmation requests sent to suppliers through EmaraTax">
          <div className="meter-block">
            <div className="meter-head">
              <span className="meter-value">{pct(data.supplier_response_rate)}</span>
              <span className="muted">
                responded · {num(responded)} of {num(data.supplier_requests_total)}
                {expired > 0 ? ` · ${num(expired)} expired without an answer` : ""}
              </span>
            </div>
            <Meter value={data.supplier_response_rate} label="Supplier response rate" />
          </div>
          <div className="stat-row stat-row-2 inner">
            <StatTile label="Average time to respond" value={hours(data.avg_response_hours)} />
            <StatTile label="Still pending" tone="info" value={num(data.supplier_requests_pending)} />
          </div>
        </Card>
      </div>

      <Card title="Waiting for a decision" subtitle="Every invoice in these applications has an outcome." flush actions={<Link to="/fta/applications?status=READY_FOR_DECISION">All →</Link>}>
        {ready.data && ready.data.length === 0 ? (
          <Empty title="Nothing to decide">Applications appear here once every supplier has responded.</Empty>
        ) : !ready.data ? (
          <Loading />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Applicant</th>
                  <th>Emirate</th>
                  <th className="num">VAT claimed</th>
                  <th className="num">Eligible</th>
                  <th>Submitted</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ready.data.slice(0, 8).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link className="row-link" to={`/fta/applications/${a.id}`}>
                        {a.maskan_ref}
                      </Link>
                    </td>
                    <td>{a.applicant_name}</td>
                    <td>{a.emirate}</td>
                    <td className="num">{aed(a.vat_claimed)}</td>
                    <td className="num">{aed(a.vat_eligible)}</td>
                    <td>{fmtDate(a.submitted_at)}</td>
                    <td>
                      <Chip {...statusInfo.application(a.status)} />
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
