// CSV round trip for large contractors (README "Supplier confirmation": "a CSV upload for large
// contractors"). The template lists pending requests; the supplier fills the answer columns.
// Parsing happens in the browser so every row can be checked before anything is sent; the API's
// bulk endpoint then saves all rows or none.
import { parseCsv, toCsv } from "./csv.ts";
import { isValidPeriod } from "./periods.ts";

export const REFERENCE_COLUMNS = ["request_id", "invoice_no", "invoice_date", "applicant", "total_aed"] as const;
export const ANSWER_COLUMNS = [
  "issued",
  "particulars_match",
  "consideration",
  "amount_received",
  "received_date",
  "retention_amount",
  "retention_release_date",
  "vat_return_period",
] as const;

export interface TemplateRow {
  request_id: number;
  invoice_no: string;
  invoice_date: string;
  applicant: string;
  total: number;
}

export function buildTemplate(rows: TemplateRow[]): string {
  return toCsv([
    [...REFERENCE_COLUMNS, ...ANSWER_COLUMNS],
    ...rows.map((r) => [r.request_id, r.invoice_no, r.invoice_date, r.applicant, r.total.toFixed(2), "", "", "", "", "", "", "", ""]),
  ]);
}

/** One bulk item minus the batch-wide declaration (declared_by + declaration). */
export interface ParsedAnswer {
  request_id: number;
  issued: boolean;
  particulars_confirmed: boolean;
  corrections: Record<string, never>;
  consideration_status: "RECEIVED" | "PARTIAL_OR_RETENTION" | null;
  amount_received: number | null;
  received_date: string | null;
  retention_amount: number | null;
  retention_release_date: string | null;
  vat_return_period: string | null;
}

export interface ParsedRow {
  line: number;
  requestId: number | null;
  invoiceNo: string;
  answer: ParsedAnswer | null;
  errors: string[];
  skipped: boolean;
}

export interface ParseResult {
  rows: ParsedRow[];
  fileError: string | null;
}

const YES = new Set(["yes", "y", "true", "1"]);
const NO = new Set(["no", "n", "false", "0"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function yesNo(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  return YES.has(s) ? true : NO.has(s) ? false : null;
}

function isDate(v: string): boolean {
  return ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v);
}

function amount(v: string): number | null {
  const s = v.replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * Check every row of an uploaded CSV against the supplier's pending requests.
 * Rows whose `issued` cell is blank are skipped (the template lists every pending request).
 */
export function parseBulkCsv(text: string, pendingIds: Set<number>): ParseResult {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], fileError: "The file has no data rows." };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = ["request_id", ...ANSWER_COLUMNS].filter((c) => !header.includes(c));
  if (missing.length) return { rows: [], fileError: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Start from the template.` };

  const seen = new Set<number>();
  const rows = table.slice(1).map((cells, i): ParsedRow => {
    const cell = (name: string) => (cells[header.indexOf(name)] ?? "").trim();
    const errors: string[] = [];
    const idText = cell("request_id");
    const requestId = /^\d+$/.test(idText) ? Number(idText) : null;
    const row: ParsedRow = { line: i + 2, requestId, invoiceNo: cell("invoice_no"), answer: null, errors, skipped: false };

    if (requestId === null) errors.push("request_id must be a number");
    else if (!pendingIds.has(requestId)) errors.push("not one of your pending requests");
    else if (seen.has(requestId)) errors.push("request listed twice");
    if (requestId !== null) seen.add(requestId);

    if (!cell("issued")) {
      row.skipped = errors.length === 0;
      return row;
    }
    const issued = yesNo(cell("issued"));
    if (issued === null) errors.push("issued must be yes or no");
    if (issued === false) {
      row.answer = errors.length ? null : blank(requestId ?? 0, false);
      return row;
    }

    const match = yesNo(cell("particulars_match"));
    if (match === null) errors.push("particulars_match must be yes or no");
    if (match === false) errors.push("particulars differ: answer this invoice on its own page so you can enter corrections");

    const answer = blank(requestId ?? 0, true);
    const consideration = cell("consideration").toLowerCase();
    const received = amount(cell("amount_received"));
    if (Number.isNaN(received)) errors.push("amount_received must be a positive number");
    answer.amount_received = received !== null && !Number.isNaN(received) ? received : null;

    if (consideration === "received") {
      answer.consideration_status = "RECEIVED";
      if (!isDate(cell("received_date"))) errors.push("received_date must be a date (YYYY-MM-DD)");
      else answer.received_date = cell("received_date");
    } else if (consideration === "retention" || consideration === "partial_or_retention") {
      answer.consideration_status = "PARTIAL_OR_RETENTION";
      const retained = amount(cell("retention_amount"));
      if (retained === null || Number.isNaN(retained)) errors.push("retention_amount is required for retention");
      else answer.retention_amount = retained;
      if (!isDate(cell("retention_release_date"))) errors.push("retention_release_date must be a date (YYYY-MM-DD)");
      else answer.retention_release_date = cell("retention_release_date");
    } else {
      errors.push("consideration must be received or retention");
    }

    const period = cell("vat_return_period");
    if (!isValidPeriod(period)) errors.push("vat_return_period must look like 2026-Q2 or Apr-2026");
    else answer.vat_return_period = period;

    row.answer = errors.length ? null : answer;
    return row;
  });
  return { rows, fileError: null };
}

function blank(requestId: number, issued: boolean): ParsedAnswer {
  return {
    request_id: requestId,
    issued,
    particulars_confirmed: issued,
    corrections: {},
    consideration_status: null,
    amount_received: null,
    received_date: null,
    retention_amount: null,
    retention_release_date: null,
    vat_return_period: null,
  };
}
