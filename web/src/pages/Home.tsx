import { useLayoutEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, get } from "../api/client.ts";
import type { Supplier } from "../api/types.ts";
import { useAuth } from "../auth.tsx";
import { GovBar, GovFooter } from "../components/Layout.tsx";
import { Banner } from "../components/ui.tsx";

// Synthetic suppliers from app/seed.py, offered as one-click demo sign-ins.
const DEMO_SUPPLIERS = [
  { trn: "100333333300003", name: "Desert Rose Electrical Works", note: "2 invoices waiting" },
  { trn: "100111111100003", name: "Al Noor Building Contracting LLC" },
  { trn: "100222222200003", name: "Gulf Steel & Cement Trading" },
  { trn: "100555555500003", name: "Falcon Pools & Landscaping LLC" },
];

const STEPS = [
  ["Maskan", "The applicant's refund claim and supplier invoices arrive from the Maskan app."],
  ["Rule engine", "Each invoice is checked against Article 59 and the New Residence rules, then rated strong, weak or fail."],
  ["Supplier", "Suppliers confirm issuance, particulars, consideration and the VAT return period."],
  ["FTA officer", "Officers review the reconciled evidence and approve or reject the refund."],
];

export function safeNext(next: string | null, prefix: string): string {
  return next && next.startsWith(prefix) && !next.startsWith("//") ? next : prefix;
}

export default function Home() {
  const { session, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const signingOut = params.has("signedout");
  useLayoutEffect(() => {
    if (!signingOut) return;
    signOut();
    setParams({}, { replace: true });
  }, [signingOut, signOut, setParams]);
  const as = params.get("as");
  const next = params.get("next");

  const [trn, setTrn] = useState("");
  const [officerId, setOfficerId] = useState("");
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function supplierSignIn(value: string) {
    const t = value.replace(/\s/g, "");
    if (!/^100\d{12}$/.test(t)) {
      setSupplierError("A UAE TRN is 15 digits and starts with 100.");
      return;
    }
    setBusy(true);
    setSupplierError(null);
    try {
      const me = await get<Supplier>("/supplier/me", { "X-Supplier-TRN": t });
      signIn({ role: "supplier", trn: me.trn, name: me.legal_name });
      navigate(safeNext(next, "/supplier"));
    } catch (e) {
      setSupplierError(e instanceof ApiError && e.status === 401 ? "No supplier with this TRN has invoices in veri-tax." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function officerSignIn(e: FormEvent) {
    e.preventDefault();
    const id = officerId.trim();
    if (!id) return;
    signIn({ role: "officer", officerId: id });
    navigate(safeNext(next, "/fta"));
  }

  return (
    <div className="shell">
    <GovBar />
    <div className="home">
      <header className="home-hero">
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
          </span>
          <span className="brand-name">veri-tax</span>
        </div>
        <h1>Verification of VAT refund claims for UAE nationals building new residences</h1>
        <p className="lede">
          One portal for the people who confirm invoices and the people who decide refunds. Every outcome links back to the
          rule, the supplier's answer and the audit trail behind it.
        </p>
        <ol className="flow">
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <span className="flow-n">{i + 1}</span>
              <div>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            </li>
          ))}
        </ol>
      </header>

      {session && !signingOut && (
        <Banner tone="info" title={session.role === "supplier" ? `Signed in as ${session.name}` : `Signed in as officer ${session.officerId}`}>
          <Link to={session.role === "supplier" ? "/supplier" : "/fta"}>Continue to the {session.role === "supplier" ? "supplier portal" : "FTA dashboard"} →</Link>
        </Banner>
      )}

      <div className="entry-grid">
        <section className={`card entry ${as === "supplier" ? "entry-focus" : ""}`} aria-labelledby="supplier-entry">
          <h2 id="supplier-entry">Supplier portal</h2>
          <p className="muted">For suppliers registered on EmaraTax: confirm tax invoices that applicants have submitted under your TRN.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              supplierSignIn(trn);
            }}
          >
            <label htmlFor="trn">Tax Registration Number (TRN)</label>
            <div className="input-row">
              <input id="trn" inputMode="numeric" autoComplete="off" placeholder="100XXXXXXXXXXXX" value={trn} onChange={(e) => setTrn(e.target.value)} />
              <button className="btn btn-primary" disabled={busy}>
                Sign in
              </button>
            </div>
            {supplierError && <p className="error-text">{supplierError}</p>}
          </form>
          <div className="demo">
            <span className="demo-label">Demo suppliers</span>
            {DEMO_SUPPLIERS.map((s) => (
              <button key={s.trn} type="button" className="demo-pick" disabled={busy} onClick={() => supplierSignIn(s.trn)}>
                <strong>{s.name}</strong>
                <span>
                  {s.trn}
                  {s.note ? ` · ${s.note}` : ""}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className={`card entry ${as === "officer" ? "entry-focus" : ""}`} aria-labelledby="officer-entry">
          <h2 id="officer-entry">FTA officer dashboard</h2>
          <p className="muted">Review verified, flagged and rejected invoices, follow suppliers, and decide refund applications.</p>
          <form onSubmit={officerSignIn}>
            <label htmlFor="officer">Officer ID</label>
            <div className="input-row">
              <input id="officer" autoComplete="username" placeholder="e.g. officer-1" value={officerId} onChange={(e) => setOfficerId(e.target.value)} />
              <button className="btn btn-primary" disabled={!officerId.trim()}>
                Sign in
              </button>
            </div>
          </form>
          <div className="demo">
            <span className="demo-label">Demo officer</span>
            <button
              type="button"
              className="demo-pick"
              onClick={() => {
                signIn({ role: "officer", officerId: "officer-demo" });
                navigate(safeNext(next, "/fta"));
              }}
            >
              <strong>officer-demo</strong>
              <span>Full dashboard access</span>
            </button>
          </div>
        </section>

        <section className="card entry" aria-labelledby="maskan-entry">
          <h2 id="maskan-entry">Maskan simulator</h2>
          <p className="muted">
            Stand in for the Maskan app: submit a refund application with its invoices and watch it move through verification, or look up
            what an applicant sees.
          </p>
          <div className="input-row">
            <Link className="btn btn-secondary" to="/maskan">
              Submit a test application
            </Link>
            <Link className="btn btn-ghost" to="/maskan/status">
              Applicant status
            </Link>
          </div>
        </section>
      </div>

      <p className="fineprint">
        Sign-in here is a development stand-in. Production uses EmaraTax / UAE PASS for suppliers and FTA single sign-on for
        officers. All data is synthetic.
      </p>
    </div>
    <GovFooter />
    </div>
  );
}
