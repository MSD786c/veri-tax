import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { post } from "../../api/client.ts";
import type { Application, ClaimType, IngestApplication, IngestInvoice } from "../../api/types.ts";
import { Banner, Card, Chip, ErrorBanner, Field, PageHeader } from "../../components/ui.tsx";
import { aed, todayIso } from "../../lib/format.ts";
import { EMIRATES, statusInfo } from "../../lib/status.ts";

const SUPPLIERS = [
  ["100111111100003", "Al Noor Building Contracting LLC"],
  ["100222222200003", "Gulf Steel & Cement Trading"],
  ["100333333300003", "Desert Rose Electrical Works"],
  ["100444444400003", "Emirates Home Furnishing LLC"],
];
const WORKS = [
  "Concrete and block work for ground floor",
  "Waterproofing and roof insulation",
  "Plumbing first fix and sanitary ware",
  "Ceramic floor tiling supply and installation",
  "Aluminium windows and doors",
  "Electrical wiring and DB installation",
];

const daysAgo = (d: number) => todayIso(new Date(Date.now() - d * 86_400_000));
const rand = (n: number) => Math.floor(Math.random() * n);
const vatOf = (taxable: number) => Math.round(taxable * 5) / 100;

interface Row extends Omit<IngestInvoice, "taxable_amount" | "vat_amount" | "total"> {
  taxable: string;
  vat: string;
  total: string;
  auto: boolean;
}

function newRow(plot: string, i = 0): Row {
  const [trn, name] = SUPPLIERS[i % 3];
  const taxable = (20 + rand(180)) * 1000;
  return {
    supplier_trn: trn,
    supplier_name: name,
    invoice_no: `${name.split(" ").filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).join("").slice(0, 3).toUpperCase()}-${1000 + rand(9000)}`,
    invoice_date: daysAgo(90 + rand(200)),
    title: "Tax Invoice",
    taxable: String(taxable),
    vat: vatOf(taxable).toFixed(2),
    total: (taxable + vatOf(taxable)).toFixed(2),
    auto: true,
    plot_no: plot,
    description: WORKS[rand(WORKS.length)],
  };
}

function sample() {
  const plot = `DXB-${100 + rand(900)}-${10 + rand(90)}`;
  return {
    maskan_ref: `MSK-SIM-${Date.now().toString().slice(-6)}`,
    applicant_name: ["Saeed Al Mazrouei", "Noura Al Dhaheri", "Omar Al Suwaidi", "Hessa Al Falasi"][rand(4)],
    emirates_id: `784-19${70 + rand(30)}-${String(1_000_000 + rand(8_999_999))}-${rand(10)}`,
    plot_no: plot,
    emirate: "Dubai",
    completion_date: daysAgo(30 + rand(60)),
    claim_type: "NEW_RESIDENCE" as ClaimType,
    rows: [newRow(plot, 0), newRow(plot, 1), newRow(plot, 2)],
  };
}

export default function MaskanSubmit() {
  const [form, setForm] = useState(sample);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Application | null>(null);

  const setRow = (i: number, patch: Partial<Row>) =>
    setForm((f) => {
      const rows = f.rows.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        if (next.auto && "taxable" in patch) {
          const t = Number(next.taxable) || 0;
          next.vat = vatOf(t).toFixed(2);
          next.total = (t + vatOf(t)).toFixed(2);
        }
        return next;
      });
      return { ...f, rows };
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { rows, ...app } = form;
    const payload: IngestApplication = {
      ...app,
      invoices: rows.map(({ taxable, vat, total, auto: _auto, ...r }) => ({
        ...r,
        taxable_amount: Number(taxable),
        vat_amount: Number(vat),
        total: Number(total),
      })),
    };
    try {
      setCreated(await post<Application>("/maskan/applications", payload));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  const totalVat = form.rows.reduce((s, r) => s + (Number(r.vat) || 0), 0);

  return (
    <>
      <PageHeader
        title="Submit a test application"
        subtitle="Stands in for the Maskan app. The application is ingested, every invoice is checked by the rule engine, and suppliers get confirmation requests."
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => { setForm(sample()); setCreated(null); }}>
            New random sample
          </button>
        }
      />
      {created && (
        <Banner tone="good" title={`${created.maskan_ref} ingested`}>
          <p>
            Status: <Chip {...statusInfo.application(created.status)} />
          </p>
          <p>
            <Link to={`/fta/applications/${created.id}`}>Open it in the FTA dashboard →</Link> · Confirm its invoices as a supplier from the{" "}
            <Link to="/?as=supplier">supplier sign-in</Link>.
          </p>
        </Banner>
      )}
      <ErrorBanner error={error} />
      <form onSubmit={submit}>
        <Card title="Applicant and residence">
          <div className="form-grid">
            <Field label="Maskan reference" htmlFor="ref">
              <input id="ref" required value={form.maskan_ref} onChange={(e) => setForm({ ...form, maskan_ref: e.target.value })} />
            </Field>
            <Field label="Applicant name" htmlFor="name">
              <input id="name" required value={form.applicant_name} onChange={(e) => setForm({ ...form, applicant_name: e.target.value })} />
            </Field>
            <Field label="Emirates ID" htmlFor="eid" hint="Hashed by the API before storage.">
              <input id="eid" required value={form.emirates_id} onChange={(e) => setForm({ ...form, emirates_id: e.target.value })} />
            </Field>
            <Field label="Plot number" htmlFor="plot">
              <input id="plot" required value={form.plot_no} onChange={(e) => setForm({ ...form, plot_no: e.target.value })} />
            </Field>
            <Field label="Emirate" htmlFor="emirate">
              <select id="emirate" value={form.emirate} onChange={(e) => setForm({ ...form, emirate: e.target.value })}>
                {EMIRATES.map((em) => (
                  <option key={em}>{em}</option>
                ))}
              </select>
            </Field>
            <Field label="Completion date" htmlFor="completion" hint="Claims must be lodged within 12 months of completion (NR-04).">
              <input id="completion" type="date" required value={form.completion_date} onChange={(e) => setForm({ ...form, completion_date: e.target.value })} />
            </Field>
            <Field label="Claim type" htmlFor="claim">
              <select id="claim" value={form.claim_type} onChange={(e) => setForm({ ...form, claim_type: e.target.value as ClaimType })}>
                <option value="NEW_RESIDENCE">New residence</option>
                <option value="RETENTION">Retention</option>
                <option value="ADDITION">Addition</option>
              </select>
            </Field>
          </div>
        </Card>

        <Card
          title={`Invoices (${form.rows.length})`}
          subtitle={`VAT claimed ${aed(totalVat)}. Try a furniture description, a wrong plot or a VAT figure that doesn't add up to see the rules reject it.`}
          actions={
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...form, rows: [...form.rows, newRow(form.plot_no, form.rows.length)] })}>
              Add invoice
            </button>
          }
        >
          {form.rows.map((r, i) => (
            <fieldset key={i} className="invoice-row">
              <legend>
                Invoice {i + 1}
                {form.rows.length > 1 && (
                  <button type="button" className="link-button" onClick={() => setForm({ ...form, rows: form.rows.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                )}
              </legend>
              <div className="form-grid">
                <Field label="Supplier" htmlFor={`sup-${i}`}>
                  <select
                    id={`sup-${i}`}
                    value={r.supplier_trn}
                    onChange={(e) => setRow(i, { supplier_trn: e.target.value, supplier_name: SUPPLIERS.find(([t]) => t === e.target.value)?.[1] ?? "" })}
                  >
                    {SUPPLIERS.map(([t, n]) => (
                      <option key={t} value={t}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Document title" htmlFor={`title-${i}`}>
                  <select id={`title-${i}`} value={r.title} onChange={(e) => setRow(i, { title: e.target.value })}>
                    <option>Tax Invoice</option>
                    <option>Proforma Invoice</option>
                    <option>Quotation</option>
                  </select>
                </Field>
                <Field label="Invoice number" htmlFor={`no-${i}`}>
                  <input id={`no-${i}`} required value={r.invoice_no} onChange={(e) => setRow(i, { invoice_no: e.target.value })} />
                </Field>
                <Field label="Invoice date" htmlFor={`date-${i}`}>
                  <input id={`date-${i}`} type="date" required value={r.invoice_date} onChange={(e) => setRow(i, { invoice_date: e.target.value })} />
                </Field>
                <Field label="Taxable amount (AED)" htmlFor={`tax-${i}`}>
                  <input id={`tax-${i}`} type="number" step="0.01" min="0" required value={r.taxable} onChange={(e) => setRow(i, { taxable: e.target.value })} />
                </Field>
                <Field label="VAT (AED)" htmlFor={`vat-${i}`}>
                  <input id={`vat-${i}`} type="number" step="0.01" min="0" required value={r.vat} onChange={(e) => setRow(i, { vat: e.target.value, auto: false })} />
                </Field>
                <Field label="Total (AED)" htmlFor={`total-${i}`}>
                  <input id={`total-${i}`} type="number" step="0.01" min="0" required value={r.total} onChange={(e) => setRow(i, { total: e.target.value, auto: false })} />
                </Field>
                <Field label="Plot on invoice" htmlFor={`iplot-${i}`}>
                  <input id={`iplot-${i}`} value={r.plot_no} onChange={(e) => setRow(i, { plot_no: e.target.value })} />
                </Field>
                <Field label="Description" htmlFor={`desc-${i}`}>
                  <input id={`desc-${i}`} value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} />
                </Field>
              </div>
              {!r.auto && (
                <button type="button" className="link-button small" onClick={() => setRow(i, { auto: true, taxable: r.taxable })}>
                  Recalculate VAT and total from the taxable amount
                </button>
              )}
            </fieldset>
          ))}
        </Card>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Submitting…" : "Submit to veri-tax"}
          </button>
        </div>
      </form>
    </>
  );
}
