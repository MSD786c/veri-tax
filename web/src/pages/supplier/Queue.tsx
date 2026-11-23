import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { post } from "../../api/client.ts";
import type { RequestView, SupplierResponseIn } from "../../api/types.ts";
import { useAuth } from "../../auth.tsx";
import { Banner, Card, Chip, Empty, ErrorBanner, Field, Loading, PageHeader, StatTile, TableWrap } from "../../components/ui.tsx";
import { useDeclarant } from "../../lib/declarant.ts";
import { aed, aedCompact, daysUntil, dueLabel, fmtDate, todayIso } from "../../lib/format.ts";
import { isValidPeriod, periodOptions } from "../../lib/periods.ts";
import { statusInfo } from "../../lib/status.ts";
import { useApi } from "../../lib/useApi.ts";

type Tab = "PENDING" | "RESPONDED" | "ALL";

export default function Queue() {
  const { session } = useAuth();
  const { data, error, loading, reload } = useApi<RequestView[]>("/supplier/requests");
  const [tab, setTab] = useState<Tab>("PENDING");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<RequestView[] | null>(null);

  const all = data ?? [];
  const pending = all.filter((r) => r.request.status === "PENDING");
  const dueSoon = pending.filter((r) => daysUntil(r.request.due_at) <= 3);
  const responded = all.filter((r) => r.request.status === "RESPONDED");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? [])
      .filter((r) => tab === "ALL" || r.request.status === tab)
      .filter(
        (r) =>
          !q ||
          [r.invoice.invoice_no, r.application.applicant_name, r.application.maskan_ref, r.application.plot_no].some((f) =>
            f.toLowerCase().includes(q),
          ),
      );
  }, [data, tab, search]);

  const selectable = rows.filter((r) => r.request.status === "PENDING");
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.request.id));
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (session?.role !== "supplier") return null;
  return (
    <>
      <PageHeader
        title="Invoice confirmations"
        subtitle={`Tax invoices applicants have submitted under TRN ${session.trn}. Confirm each one, or tell us it isn't yours.`}
        actions={
          <Link className="btn btn-secondary" to="/supplier/upload">
            Respond by CSV
          </Link>
        }
      />
      <ErrorBanner error={error} />
      {result && <BulkResult views={result} onClose={() => setResult(null)} />}

      <div className="stat-row">
        <StatTile label="Awaiting your confirmation" value={pending.length} tone="info" />
        <StatTile label="Due within 3 days" value={dueSoon.length} tone={dueSoon.length ? "warning" : undefined} sub={dueSoon.some((r) => daysUntil(r.request.due_at) < 0) ? "Some are overdue" : undefined} />
        <StatTile label="VAT on pending invoices" value={aedCompact(pending.reduce((s, r) => s + r.invoice.vat_amount, 0))} />
        <StatTile label="Responded" value={responded.length} tone="good" />
      </div>

      {selected.size > 0 && (
        <BulkConfirm
          views={all.filter((r) => selected.has(r.request.id))}
          onDone={(views) => {
            setSelected(new Set());
            setResult(views);
            reload();
          }}
          onCancel={() => setSelected(new Set())}
        />
      )}

      <Card flush>
        <div className="toolbar">
          <div className="tabs" role="tablist" aria-label="Filter by status">
            {(
              [
                ["PENDING", `Pending (${pending.length})`],
                ["RESPONDED", `Responded (${responded.length})`],
                ["ALL", `All (${all.length})`],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>
          <input className="search" type="search" placeholder="Search invoice, applicant, plot…" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {loading && !data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title={tab === "PENDING" ? "Nothing waiting for you" : "No invoices match"}>
            {tab === "PENDING" ? "New confirmation requests appear here when an applicant submits one of your invoices." : "Try a different search or tab."}
          </Empty>
        ) : (
          <TableWrap busy={loading}>
            <table className="table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label="Select all pending"
                      disabled={!selectable.length}
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.request.id)))}
                    />
                  </th>
                  <th>Invoice</th>
                  <th>Applicant</th>
                  <th>Plot</th>
                  <th className="num">Total</th>
                  <th className="num">VAT</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const days = daysUntil(r.request.due_at);
                  const isPending = r.request.status === "PENDING";
                  return (
                    <tr key={r.request.id} className={selected.has(r.request.id) ? "selected" : ""}>
                      <td className="col-check">
                        {isPending && (
                          <input type="checkbox" aria-label={`Select ${r.invoice.invoice_no}`} checked={selected.has(r.request.id)} onChange={() => toggle(r.request.id)} />
                        )}
                      </td>
                      <td>
                        <Link className="row-link" to={`/supplier/requests/${r.request.id}`}>
                          {r.invoice.invoice_no}
                        </Link>
                        <div className="cell-sub">{fmtDate(r.invoice.invoice_date)}</div>
                      </td>
                      <td>
                        {r.application.applicant_name}
                        <div className="cell-sub">{r.application.maskan_ref}</div>
                      </td>
                      <td>
                        {r.application.plot_no}
                        <div className="cell-sub">{r.application.emirate}</div>
                      </td>
                      <td className="num">{aed(r.invoice.total)}</td>
                      <td className="num">{aed(r.invoice.vat_amount)}</td>
                      <td className={isPending && days <= 3 ? "due-soon" : ""}>{isPending ? dueLabel(r.request.due_at) : fmtDate(r.response?.declared_at)}</td>
                      <td>
                        {isPending ? <Chip {...statusInfo.request(r.request.status)} /> : <Chip {...statusInfo.invoice(r.invoice.status)} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

function BulkResult({ views, onClose }: { views: RequestView[]; onClose: () => void }) {
  const verified = views.filter((v) => v.invoice.status === "VERIFIED").length;
  return (
    <Banner tone="good" title={`${views.length} invoice${views.length === 1 ? "" : "s"} confirmed`}>
      {verified} verified{views.length - verified ? `, ${views.length - verified} sent to the FTA for review` : ""}.{" "}
      <button className="link-button" onClick={onClose}>
        Dismiss
      </button>
    </Banner>
  );
}

/** Confirm several invoices with one declaration: issued, particulars as submitted, paid in full. */
function BulkConfirm({ views, onDone, onCancel }: { views: RequestView[]; onDone: (v: RequestView[]) => void; onCancel: () => void }) {
  const [declaredBy, setDeclaredBy] = useDeclarant();
  const [receivedDate, setReceivedDate] = useState(todayIso());
  const earliest = views.map((v) => v.invoice.invoice_date).sort()[0];
  const options = periodOptions("quarterly", earliest, todayIso());
  const [chosen, setPeriod] = useState(options[0] ?? "");
  const period = options.includes(chosen) ? chosen : (options[0] ?? ""); // selection can change under us
  const [declaration, setDeclaration] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const base: Omit<SupplierResponseIn, "declaration"> = {
      issued: true,
      particulars_confirmed: true,
      corrections: {},
      consideration_status: "RECEIVED",
      amount_received: null,
      received_date: receivedDate,
      retention_amount: null,
      retention_release_date: null,
      vat_return_period: period,
      declared_by: declaredBy.trim(),
    };
    try {
      const items = views.map((v) => ({ ...base, amount_received: v.invoice.total, request_id: v.request.id, declaration }));
      onDone(await post<RequestView[]>("/supplier/requests/bulk-respond", { items }));
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  const ready = declaration && declaredBy.trim() && receivedDate && isValidPeriod(period);
  return (
    <Card
      className="bulk-panel"
      title={`Confirm ${views.length} selected invoice${views.length === 1 ? "" : "s"}`}
      subtitle="Use this only when every selected invoice was issued by you exactly as shown and paid in full. Answer any other invoice on its own page."
    >
      <ErrorBanner error={error} />
      <form className="form-grid" onSubmit={submit}>
        <Field label="Consideration received in full on" htmlFor="bulk-received">
          <input id="bulk-received" type="date" required value={receivedDate} max={todayIso()} onChange={(e) => setReceivedDate(e.target.value)} />
        </Field>
        <Field label="Declared in VAT return period" htmlFor="bulk-period" hint="Quarterly periods. For monthly filers, respond per invoice or by CSV.">
          <select id="bulk-period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Field>
        <Field label="Declared by (EmaraTax user)" htmlFor="bulk-declarant">
          <input id="bulk-declarant" required placeholder="Name or email" value={declaredBy} onChange={(e) => setDeclaredBy(e.target.value)} />
        </Field>
        <label className="check declaration span-all">
          <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} />
          <span>
            I declare that my company issued these {views.length} tax invoices with the particulars shown, received the consideration in full, and
            included the output VAT in the return for the period selected.
          </span>
        </label>
        <div className="form-actions span-all">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ready || busy}>
            {busy ? "Submitting…" : `Confirm ${views.length} invoice${views.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </Card>
  );
}
