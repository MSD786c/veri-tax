import Link from "next/link";
import Shell from "@/components/Shell";
import { guard } from "@/components/states";
import { Badge, Empty, Icon, PageHead, RatingBadge, SearchBox, Seg } from "@/components/ui";
import { getSupplier, loadAll, type SupplierView } from "@/lib/data";
import { fdate, flat, match, money, qs, type Params } from "@/lib/format";
import type { InvStatus } from "@/lib/types";

export const metadata = { title: "Entities · Federal Tax Authority" };

const ringColor = (p: number) => (p >= 60 ? "#1c9b6c" : p >= 25 ? "#d6a21f" : "#d93a52");
const stateBadge = (s: SupplierView["state"]) => <Badge kind={s === "active" ? "approved" : s === "review" ? "referred" : "rejected"}>{s.charAt(0).toUpperCase() + s.slice(1)}</Badge>;
const ratingStatus = (r: string | null): InvStatus => (r === "STRONG" ? "approved" : r === "WEAK" ? "referred" : r === "FAIL" ? "rejected" : "pending");

function Ring({ pct }: { pct: number }) {
  return (
    <svg className="ring" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${pct}% verified`}>
      <circle cx="32" cy="32" r="25" fill="none" stroke="#efe9d8" strokeWidth="7" />
      <circle cx="32" cy="32" r="25" fill="none" stroke={ringColor(pct)} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${((pct / 100) * 157.08).toFixed(1)} 157.08`} transform="rotate(-90 32 32)" />
      <text x="32" y="36" textAnchor="middle" className="ring-n">{pct}%</text>
    </svg>
  );
}

export default async function Entities({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const r = await guard(async () => ({ all: await loadAll(), detail: f.open ? await getSupplier(f.open) : null }));
  if (!r.ok) return <Shell route="entities" msg={f.msg}>{r.error}</Shell>;
  const { suppliers: all } = r.data.all;
  const d = r.data.detail;
  const q = f.q ?? "", em = f.em || "all", tier = f.tier || "all";
  const emirates = [...new Set(all.map((s) => s.emirate).filter(Boolean))].sort();
  const rows = all.filter((s) => (em === "all" || s.emirate === em) && (tier === "all" || s.tier === tier) && match(q, s.legal_name, s.trn, s.emirate)).sort((a, b) => b.vat_claimed - a.vat_claimed);
  const sum = (k: "vat_claimed" | "vat_verified") => all.reduce((a, s) => a + s[k], 0);
  const tiers = (t: string) => all.filter((s) => s.tier === t).length;
  const close = `/entities?${qs(f, { open: null })}`;

  return (
    <Shell route="entities" msg={f.msg}>
      <PageHead title="Entities" lead="Every supplier on a refund claim: how much VAT they claimed, how much held up, and how far to trust them." />
      <div className="kpis">
        <div className="kpi-c"><span>Suppliers</span><b>{all.length}</b></div>
        <div className="kpi-c"><span>VAT claimed</span><b>{money(sum("vat_claimed"))}</b></div>
        <div className="kpi-c good"><span>VAT verified</span><b>{money(sum("vat_verified"))}</b></div>
        <div className="kpi-c"><span>Need attention</span><b>{all.filter((s) => s.tier === "WATCH" || s.state !== "active").length}</b></div>
      </div>
      <section className="card nopad">
        <form className="toolbar" method="get">
          <SearchBox value={q} placeholder="Search supplier or TRN" />
          <Seg name="tier" value={tier} label="Trust tier" options={[["all", "All tiers"], ...(["TRUSTED", "STANDARD", "WATCH"] as const).map((t) => [t, `${t.charAt(0) + t.slice(1).toLowerCase()} · ${tiers(t)}`] as [string, string])]} />
          <label className="select"><Icon n="pin" s={16} /><span className="sr">Emirate</span>
            <select name="em" aria-label="Emirate" defaultValue={em}><option value="all">All emirates</option>{emirates.map((e) => <option key={e} value={e}>{e}</option>)}</select><Icon n="chevron" s={16} /></label>
          <button className="btn soft md" type="submit"><span>Apply</span></button>
        </form>
        {rows.length ? (
          <ul className="ent-grid">
            {rows.map((s) => (
              <li key={s.trn}><Link className={`ent2 st-${s.state}`} href={`/entities?${qs(f, { open: s.trn })}`}>
                <div className="e2-head"><span className="e2-av">{s.legal_name[0]}</span><span className="e2-name"><b>{s.legal_name}</b><small className="mono">{s.trn}</small></span><Ring pct={s.verified_pct} /></div>
                <div className="ent-chips"><span className={`tier t-${s.tier.toLowerCase()}`}>{s.tier.charAt(0) + s.tier.slice(1).toLowerCase()}</span>{stateBadge(s.state)}<span className="chip">{s.emirate || "—"}</span></div>
                <div className="split" aria-label="Claimed VAT split"><i className="v" style={{ width: `${s.verified_pct}%` }} title={`Verified ${money(s.vat_verified)}`} /><i className="r" style={{ width: `${s.rejected_pct}%` }} title={`Rejected ${money(s.vat_rejected)}`} /></div>
                <dl className="ent-nums"><div><dt>Claimed</dt><dd>{money(s.vat_claimed)}</dd></div><div><dt>Verified</dt><dd className="g">{money(s.vat_verified)}</dd></div><div><dt>Rejected</dt><dd className="r">{money(s.vat_rejected)}</dd></div></dl>
                <div className="e2-foot"><span>{s.invoice_count} invoice{s.invoice_count === 1 ? "" : "s"} · {s.application_count} application{s.application_count === 1 ? "" : "s"}</span><span>Responds {s.response_pct}%</span></div>
              </Link></li>
            ))}
          </ul>
        ) : <Empty title="Nothing matches" text="Try a different search or clear the filters." clear="/entities" />}
      </section>

      {d && (
        <div className="scrim drawer-wrap"><Link className="scrim-close" href={close} aria-label="Close" />
          <aside className="dialog drawer" role="dialog" aria-modal="true" aria-labelledby="dt">
            <header className="dialog-h"><span className="dialog-ic"><Icon n="building" s={22} /></span><div className="dialog-t"><h2 id="dt">Supplier</h2><p>{d.legal_name}</p></div><Link className="icon-btn" href={close} aria-label="Close"><Icon n="x" s={18} /></Link></header>
            <div className="dialog-b">
              <div className="ent-hero"><Ring pct={d.verified_pct} /><div><p className="eyebrow">VAT held up</p><h3>{money(d.vat_verified)} <small>of {money(d.vat_claimed)}</small></h3>
                <div className="ent-chips"><span className={`tier t-${d.tier.toLowerCase()}`}>{d.tier.charAt(0) + d.tier.slice(1).toLowerCase()}</span>{stateBadge(d.state)}</div></div></div>
              <dl className="kv">
                <div><dt>TRN</dt><dd className="mono">{d.trn}</dd></div><div><dt>Emirate</dt><dd>{d.emirate || "—"}</dd></div>
                <div><dt>Applications</dt><dd>{d.application_count}</dd></div><div><dt>Invoices</dt><dd>{d.invoice_count}</dd></div>
                <div><dt>VAT rejected</dt><dd>{money(d.vat_rejected)}</dd></div><div><dt>Response rate</dt><dd>{d.response_pct}%</dd></div>
                <div><dt>Declared VAT periods</dt><dd>{d.declared_vat_periods.join(", ") || "—"}</dd></div><div><dt>Retention outstanding</dt><dd>{money(d.retention_outstanding)}</dd></div>
              </dl>
              <h3 className="sec">Invoices</h3>
              <ul className="mini-list">
                {d.invoices.map((i) => <li key={i.id}><Link href={`/verifications?open=${i.id}`}><span><b>{i.invoice_no}</b><small>{money(i.vat_amount)} · {fdate(i.invoice_date)}</small></span><RatingBadge s={ratingStatus(i.rating)} /></Link></li>)}
              </ul>
            </div>
          </aside>
        </div>
      )}
    </Shell>
  );
}
