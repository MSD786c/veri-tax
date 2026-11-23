import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.tsx";
import { useRules } from "../lib/rules.tsx";

type Theme = "light" | "dark" | null;

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("veritax.theme");
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem("veritax.theme", theme);
      else localStorage.removeItem("veritax.theme");
    } catch {
      /* not persisted */
    }
  }, [theme]);
  const systemDark = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme ? theme === "dark" : systemDark;
  return (
    <button type="button" className="icon-button" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={dark ? "Light theme" : "Dark theme"}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {dark ? (
          <>
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
          </>
        ) : (
          <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" />
        )}
      </svg>
    </button>
  );
}

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export function Shell({ area, nav }: { area: string; nav: NavItem[] }) {
  const { session } = useAuth();
  const { version } = useRules();
  const navigate = useNavigate();
  let who: ReactNode = null;
  if (session?.role === "supplier") who = <><strong>{session.name}</strong><span>TRN {session.trn}</span></>;
  if (session?.role === "officer") who = <><strong>FTA officer</strong><span>{session.officerId}</span></>;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="veri-tax home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
          </span>
          <span className="brand-name">veri-tax</span>
          <span className="brand-area">{area}</span>
        </Link>
        <nav className="topnav" aria-label="Main">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-end">
          {who && <div className="who">{who}</div>}
          <ThemeToggle />
          {session && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              // Leave the guarded area first; Home then clears the session. Clearing it here would let
              // the route guard redirect (with ?next=) before this navigation lands.
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
      <footer className="footer">
        <span>veri-tax verification body · synthetic data only</span>
        {version && <span>Ruleset {version}</span>}
      </footer>
    </div>
  );
}
