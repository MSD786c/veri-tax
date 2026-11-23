import { useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { post } from "../../api/client.ts";
import type { ConsiderationStatus, Invoice, RequestView, SupplierResponse, SupplierResponseIn } from "../../api/types.ts";
import { Banner, Card, Chip, ErrorBanner, Field, KeyValues, Loading, PageHeader } from "../../components/ui.tsx";
import { useDeclarant } from "../../lib/declarant.ts";
import { aed, dueLabel, fmtDate, fmtDateTime, humanize, todayIso } from "../../lib/format.ts";
import { periodEndsBeforeInvoice, periodOptions, type PeriodKind } from "../../lib/periods.ts";
import { statusInfo } from "../../lib/status.ts";
import { useApi } from "../../lib/useApi.ts";

export default function RequestDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<RequestView>(`/supplier/requests/${id}`);
  const [justSubmitted, setJustSubmitted] = useState(false);

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBanner error={error} />;
  const { request, invoice, application, response } = data;

  return (
    <>
      <PageHeader
        back={{ to: "/supplier", label: "All confirmations" }}
        title={`Tax invoice ${invoice.invoice_no}`}
        subtitle={`Submitted by ${application.applicant_name} (${application.maskan_ref}) for a VAT refund on plot ${application.plot_no}, ${application.emirate}.`}
        actions={
          request.status === "PENDING" ? <Chip tone="info" label={dueLabel(request.due_at)} /> : <Chip {...statusInfo.invoice(invoice.status)} />
        }
      />
      {justSubmitted && response && <Outcome invoice={invoice} />}
      <div className="split">
        <Card title="What the applicant submitted" subtitle="Check these particulars against your own records.">
          <KeyValues
            items={[
              ["Document title", invoice.title],
              ["Invoice number", invoice.invoice_no],
              ["Date of issue", fmtDate(invoice.invoice_date)],
              ["Taxable amount", aed(invoice.taxable_amount)],
              ["VAT (5%)", aed(invoice.vat_amount)],
              ["Total", aed(invoice.total)],
              ["Plot / address", invoice.plot_no || "—"],
              ["Description", invoice.description || "—"],
            ]}
          />
          {invoice.document_uri ? (
            <a className="btn btn-secondary btn-sm" href={invoice.document_uri} target="_blank" rel="noreferrer noopener">
              Open the original document
            </a>
          ) : (
            <p className="muted small">The original scan will appear here once document storage is connected.</p>
          )}
        </Card>
        {request.status === "PENDING" ? (
          <ConfirmForm
            invoice={invoice}
            requestId={request.id}
            onDone={() => {
              setJustSubmitted(true);
              reload();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ) : response ? (
          <ResponseSummary response={response} invoice={invoice} />
        ) : (
          <Card title="Request closed">
            <p>This request is {request.status.toLowerCase()} and can no longer be answered here.</p>
          </Card>
        )}
      </div>
    </>
  );
}

function Outcome({ invoice }: { invoice: Invoice }) {
  if (invoice.status === "VERIFIED")
    return <Banner tone="good" title="Thank you — your confirmation is recorded">Your answers match the invoice the applicant submitted.</Banner>;
  if (invoice.status === "DISPUTED")
    return <Banner tone="serious" title="Recorded: you did not issue this invoice">The FTA will follow up with the applicant. No further action is needed from you.</Banner>;
  return (
    <Banner tone="warning" title="Recorded and sent to the FTA for review">
      Some of your answers differ from what the applicant submitted, or are incomplete. An FTA officer will review them.
    </Banner>
  );
}

function ResponseSummary({ response: r, invoice }: { response: SupplierResponse; invoice: Invoice }) {
  const items: [string, ReactNode][] = [["Issued this invoice", r.issued ? "Yes" : "No"]];
  if (r.issued) {
    items.push(["Particulars match", r.particulars_confirmed ? "Yes" : "No, corrected"]);
    for (const [k, v] of Object.entries(r.corrections)) items.push([`Corrected ${humanize(k).toLowerCase()}`, String(v)]);
    items.push(["Consideration", r.consideration_status === "RECEIVED" ? "Received in full" : "Partly received or retention"]);
    if (r.received_date) items.push(["Received on", fmtDate(r.received_date)]);
    if (r.amount_received !== null) items.push(["Amount received", aed(r.amount_received)]);
    if (r.retention_amount !== null) items.push(["Retention", aed(r.retention_amount)]);
    if (r.retention_release_date) items.push(["Expected release", fmtDate(r.retention_release_date)]);
    items.push(["VAT return period", r.vat_return_period ?? "—"]);
  }
  items.push(["Declared by", r.declared_by], ["Declared at", fmtDateTime(r.declared_at)]);
  return (
    <Card title="Your response" actions={<Chip {...statusInfo.invoice(invoice.status)} />}>
      <KeyValues items={items} />
    </Card>
  );
}

const CORRECTABLE: { key: keyof Invoice; label: string; type: "text" | "date" | "number" }[] = [
  { key: "invoice_no", label: "Invoice number", type: "text" },
  { key: "invoice_date", label: "Date of issue", type: "date" },
  { key: "taxable_amount", label: "Taxable amount (AED)", type: "number" },
  { key: "vat_amount", label: "VAT amount (AED)", type: "number" },
  { key: "total", label: "Total (AED)", type: "number" },
];

type Errors = Partial<Record<string, string>>;

function YesNo({ name, value, onChange, yes, no }: { name: string; value: boolean | null; onChange: (v: boolean) => void; yes: string; no: string }) {
  return (
    <div className="choice-row" role="radiogroup">
      <label className={`choice ${value === true ? "on" : ""}`}>
        <input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} />
        {yes}
      </label>
      <label className={`choice ${value === false ? "on" : ""}`}>
        <input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} />
        {no}
      </label>
    </div>
  );
}

function Step({ n, title, children, error }: { n: number; title: string; children: ReactNode; error?: string }) {
  return (
    <fieldset className={`step ${error ? "field-error" : ""}`}>
      <legend>
        <span className="step-n">{n}</span>
        {title}
      </legend>
      {children}
      {error && <p className="error-text">{error}</p>}
    </fieldset>
  );
}

/** The four questions from README "Supplier confirmation", plus the declaration. */
function ConfirmForm({ invoice, requestId, onDone }: { invoice: Invoice; requestId: number; onDone: () => void }) {
  const [issued, setIssued] = useState<boolean | null>(null);
  const [match, setMatch] = useState<boolean | null>(null);
  const [fix, setFix] = useState<Record<string, string>>(() =>
    Object.fromEntries(CORRECTABLE.map((c) => [c.key, String(invoice[c.key] ?? "")])),
  );
  const [consideration, setConsideration] = useState<ConsiderationStatus | null>(null);
  const [receivedDate, setReceivedDate] = useState("");
  const [amountReceived, setAmountReceived] = useState(String(invoice.total));
  const [retention, setRetention] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [periodKind, setPeriodKind] = useState<PeriodKind>("quarterly");
  const [period, setPeriod] = useState("");
  const [declaredBy, setDeclaredBy] = useDeclarant();
  const [declaration, setDeclaration] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [apiError, setApiError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const today = todayIso();
  const periods = periodOptions(periodKind, invoice.invoice_date, today);
  const corrections = Object.fromEntries(
    CORRECTABLE.flatMap((c) => {
      const raw = fix[c.key].trim();
      const value = c.type === "number" ? Number(raw) : raw;
      return value !== invoice[c.key] && raw !== "" ? [[c.key, value]] : [];
    }),
  ) as Record<string, string | number>;

  const received = Number(amountReceived || 0);
  const retained = Number(retention || 0);
  const splitMismatch = consideration === "PARTIAL_OR_RETENTION" && retention !== "" && Math.abs(received + retained - invoice.total) > 0.05;

  function validate(): Errors {
    const e: Errors = {};
    if (issued === null) e.issued = "Tell us whether you issued this invoice.";
    if (issued) {
      if (match === null) e.match = "Tell us whether the particulars match.";
      if (match === false && Object.keys(corrections).length === 0) e.match = "Change at least one field to what you actually issued.";
      for (const c of CORRECTABLE) if (c.type === "number" && fix[c.key].trim() !== "" && !(Number(fix[c.key]) >= 0)) e.match = `${c.label} must be a number.`;
      if (!consideration) e.consideration = "Choose how the consideration stands.";
      if (consideration === "RECEIVED" && !receivedDate) e.consideration = "Enter the date you received payment.";
      if (consideration === "PARTIAL_OR_RETENTION" && (!retention || !releaseDate || amountReceived === ""))
        e.consideration = "Enter the amount received, the amount retained and the expected release date.";
      if (!period) e.period = "Choose the VAT return period.";
    }
    if (!declaredBy.trim()) e.declaredBy = "Enter your name or EmaraTax user email.";
    if (!declaration) e.declaration = "You must accept the declaration.";
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    const body: SupplierResponseIn = issued
      ? {
          issued: true,
          particulars_confirmed: match === true,
          corrections: match ? {} : corrections,
          consideration_status: consideration,
          amount_received: amountReceived === "" ? null : received,
          received_date: consideration === "RECEIVED" ? receivedDate : null,
          retention_amount: consideration === "PARTIAL_OR_RETENTION" ? retained : null,
          retention_release_date: consideration === "PARTIAL_OR_RETENTION" ? releaseDate : null,
          vat_return_period: period,
          declared_by: declaredBy.trim(),
          declaration,
        }
      : {
          issued: false,
          particulars_confirmed: false,
          corrections: {},
          consideration_status: null,
          amount_received: null,
          received_date: null,
          retention_amount: null,
          retention_release_date: null,
          vat_return_period: null,
          declared_by: declaredBy.trim(),
          declaration,
        };
    setBusy(true);
    setApiError(null);
    try {
      await post(`/supplier/requests/${requestId}/respond`, body);
      onDone();
    } catch (err) {
      setApiError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  let n = 1;
  return (
    <Card title="Your confirmation" subtitle="Your answers are compared with the applicant's submission and shared with the FTA.">
      <ErrorBanner error={apiError} />
      <form className="confirm-form" onSubmit={submit} noValidate>
        <Step n={n++} title="Did you issue this tax invoice?" error={errors.issued}>
          <YesNo name="issued" value={issued} onChange={setIssued} yes="Yes, we issued it" no="No, we did not" />
          {issued === false && <p className="hint">The invoice will be marked as disputed and the FTA will follow up with the applicant.</p>}
        </Step>

        {issued && (
          <>
            <Step n={n++} title="Do the particulars match what you issued?" error={errors.match}>
              <YesNo name="match" value={match} onChange={setMatch} yes="Yes, they match" no="No, correct them" />
              {match === false && (
                <div className="corrections">
                  <p className="hint">Enter the values on the invoice you actually issued. Every change is shown to the FTA.</p>
                  {CORRECTABLE.map((c) => {
                    const changed = c.key in corrections;
                    return (
                      <Field key={c.key} label={c.label} htmlFor={`fix-${c.key}`} hint={changed ? `Submitted: ${String(invoice[c.key])}` : undefined}>
                        <input
                          id={`fix-${c.key}`}
                          className={changed ? "changed" : ""}
                          type={c.type}
                          step={c.type === "number" ? "0.01" : undefined}
                          value={fix[c.key]}
                          onChange={(e) => setFix({ ...fix, [c.key]: e.target.value })}
                        />
                      </Field>
                    );
                  })}
                </div>
              )}
            </Step>

            <Step n={n++} title="Has the consideration been received?" error={errors.consideration}>
              <div className="choice-row" role="radiogroup">
                <label className={`choice ${consideration === "RECEIVED" ? "on" : ""}`}>
                  <input type="radio" name="consideration" checked={consideration === "RECEIVED"} onChange={() => setConsideration("RECEIVED")} />
                  Received in full
                </label>
                <label className={`choice ${consideration === "PARTIAL_OR_RETENTION" ? "on" : ""}`}>
                  <input type="radio" name="consideration" checked={consideration === "PARTIAL_OR_RETENTION"} onChange={() => setConsideration("PARTIAL_OR_RETENTION")} />
                  Partly received, or held as retention
                </label>
              </div>
              {consideration === "RECEIVED" && (
                <div className="form-grid">
                  <Field label="Date received" htmlFor="received-date">
                    <input id="received-date" type="date" max={today} value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
                  </Field>
                  <Field label="Amount received (AED)" htmlFor="amount-received">
                    <input id="amount-received" type="number" step="0.01" min="0" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} />
                  </Field>
                </div>
              )}
              {consideration === "PARTIAL_OR_RETENTION" && (
                <div className="form-grid">
                  <Field label="Amount received (AED)" htmlFor="amount-received">
                    <input id="amount-received" type="number" step="0.01" min="0" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} />
                  </Field>
                  <Field label="Amount retained (AED)" htmlFor="retention">
                    <input id="retention" type="number" step="0.01" min="0" value={retention} onChange={(e) => setRetention(e.target.value)} />
                  </Field>
                  <Field label="Expected release date" htmlFor="release">
                    <input id="release" type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
                  </Field>
                  {splitMismatch && (
                    <p className="warn-text span-all">
                      Received + retained is {aed(received + retained)}, but the invoice total is {aed(invoice.total)}.
                    </p>
                  )}
                </div>
              )}
            </Step>

            <Step n={n++} title="Which VAT return did you declare the output VAT in?" error={errors.period}>
              <div className="form-grid">
                <Field label="You file" htmlFor="period-kind">
                  <select
                    id="period-kind"
                    value={periodKind}
                    onChange={(e) => {
                      setPeriodKind(e.target.value as PeriodKind);
                      setPeriod("");
                    }}
                  >
                    <option value="quarterly">Quarterly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </Field>
                <Field label="Tax period" htmlFor="period">
                  <select id="period" value={period} onChange={(e) => setPeriod(e.target.value)}>
                    <option value="">Choose…</option>
                    {periods.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              </div>
              {period && periodEndsBeforeInvoice(period, invoice.invoice_date) && (
                <p className="warn-text">This period ends before the invoice date ({fmtDate(invoice.invoice_date)}), so it will be flagged as inconsistent.</p>
              )}
            </Step>
          </>
        )}

        {issued !== null && (
          <Step n={n++} title="Declaration" error={errors.declaredBy ?? errors.declaration}>
            <Field label="Declared by (EmaraTax user)" htmlFor="declared-by">
              <input id="declared-by" placeholder="Name or email" value={declaredBy} onChange={(e) => setDeclaredBy(e.target.value)} />
            </Field>
            <label className="check declaration">
              <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} />
              <span>
                I declare that the information above is correct and complete. I understand it is shared with the Federal Tax Authority and
                recorded against my EmaraTax user.
              </span>
            </label>
          </Step>
        )}

        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy || issued === null}>
            {busy ? "Submitting…" : issued === false ? "Report invoice as not issued" : "Submit confirmation"}
          </button>
        </div>
      </form>
    </Card>
  );
}
