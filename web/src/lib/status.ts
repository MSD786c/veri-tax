// One vocabulary for every status chip in the portal. Tone maps to the reserved status colours
// (good / warning / serious / critical) or to in-progress (info) and neutral; the label and icon
// always travel with the colour so meaning never rests on colour alone.
import type { ApplicationStatus, Decision, InvoiceDecisionValue, InvoiceStatus, Rating, RequestStatus, RuleOutcome, TrustTier } from "../api/types.ts";

export type Tone = "good" | "warning" | "serious" | "critical" | "info" | "neutral";

interface StatusInfo {
  label: string;
  tone: Tone;
  hint?: string;
}

const INVOICE: Record<InvoiceStatus, StatusInfo> = {
  INGESTED: { label: "Ingested", tone: "neutral" },
  EXTRACTED: { label: "Extracted", tone: "neutral" },
  AUTO_VERIFIED: { label: "Auto-verified", tone: "good" },
  NEEDS_SUPPLIER: { label: "Needs supplier", tone: "info" },
  AWAITING_SUPPLIER: { label: "Awaiting supplier", tone: "warning", hint: "Sent to the supplier for confirmation" },
  SUPPLIER_CONFIRMED: { label: "Supplier confirmed", tone: "info" },
  DISPUTED: { label: "Disputed", tone: "serious", hint: "The supplier says it did not issue this invoice" },
  NO_SUPPLIER_RESPONSE: { label: "No supplier response", tone: "warning" },
  AUTO_REJECTED: { label: "Auto-rejected", tone: "critical", hint: "Failed a tax invoice or eligibility rule" },
  RECONCILED: { label: "Reconciled", tone: "info" },
  VERIFIED: { label: "Verified", tone: "good", hint: "Rules passed and the supplier confirmed it" },
  FLAGGED: { label: "Flagged", tone: "warning", hint: "The supplier's answers differ or are incomplete" },
  REJECTED: { label: "Rejected", tone: "critical" },
};

const APPLICATION: Record<ApplicationStatus, StatusInfo> = {
  RECEIVED: { label: "Received", tone: "neutral" },
  IN_VERIFICATION: { label: "In verification", tone: "info" },
  AWAITING_SUPPLIERS: { label: "Awaiting suppliers", tone: "info" },
  READY_FOR_DECISION: { label: "Ready for decision", tone: "warning", hint: "Every invoice has an outcome; an officer must decide" },
  APPROVED: { label: "Approved", tone: "good" },
  PARTIALLY_APPROVED: { label: "Partially approved", tone: "good" },
  REJECTED: { label: "Rejected", tone: "critical" },
};

const REQUEST: Record<RequestStatus, StatusInfo> = {
  PENDING: { label: "Pending", tone: "info" },
  RESPONDED: { label: "Responded", tone: "good" },
  EXPIRED: { label: "Expired", tone: "serious" },
  CANCELLED: { label: "Cancelled", tone: "neutral", hint: "Withdrawn after the invoice was rated fail; re-issued if it recovers" },
};

const RULE: Record<RuleOutcome, StatusInfo> = {
  PASS: { label: "Pass", tone: "good" },
  FAIL: { label: "Fail", tone: "critical" },
  UNCERTAIN: { label: "Uncertain", tone: "warning" },
  NOT_APPLICABLE: { label: "N/A", tone: "neutral" },
};

const DECISION: Record<Decision, StatusInfo> = {
  APPROVED: APPLICATION.APPROVED,
  PARTIALLY_APPROVED: APPLICATION.PARTIALLY_APPROVED,
  REJECTED: APPLICATION.REJECTED,
};

const RATING: Record<Rating | "PENDING", StatusInfo> = {
  STRONG: { label: "Strong", tone: "good", hint: "Agent: every check passed and the supplier confirmed it" },
  WEAK: { label: "Weak", tone: "warning", hint: "Agent: something needs a person to look at it" },
  FAIL: { label: "Fail", tone: "critical", hint: "Agent: a hard rule failed or the supplier disputes it" },
  PENDING: { label: "No rating yet", tone: "neutral", hint: "Waiting for the supplier to confirm" },
};

const TRUST: Record<TrustTier, StatusInfo> = {
  TRUSTED: { label: "Trusted", tone: "good", hint: "Several earlier invoices confirmed and verified" },
  STANDARD: { label: "Standard", tone: "neutral" },
  WATCH: { label: "Watch list", tone: "warning", hint: "Repeated corrections or missed responses, or flagged by an officer" },
};

const INVOICE_DECISION: Record<InvoiceDecisionValue, StatusInfo> = {
  APPROVED: { label: "Officer approved", tone: "good" },
  REJECTED: { label: "Officer rejected", tone: "critical" },
};

export const statusInfo = {
  invoice: (s: InvoiceStatus) => INVOICE[s] ?? { label: s, tone: "neutral" },
  application: (s: ApplicationStatus) => APPLICATION[s] ?? { label: s, tone: "neutral" },
  request: (s: RequestStatus) => REQUEST[s] ?? { label: s, tone: "neutral" },
  rule: (s: RuleOutcome) => RULE[s] ?? { label: s, tone: "neutral" },
  decision: (s: Decision) => DECISION[s] ?? { label: s, tone: "neutral" },
  rating: (s: Rating | "PENDING" | null | undefined) => RATING[s ?? "PENDING"] ?? { label: String(s), tone: "neutral" },
  trust: (s: TrustTier) => TRUST[s] ?? { label: s, tone: "neutral" },
  invoiceDecision: (s: InvoiceDecisionValue) => INVOICE_DECISION[s] ?? { label: s, tone: "neutral" },
};

export const RATING_ORDER: (Rating | "PENDING")[] = ["STRONG", "WEAK", "FAIL", "PENDING"];

/** Pipeline order for application status charts and filters. */
export const APPLICATION_ORDER: ApplicationStatus[] = [
  "RECEIVED",
  "IN_VERIFICATION",
  "AWAITING_SUPPLIERS",
  "READY_FOR_DECISION",
  "APPROVED",
  "PARTIALLY_APPROVED",
  "REJECTED",
];

export const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"];
