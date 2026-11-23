import Link from "next/link";
import Shell from "@/components/Shell";
import { guard } from "@/components/states";
import { Empty, Icon, PageHead, Pager, SearchBox, Seg } from "@/components/ui";
import { describe, loadAll, type Described } from "@/lib/data";
import { fdate, flat, hhmm, match, paginate, qs, type Params } from "@/lib/format";
import type { AuditView } from "@/lib/types";

export const metadata = { title: "Audit Trail · Federal Tax Authority" };

const TONES: [string, string, string][] = [["src", "From Maskan", "down"], ["sys", "Rule engine", "shield"], ["supplier", "Suppliers", "mail"], ["officer", "Officers", "check"]];

export default async function Audit({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const r = await guard(loadAll);
  if (!r.ok) return <Shell route="audit" msg={f.msg}>{r.error}</Shell>;
  const q = f.q ?? "", who = f.who || "all";
  const all = r.data.audit.map((e) => ({ e, d: describe(e) }));
  const rows = all.filter(({ e, d }) => (who === "all" || d.tone === who) && match(q, e.actor, e.action, e.entity, e.app_ref, d.head, d.line, d.who));
  const pg = paginate(rows, f.page);
  const groups: { day: string; items: { e: AuditView; d: Described }[] }[] = [];
  for (const it of pg.rows) {
    const day = fdate(it.e.at);
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
    groups[groups.length - 1].items.push(it);
  }
  const count = (t: string) => all.filter((x) => x.d.tone === t).length;

  return (
    <Shell route="audit" msg={f.msg}>
      <PageHead title="Audit Trail" lead={`A tamper-evident record of every system and officer action. ${rows.length} of ${all.length} events shown.`}
        actions={<a className="btn ghost md" href="/export/applications.csv"><Icon n="down" s={18} /><span>Export claims</span></a>} />
      <div className="aud-stats">
        {TONES.map(([k, label, ic]) => (
          <Link key={k} className={`aud-stat t-${k}${who === k ? " on" : ""}`} href={`/audit?${qs(f, { who: who === k ? "all" : k, page: null })}`}>
            <span className="aud-ic"><Icon n={ic} s={18} /></span><span><b>{count(k)}</b><small>{label}</small></span>
          </Link>
        ))}
      </div>
      <section className="card nopad aud-card">
        <form className="toolbar" method="get">
          <SearchBox value={q} placeholder="Search actor, action or reference" />
          <Seg name="who" value={who} label="Source" options={[["all", "All"], ["officer", "Officers"], ["sys", "System"]]} />
        </form>
        {groups.length ? (
          <div className="aud-feed">
            {groups.map((g) => (
              <section className="aud-day" key={g.day}>
                <h3><span>{g.day}</span><i /></h3>
                <ol className="aud-list">
                  {g.items.map(({ e, d }) => (
                    <li key={e.id} className={`aud-item t-${d.tone}`}>
                      <span className="aud-dot"><Icon n={d.icon} s={16} /></span>
                      <div className="aud-body">
                        <div className="aud-top"><b>{d.head}</b><time>{hhmm(e.at)}</time></div>
                        <p className="aud-sub"><span className={`chip t-${d.tone}`}>{d.who}</span>
                          {d.kind === "application" ? <Link className="aud-ref" href={`/applications?open=${d.ident}`}>{e.app_ref}</Link>
                            : d.kind === "invoice" ? <><Link className="aud-ref" href={`/verifications?open=${d.ident}`}>Invoice {d.ident}</Link> <span className="muted">in {e.app_ref}</span></>
                            : <span className="aud-ref plain">{d.kind} {d.ident}</span>}
                        </p>
                        {d.line && <p className="aud-detail">{d.line}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        ) : <Empty title="Nothing matches" text="Try a different search or clear the filters." clear="/audit" />}
        <Pager p={pg.p} pages={pg.pages} current={f} path="/audit" />
      </section>
    </Shell>
  );
}
