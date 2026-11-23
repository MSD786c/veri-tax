import Link from "next/link";
import { AnalyticsFilters } from "@/components/Analytics";
import Shell from "@/components/Shell";
import { guard } from "@/components/states";
import { Badge, Empty, Icon, RatingBadge } from "@/components/ui";
import { officerId } from "@/lib/api";
import { AMBER, Donut, GREEN, GREY, GroupedBars, RED } from "@/lib/charts";
import { getAnalytics, loadAll } from "@/lib/data";
import { fdate, flat, money, qs, rel, type Params } from "@/lib/format";
import "./dashboard.css";

export const metadata = { title: "Dashboard · Federal Tax Authority" };

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default async function Dashboard({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const r = await guard(async () => ({ all: await loadAll(), an: await getAnalytics(f) }));
  if (!r.ok) return <Shell route="dashboard" msg={f.msg}>{r.error}</Shell>;
  const { all: { apps, invoices, audit }, an } = r.data;

  const open = apps.filter((a) => !a.decided);
  const ready = apps.filter((a) => a.status === "READY_FOR_DECISION");
  const referred = invoices.filter((i) => i.status_ui === "referred");
  const waiting = apps.filter((a) => a.status === "AWAITING_SUPPLIERS").length;
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = invoices.filter((i) => i.decision && i.decision.decided_at.slice(0, 10) === today).length
    + audit.filter((e) => e.action === "decide" && e.at.slice(0, 10) === today).length;
  const oldest = [...referred].sort((a, b) => a.invoice_date.localeCompare(b.invoice_date))[0];
  const queue = [
    ...open.map((a) => ({ kind: "app" as const, key: `a${a.id}`, title: a.applicant_name, meta: `${a.maskan_ref} · Plot ${a.plot_no}`, at: a.submitted_at, href: `/applications?open=${a.id}`, badge: <Badge kind={a.tone}>{a.label}</Badge> })),
    ...referred.map((i) => ({ kind: "inv" as const, key: `i${i.id}`, title: i.supplier_name, meta: `${i.invoice_no} · ${clip(i.rating_reasons[0] ?? "Needs your decision", 56)}`, at: i.invoice_date, href: `/verifications?open=${i.id}`, badge: <Badge kind="referred">Referred</Badge> })),
  ].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 6);
  const recent = [...invoices].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)).slice(0, 4);
  const officer = `Officer ${await officerId()}`;
  const hour = new Date().getHours();
  const rt = an.ratings;

  return (
    <Shell route="dashboard" msg={f.msg}>
      <header className="page-h">
        <div className="hello">
          <div>
            <p className="eyebrow">{new Date().toLocaleString("en", { weekday: "long", day: "numeric", month: "long" })}</p>
            <h1>{hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, {officer}</h1>
            <p className="lead">{open.length || referred.length ? `Waiting for you: ${plural(open.length, "application")}, ${plural(referred.length, "invoice")}.` : "You are all caught up."}</p>
          </div>
        </div>
        <div className="page-actions">
          <Link className="btn ghost md" href="/applications"><Icon n="doc" s={18} /><span>Applications</span></Link>
          <Link className="btn primary md" href="/verify"><Icon n="scan" s={18} /><span>Verify invoice</span></Link>
        </div>
      </header>

      <div className="bento">
        <section className="tile t-forecast">
          <header className="tile-h"><h2>Claims forecast</h2><Link className="tile-link" href={`/reports?${qs(f)}`}>Full reports<Icon n="arrow" s={15} /></Link></header>
          <AnalyticsFilters an={an} f={f} path="/dashboard" compact />
          <div className="fc-grid">
            <div className="pills">
              <div className="pill-tile white"><span>VAT claimed</span><b>{money(an.totals.claimed)}</b></div>
              <div className="pill-tile navy"><span>VAT verified</span><b>{money(an.totals.verified)}</b></div>
              <div className="pill-tile blush"><span>Not refundable</span><b>{money(an.totals.not_refundable)}</b></div>
            </div>
            <div className="chart-card">
              <div className="chart-top"><span className="chip">{plural(an.totals.invoices, "invoice")} · {plural(an.totals.applications, "application")}</span>
                <ul className="legend inline"><li><i style={{ background: "#0f1f3d" }} />Claimed</li><li><i style={{ background: "#d1ab4d" }} />Verified</li></ul></div>
              <GroupedBars monthly={an.monthly} />
            </div>
          </div>
        </section>

        <section className="tile t-work dark">
          <header className="tile-h"><h2>Your work</h2><span className="tile-sub">{doneToday} decision{doneToday === 1 ? "" : "s"} today</span></header>
          <div className="wk-grid">
            <Link className="big-tile blue" href="/applications">
              <span>Applications to review</span>
              <small>{ready.length} ready for decision · {waiting} awaiting suppliers</small>
              <b>{open.length}</b>
              <i className="go"><Icon n="arrow" s={18} /></i>
            </Link>
            <Link className="big-tile mint" href="/verifications?st=referred">
              <span>Invoices to decide</span>
              <small>{oldest ? `Oldest ${fdate(oldest.invoice_date)}` : "Nothing waiting"}</small>
              <b>{referred.length}</b>
              <i className="go"><Icon n="arrow" s={18} /></i>
            </Link>
          </div>
        </section>

        <section className="tile t-ratings dark">
          <header className="tile-h"><h2>Invoice ratings</h2><span className="tile-sub">{an.totals.invoices} in range</span></header>
          <div className="on-dark">
            <Donut parts={[["Strong", rt.STRONG, GREEN], ["Weak", rt.WEAK, AMBER], ["Fail", rt.FAIL, RED], ["Pending", rt.PENDING, GREY]]} />
          </div>
        </section>

        <section className="tile t-queue light">
          <header className="tile-h"><h2>Next up</h2><span className="tile-sub">Oldest first</span></header>
          {queue.length ? (
            <ul className="q-list">
              {queue.map((q) => (
                <li key={q.key}><Link href={q.href}>
                  <span className={`q-tile k-${q.kind}`}><Icon n={q.kind === "app" ? "doc" : "file"} s={20} /></span>
                  <span className="q-text"><b>{q.title}</b><small>{q.meta}</small></span>
                  <span className="q-side">{q.badge}<small>{rel(q.at)}</small></span>
                </Link></li>
              ))}
            </ul>
          ) : <Empty icon="check" title="All caught up" text="Nothing needs your decision right now." />}
        </section>

        <section className="tile t-verify dark">
          <header className="tile-h"><h2>Verify an invoice</h2></header>
          <p className="tile-text">Enter the TRN, invoice number and amount for an instant decision.</p>
          <form action="/verify" method="get" className="qv-form">
            <label><span>Tax Registration Number (TRN)</span><input className="mono" name="trn" inputMode="numeric" placeholder="100 000 000 000 003" maxLength={19} autoComplete="off" required /></label>
            <div className="grid2">
              <label><span>Invoice number</span><input name="inv" placeholder="INV-78421" autoComplete="off" required /></label>
              <label><span>Amount (AED)</span><input name="amt" inputMode="decimal" placeholder="0.00" required /></label>
            </div>
            <button className="btn gold lg full" type="submit"><span>Verify now</span><Icon n="arrow" s={18} /></button>
          </form>
        </section>

        <section className="tile t-latest sand">
          <header className="tile-h"><h2>Latest invoices</h2><Link className="tile-link" href="/invoices">All invoices<Icon n="arrow" s={15} /></Link></header>
          <ul className="q-list compact">
            {recent.map((v) => (
              <li key={v.id}><Link href={`/verifications?open=${v.id}`}>
                <span className="q-tile k-inv"><Icon n="file" s={20} /></span>
                <span className="q-text"><b>{v.invoice_no}</b><small>{v.supplier_name} · {fdate(v.invoice_date)}</small></span>
                <span className="q-side amount"><b>{money(v.vat_amount)}</b><RatingBadge s={v.status_ui} /></span>
              </Link></li>
            ))}
          </ul>
        </section>
      </div>
    </Shell>
  );
}
