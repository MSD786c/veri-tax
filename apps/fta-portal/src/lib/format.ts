export const money = (x: number | null | undefined) =>
  `AED ${Number(x ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parse = (ts: string | null | undefined): Date | null => {
  if (!ts) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) || ts.length <= 10 ? ts : ts + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
};

export const fdate = (ts: string | null | undefined) => {
  const d = parse(ts);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "—";
};

export const fdt = (ts: string | null | undefined) => {
  const d = parse(ts);
  if (!d) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${fdate(ts)}, ${hh}:${mm}`;
};

export const hhmm = (ts: string) => {
  const d = parse(ts);
  return d ? `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : "";
};

export const rel = (ts: string | null | undefined) => {
  const d = parse(ts);
  if (!d) return "—";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
};

export const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  return MONTHS[Number(mm) - 1] + (mm === "01" ? ` ${y.slice(2)}` : "");
};

export const nice = (s: unknown) => {
  const t = String(s ?? "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
};

/** Case-insensitive search that ignores spaces and dashes: "100 111 111 100 003" finds a TRN, "msk20260001" finds MSK-2026-0001. */
export function match(q: string | undefined, ...fields: (string | number | null | undefined)[]): boolean {
  const t = (q ?? "").trim().toLowerCase();
  if (!t) return true;
  const squash = (x: string) => x.replace(/[\s\-_/]/g, "");
  const hay = fields.map((f) => String(f ?? "")).join(" ").toLowerCase();
  return hay.includes(t) || squash(hay).includes(squash(t));
}

export type Params = Record<string, string | string[] | undefined>;

/** First value of each search param as a plain string. */
export const flat = (p: Params): Record<string, string> =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? "") : (v ?? "")]));

/** Build a query string from the current params with overrides. Empty values and "all" are dropped. */
export function qs(current: Record<string, string>, over: Record<string, string | number | null> = {}): string {
  const merged: Record<string, string | number | null> = { ...current };
  delete merged.msg;
  Object.assign(merged, over);
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== null && v !== "" && v !== "all") u.set(k, String(v));
  return u.toString();
}

export const PAGE = 10;
export function paginate<T>(rows: T[], pageParam: string | undefined) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(Math.max(1, parseInt(pageParam ?? "1", 10) || 1), pages);
  return { rows: rows.slice((p - 1) * PAGE, p * PAGE), p, pages };
}
