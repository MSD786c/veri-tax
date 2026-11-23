import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { logoutAction } from "@/app/actions";
import { officerId } from "@/lib/api";
import { Icon } from "./ui";

const NAV: [string, string, string][] = [
  ["dashboard", "home", "Dashboard"], ["verifications", "shield", "Verifications"], ["applications", "doc", "Applications"],
  ["invoices", "file", "Invoices"], ["entities", "building", "Entities"], ["reports", "chart", "Reports"], ["audit", "log", "Audit Trail"],
];

/** Authenticated page chrome: sidebar, top bar, quick-action dock and the flash message. Redirects to /login when signed out. */
export default async function Shell({ route, children, msg, skeleton = false }: { route: string; children: ReactNode; msg?: string; skeleton?: boolean }) {
  const officer = await officerId();
  if (!officer) redirect("/login");
  const failed = msg?.startsWith("Not saved");
  return (
    <div className={`app${skeleton ? " is-skel" : ""}`}>
      {/* Streaming swaps the real page in with a tiny inline script. Without JavaScript the page stays in a hidden
          container, so reveal it and drop the skeleton. */}
      <noscript>
        <style>{"div[hidden]{display:block!important}.app.is-skel{display:none!important}"}</style>
      </noscript>
      <input type="checkbox" id={skeleton ? undefined : "menu"} className="menu-toggle" aria-label="Open navigation" />
      <a href="#main" className="skip">Skip to content</a>
      <aside className="side" aria-label="Main navigation">
        <div className="brand"><div><b>Federal Tax Authority</b><small>Verification Portal</small></div></div>
        <nav>
          <ul>
            {NAV.map(([k, ic, label]) => (
              <li key={k}><Link href={`/${k}`} className={route === k ? "on" : ""} aria-current={route === k ? "page" : undefined}><Icon n={ic} s={20} /><span>{label}</span></Link></li>
            ))}
          </ul>
          <ul className="side-bottom"><li><Link href="/settings" className={route === "settings" ? "on" : ""}><Icon n="gear" s={20} /><span>Settings</span></Link></li></ul>
        </nav>
        <div className="side-meta"><small>Signed in as</small><b>Officer {officer}</b><span><i />Live · veri-tax API</span></div>
      </aside>
      <label htmlFor={skeleton ? undefined : "menu"} className="menu-scrim" aria-label="Close navigation" />
      <div className="main-col">
        <header className="top">
          <label htmlFor={skeleton ? undefined : "menu"} className="icon-btn menu-btn" aria-label="Open navigation"><Icon n="menu" s={20} /></label>
          <form className="search-trigger" action="/search" method="get" role="search">
            <Icon n="search" s={18} />
            <input name="q" placeholder="Search TRN, invoice or application…" aria-label="Search TRN, invoice or application" autoComplete="off" />
          </form>
          <div className="top-right">
            <details className="pop-wrap">
              <summary className="icon-btn bell" aria-label="Notifications"><Icon n="bell" s={20} /><i className="dot-badge" /></summary>
              <div className="pop">
                <h3>Notifications</h3>
                <Link href="/verifications?st=referred"><span className="pop-ic"><Icon n="clock" s={17} /></span>Invoices waiting for your decision</Link>
                <Link href="/applications?st=READY_FOR_DECISION"><span className="pop-ic"><Icon n="doc" s={17} /></span>Applications ready for decision</Link>
                <Link href="/reports"><span className="pop-ic"><Icon n="chart" s={17} /></span>Download reports</Link>
              </div>
            </details>
            <details className="pop-wrap">
              <summary className="user" aria-haspopup="menu"><span className="avatar">{officer}</span><span className="user-n">Verification Officer</span><Icon n="chevron" s={16} /></summary>
              <div className="pop right">
                <div className="pop-user"><span className="avatar lg">{officer}</span><div><b>Officer {officer}</b><small>officer@fta-demo.gov.ae</small></div></div>
                <Link href="/settings"><span className="pop-ic"><Icon n="gear" s={17} /></span>Settings</Link>
                <form action={logoutAction}><button type="submit" className="pop-btn"><span className="pop-ic"><Icon n="logout" s={17} /></span>Sign out</button></form>
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </div>
      <div className="dock-wrap">
        <nav className="dock" aria-label="Quick actions">
          <Link href="/verify"><Icon n="scan" s={22} /><span>Verify invoice</span></Link>
          <Link href="/applications"><Icon n="doc" s={22} /><span>Applications</span></Link>
          <Link href="/search"><Icon n="search" s={22} /><span>Check status</span></Link>
          <Link href="/reports"><Icon n="down" s={22} /><span>Reports</span></Link>
        </nav>
      </div>
      {msg && (
        <div className="toasts" role="status">
          <div className={`toast ${failed ? "warn" : "ok"} auto-hide`}><Icon n={failed ? "x" : "check"} s={16} />{msg}</div>
        </div>
      )}
    </div>
  );
}
