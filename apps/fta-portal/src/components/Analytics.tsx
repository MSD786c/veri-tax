import { AreaChart, BarChart, Donut, Funnel, GOLD, GREEN, RED, AMBER, GREY } from "@/lib/charts";
import { money, monthLabel, fdate } from "@/lib/format";
import type { Analytics } from "@/lib/types";
import Link from "next/link";
import { Icon } from "./ui";

export const STATUS_COLORS: Record<string, string> = {
  RECEIVED: "#9db7e8", IN_VERIFICATION: "#b9a7e6", AWAITING_SUPPLIERS: "#d6a21f", READY_FOR_DECISION: "#0f1f3d", APPROVED: "#1c9b6c", PARTIALLY_APPROVED: "#7cc9a6", REJECTED: "#d93a52",
};
const nice = (k: string) => k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, " ");

/** Emirate + date-range filter. A plain GET form, so every chart below it follows the URL. */
export function AnalyticsFilters({ an, f, path, compact = false }: { an: Analytics; f: Record<string, string>; path: string; compact?: boolean }) {
  const emirate = f.emirate || "all";
  const active = emirate !== "all" || f.from || f.to;
  return (
    <form className={`an-filters${compact ? " compact" : ""}`} method="get" action={path} aria-label="Chart filters">
      <label className="select"><Icon n="pin" s={16} /><span className="sr">Emirate</span>
        <select name="emirate" aria-label="Emirate" defaultValue={emirate}>
          <option value="all">All emirates</option>
          {an.filters.emirates.map((e) => <option key={e} value={e}>{e}</option>)}
        </select><Icon n="chevron" s={16} /></label>
      <label className="date-in"><span>From</span><input type="date" name="from" defaultValue={f.from ?? ""} aria-label="From date" /></label>
      <label className="date-in"><span>To</span><input type="date" name="to" defaultValue={f.to ?? ""} aria-label="To date" /></label>
      <button className="btn primary md" type="submit"><span>Apply</span></button>
      {active && <Link className="btn ghost md" href={path}><span>Reset</span></Link>}
    </form>
  );
}

export function Kpis({ an, fourth }: { an: Analytics; fourth: "counts" | "response" }) {
  return (
    <div className="kpis">
      <div className="kpi-c"><span>VAT claimed</span><b>{money(an.totals.claimed)}</b></div>
      <div className="kpi-c good"><span>VAT verified</span><b>{money(an.totals.verified)}</b></div>
      <div className="kpi-c bad"><span>Not refundable</span><b>{money(an.totals.not_refundable)}</b></div>
      {fourth === "counts"
        ? <div className="kpi-c"><span>Invoices · Applications</span><b>{an.totals.invoices} · {an.totals.applications}</b></div>
        : <div className="kpi-c"><span>Supplier response rate</span><b>{Math.round((an.totals.supplier_response_rate ?? 0) * 100)}%</b></div>}
    </div>
  );
}

export function ClaimsChart({ an }: { an: Analytics }) {
  return (
    <section className="card an-wide">
      <header className="card-h"><h2>VAT claimed vs verified</h2><div><small className="muted">by invoice month</small></div></header>
      <AreaChart monthly={an.monthly} />
    </section>
  );
}

export function RatingsChart({ an }: { an: Analytics }) {
  const r = an.ratings;
  return (
    <section className="card an-donut">
      <header className="card-h"><h2>Invoice ratings</h2></header>
      <Donut parts={[["Strong", r.STRONG, GREEN], ["Weak", r.WEAK, AMBER], ["Fail", r.FAIL, RED], ["Pending", r.PENDING, GREY]]} />
    </section>
  );
}

export function ReportCharts({ an }: { an: Analytics }) {
  const decisions = an.decisions_daily.map((d) => ({ label: fdate(d.day).slice(0, -5), value: d.approved + d.rejected }));
  const mx = an.top_suppliers.reduce((m, s) => Math.max(m, s.claimed), 1);
  return (
    <>
      <section className="card"><header className="card-h"><h2>Invoices per month</h2></header>
        <BarChart rows={an.monthly.map((m) => ({ label: monthLabel(m.month), value: m.invoices }))} color={GOLD} format={(v) => `${v} invoices`} /></section>
      <section className="card"><header className="card-h"><h2>Application pipeline</h2></header>
        <Funnel parts={Object.entries(an.application_status).map(([k, v]) => [nice(k), v, STATUS_COLORS[k] ?? GREY] as [string, number, string])} /></section>
      <section className="card"><header className="card-h"><h2>VAT claimed by emirate</h2><div><small className="muted">ignores the emirate filter</small></div></header>
        <BarChart rows={an.by_emirate.map((e) => ({ label: e.emirate, value: e.claimed }))} format={money} /></section>
      <section className="card"><header className="card-h"><h2>Most common rule failures</h2></header>
        {an.rule_failures.length ? <Funnel parts={an.rule_failures.map((x) => [x.rule, x.count, RED] as [string, number, string])} /> : <div className="chart-empty">No rule failures in this range</div>}</section>
      <section className="card"><header className="card-h"><h2>Officer decisions per day</h2><div><small className="muted">{an.totals.officer_decisions} decisions · {an.totals.overrides} overrides of the agent</small></div></header>
        <BarChart rows={decisions} color={GREEN} format={(v) => `${v} decisions`} empty="No officer decisions yet. Approve or reject an invoice and it appears here." /></section>
      <section className="card"><header className="card-h"><h2>Suppliers with the most rejected VAT</h2></header>
        {an.top_suppliers.length ? (
          <ul className="sup-rank">
            {an.top_suppliers.map((s) => (
              <li key={s.trn}><Link href={`/entities?open=${s.trn}`}>
                <span className="sr-name"><b>{s.name}</b><small>{s.invoices} invoice{s.invoices === 1 ? "" : "s"}</small></span>
                <div className="track two"><i className="claimed" style={{ width: `${Math.round((s.claimed / mx) * 100)}%` }} title={`Claimed ${money(s.claimed)}`} /><i className="rej" style={{ width: `${Math.round((s.rejected / mx) * 100)}%` }} title={`Rejected ${money(s.rejected)}`} /></div>
                <span className="sr-val">{money(s.rejected)}<small>of {money(s.claimed)}</small></span>
              </Link></li>
            ))}
          </ul>
        ) : <div className="chart-empty">No suppliers in this range</div>}</section>
    </>
  );
}
