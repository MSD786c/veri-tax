import Link from "next/link";
import { fileHref, SOURCE } from "@/components/review";
import Shell from "@/components/Shell";
import { guard } from "@/components/states";
import { Badge, Empty, Icon, PageHead, Pager, SearchBox } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { fdt, flat, match, money, nice, paginate, type Params } from "@/lib/format";
import type { ApplicationSummary, DocumentRow, Tone } from "@/lib/types";

export const metadata = { title: "Documents · Federal Tax Authority" };

const STATUS: Record<string, Tone> = { EXTRACTED: "approved", EXTRACTING: "gold", UPLOADED: "neutral", FAILED: "rejected" };

const load = () => Promise.all([apiGet<DocumentRow[]>("/fta/documents"), apiGet<ApplicationSummary[]>("/fta/applications")]);

export default async function Documents({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const r = await guard(load);
  if (!r.ok) return <Shell route="documents" msg={f.msg}>{r.error}</Shell>;
  const [docs, apps] = r.data;
  const appId = new Map(apps.map((a) => [a.maskan_ref, a.id]));
  const val = (d: DocumentRow, k: string) => d.extraction?.fields[k]?.value;
  const q = f.q ?? "";
  const rows = docs.filter((d) => match(q, d.document.filename, String(val(d, "supplier_name") ?? ""), String(val(d, "invoice_no") ?? ""), ...d.linked_invoices.map((l) => `${l.invoice_no} ${l.maskan_ref}`)));
  const pg = paginate(rows, f.page);
  const linked = docs.filter((d) => d.linked_invoices.length).length;
  return (
    <Shell route="documents" msg={f.msg}>
      <PageHead title="Documents" lead="Original invoices uploaded through Maskan, with what was read from each and the claims they back." />
      <div className="stat-row three">
        <div className="stat static"><span>Documents</span><b>{docs.length}</b></div>
        <div className="stat approved"><span>Linked to an invoice</span><b>{linked}</b></div>
        <div className="stat referred"><span>Not linked yet</span><b>{docs.length - linked}</b></div>
      </div>
      <section className="card nopad">
        <form className="toolbar" method="get"><SearchBox value={q} placeholder="Search file, supplier, invoice or application" /></form>
        {rows.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Document</th><th>Status</th><th>Type</th><th>Supplier</th><th>Invoice no.</th><th className="num">Total</th><th>Linked to</th></tr></thead>
            <tbody>
              {pg.rows.map((d) => {
                const total = val(d, "total");
                return (
                  <tr key={d.document.id}>
                    <td><a className="link" href={fileHref(d.document.id)} target="_blank" rel="noopener">{d.document.filename}</a><small className="sub">{SOURCE[d.document.source] ?? nice(d.document.source)} · {fdt(d.document.uploaded_at)}</small></td>
                    <td><Badge kind={STATUS[d.document.status] ?? "neutral"}>{nice(d.document.status)}</Badge>{d.document.error && <small className="sub">{d.document.error}</small>}</td>
                    <td>{d.extraction ? nice(d.extraction.document_type) : "—"}</td>
                    <td>{String(val(d, "supplier_name") ?? "—")}<small className="sub mono">{String(val(d, "supplier_trn") ?? "")}</small></td>
                    <td className="mono">{String(val(d, "invoice_no") ?? "—")}</td>
                    <td className="num">{typeof total === "number" ? money(total) : "—"}</td>
                    <td>{d.linked_invoices.length ? d.linked_invoices.map((l) => (
                      <span className="linked" key={l.invoice_id}>
                        <Link className="link" href={`/verifications?open=${l.invoice_id}`}>{l.invoice_no}</Link>
                        <Icon n="arrow" s={13} />
                        {appId.has(l.maskan_ref) ? <Link className="link mono" href={`/applications?open=${appId.get(l.maskan_ref)}`}>{l.maskan_ref}</Link> : <span className="mono">{l.maskan_ref}</span>}
                      </span>
                    )) : <span className="muted">Not linked</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        ) : <Empty title={docs.length ? "Nothing matches" : "No documents yet"} text={docs.length ? "Try a different search." : "Originals appear here once an applicant uploads them through Maskan."} clear={docs.length ? "/documents" : undefined} />}
        <Pager p={pg.p} pages={pg.pages} current={f} path="/documents" />
      </section>
    </Shell>
  );
}
