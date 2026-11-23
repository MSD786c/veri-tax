import { AnalyticsFilters, ClaimsChart, Kpis, RatingsChart, ReportCharts } from "@/components/Analytics";
import Shell from "@/components/Shell";
import { guard } from "@/components/states";
import { Icon, PageHead } from "@/components/ui";
import { getAnalytics } from "@/lib/data";
import { flat, type Params } from "@/lib/format";

export const metadata = { title: "Reports · Federal Tax Authority" };

export default async function Reports({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const r = await guard(() => getAnalytics(f));
  if (!r.ok) return <Shell route="reports" msg={f.msg}>{r.error}</Shell>;
  const an = r.data;
  return (
    <Shell route="reports" msg={f.msg}>
      <PageHead title="Reports" lead="Every figure and chart here is calculated live by the verification body."
        actions={<><a className="btn ghost md" href="/export/invoices.csv"><Icon n="down" s={18} /><span>Invoices CSV</span></a><a className="btn primary md" href="/export/applications.csv"><Icon n="down" s={18} /><span>Applications CSV</span></a></>} />
      <AnalyticsFilters an={an} f={f} path="/reports" />
      <Kpis an={an} fourth="response" />
      <div className="an-grid"><ClaimsChart an={an} /><RatingsChart an={an} /><ReportCharts an={an} /></div>
    </Shell>
  );
}
