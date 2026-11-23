import Link from "next/link";
import { AnalyticsFilters, ClaimsChart, Kpis, RatingsChart } from "@/components/Analytics";
import Shell from "@/components/Shell";
import { guard } from "@/components/states";
import { Badge, Icon, RatingBadge, Empty } from "@/components/ui";
import { officerId } from "@/lib/api";
import { getAnalytics, loadAll } from "@/lib/data";
import { fdate, flat, qs, rel, type Params } from "@/lib/format";

export const metadata = { title: "Dashboard · Federal Tax Authority" };

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
    ...open.map((a) => ({ kind: "app" as const, key: `a${a.id}`, title: a.applicant_name, meta: `${a.claim_type.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())} · ${a.maskan_ref}`, at: a.submitted_at, href: `/applications?open=${a.id}`, badge: <Badge kind={a.tone}>{a.label}</Badge> })),
    ...referred.map((i) => ({ kind: "inv" as const, key: `i${i.id}`, title: i.supplier_name, meta: `${i.invoice_no} · ${(i.rating_reasons[0] ?? "Needs your decision").slice(0, 70)}`, at: i.invoice_date, href: `/verifications?open=${i.id}`, badge: <Badge kind="referred">Referred</Badge> })),
  ].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 7);
  const recent = [...invoices].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)).slice(0, 3);
  const hour = new Date().getHours();
  const officer = `Officer ${await officerId()}`;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  return (
    <Shell route="dashboard" msg={f.msg}>
      <header className="page-h">
        <div className="hello">
          <div className="daytile" aria-hidden="true"><span>{new Date().toLocaleString("en", { month: "short" }).toUpperCase()}</span><b>{new Date().getDate()}</b></div>
          <div>
            <p className="eyebrow">{new Date().toLocaleString("en", { weekday: "long" })}</p>
            <h1>{hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, {officer}</h1>
            <p className="lead">{open.length || referred.length ? `Waiting for you: ${plural(open.length, "application")}, ${plural(referred.length, "invoice")}.` : "You are all caught up."}</p>
          </div>
        </div>
        <div className="page-actions">
          <Link className="btn ghost md" href="/applications"><Icon n="doc" s={18} /><span>Applications</span></Link>
          <Link className="btn primary md" href="/verify"><Icon n="scan" s={18} /><span>Verify invoice</span></Link>
        </div>
      </header>

      <section className="tasks" aria-label="Your work">
        <article className="task t-apps"><header><span className="task-ic"><Icon n="doc" /></span><p>Applications to review</p></header><b>{open.length}</b><small>{ready.length} ready for decision · {waiting} awaiting suppliers</small><footer><Link className="task-go" href="/applications">Open list<Icon n="arrow" s={16} /></Link></footer></article>
        <article className="task t-inv"><header><span className="task-ic"><Icon n="clock" /></span><p>Invoices to decide</p></header><b>{referred.length}</b><small>{oldest ? `Oldest: ${fdate(oldest.invoice_date)}` : "Nothing waiting"}</small><footer><Link className="task-go" href="/verifications?st=referred">Open list<Icon n="arrow" s={16} /></Link></footer></article>
        <article className="task t-done"><header><span className="task-ic"><Icon n="check" /></span><p>Decisions today</p></header><b>{doneToday}</b><small>Made by officers today</small><footer><Link className="task-go" href="/audit">Audit Trail<Icon n="arrow" s={16} /></Link></footer></article>
      </section>

      <div className="work">
        <section className="card nopad queue-card">
          <header className="card-h"><h2>Next up</h2><div><small className="muted">Oldest first</small></div></header>
          {queue.length ? (
            <ul className="queue">
              {queue.map((q, n) => (
                <li key={q.key}><Link className="queue-row" href={q.href}>
                  <span className="q-n">{String(n + 1).padStart(2, "0")}</span>
                  <span className={`q-ic k-${q.kind}`}><Icon n={q.kind === "app" ? "doc" : "file"} s={18} /></span>
                  <span className="q-main"><b>{q.title}</b><small>{q.meta}</small></span>
                  <span className="q-when">{rel(q.at)}</span>{q.badge}
                  <span className="q-go"><Icon n="chevr" s={16} /></span>
                </Link></li>
              ))}
            </ul>
          ) : <Empty icon="check" title="All caught up" text="Nothing needs your decision right now." />}
          {waiting > 0 && <p className="queue-foot">{plural(waiting, "application")} waiting for suppliers to confirm.</p>}
        </section>
        <section className="card dark quickv">
          <header className="card-h"><h2>Verify an invoice</h2></header>
          <p className="lead">Enter the TRN, invoice number and amount for an instant decision.</p>
          <form action="/verify" method="get" className="qv-form">
            <label><span>Tax Registration Number (TRN)</span><input className="mono" name="trn" inputMode="numeric" placeholder="100 000 000 000 003" maxLength={19} autoComplete="off" required /></label>
            <div className="grid2">
              <label><span>Invoice number</span><input name="inv" placeholder="INV-78421" autoComplete="off" required /></label>
              <label><span>Amount (AED)</span><input name="amt" inputMode="decimal" placeholder="0.00" required /></label>
            </div>
            <button className="btn gold lg full" type="submit"><span>Verify now</span><Icon n="arrow" s={18} /></button>
          </form>
          <h3 className="qv-sub">Latest invoices</h3>
          <ul className="qv-recent">
            {recent.map((v) => <li key={v.id}><Link href={`/verifications?open=${v.id}`}><span><b>{v.invoice_no}</b><small>{fdate(v.invoice_date)}</small></span><RatingBadge s={v.status_ui} /></Link></li>)}
          </ul>
        </section>
      </div>

      <section className="analytics" id="analytics">
        <header className="an-head">
          <div><h2>Refund claims at a glance</h2><p className="muted">Live from the verification body. Every chart follows the filters.</p></div>
          <Link className="link-more" href={`/reports?${qs(f)}`}>Full reports<Icon n="arrow" s={15} /></Link>
        </header>
        <AnalyticsFilters an={an} f={f} path="/dashboard" />
        <Kpis an={an} fourth="counts" />
        <div className="an-grid"><ClaimsChart an={an} /><RatingsChart an={an} /></div>
      </section>
    </Shell>
  );
}
