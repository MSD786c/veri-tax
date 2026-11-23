import { useLayoutEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth.tsx";
import { GovBar, GovFooter, Wordmark } from "../../components/Layout.tsx";
import { safeNext } from "../Home.tsx";

/** The ":3001" (VITE_FTA_ONLY) landing: officer sign-in only, no supplier or Maskan entry points. */
export default function FtaSignIn() {
  const { session, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const signingOut = params.has("signedout");
  useLayoutEffect(() => {
    if (!signingOut) return;
    signOut();
    setParams({}, { replace: true });
  }, [signingOut, signOut, setParams]);
  useLayoutEffect(() => {
    document.title = "Officer Console sign-in · FTA";
  }, []);
  const next = params.get("next");
  const [officerId, setOfficerId] = useState("");

  if (session?.role === "officer" && !signingOut) return <Navigate to={safeNext(next, "/fta")} replace />;

  function enter(id: string) {
    signIn({ role: "officer", officerId: id });
    navigate(safeNext(next, "/fta"));
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const id = officerId.trim();
    if (id) enter(id);
  }

  return (
    <div className="shell">
      <GovBar />
      <main id="main" className="signin">
        <div className="signin-card">
          <section className="signin-panel">
            <Wordmark brand="FTA" area="Officer Console" />
            <h1>Refund verification for new-residence VAT claims</h1>
            <p>
              Review Maskan applications, the evidence behind each invoice and supplier confirmations, then record refund decisions.
              Every action is written to the audit trail.
            </p>
            <p className="signin-restricted">Restricted to authorised Federal Tax Authority staff.</p>
          </section>
          <section className="signin-form" aria-labelledby="signin-title">
            <h2 id="signin-title">Officer sign-in</h2>
            <form onSubmit={onSubmit} className="field">
              <label htmlFor="officer">Officer ID</label>
              <input id="officer" autoComplete="username" placeholder="e.g. officer-1" value={officerId} onChange={(e) => setOfficerId(e.target.value)} />
              <button className="btn btn-primary btn-block" disabled={!officerId.trim()}>
                Sign in
              </button>
            </form>
            <div className="demo">
              <span className="demo-label">Demo officer</span>
              <button type="button" className="demo-pick" onClick={() => enter("officer-demo")}>
                <strong>officer-demo</strong>
                <span>Full console access</span>
              </button>
            </div>
            <p className="signin-sso">
              <span className="chip chip-neutral">FTA single sign-on (mock)</span>
              Production uses FTA single sign-on; this ID field is a development stand-in.
            </p>
          </section>
        </div>
      </main>
      <GovFooter />
    </div>
  );
}
