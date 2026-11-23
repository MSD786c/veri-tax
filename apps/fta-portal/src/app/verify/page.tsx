import Link from "next/link";
import Shell from "@/components/Shell";
import { guard } from "@/components/states";
import { Icon, PageHead } from "@/components/ui";
import { runChecks } from "@/lib/data";
import { flat, money, type Params } from "@/lib/format";

export const metadata = { title: "Verify invoice · Federal Tax Authority" };

const HEADLINE = { approved: "Approved", referred: "Referred to an officer", rejected: "Rejected" } as const;

// The form is a GET, so every result has its own shareable URL: /verify?trn=...&inv=...&amt=...
export default async function Verify({ searchParams }: { searchParams: Promise<Params> }) {
  const f = flat(await searchParams);
  const digits = (f.trn ?? "").replace(/\D/g, "");
  const submitted = Boolean(f.trn || f.inv || f.amt);
  const amount = Number(f.amt);
  const vat = f.vat?.trim() ? Number(f.vat) : Math.round(amount * 5) / 100;
  let error = "";
  if (submitted) {
    if (!Number.isFinite(amount) || !Number.isFinite(vat)) error = "Enter the amount as a number, for example 12000.50";
    else if (digits.length !== 15 || !digits.startsWith("100") || !(f.inv ?? "").trim() || amount <= 0) error = "Check the TRN (15 digits starting 100), the invoice number and the amount.";
  }
  const run = submitted && !error ? await guard(() => runChecks(f.trn, f.inv, amount, vat)) : null;
  if (run && !run.ok) return <Shell route="verifications" msg={f.msg}>{run.error}</Shell>;
  const res = run?.ok ? run.data : null;
  return (
    <Shell route="verifications" msg={f.msg}>
      <PageHead title="Verify an invoice" lead="Checks the supplier registry and every claim in the system, live." />
      <div className="work">
        <section className="card">
          <form method="get" action="/verify" className="verify-form">
            {error && <p className="err banner">{error}</p>}
            <div className="field"><label htmlFor="trn">Tax Registration Number (TRN)</label><input id="trn" name="trn" className="mono" inputMode="numeric" defaultValue={f.trn ?? ""} placeholder="100 000 000 000 003" maxLength={19} autoComplete="off" required /></div>
            <div className="grid2">
              <div className="field"><label htmlFor="inv">Invoice number</label><input id="inv" name="inv" defaultValue={f.inv ?? ""} placeholder="INV-78421" autoComplete="off" required /></div>
              <div className="field"><label htmlFor="amt">Amount excl. VAT (AED)</label><input id="amt" name="amt" inputMode="decimal" defaultValue={f.amt ?? ""} placeholder="0.00" required /></div>
            </div>
            <div className="field"><label htmlFor="vat">VAT on the invoice (AED)</label><input id="vat" name="vat" inputMode="decimal" defaultValue={f.vat ?? ""} placeholder="Leave empty to use 5%" /><p className="hint">Optional. If empty, 5% of the amount is used.</p></div>
            <button className="btn primary lg" type="submit"><span>Run verification</span><Icon n="arrow" s={18} /></button>
          </form>
        </section>
        <section className={`card ${res ? "" : "tint"}`}>
          {res ? (
            <>
              <div className={`verdict ${res.status}`}>
                <div className="verdict-top">
                  <span className="verdict-ic"><Icon n={res.status === "approved" ? "check" : res.status === "referred" ? "clock" : "x"} s={28} /></span>
                  <div><p className="eyebrow">Result</p><h3>{HEADLINE[res.status]}</h3></div>
                  <span className={`stamp ${res.status}`}>{res.status.toUpperCase()}</span>
                </div>
                {res.reasons.length ? res.reasons.map((x) => <p key={x} className="muted">{x}</p>) : <p className="muted">All checks passed. VAT {money(vat)} on {money(amount)}.</p>}
              </div>
              <ul className="checks">
                {res.checks.map(([label, ok]) => (
                  <li key={label} className={`done ${ok === "warn" ? "warn" : !ok ? "bad" : ""}`}><span className="ck"><Icon n={ok === true ? "check" : ok === "warn" ? "clock" : "x"} s={14} /></span>{label}</li>
                ))}
              </ul>
              {res.supplierTrn && <p className="muted small">Supplier: <Link className="link" href={`/invoices?q=${res.supplierTrn}`}>{res.supplierName}</Link></p>}
            </>
          ) : (
            <div className="empty"><span className="empty-ic"><Icon n="scan" s={26} /></span><h3>Result appears here</h3><p>Five live checks run: registry, supplier status, duplicate claim, VAT rate and value.</p></div>
          )}
        </section>
      </div>
    </Shell>
  );
}
