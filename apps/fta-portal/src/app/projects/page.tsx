import Link from "next/link";
import Shell from "@/components/Shell";
import { guard } from "@/components/states";
import { pct, projectHref, RatingCounts, Ring, statusBadge } from "@/components/project";
import { Empty, Icon, PageHead, SearchBox } from "@/components/ui";
import { getProjects } from "@/lib/data";
import { fdate, flat, match, money, type Params } from "@/lib/format";

export const metadata = { title: "Projects · Federal Tax Authority" };

export default async function Projects({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const r = await guard(getProjects);
  if (!r.ok) return <Shell route="projects" msg={f.msg}>{r.error}</Shell>;
  const all = r.data;
  const q = f.q ?? "", em = f.em || "all";
  const emirates = [...new Set(all.map((p) => p.emirate).filter(Boolean))].sort();
  const rows = all.filter((p) => (em === "all" || p.emirate === em) && match(q, p.permit_no, p.applicant_name, p.plot_no, p.maskan_ref));
  const sum = (k: "vat_claimed" | "vat_eligible") => all.reduce((a, p) => a + (p[k] || 0), 0);

  return (
    <Shell route="projects" msg={f.msg}>
      <PageHead title="Projects" lead="Every new-home refund claim, by building permit: the invoices behind it, how they rated and how much VAT holds up." />
      <div className="kpis">
        <div className="kpi-c"><span>Projects</span><b>{all.length}</b></div>
        <div className="kpi-c"><span>VAT claimed</span><b>{money(sum("vat_claimed"))}</b></div>
        <div className="kpi-c good"><span>VAT eligible</span><b>{money(sum("vat_eligible"))}</b></div>
        <div className="kpi-c"><span>Invoices</span><b>{all.reduce((a, p) => a + p.invoice_count, 0)}</b></div>
      </div>
      <section className="card nopad">
        {all.length > 0 && (
          <form className="toolbar" method="get">
            <SearchBox value={q} placeholder="Search permit, applicant or plot" />
            <label className="select"><Icon n="pin" s={16} /><span className="sr">Emirate</span>
              <select name="em" aria-label="Emirate" defaultValue={em}><option value="all">All emirates</option>{emirates.map((e) => <option key={e} value={e}>{e}</option>)}</select><Icon n="chevron" s={16} /></label>
            <button className="btn soft md" type="submit"><span>Apply</span></button>
          </form>
        )}
        {!all.length ? (
          <Empty icon="building" title="No projects yet" text="No projects yet — cases appear here once an invoice has been uploaded and its supplier has answered." />
        ) : rows.length ? (
          <ul className="ent-grid">
            {rows.map((p) => {
              const n = p.invoice_count || 0, rt = p.invoices_by_rating ?? { STRONG: 0, WEAK: 0, FAIL: 0, PENDING: 0 };
              return (
                <li key={p.permit_no}><Link className="ent2" href={projectHref(p.permit_no)}>
                  <div className="e2-head"><span className="e2-av"><Icon n="building" s={22} /></span><span className="e2-name"><b className="mono">{p.permit_no}</b><small>{p.applicant_name}</small></span><Ring pct={pct(p.vat_eligible, p.vat_claimed)} /></div>
                  <div className="ent-chips">{statusBadge(p.status)}<span className="chip">Plot {p.plot_no || "—"}</span><span className="chip">{p.emirate || "—"}</span></div>
                  <div className="split" aria-label="Invoice ratings"><i className="v" style={{ width: `${pct(rt.STRONG ?? 0, n)}%` }} title={`${rt.STRONG ?? 0} strong`} /><i className="r" style={{ width: `${pct(rt.FAIL ?? 0, n)}%` }} title={`${rt.FAIL ?? 0} fail`} /></div>
                  <dl className="ent-nums"><div><dt>Claimed</dt><dd>{money(p.vat_claimed)}</dd></div><div><dt>Eligible</dt><dd className="g">{money(p.vat_eligible)}</dd></div><div><dt>Invoices</dt><dd>{n}</dd></div></dl>
                  <div className="e2-foot"><RatingCounts p={p} /><span>Completed {fdate(p.completion_date)}</span></div>
                </Link></li>
              );
            })}
          </ul>
        ) : <Empty title="Nothing matches" text="Try a different search or clear the filters." clear="/projects" />}
      </section>
    </Shell>
  );
}
