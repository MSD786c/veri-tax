// Formatting helpers. Backend datetimes are UTC; SQLite returns them without an offset.

const money = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 });

export function aed(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `AED ${money.format(n)}`;
}

/** Auto-compact for stat tiles: AED 1,284 / AED 12.9K / AED 4.2M. */
export function aedCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `AED ${trim(n / 1e6)}M`;
  if (abs >= 1e4) return `AED ${trim(n / 1e3)}K`;
  return `AED ${whole.format(n)}`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

export function num(n: number): string {
  return whole.format(n);
}

export function pct(ratio: number | null | undefined): string {
  return ratio === null || ratio === undefined ? "—" : `${Math.round(ratio * 100)}%`;
}

export function parseUtc(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) || s.length === 10 ? s : `${s}Z`);
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "2026-03-01" -> "1 Mar 2026". Date-only strings are calendar dates, so format them in UTC. */
export function fmtDate(s: string | null | undefined): string {
  return s ? dateFmt.format(parseUtc(s.slice(0, 10))) : "—";
}

export function fmtDateTime(s: string | null | undefined): string {
  return s ? dateTimeFmt.format(parseUtc(s)) : "—";
}

const DAY = 86_400_000;

/** Whole days from `now` until `due` (negative when overdue). */
export function daysUntil(due: string, now: Date = new Date()): number {
  return Math.ceil((parseUtc(due).getTime() - now.getTime()) / DAY);
}

export function dueLabel(due: string, now: Date = new Date()): string {
  const d = daysUntil(due, now);
  if (d < 0) return `Overdue by ${-d} day${d === -1 ? "" : "s"}`;
  if (d === 0) return "Due today";
  return `Due in ${d} day${d === 1 ? "" : "s"}`;
}

export function hours(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  if (h < 1) return "< 1 h";
  if (h < 48) return `${trim(h)} h`;
  return `${trim(h / 24)} days`;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function humanize(s: string): string {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "1 application", "3 applications". */
export function plural(n: number, word: string): string {
  return `${num(n)} ${word}${n === 1 ? "" : "s"}`;
}
