import { loginAction } from "@/app/actions";
import { Icon } from "@/components/ui";
import { flat, type Params } from "@/lib/format";
import "../login.css";

export const metadata = { title: "Sign in · Federal Tax Authority" };

// Static, illustrative sample for the left panel. Not read from the API.
const R = 34, C = 2 * Math.PI * R, GAP = 14;
const PARTS: [number, string][] = [[2, "#1c9b6c"], [4, "#d6a21f"], [6, "#d93a52"], [2, "#b9b19b"]];
const TOTAL = PARTS.reduce((a, p) => a + p[0], 0);

const SEGS = PARTS.map(([v, color], i) => {
  const seg = (C * v) / TOTAL;
  const start = PARTS.slice(0, i).reduce((a, p) => a + (C * p[0]) / TOTAL, 0);
  return { color, draw: Math.max(0.1, seg - GAP), off: start + GAP / 2 };
});

function MiniDonut() {
  return (
    <svg viewBox="0 0 90 90" width="92" height="92" role="img" aria-label="Sample: 14 invoices rated">
      <circle cx="45" cy="45" r={R} fill="none" stroke="#efe9d8" strokeWidth="11" />
      {SEGS.map((g) => (
        <circle key={g.color} cx="45" cy="45" r={R} fill="none" stroke={g.color} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${g.draw.toFixed(2)} ${(C - g.draw).toFixed(2)}`} strokeDashoffset={(-g.off).toFixed(2)} transform="rotate(-90 45 45)" />
      ))}
      <text x="45" y="49" textAnchor="middle" className="ld-n">14</text>
    </svg>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { error } = flat(await searchParams);
  return (
    <div className="login login-split">
      <section className="login-art" aria-label="About this portal">
        <div className="brand on-dark"><div><b>Federal Tax Authority</b><small>Verification Portal</small></div></div>

        <div className="la-main">
          <div className="login-copy">
            <h1>Verification portal for officers</h1>
            <p>Everything you need to verify invoices and process applications, in one place.</p>
          </div>

          <div className="la-stack" aria-hidden="true">
            <span className="la-tag">Illustrative sample</span>
            <div className="la-card la-mint"><span className="la-ic"><Icon n="check" s={18} /></span><div><b>Strong</b><small>ANB-1001 · AED 15,000.00</small></div></div>
            <div className="la-card la-peach"><span className="la-ic"><Icon n="clock" s={18} /></span><div><b>Needs your decision</b><small>4 invoices waiting</small></div></div>
            <div className="la-card la-white"><MiniDonut /><div><b>14 invoices</b><small>Strong, weak, fail and pending</small></div></div>
          </div>

          <ul className="login-points">
            <li><span><Icon n="scan" /></span><div><b>Check an invoice</b><p>Enter a TRN and invoice number. You get a decision in seconds.</p></div></li>
            <li><span><Icon n="doc" /></span><div><b>Review applications</b><p>See what is waiting, then approve, reject or ask for more information.</p></div></li>
            <li><span><Icon n="chart" /></span><div><b>Download reports</b><p>Pick a report. The file downloads as CSV.</p></div></li>
          </ul>
        </div>

        <small className="login-foot">Federal Tax Authority · United Arab Emirates</small>
      </section>

      <section className="login-form">
        <div className="lf-main">
          <div className="login-box">
            <div className="login-brand"><b>Federal Tax Authority</b><small>Verification Portal</small></div>
            <h2>Sign in</h2>
            <p className="lead">Use your official email to continue to the portal.</p>
            <form action={loginAction} noValidate>
              <div className={`field ${error ? "bad" : ""}`}>
                <label htmlFor="email">Work email</label>
                <input id="email" name="email" type="email" placeholder="name@fta.gov.ae" autoComplete="email" required autoFocus aria-invalid={error ? true : undefined} aria-describedby={error ? "email-err" : undefined} />
                {error && <p id="email-err" className="err" role="alert">{error}</p>}
              </div>
              <button className="btn primary lg full" type="submit"><span>Continue</span><Icon n="arrow" s={18} /></button>
            </form>
            <form action={loginAction}><input type="hidden" name="email" value="ak@fta.gov.ae" /><button className="link demo" type="submit">Use the demo account</button></form>
            <p className="login-note"><Icon n="lock" s={15} /> Protected session. Demo data only.</p>
          </div>
        </div>
        <footer className="lf-foot">Prototype for the FTA verification body. Demo data only. Not an official FTA service.</footer>
      </section>
    </div>
  );
}
