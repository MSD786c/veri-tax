import { useEffect, type ReactNode } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.tsx";
import { useRules } from "../lib/rules.tsx";

/** Thin navy government utility bar that tops every page. */
export function GovBar() {
  return (
    <div className="govbar">
      <span>United Arab Emirates · Federal Tax Authority</span>
    </div>
  );
}

/** Prototype disclaimer that closes every page. */
export function GovFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className="footer">
      <span>Hackathon prototype – not an official government service. Synthetic data only.</span>
      {children}
    </footer>
  );
}

/** Text wordmark with a plain gold monogram square (no official emblems). */
export function Wordmark({ brand, area }: { brand: string; area: string }) {
  return (
    <span className="wordmark">
      <span className="monogram" aria-hidden="true">
        {brand.slice(0, 1).toUpperCase()}
      </span>
      <span className="wordmark-text">
        <strong>{brand}</strong>
        <span>{area}</span>
      </span>
    </span>
  );
}

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export function Shell({ brand = "veri-tax", area, nav }: { brand?: string; area: string; nav: NavItem[] }) {
  const { session } = useAuth();
  const { version } = useRules();
  const navigate = useNavigate();
  useEffect(() => {
    document.title = `${area} · ${brand}`;
  }, [area, brand]);
  let who: ReactNode = null;
  if (session?.role === "supplier") who = <><strong>{session.name}</strong><span>TRN {session.trn}</span></>;
  if (session?.role === "officer") who = <><strong>{session.officerId}</strong><span>FTA officer</span></>;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <GovBar />
      <div className="console">
        <aside className="sidebar">
          <Link to="/" className="sidebar-brand" aria-label={`${brand} ${area} home`}>
            <Wordmark brand={brand} area={area} />
          </Link>
          <nav className="sidenav" aria-label="Main">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <div className="console-body">
          <header className="content-header">
            <span className="content-area">{area}</span>
            <div className="topbar-end">
              {who && <div className="who">{who}</div>}
              {session && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  // Leave the guarded area first; the sign-in page then clears the session. Clearing it here
                  // would let the route guard redirect (with ?next=) before this navigation lands.
                  onClick={() => navigate("/?signedout=1", { replace: true })}
                >
                  Sign out
                </button>
              )}
            </div>
          </header>
          <main id="main" className="main">
            <Outlet />
          </main>
          <GovFooter>{version && <span>Ruleset {version}</span>}</GovFooter>
        </div>
      </div>
    </div>
  );
}
