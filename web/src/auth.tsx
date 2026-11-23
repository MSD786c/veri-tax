import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { setApiSession } from "./api/client.ts";

// Mock sign-in. The API trusts X-Supplier-TRN / X-Officer-Id headers until EmaraTax / UAE PASS
// and FTA SSO are wired in (README "Security and audit"); this mirrors that, nothing more.
export type Session =
  | { role: "supplier"; trn: string; name: string }
  | { role: "officer"; officerId: string };

const KEY = "veritax.session";

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function store(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the session lives in memory only */
  }
}

interface AuthValue {
  session: Session | null;
  signIn: (s: Session) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

const initial = load();
setApiSession(initial);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(initial);
  const signIn = useCallback((s: Session) => {
    setApiSession(s);
    store(s);
    setSession(s);
  }, []);
  const signOut = useCallback(() => {
    setApiSession(null);
    store(null);
    setSession(null);
  }, []);
  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export function RequireRole({ role, children }: { role: Session["role"]; children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (session?.role !== role) return <Navigate to={`/?as=${role}&next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}
