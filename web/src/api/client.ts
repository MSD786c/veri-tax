import type { Session } from "../auth.tsx";

// Same origin by default: FastAPI serves the portal, and `npm run dev` proxies the API.
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

let session: Session | null = null;
export function setApiSession(s: Session | null) {
  session = s;
}

/** Mock identity headers (README "Getting started"). Swap for EmaraTax / FTA SSO tokens. */
function authHeaders(): Record<string, string> {
  if (session?.role === "supplier") return { "X-Supplier-TRN": session.trn };
  if (session?.role === "officer") return { "X-Officer-Id": session.officerId };
  return {};
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(formatDetail(status, detail));
    this.status = status;
    this.detail = detail;
  }
}

interface FastApiValidationItem {
  loc: (string | number)[];
  msg: string;
}

/** Turn FastAPI's error bodies (string, validation list, or {message, errors}) into one readable line. */
export function formatDetail(status: number, detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return (detail as FastApiValidationItem[])
      .map((d) => `${d.loc.filter((l) => l !== "body").join(" › ")}: ${d.msg.replace(/^Value error, /, "")}`)
      .join("; ");
  }
  if (detail && typeof detail === "object" && "message" in detail) {
    const d = detail as { message: string; errors?: { request_id: number; error: string }[] };
    const rows = d.errors?.map((e) => `request ${e.request_id}: ${e.error}`).join("; ");
    return rows ? `${d.message} — ${rows}` : d.message;
  }
  return `Request failed (${status})`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...authHeaders(), ...init.headers },
  });
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return res;
}

export async function get<T>(path: string, headers?: Record<string, string>): Promise<T> {
  return (await request(path, { headers })).json();
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  return (await request(path, { method: "POST", body: JSON.stringify(body) })).json();
}

/** Fetch a file with auth headers and hand it to the browser as a download. */
export async function download(path: string, filename: string): Promise<void> {
  const blob = await (await request(path)).blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function query(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}
