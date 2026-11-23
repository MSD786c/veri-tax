import Link from "next/link";
import Shell from "@/components/Shell";
import { guard } from "@/components/states";
import { Empty, Icon, PageHead, Pager, RatingBadge, SearchBox } from "@/components/ui";
import { loadAll } from "@/lib/data";
import { fdate, flat, match, money, paginate, type Params } from "@/lib/format";

export const metadata = { title: "Invoices · Federal Tax Authority" };

export default async function Invoices({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const r = await guard(loadAll);
  if (!r.ok) return <Shell route="invoices" msg={f.msg}>{r.error}</Shell>;
  const q = f.q ?? "";
  const rows = r.data.invoices.filter((i) => match(q, i.invoice_no, i.supplier_trn, i.supplier_name, i.app.maskan_ref)).sort((a, b) => b.invoice_date.localeCompare(a.invoice_date));
  const pg = paginate(rows, f.page);
  return (
    <Shell route="invoices" msg={f.msg}>
      <PageHead title="Invoices" lead="All supplier invoices submitted with refund claims."
        actions={<a className="btn ghost md" href="/export/invoices.csv"><Icon n="down" s={18} /><span>Export CSV</span></a>} />
      <div className="stat-row three">
        <div className="stat static"><span>Invoice value</span><b>{money(rows.reduce((a, i) => a + i.taxable_amount, 0))}</b></div>
        <div className="stat static"><span>VAT on invoices</span><b>{money(rows.reduce((a, i) => a + i.vat_amount, 0))}</b></div>
        <div className="stat static"><span>Invoices</span><b>{rows.length}</b></div>
      </div>
      <section className="card nopad">
        <form className="toolbar" method="get"><SearchBox value={q} placeholder="Search invoice, TRN or supplier" /></form>
        {rows.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Invoice</th><th>Supplier TRN</th><th>Date</th><th className="num">Amount</th><th className="num">VAT</th><th>Rating</th></tr></thead>
            <tbody>
              {pg.rows.map((v) => (
                <tr key={v.id}>
                  <td><Link className="row-link" href={`/verifications?open=${v.id}`}><b className="strong">{v.invoice_no}</b></Link></td>
                  <td className="mono">{v.supplier_trn}</td><td className="muted">{fdate(v.invoice_date)}</td>
                  <td className="num">{money(v.taxable_amount)}</td><td className="num">{money(v.vat_amount)}</td><td><RatingBadge s={v.status_ui} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <Empty title="Nothing matches" text="Try a different search." clear="/invoices" />}
        <Pager p={pg.p} pages={pg.pages} current={f} path="/invoices" />
      </section>
    </Shell>
  );
}
