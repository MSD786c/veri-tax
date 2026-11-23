import Link from "next/link";
import { decideApplicationAction } from "@/app/actions";
import Shell from "@/components/Shell";
import { DecisionBrief, fileHref } from "@/components/review";
import { guard } from "@/components/states";
import { Badge, Empty, Icon, PageHead, Pager, RatingBadge, SearchBox, Seg, Timeline } from "@/components/ui";
import { APP_STATUS, loadAll } from "@/lib/data";
import { fdate, fdt, flat, match, money, nice, paginate, qs, type Params } from "@/lib/format";

export const metadata = { title: "Applications · Federal Tax Authority" };

const PIPE = ["RECEIVED", "IN_VERIFICATION", "AWAITING_SUPPLIERS", "READY_FOR_DECISION"];

export default async function Applications({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const r = await guard(loadAll);
  if (!r.ok) return <Shell route="applications" msg={f.msg}>{r.error}</Shell>;
  const { apps, audit } = r.data;
  const st = f.st || "all", q = f.q ?? "";
  const rows = apps.filter((a) => (st === "all" || a.status === st)
    && match(q, a.maskan_ref, a.applicant_name, a.plot_no, a.emirate, ...a.invoices.map((i) => `${i.invoice_no} ${i.supplier_trn} ${i.supplier_name}`)));
  const pg = paginate(rows, f.page);
  const counts = (k: string) => apps.filter((a) => a.status === k).length;
  const a = apps.find((x) => String(x.id) === f.open);
  const history = a ? audit.filter((e) => e.entity === `application:${a.id}`) : [];
  const close = `/applications?${qs(f, { open: null })}`;

  return (
    <Shell route="applications" msg={f.msg}>
      <PageHead title="Applications" lead="Follow each refund claim from Maskan to your decision."
        actions={<><Link className="btn ghost md" href="/search"><Icon n="search" s={18} /><span>Check status</span></Link><a className="btn primary md" href="/export/applications.csv"><Icon n="down" s={18} /><span>Export CSV</span></a></>} />
      <div className="pipeline">
        {PIPE.map((k) => (
          <Link key={k} className={`pipe ${st === k ? "on" : ""}`} href={`/applications?${qs(f, { st: st === k ? "all" : k, page: null, open: null })}`}>
            <span>{APP_STATUS[k][0]}</span><b>{counts(k)}</b><i style={{ width: `${Math.round((counts(k) / (apps.length || 1)) * 100)}%` }} />
          </Link>
        ))}
      </div>
      <section className="card nopad">
        <form className="toolbar" method="get">
          <SearchBox value={q} placeholder="Search reference, applicant, plot or invoice" />
          <Seg name="st" value={st} label="Status" options={[["all", "All"], ["READY_FOR_DECISION", "Ready"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]]} />
        </form>
        {rows.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Reference</th><th>Applicant</th><th>Emirate</th><th className="num">VAT claimed</th><th className="num">Eligible</th><th>Status</th><th>Submitted</th></tr></thead>
            <tbody>
              {pg.rows.map((x) => (
                <tr key={x.id}>
                  <td className="mono"><Link className="row-link" href={`/applications?${qs(f, { open: x.id })}`}>{x.maskan_ref}</Link></td>
                  <td><b className="strong">{x.applicant_name}</b><small className="sub mono">Plot {x.plot_no}</small></td>
                  <td>{x.emirate}</td><td className="num">{money(x.vat_claimed)}</td><td className="num">{money(x.vat_eligible)}</td>
                  <td><Badge kind={x.tone}>{x.label}</Badge></td><td className="muted">{fdt(x.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <Empty title="Nothing matches" text="Try a different search or clear the filters." clear="/applications" />}
        <Pager p={pg.p} pages={pg.pages} current={f} path="/applications" />
      </section>

      {a && (
        <div className="scrim drawer-wrap"><Link className="scrim-close" href={close} aria-label="Close" />
          <aside className="dialog drawer" role="dialog" aria-modal="true" aria-labelledby="dt">
            <header className="dialog-h"><span className="dialog-ic"><Icon n="doc" s={22} /></span><div className="dialog-t"><h2 id="dt">Application</h2><p>{a.applicant_name}</p></div><Link className="icon-btn" href={close} aria-label="Close"><Icon n="x" s={18} /></Link></header>
            <div className="dialog-b">
              <div className="verdict neutral"><div className="verdict-top"><span className="verdict-ic"><Icon n="doc" s={24} /></span><div><p className="eyebrow">{nice(a.claim_type)}</p><h3 className="mono sm">{a.maskan_ref}</h3></div><Badge kind={a.tone}>{a.label}</Badge></div></div>
              <dl className="kv">
                <div><dt>Applicant</dt><dd>{a.applicant_name}</dd></div><div><dt>Plot</dt><dd className="mono">{a.plot_no}</dd></div>
                <div><dt>Emirate</dt><dd>{a.emirate}</dd></div><div><dt>Submitted</dt><dd>{fdt(a.submitted_at)}</dd></div>
                <div><dt>Completion date</dt><dd>{fdate(a.completion_date)}</dd></div><div><dt>Contract value</dt><dd>{money(a.contract_value)}</dd></div>
                <div><dt>VAT claimed</dt><dd>{money(a.vat_claimed)}</dd></div><div><dt>VAT eligible</dt><dd>{money(a.vat_eligible)}</dd></div>
              </dl>
              <h3 className="sec">Invoices ({a.invoices.length})</h3>
              <ul className="mini-list">
                {a.invoices.map((i) => <li key={i.id}><Link href={`/verifications?open=${i.id}`}><span><b>{i.invoice_no}</b><small>{i.supplier_name} · {money(i.vat_amount)}</small></span><RatingBadge s={i.status_ui} /></Link></li>)}
              </ul>
              {a.invoices.some((i) => i.row.document) && (
                <><h3 className="sec">Original documents</h3>
                  <ul className="mini-list">
                    {a.invoices.filter((i) => i.row.document).map((i) => <li key={i.id}><a href={fileHref(i.row.document!.id)} target="_blank" rel="noopener"><span><b>{i.row.document!.filename}</b><small>{i.invoice_no} · {i.row.extraction ? nice(i.row.extraction.document_type) : nice(i.row.document!.status)}</small></span><span className="doc-open">Open original <Icon n="external" s={14} /></span></a></li>)}
                  </ul></>
              )}
              <DecisionBrief appId={a.id} runs={a.detail.agent_runs} />
              <h3 className="sec">History</h3>
              <Timeline items={history.map((e) => ({ title: nice(e.action), sub: `by ${e.actor}`, at: fdt(e.at) }))} />
              {a.detail.decision ? (
                <p className="muted">Decision: <b>{nice(a.detail.decision.decision)}</b> by {a.detail.decision.officer_id} for {money(a.detail.decision.approved_amount)}.</p>
              ) : a.status === "READY_FOR_DECISION" ? (
                <form className="actions-box" action={decideApplicationAction}>
                  <input type="hidden" name="id" value={a.id} /><input type="hidden" name="approved_amount" value={a.vat_eligible} />
                  <p className="muted small">Approving refunds the eligible VAT of <b>{money(a.vat_eligible)}</b>. Rejecting refunds nothing.</p>
                  <div className="field"><label htmlFor="c">Comments (optional)</label><textarea id="c" name="comments" rows={2} placeholder="Add a short note…" /></div>
                  <div className="row">
                    <button className="btn primary md" name="decision" value="approve"><Icon n="check" s={18} /><span>Approve</span></button>
                    <button className="btn ghost md danger" name="decision" value="reject"><Icon n="x" s={18} /><span>Reject</span></button>
                  </div>
                </form>
              ) : <p className="muted small">This application can be decided once every invoice is verified or its supplier has responded. It is currently <b>{a.label.toLowerCase()}</b>.</p>}
            </div>
          </aside>
        </div>
      )}
    </Shell>
  );
}
