import Link from "next/link";
import Shell from "@/components/Shell";
import { guard } from "@/components/states";
import { Badge, Icon, PageHead, RatingBadge } from "@/components/ui";
import { loadAll } from "@/lib/data";
import { flat, match, money, type Params } from "@/lib/format";

export const metadata = { title: "Check status · Federal Tax Authority" };

export default async function Search({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const q = (f.q ?? "").trim().slice(0, 120);
  const r = await guard(loadAll);
  if (!r.ok) return <Shell route="search" msg={f.msg}>{r.error}</Shell>;
  const { apps, invoices, suppliers } = r.data;
  const a = q ? apps.filter((x) => match(q, x.maskan_ref, x.applicant_name, x.plot_no, x.emirate, ...x.invoices.map((i) => `${i.invoice_no} ${i.supplier_trn}`))) : [];
  const i = q ? invoices.filter((x) => match(q, x.invoice_no, x.supplier_trn, x.supplier_name, x.app.maskan_ref)) : [];
  const s = q ? suppliers.filter((x) => match(q, x.legal_name, x.trn, x.emirate)) : [];
  const total = a.length + i.length + s.length;
  const examples = apps[0] && invoices[0] && suppliers[0] ? [apps[0].maskan_ref, invoices[0].invoice_no, suppliers[0].trn, suppliers[0].legal_name.split(" ")[0]] : [];
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return (
    <Shell route="search" msg={f.msg}>
      <PageHead title="Check status" lead="Find an application, invoice or supplier by reference, TRN, plot or name." />
      <section className="card">
        <form method="get" className="toolbar solo">
          <label className="search-in big"><Icon n="search" s={18} /><input name="q" defaultValue={q} placeholder="MSK-2026-0001, INV number, TRN or supplier name" aria-label="Search" autoFocus /></label>
          <button className="btn primary md" type="submit"><span>Search</span></button>
        </form>
      </section>
      {!q && (
        <section className="card">
          <div className="empty"><span className="empty-ic"><Icon n="search" s={26} /></span><h3>Start typing to search</h3><p>Search works on references, invoice numbers, TRNs (spaces are fine), plots and supplier names.</p>
            {examples.length > 0 && <div className="ent-chips" style={{ justifyContent: "center", marginTop: 14 }}><span className="muted small">Try</span>{examples.map((e) => <Link key={e} className="chip" href={`/search?q=${encodeURIComponent(e)}`}>{e}</Link>)}</div>}
          </div>
        </section>
      )}
      {q && <p className="muted small result-count">{total} result{total === 1 ? "" : "s"} for “{q}”</p>}
      {q && total === 0 && <section className="card"><div className="empty"><span className="empty-ic"><Icon n="search" s={26} /></span><h3>No results for “{q}”</h3><p>Check the spelling, or try the TRN or invoice number.</p></div></section>}
      {a.length > 0 && (
        <section className="card"><header className="card-h"><h2>Applications</h2></header>
          <ul className="mini-list">{a.map((x) => <li key={x.id}><Link href={`/applications?open=${x.id}`}><span><b>{x.maskan_ref} · {x.applicant_name}</b><small>Plot {x.plot_no} · {money(x.vat_claimed)} claimed</small></span><Badge kind={x.tone}>{x.label}</Badge></Link></li>)}</ul></section>
      )}
      {i.length > 0 && (
        <section className="card"><header className="card-h"><h2>Invoices</h2></header>
          <ul className="mini-list">{i.map((x) => <li key={x.id}><Link href={`/verifications?open=${x.id}`}><span><b>{x.invoice_no}</b><small>{x.supplier_name} · {x.app.maskan_ref}</small></span><RatingBadge s={x.status_ui} /></Link></li>)}</ul></section>
      )}
      {s.length > 0 && (
        <section className="card"><header className="card-h"><h2>Suppliers</h2></header>
          <ul className="mini-list">{s.map((x) => <li key={x.trn}><Link href={`/entities?open=${x.trn}`}><span><b>{x.legal_name}</b><small className="mono">{x.trn}</small></span><Badge kind={x.state === "active" ? "approved" : x.state === "review" ? "referred" : "rejected"}>{cap(x.state)}</Badge></Link></li>)}</ul></section>
      )}
    </Shell>
  );
}
