import Link from "next/link";
import Shell from "@/components/Shell";
import { ErrorState, guard } from "@/components/states";
import { Badge, Empty, Icon, PageHead, RatingBadge } from "@/components/ui";
import { getProject, ratingStatus } from "@/lib/data";
import { fdate, flat, money, nice, type Params } from "@/lib/format";
import { pct, RatingCounts, Ring, statusBadge } from "@/components/project";

export const metadata = { title: "Project · Federal Tax Authority" };

const yes = (b: boolean, y: string, n: string) => <Badge kind={b ? "approved" : "neutral"}>{b ? y : n}</Badge>;

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ permit: string }>; searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const raw = (await params).permit;
  let permit = raw; // Next leaves %2F encoded in params, so "BP/2026-1" arrives as "BP%2F2026-1"
  try { permit = decodeURIComponent(raw); } catch { /* malformed escape: use as is */ }
  const r = await guard(() => getProject(permit));
  if (!r.ok) return <Shell route="projects" msg={f.msg}>{r.error}</Shell>;
  if (!r.data) return <Shell route="projects" msg={f.msg}><ErrorState code={404} title="Project not found" text={`No visible case for permit ${permit}. It appears once an invoice has been uploaded and its supplier has answered.`} /></Shell>;
  const { project: p, invoices } = r.data;

  return (
    <Shell route="projects" msg={f.msg}>
      <p><Link className="link" href="/projects"><Icon n="chevl" s={14} /> All projects</Link></p>
      <PageHead title={p.permit_no} lead={<>{p.applicant_name} · Plot {p.plot_no || "—"} · {p.emirate || "—"}</>}
        actions={<Link className="btn ghost md" href={`/applications?open=${p.application_id}`}><Icon n="doc" s={18} /><span>Application {p.maskan_ref}</span></Link>} />
      <section className="card">
        <div className="ent-hero"><Ring pct={pct(p.vat_eligible, p.vat_claimed)} /><div><p className="eyebrow">VAT eligible</p><h3>{money(p.vat_eligible)} <small>of {money(p.vat_claimed)}</small></h3>
          <div className="ent-chips">{statusBadge(p.status)}<small className="muted"><RatingCounts p={p} /></small></div></div></div>
        <dl className="kv">
          <div><dt>Building permit</dt><dd className="mono">{p.permit_no}</dd></div><div><dt>Maskan reference</dt><dd className="mono">{p.maskan_ref}</dd></div>
          <div><dt>Permit date</dt><dd>{fdate(p.permit_date)}</dd></div><div><dt>Completion date</dt><dd>{fdate(p.completion_date)}</dd></div>
          <div><dt>Applicant</dt><dd>{p.applicant_name}</dd></div><div><dt>Plot</dt><dd>{p.plot_no || "—"}</dd></div>
        </dl>
      </section>
      <section className="card nopad" style={{ marginTop: 20 }}>
        {invoices.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Invoice</th><th>Supplier</th><th>Date</th><th className="num">Total</th><th className="num">VAT</th><th>Rating</th><th>Status</th><th>Evidence</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td><Link className="row-link" href={`/verifications?open=${i.id}`}><b className="strong">{i.invoice_no}</b></Link></td>
                  <td>{i.supplier_name || <span className="mono">{i.supplier_trn}</span>}</td><td className="muted">{fdate(i.invoice_date)}</td>
                  <td className="num">{money(i.total)}</td><td className="num">{money(i.vat_amount)}</td>
                  <td><RatingBadge s={ratingStatus(i.rating)} /></td><td>{nice(i.status)}</td>
                  <td><span className="ent-chips">{yes(i.has_document, "Document", "No document")}{yes(i.supplier_responded, "Supplier answered", "Awaiting supplier")}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <Empty icon="file" title="No invoices" text="This project has no invoices yet." />}
      </section>
    </Shell>
  );
}
