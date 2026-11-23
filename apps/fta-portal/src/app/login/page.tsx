import { loginAction } from "@/app/actions";
import { Icon } from "@/components/ui";
import { flat, type Params } from "@/lib/format";

export const metadata = { title: "Sign in · Federal Tax Authority" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { error } = flat(await searchParams);
  return (
    <div className="login login-split">
      <section className="login-art">
        <div className="brand on-dark"><div><b>Federal Tax Authority</b><small>Verification Portal</small></div></div>
        <div className="login-copy">
          <h1>Verification portal for officers</h1>
          <p>Everything you need to verify invoices and process applications, in one place.</p>
          <ul className="login-points">
            <li><span><Icon n="scan" /></span><div><b>Check an invoice</b><p>Enter a TRN and invoice number. You get a decision in seconds.</p></div></li>
            <li><span><Icon n="doc" /></span><div><b>Review applications</b><p>See what is waiting, then approve, reject or ask for more information.</p></div></li>
            <li><span><Icon n="chart" /></span><div><b>Download reports</b><p>Pick a report. The file downloads as CSV.</p></div></li>
          </ul>
        </div>
        <small className="login-foot">Federal Tax Authority · United Arab Emirates</small>
      </section>
      <section className="login-form">
        <div className="login-box">
          <div className="login-brand"><b>Federal Tax Authority</b><small>Verification Portal</small></div>
          <h2>Sign in</h2>
          <p className="lead">Use your official email to continue to the portal.</p>
          <form action={loginAction} noValidate>
            <div className={`field ${error ? "bad" : ""}`}>
              <label htmlFor="email">Work email</label>
              <input id="email" name="email" type="email" placeholder="name@fta.gov.ae" autoComplete="email" required autoFocus />
              {error && <p className="err">{error}</p>}
            </div>
            <button className="btn primary lg full" type="submit"><span>Continue</span><Icon n="arrow" s={18} /></button>
          </form>
          <form action={loginAction}><input type="hidden" name="email" value="ak@fta.gov.ae" /><button className="link demo" type="submit">Use the demo account</button></form>
          <p className="login-note"><Icon n="lock" s={15} /> Protected session. Demo data only.</p>
        </div>
      </section>
    </div>
  );
}
