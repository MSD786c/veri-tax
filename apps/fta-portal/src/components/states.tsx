import Link from "next/link";
import { API_URL, ApiDown, ApiError } from "@/lib/api";
import { Icon } from "./ui";

/** Designed error state for a page. Used for API failures and 404s. */
export function ErrorState({ code, title, text, detail }: { code: number; title: string; text: string; detail?: string }) {
  const api = code === 503 || code === 502;
  return (
    <section className="err-state">
      <div className={`err-card t-${code}`}>
        <span className="err-code">{code}</span>
        <span className="err-ic"><Icon n={code === 404 ? "search" : code === 503 ? "clock" : "x"} s={30} /></span>
        <h1>{title}</h1>
        <p>{text}</p>
        <div className="err-actions">
          <a className="btn primary lg" href=""><Icon n="refresh" s={18} /><span>Try again</span></a>
          <Link className="btn ghost lg" href="/dashboard"><Icon n="home" s={18} /><span>Back to dashboard</span></Link>
        </div>
        {api && (
          <ol className="err-steps">
            <li>Start the verification body: <code>uvicorn app.main:app --port 8000</code></li>
            <li>The portal expects it at <code>{API_URL}</code></li>
          </ol>
        )}
        {detail && code !== 404 && <details className="err-detail"><summary>Technical detail</summary><code>{detail}</code></details>}
      </div>
    </section>
  );
}

export function errorFor(e: unknown) {
  if (e instanceof ApiDown) return { code: 503, title: "Can't reach the verification body", text: "The portal could not connect to the veri-tax API. Check that it is running, then try again.", detail: e.message };
  if (e instanceof ApiError) return { code: 502, title: "The verification body returned an error", text: `The API answered ${e.status}. Nothing was changed. Try again in a moment.`, detail: e.message };
  return { code: 500, title: "Something went wrong on our side", text: "The page could not be built. Nothing was changed. Try again, or go back to the dashboard.", detail: e instanceof Error ? e.message : String(e) };
}

/** Run a page loader; on failure return a ready-made error state instead of throwing. */
export async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: React.ReactNode }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: <ErrorState {...errorFor(e)} /> };
  }
}

type Kind = "dash" | "table" | "audit" | "cards" | "form";

/** Skeleton screens shown by loading.tsx while the page streams in. Pure CSS shimmer. */
export function Skeleton({ kind }: { kind: Kind }) {
  return (
    <div className="skel" role="status" aria-live="polite" aria-label="Loading">
      <span className="sr">Loading…</span>
      <header className="page-h"><div className="sk-stack"><i className="sk sk-h1" /><i className="sk sk-line w60" /></div><div className="page-actions"><i className="sk sk-pill" /><i className="sk sk-pill dark" /></div></header>
      {kind === "dash" && (
        <>
          <section className="tasks"><i className="sk sk-card tall" /><i className="sk sk-card tall" /><i className="sk sk-card tall" /></section>
          <div className="work">
            <section className="sk-panel">{[0, 1, 2, 3, 4, 5].map((n) => <div className="sk-row" key={n}><i className="sk sk-dot" /><div className="sk-stack"><i className="sk sk-line w40" /><i className="sk sk-line w70 thin" /></div><i className="sk sk-pill sm" /></div>)}</section>
            <i className="sk sk-card dark huge" />
          </div>
          <i className="sk sk-card wide" />
        </>
      )}
      {kind === "table" && (
        <>
          <div className="stat-row"><i className="sk sk-card short" /><i className="sk sk-card short" /><i className="sk sk-card short" /></div>
          <section className="sk-panel"><div className="sk-toolbar"><i className="sk sk-pill grow" /><i className="sk sk-pill" /></div>{[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <div className="sk-trow" key={n}><i className="sk sk-line w60" /><i className="sk sk-line w80" /><i className="sk sk-line w50" /><i className="sk sk-line w70" /><i className="sk sk-pill sm" /></div>)}</section>
        </>
      )}
      {kind === "audit" && (
        <>
          <div className="aud-stats"><i className="sk sk-card short" /><i className="sk sk-card short" /><i className="sk sk-card short" /><i className="sk sk-card short" /></div>
          <section className="sk-panel">{[0, 1, 2, 3, 4, 5].map((n) => <div className="sk-row" key={n}><i className="sk sk-dot big" /><div className="sk-stack"><i className="sk sk-line w40" /><i className="sk sk-line w60 thin" /><i className="sk sk-line w80 thin" /></div></div>)}</section>
        </>
      )}
      {kind === "cards" && <section className="sk-grid">{[0, 1, 2, 3, 4, 5].map((n) => <i className="sk sk-card mid" key={n} />)}</section>}
      {kind === "form" && <div className="work"><i className="sk sk-card huge" /><i className="sk sk-card huge" /></div>}
      <p className="skel-slow">Still loading… the verification body is taking longer than usual. <a href="">Reload</a></p>
    </div>
  );
}
