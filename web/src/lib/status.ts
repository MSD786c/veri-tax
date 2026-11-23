// One vocabulary for every status chip in the portal. Tone maps to the reserved status colours
// (good / warning / serious / critical) or to in-progress (info) and neutral; the label and icon
// always travel with the colour so meaning never rests on colour alone.
import type { ApplicationStatus, Decision, InvoiceStatus, RequestStatus, RuleOutcome } from "../api/types.ts";

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
  AWAITING_SUPPLIER: { label: "Awaiting supplier", tone: "info", hint: "Sent to the supplier for confirmation" },
  SUPPLIER_CONFIRMED: { label: "Supplier confirmed", tone: "info" },
  DISPUTED: { label: "Disputed", tone: "serious", hint: "The supplier says it did not issue this invoice" },
  NO_SUPPLIER_RESPONSE: { label: "No supplier response", tone: "serious" },
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

export const statusInfo = {
  invoice: (s: InvoiceStatus) => INVOICE[s] ?? { label: s, tone: "neutral" },
  application: (s: ApplicationStatus) => APPLICATION[s] ?? { label: s, tone: "neutral" },
  request: (s: RequestStatus) => REQUEST[s] ?? { label: s, tone: "neutral" },
  rule: (s: RuleOutcome) => RULE[s] ?? { label: s, tone: "neutral" },
  decision: (s: Decision) => DECISION[s] ?? { label: s, tone: "neutral" },
};

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
