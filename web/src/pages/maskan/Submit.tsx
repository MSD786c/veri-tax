import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { post } from "../../api/client.ts";
import type { Application, ClaimType, IngestApplication, InvoiceType } from "../../api/types.ts";
import { Banner, Card, Chip, ErrorBanner, Field, PageHeader } from "../../components/ui.tsx";
import { aed, todayIso } from "../../lib/format.ts";
import { EMIRATES, statusInfo } from "../../lib/status.ts";

// The FTA registry suppliers from app/seed.py: [TRN, legal name, address].
export const SUPPLIERS: [string, string, string][] = [
  ["100111111100003", "Al Noor Building Contracting LLC", "Al Quoz Industrial Area 3, Dubai"],
  ["100222222200003", "Gulf Steel & Cement Trading", "Mussafah M-14, Abu Dhabi"],
  ["100333333300003", "Desert Rose Electrical Works", "Industrial Area 6, Sharjah"],
  ["100444444400003", "Emirates Home Furnishing LLC", "Sheikh Zayed Road, Dubai"],
  ["100555555500003", "Falcon Pools & Landscaping LLC", "Al Barsha South, Dubai"],
  ["100666666600003", "Oasis Security Systems LLC", "Electra Street, Abu Dhabi"],
  ["100777777700003", "Marina Aluminium & Glass LLC", "Ajman Industrial 2, Ajman"],
  ["100888888800003", "Sahara Plumbing Services (deregistered)", "Industrial Area 11, Sharjah"],
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

interface Row {
  supplier_trn: string;
  invoice_no: string;
  invoice_date: string;
  title: string;
  invoice_type: InvoiceType;
  /** Blank means the invoice is addressed to the applicant. */
  recipient_name: string;
  taxable: string;
  vat: string;
  total: string;
  auto: boolean;
  plot_no: string;
  description: string;
}

function newRow(plot: string, i = 0): Row {
  const [, name] = SUPPLIERS[i % 3];
  const taxable = (20 + rand(180)) * 1000;
  return {
    supplier_trn: SUPPLIERS[i % 3][0],
    invoice_no: `${name.split(" ").filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).join("").slice(0, 3).toUpperCase()}-${1000 + rand(9000)}`,
    invoice_date: daysAgo(90 + rand(200)),
    title: "Tax Invoice",
    invoice_type: "FULL",
    recipient_name: "",
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
    permit_date: daysAgo(400 + rand(100)),
    completion_date: daysAgo(30 + rand(60)),
    contract_value: "1500000",
    claim_type: "NEW_RESIDENCE" as ClaimType,
    rows: [newRow(plot, 0), newRow(plot, 1), newRow(plot, 2)],
  };
}

export default function MaskanSubmit() {
  const [form, setForm] = useState(sample);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ app: Application; emiratesId: string } | null>(null);

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
    const { rows, contract_value, ...app } = form;
    // The Article 59 particulars a real extraction would read off the document (app/rules.py TI-02, TI-08, TI-09).
    const payload: IngestApplication = {
      ...app,
      permit_date: app.permit_date || null,
      contract_value: contract_value ? Number(contract_value) : null,
      invoices: rows.map((r) => {
        const [trn, name, address] = SUPPLIERS.find(([t]) => t === r.supplier_trn) ?? SUPPLIERS[0];
        const taxable = Number(r.taxable);
        const simplified = r.invoice_type === "SIMPLIFIED";
        return {
          supplier_trn: trn,
          supplier_name: name.replace(/ \(deregistered\)$/, ""),
          supplier_address: address,
          invoice_no: r.invoice_no,
          invoice_date: r.invoice_date,
          title: r.title,
          invoice_type: r.invoice_type,
          recipient_name: simplified ? "" : r.recipient_name.trim() || app.applicant_name,
          recipient_address: simplified ? "" : `Plot ${r.plot_no || app.plot_no}`,
          line_items: simplified ? [] : [{ description: r.description, quantity: 1, unit_price: taxable, amount: taxable }],
          taxable_amount: taxable,
          vat_amount: Number(r.vat),
          total: Number(r.total),
          plot_no: r.plot_no,
          description: r.description,
        };
      }),
    };
    try {
      setCreated({ app: await post<Application>("/maskan/applications", payload), emiratesId: form.emirates_id });
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
        subtitle="Stands in for the Maskan app. The application is ingested, every invoice is checked and rated by the rule engine, and suppliers get confirmation requests."
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setForm(sample());
              setCreated(null);
            }}
          >
            New random sample
          </button>
        }
      />
      {created && (
        <Banner tone="good" title={`${created.app.maskan_ref} ingested`}>
          <p>
            Status: <Chip {...statusInfo.application(created.app.status)} />
          </p>
          <p>
            <Link to="/maskan/status" state={{ ref: created.app.maskan_ref, emiratesId: created.emiratesId }}>
              See what the applicant sees →
            </Link>{" "}
            · <Link to={`/fta/applications/${created.app.id}`}>Open it in the FTA dashboard</Link> · Confirm its invoices from the{" "}
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
            <Field label="Emirates ID" htmlFor="eid" hint="Stored only as a keyed hash.">
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
            <Field label="Building permit date" htmlFor="permit" hint="Invoices dated before it go to review (NR-03).">
              <input id="permit" type="date" value={form.permit_date} onChange={(e) => setForm({ ...form, permit_date: e.target.value })} />
            </Field>
            <Field label="Completion date" htmlFor="completion" hint="Claims must be lodged within 12 months of completion (NR-04).">
              <input id="completion" type="date" required value={form.completion_date} onChange={(e) => setForm({ ...form, completion_date: e.target.value })} />
            </Field>
            <Field label="Construction contract value (AED)" htmlFor="contract" hint="Invoices above 110% of it flag the application (CS-01).">
              <input id="contract" type="number" min="0" step="1000" value={form.contract_value} onChange={(e) => setForm({ ...form, contract_value: e.target.value })} />
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
          subtitle={`VAT claimed ${aed(totalVat)}. To see the agent rate an invoice fail, try furniture in the description, a simplified tax invoice, a VAT figure that doesn't add up, or the deregistered supplier.`}
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
                  <select id={`sup-${i}`} value={r.supplier_trn} onChange={(e) => setRow(i, { supplier_trn: e.target.value })}>
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
                <Field label="Invoice type" htmlFor={`type-${i}`}>
                  <select id={`type-${i}`} value={r.invoice_type} onChange={(e) => setRow(i, { invoice_type: e.target.value as InvoiceType })}>
                    <option value="FULL">Full tax invoice</option>
                    <option value="SIMPLIFIED">Simplified tax invoice</option>
                  </select>
                </Field>
                <Field label="Invoice number" htmlFor={`no-${i}`}>
                  <input id={`no-${i}`} required value={r.invoice_no} onChange={(e) => setRow(i, { invoice_no: e.target.value })} />
                </Field>
                <Field label="Invoice date" htmlFor={`date-${i}`}>
                  <input id={`date-${i}`} type="date" required value={r.invoice_date} onChange={(e) => setRow(i, { invoice_date: e.target.value })} />
                </Field>
                <Field label="Addressed to" htmlFor={`to-${i}`} hint="Blank: the applicant.">
                  <input id={`to-${i}`} placeholder={form.applicant_name} value={r.recipient_name} disabled={r.invoice_type === "SIMPLIFIED"} onChange={(e) => setRow(i, { recipient_name: e.target.value })} />
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
