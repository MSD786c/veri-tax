import { apiGet, apiGetOrNull, apiRaw } from "./api";
import { fdate, nice } from "./format";
import type {
  Analytics, ApplicationDetail, ApplicationSummary, AppView, AuditView, FlatInvoice, InvStatus, SupplierDetail, SupplierStat, Tone,
} from "./types";

export const APP_STATUS: Record<string, [string, Tone]> = {
  RECEIVED: ["Received", "neutral"], IN_VERIFICATION: ["In verification", "neutral"], AWAITING_SUPPLIERS: ["Awaiting suppliers", "gold"],
  READY_FOR_DECISION: ["Ready for decision", "info"], APPROVED: ["Approved", "approved"], PARTIALLY_APPROVED: ["Partly approved", "approved"], REJECTED: ["Rejected", "rejected"],
};
const DECIDED = new Set(["APPROVED", "PARTIALLY_APPROVED", "REJECTED"]);
const RATING: Record<string, InvStatus> = { STRONG: "approved", WEAK: "referred", FAIL: "rejected" };
export const RATING_LABEL: Record<InvStatus, string> = { approved: "Strong", referred: "Weak", rejected: "Fail", pending: "Pending" };

export interface Loaded {
  apps: AppView[];
  invoices: FlatInvoice[];
  audit: AuditView[];
  suppliers: SupplierView[];
}

export type SupplierView = SupplierStat & {
  tier: string; state: "active" | "review" | "suspended"; verified_pct: number; rejected_pct: number; response_pct: number; score: number;
};

export function enrichSupplier<T extends SupplierStat>(s: T): T & SupplierView {
  const tier = (typeof s.trust === "string" ? s.trust : s.trust.tier || "STANDARD").toUpperCase();
  const score = ({ TRUSTED: 95, STANDARD: 80, WATCH: 62 } as Record<string, number>)[tier] ?? 80;
  const state = s.status === "DEREGISTERED" ? "suspended" : s.risk_flag ? "review" : "active";
  const claimed = s.vat_claimed || 0;
  return {
    ...s, tier, score, state,
    verified_pct: claimed ? Math.round((s.vat_verified / claimed) * 100) : 0,
    rejected_pct: claimed ? Math.round((s.vat_rejected / claimed) * 100) : 0,
    response_pct: Math.round((s.response_rate ?? 0) * 100),
  };
}

/** One pass over the API: applications with their invoices, every supplier and the merged audit trail. */
export async function loadAll(): Promise<Loaded> {
  const [apps, sups] = await Promise.all([apiGet<ApplicationSummary[]>("/fta/applications"), apiGet<SupplierStat[]>("/fta/suppliers")]);
  const details = await Promise.all(apps.map((a) => apiGet<ApplicationDetail>(`/fta/applications/${a.id}`)));
  const invoices: FlatInvoice[] = [];
  const audit: AuditView[] = [];
  const views: AppView[] = apps.map((a, idx) => {
    const d = details[idx];
    const [label, tone] = APP_STATUS[a.status] ?? [nice(a.status), "neutral" as Tone];
    const view = { ...a, detail: d, label, tone, decided: DECIDED.has(a.status), invoices: [] as FlatInvoice[] } as AppView;
    for (const row of d.invoices) {
      // Rules re-run (e.g. EX-01 once the original document is read), so keep only the latest result per rule.
      const latest = new Map(row.rule_results.map((x) => [x.rule_id, x] as const));
      for (const x of row.rule_results) if (x.id > latest.get(x.rule_id)!.id) latest.set(x.rule_id, x);
      row.rule_results = [...latest.values()];
      const inv = row.invoice;
      const od = row.officer_decision;
      const status_ui: InvStatus = od ? (od.decision === "APPROVED" ? "approved" : "rejected") : RATING[inv.rating ?? ""] ?? "pending";
      const flat: FlatInvoice = { ...inv, row, app: view, supplier_name: row.supplier?.legal_name ?? inv.supplier_trn, status_ui, decision: od };
      invoices.push(flat);
      view.invoices.push(flat);
    }
    for (const e of d.audit) audit.push({ ...e, app_ref: a.maskan_ref });
    return view;
  });
  audit.sort((x, y) => y.at.localeCompare(x.at));
  return { apps: views, invoices, audit, suppliers: sups.map(enrichSupplier) };
}

export const getSupplier = async (trn: string) => {
  const s = await apiGetOrNull<SupplierDetail>(`/fta/suppliers/${encodeURIComponent(trn)}`);
  return s ? enrichSupplier(s) : null;
};

export function getAnalytics(p: Record<string, string>): Promise<Analytics> {
  const u = new URLSearchParams();
  if (p.emirate && p.emirate !== "all") u.set("emirate", p.emirate);
  if (p.from) u.set("date_from", p.from);
  if (p.to) u.set("date_to", p.to);
  return apiGet<Analytics>(`/fta/analytics${u.size ? `?${u}` : ""}`);
}

// ── audit trail wording ──
const ACTOR: Record<string, [string, string]> = {
  maskan: ["Maskan", "src"], "rule-engine": ["Rule engine", "sys"], agent: ["Agent", "sys"], reconciliation: ["Reconciliation", "sys"], "supplier-requests": ["Supplier requests", "sys"],
};
const HEADS: Record<string, string> = {
  ingest: "Claim received from Maskan", verify: "Rules run on invoice", decide: "Application decided", "decide-invoice": "Invoice decided", request: "Supplier asked to confirm",
  respond: "Supplier responded", expire: "Supplier did not respond in time", "expire-overdue": "Supplier requests expired", reconcile: "Supplier answer reconciled", "flag-duplicate": "Duplicate claim flagged",
};
const ICON: Record<string, string> = { ingest: "down", verify: "shield", decide: "check", "decide-invoice": "check", request: "mail", respond: "mail", "expire-overdue": "clock", expire: "clock", "flag-duplicate": "x", reconcile: "refresh" };
const LABEL: Record<string, string> = { duplicate_of_invoice: "Duplicate of invoice", maskan_ref: "Maskan reference", ruleset: "Ruleset", request: "Request" };

export interface Described { head: string; who: string; tone: string; line: string; kind: string; ident: string; icon: string }

export function describe(e: AuditView): Described {
  const [kind, , ident = ""] = e.entity.split(/(:)/);
  let who: string, tone: string;
  if (ACTOR[e.actor]) [who, tone] = ACTOR[e.actor];
  else if (e.actor.startsWith("officer:")) [who, tone] = [`Officer ${e.actor.split(":")[1]}`, "officer"];
  else if (e.actor.startsWith("supplier")) [who, tone] = [`Supplier ${e.actor.split(":").pop()}`, "supplier"];
  else [who, tone] = [e.actor, "sys"];
  const bits = Object.entries(e.detail ?? {})
    .filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length))
    .slice(0, 4)
    .map(([k, v]) => `${LABEL[k] ?? nice(k)}: ${typeof v === "string" && v === v.toUpperCase() ? nice(v) : String(v)}`);
  return { head: HEADS[e.action] ?? nice(e.action), who, tone, line: bits.join(" · "), kind, ident, icon: ICON[e.action] ?? "log" };
}

// ── verify an invoice against the live registry ──
export interface CheckResult {
  status: "approved" | "referred" | "rejected";
  reasons: string[];
  checks: [string, boolean | "warn"][];
  supplierName: string | null;
  supplierTrn: string | null;
}

export async function runChecks(trnRaw: string, invoiceNo: string, amount: number, vat: number): Promise<CheckResult> {
  const trn = trnRaw.replace(/\D/g, "");
  const r = await apiRaw(`/fta/suppliers/${trn}`);
  const sup = r.ok ? ((await r.json()) as SupplierStat) : null;
  const { invoices } = await loadAll();
  const dup = invoices.find((i) => i.invoice_no.toLowerCase() === invoiceNo.trim().toLowerCase() && i.supplier_trn === trn);
  const expected = Math.round(amount * 5) / 100;
  const vatOk = Math.abs(vat - expected) <= Math.max(0.05, amount * 0.0005);
  const high = amount >= 100000;
  const reasons: string[] = [];
  let status: CheckResult["status"] = "approved";
  if (!sup) { reasons.push("The TRN was not found in the registry."); status = "rejected"; }
  else if (sup.status !== "ACTIVE") { reasons.push("The supplier is deregistered."); status = "rejected"; }
  if (dup) { reasons.push(`This invoice number is already claimed (${dup.app.maskan_ref}).`); status = "rejected"; }
  if (status !== "rejected") {
    if (!vatOk) { reasons.push(`VAT should be AED ${expected.toFixed(2)} at 5%.`); status = "referred"; }
    if (high) { reasons.push("High-value invoice needs a second look."); status = "referred"; }
    if (sup?.risk_flag) { reasons.push("Supplier carries a risk flag."); status = "referred"; }
  }
  return {
    status, reasons, supplierName: sup?.legal_name ?? null, supplierTrn: sup?.trn ?? null,
    checks: [
      ["TRN is in the registry", !!sup],
      ["Supplier is active", sup ? (sup.risk_flag ? "warn" : sup.status === "ACTIVE") : false],
      ["Invoice not already claimed", !dup],
      ["VAT is 5% of the amount", vatOk],
      ["Amount is below the high-value limit", high ? "warn" : true],
    ],
  };
}

export { fdate };
