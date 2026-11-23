// VAT return periods, in the two formats the API accepts (app/rules.py PERIOD_RE):
// quarterly "2026-Q2" or monthly "Apr-2026".

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const PERIOD_RE = /^(\d{4}-Q[1-4]|[A-Z][a-z]{2}-\d{4})$/;

export type PeriodKind = "quarterly" | "monthly";

export function isValidPeriod(p: string): boolean {
  if (!PERIOD_RE.test(p)) return false;
  return p.includes("-Q") || MONTHS.includes(p.slice(0, 3));
}

function ym(iso: string): [number, number] {
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
}

/** Index of a month on a single timeline, so periods compare as plain numbers. */
const idx = (year: number, month: number) => year * 12 + (month - 1);

/** The last month (timeline index) a period covers, or null when the period is malformed. */
export function periodEnd(p: string): number | null {
  if (!isValidPeriod(p)) return null;
  const q = /^(\d{4})-Q([1-4])$/.exec(p);
  if (q) return idx(Number(q[1]), Number(q[2]) * 3);
  return idx(Number(p.slice(4)), MONTHS.indexOf(p.slice(0, 3)) + 1);
}

/** Mirrors SC-05: the declared period must not end before the invoice date. */
export function periodEndsBeforeInvoice(p: string, invoiceDate: string): boolean {
  const end = periodEnd(p);
  return end !== null && end < idx(...ym(invoiceDate));
}

/**
 * Periods a supplier could plausibly have declared an invoice in: from a little before the
 * invoice date (a truthful early declaration must stay selectable; SC-05 then flags it) up to
 * the current period. Most recent first.
 */
export function periodOptions(kind: PeriodKind, invoiceDate: string, today: string): string[] {
  const [iy, im] = ym(invoiceDate);
  const [ty, tm] = ym(today);
  const out: string[] = [];
  if (kind === "quarterly") {
    const q = (y: number, m: number) => y * 4 + Math.floor((m - 1) / 3);
    for (let i = Math.max(q(ty, tm), q(iy, im)); i >= q(iy, im) - 2; i--) out.push(`${Math.floor(i / 4)}-Q${(i % 4) + 1}`);
  } else {
    for (let i = Math.max(idx(ty, tm), idx(iy, im)); i >= idx(iy, im) - 3; i--) out.push(`${MONTHS[i % 12]}-${Math.floor(i / 12)}`);
  }
  return out;
}
