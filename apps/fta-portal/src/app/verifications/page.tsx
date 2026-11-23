import Link from "next/link";
import { decideInvoiceAction } from "@/app/actions";
import Shell from "@/components/Shell";
import { ComplianceAdvice, DocumentPanel } from "@/components/review";
import { guard } from "@/components/states";
import { Badge, Empty, Icon, PageHead, Pager, RatingBadge, SearchBox, Seg, Timeline } from "@/components/ui";
import { loadAll } from "@/lib/data";
import { fdate, fdt, flat, match, money, nice, paginate, qs, type Params } from "@/lib/format";

export const metadata = { title: "Verifications · Federal Tax Authority" };

export default async function Verifications({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const r = await guard(loadAll);
  if (!r.ok) return <Shell route="verifications" msg={f.msg}>{r.error}</Shell>;
  const { invoices, audit } = r.data;
  const st = f.st || "all", sort = f.sort || "at", q = f.q ?? "";
  const rows = invoices
    .filter((i) => (st === "all" || i.status_ui === st) && match(q, i.invoice_no, i.supplier_trn, i.supplier_name, i.app.maskan_ref))
    .sort((a, b) => (sort === "amount" ? b.taxable_amount - a.taxable_amount : b.invoice_date.localeCompare(a.invoice_date)));
  const pg = paginate(rows, f.page);
  const counts = (k: string) => invoices.filter((i) => i.status_ui === k).length;
  const v = invoices.find((i) => String(i.id) === f.open);
  const history = v ? audit.filter((e) => e.entity === `invoice:${v.id}`) : [];
  const close = `/verifications?${qs(f, { open: null })}`;

  return (
    <Shell route="verifications" msg={f.msg}>
      <PageHead title="Verifications" lead="Every invoice, rated by the rule engine and decided by you."
        actions={<><a className="btn ghost md" href="/export/invoices.csv"><Icon n="down" s={18} /><span>Export CSV</span></a><Link className="btn primary md" href="/verify"><Icon n="scan" s={18} /><span>Verify invoice</span></Link></>} />
      <div className="stat-row">
        {([["approved", "Strong"], ["referred", "Weak"], ["rejected", "Fail"]] as const).map(([k, label]) => (
          <Link key={k} className={`stat ${k}${st === k ? " on" : ""}`} href={`/verifications?${qs(f, { st: st === k ? "all" : k, page: null, open: null })}`}><span>{label}</span><b>{counts(k)}</b></Link>
        ))}
      </div>
      <section className="card nopad">
        <form className="toolbar" method="get">
          <SearchBox value={q} placeholder="Search invoice, TRN or supplier" />
          <Seg name="st" value={st} label="Rating" options={[["all", "All"], ["approved", "Strong"], ["referred", "Weak"], ["rejected", "Fail"]]} />
          <Seg name="sort" value={sort} label="Sort" options={[["at", "Recent"], ["amount", "Amount"]]} />
        </form>
        {rows.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Invoice</th><th>Supplier</th><th>Application</th><th className="num">Amount excl. VAT</th><th className="num">VAT</th><th>Rating</th><th>Date</th></tr></thead>
            <tbody>
              {pg.rows.map((i) => (
                <tr key={i.id}>
                  <td><Link className="row-link" href={`/verifications?${qs(f, { open: i.id })}`}><b className="strong">{i.invoice_no}</b></Link></td>
                  <td>{i.supplier_name}<small className="sub mono">{i.supplier_trn}</small></td>
                  <td className="mono">{i.app.maskan_ref}</td>
                  <td className="num">{money(i.taxable_amount)}</td><td className="num">{money(i.vat_amount)}</td>
                  <td><RatingBadge s={i.status_ui} />{i.decision && <small className="sub">Decided by {i.decision.officer_id}</small>}</td>
                  <td className="muted">{fdate(i.invoice_date)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <Empty title="Nothing matches" text="Try a different search or clear the filters." clear="/verifications" />}
        <Pager p={pg.p} pages={pg.pages} current={f} path="/verifications" />
      </section>

      {v && (
        <div className="scrim drawer-wrap"><Link className="scrim-close" href={close} aria-label="Close" />
          <aside className="dialog drawer" role="dialog" aria-modal="true" aria-labelledby="dt">
            <header className="dialog-h"><span className="dialog-ic"><Icon n="shield" s={22} /></span><div className="dialog-t"><h2 id="dt">Invoice review</h2><p>{v.invoice_no}</p></div><Link className="icon-btn" href={close} aria-label="Close"><Icon n="x" s={18} /></Link></header>
            <div className="dialog-b">
              <div className={`verdict ${v.status_ui === "pending" ? "neutral" : v.status_ui}`}>
                <div className="verdict-top">
                  <span className="verdict-ic"><Icon n={v.status_ui === "approved" ? "check" : v.status_ui === "rejected" ? "x" : "clock"} s={26} /></span>
                  <div><p className="eyebrow">Application</p><h3 className="mono sm">{v.app.maskan_ref}</h3></div>
                  <span className={`stamp ${v.status_ui}`}>{{ approved: "STRONG", referred: "WEAK", rejected: "FAIL", pending: "PENDING" }[v.status_ui]}</span>
                </div>
                {v.rating_reasons.map((x) => <p key={x} className="muted">{x}</p>)}
              </div>
              <dl className="kv">
                <div><dt>Invoice number</dt><dd>{v.invoice_no}</dd></div><div><dt>Invoice date</dt><dd>{fdate(v.invoice_date)}</dd></div>
                <div><dt>Supplier</dt><dd><Link className="link" href={`/invoices?q=${v.supplier_trn}`}>{v.supplier_name}</Link></dd></div><div><dt>Supplier TRN</dt><dd className="mono">{v.supplier_trn}</dd></div>
                <div><dt>Amount excl. VAT</dt><dd>{money(v.taxable_amount)}</dd></div><div><dt>VAT claimed</dt><dd>{money(v.vat_amount)}</dd></div>
                <div><dt>Eligible VAT</dt><dd>{money(v.eligible_vat_amount)}</dd></div><div><dt>Supplier trust</dt><dd>{nice(typeof v.row.supplier_trust === "string" ? v.row.supplier_trust : v.row.supplier_trust.tier)}</dd></div>
              </dl>
              {v.fix_guidance.length > 0 && <><h3 className="sec">How to fix</h3><ul className="fixlist">{v.fix_guidance.map((g) => <li key={g}>{g}</li>)}</ul></>}
              <DocumentPanel doc={v.row.document} extraction={v.row.extraction} />
              <h3 className="sec">Rule checks</h3>
              <ul className="rules">
                {v.row.rule_results.map((x) => <li key={x.rule_id}><span className="rid mono">{x.rule_id}</span><Badge kind={x.result === "PASS" ? "approved" : x.result === "FAIL" ? "rejected" : x.result === "UNCERTAIN" ? "referred" : "neutral"}>{nice(x.result)}</Badge></li>)}
              </ul>
              {v.row.supplier_response ? (
                <><h3 className="sec">Supplier confirmation</h3>
                  <dl className="kv"><div><dt>Issued the invoice</dt><dd>{v.row.supplier_response.issued ? "Yes" : "No"}</dd></div><div><dt>Particulars confirmed</dt><dd>{v.row.supplier_response.particulars_confirmed ? "Yes" : "No"}</dd></div><div><dt>VAT return period</dt><dd>{v.row.supplier_response.vat_return_period ?? "—"}</dd></div><div><dt>Declared by</dt><dd>{v.row.supplier_response.declared_by}</dd></div></dl></>
              ) : v.row.confirmation_request ? <><h3 className="sec">Supplier confirmation</h3><p className="muted">Requested {fdt(v.row.confirmation_request.sent_at)}. Status: {nice(v.row.confirmation_request.status)}.</p></> : null}
              <ComplianceAdvice invoiceId={v.id} runs={v.row.agent_runs} />
              <h3 className="sec">History</h3>
              <Timeline items={[
                ...history.map((e) => ({ title: nice(e.action), sub: `by ${e.actor}`, at: fdt(e.at) })),
                ...(v.decision ? [{ title: `Officer decision: ${nice(v.decision.decision)}`, sub: v.decision.comment || `by ${v.decision.officer_id}`, at: fdt(v.decision.decided_at) }] : []),
              ]} />
              {!v.app.decided && !v.decision ? (
                <form className="actions-box" action={decideInvoiceAction}>
                  <input type="hidden" name="id" value={v.id} /><input type="hidden" name="back_to" value="/verifications" />
                  <p className="muted small">The rating is a recommendation. Your decision is final for this invoice.</p>
                  <div className="field"><label htmlFor="c">Note (optional)</label><textarea id="c" name="comment" rows={2} placeholder="Add a short note…" /></div>
                  <div className="row">
                    <button className="btn primary md" name="decision" value="approve"><Icon n="check" s={18} /><span>Approve invoice</span></button>
                    <button className="btn ghost md danger" name="decision" value="reject"><Icon n="x" s={18} /><span>Reject invoice</span></button>
                  </div>
                </form>
              ) : v.app.decided ? <p className="muted small">The application is already {v.app.label.toLowerCase()}, so this invoice is locked.</p> : null}
            </div>
          </aside>
        </div>
      )}
    </Shell>
  );
}
