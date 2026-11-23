// Shapes returned by the veri-tax API (only the fields this portal reads).
export type Rating = "STRONG" | "WEAK" | "FAIL";
export type Tier = "TRUSTED" | "STANDARD" | "WATCH";

export interface Invoice {
  id: number;
  application_id: number;
  supplier_trn: string;
  invoice_no: string;
  invoice_date: string;
  taxable_amount: number;
  vat_amount: number;
  eligible_vat_amount: number;
  rating: Rating | null;
  rating_reasons: string[];
  fix_guidance: string[];
}

export interface OfficerInvoiceDecision {
  decision: "APPROVED" | "REJECTED";
  officer_id: string;
  decided_at: string;
  comment: string;
}

export interface SupplierResponse {
  issued: boolean;
  particulars_confirmed: boolean;
  vat_return_period: string | null;
  declared_by: string;
}

export interface InvoiceRow {
  invoice: Invoice;
  supplier: { legal_name: string } | null;
  /** Every run of every rule, oldest first. loadAll keeps only the latest result per rule_id. */
  rule_results: { id: number; rule_id: string; result: "PASS" | "FAIL" | "UNCERTAIN" | "NOT_APPLICABLE" }[];
  confirmation_request: { sent_at: string; status: string } | null;
  supplier_response: SupplierResponse | null;
  supplier_trust: string | { tier: string };
  officer_decision: OfficerInvoiceDecision | null;
  document: DocumentMeta | null;
  extraction: Extraction | null;
  agent_runs: AgentRun<ComplianceOutput>[];
}

// ── original documents and advisory agents (v0.2) ──
export interface DocumentMeta {
  id: number;
  filename: string;
  content_type: string;
  size: number;
  source: string;
  status: string; // UPLOADED | STORED | EXTRACTING | EXTRACTED | FAILED
  error: string | null;
  label: string | null;
  uploaded_at: string;
}

export interface Extraction {
  document_type: string;
  model: string;
  created_at: string;
  fields: Record<string, { value: unknown; confidence: number }>;
}

export interface DocumentRow {
  document: DocumentMeta;
  extraction: Extraction | null;
  linked_invoices: { invoice_id: number; invoice_no: string; status: string; maskan_ref: string }[];
}

export interface AgentRun<T> {
  id: number;
  kind: string;
  model: string;
  at: string;
  error: string | null;
  output: T | null;
}

export interface ComplianceOutput {
  recommendations?: { rule_id: string; recommendation: string; reason: string }[];
  eligible_goods?: boolean;
  notes?: string;
}

export interface BriefOutput {
  recommended_decision?: string;
  recommended_amount?: number;
  summary?: string;
  reasons?: string[];
  risks?: string[];
  follow_up?: string[];
}

export interface AuditEvent {
  id: number;
  entity: string;
  actor: string;
  action: string;
  at: string;
  detail: Record<string, unknown> | null;
}

export interface ApplicationSummary {
  id: number;
  maskan_ref: string;
  applicant_name: string;
  plot_no: string;
  emirate: string;
  status: string;
  submitted_at: string;
  completion_date: string;
  contract_value: number | null;
  claim_type: string;
  invoice_count: number;
  vat_claimed: number;
  vat_eligible: number;
}

export interface ApplicationDetail {
  application: ApplicationSummary;
  invoices: InvoiceRow[];
  decision: { decision: string; approved_amount: number; officer_id: string; decided_at: string; comments: string } | null;
  audit: AuditEvent[];
  agent_runs: AgentRun<BriefOutput>[];
}

export interface SupplierStat {
  trn: string;
  legal_name: string;
  emirate: string;
  status: string;
  risk_flag: boolean;
  trust: string | { tier: string };
  invoice_count: number;
  application_count: number;
  vat_claimed: number;
  vat_verified: number;
  vat_rejected: number;
  response_rate: number | null;
}

export interface SupplierDetail extends SupplierStat {
  invoices: Invoice[];
  declared_vat_periods: string[];
  retention_outstanding: number;
}

export interface Analytics {
  filters: { emirate: string | null; date_from: string | null; date_to: string | null; emirates: string[] };
  totals: {
    applications: number; invoices: number; claimed: number; verified: number; not_refundable: number;
    officer_decisions: number; overrides: number; supplier_response_rate: number | null;
  };
  monthly: { month: string; claimed: number; verified: number; rejected: number; invoices: number }[];
  ratings: Record<"STRONG" | "WEAK" | "FAIL" | "PENDING", number>;
  application_status: Record<string, number>;
  by_emirate: { emirate: string; claimed: number; verified: number; invoices: number }[];
  top_suppliers: { trn: string; name: string; claimed: number; rejected: number; invoices: number }[];
  rule_failures: { rule: string; count: number }[];
  decisions_daily: { day: string; approved: number; rejected: number }[];
}

// ── joined view models ──
export type InvStatus = "approved" | "referred" | "rejected" | "pending";
export type Tone = "neutral" | "gold" | "info" | "approved" | "rejected" | "referred";

export interface FlatInvoice extends Invoice {
  row: InvoiceRow;
  app: AppView;
  supplier_name: string;
  status_ui: InvStatus;
  decision: OfficerInvoiceDecision | null;
}

export interface AppView extends ApplicationSummary {
  detail: ApplicationDetail;
  label: string;
  tone: Tone;
  decided: boolean;
  invoices: FlatInvoice[];
}

export interface AuditView extends AuditEvent {
  app_ref: string;
}

// ── projects: one Maskan application per building permit ──
export interface Project {
  permit_no: string;
  application_id: number;
  maskan_ref: string;
  applicant_name: string;
  plot_no: string;
  emirate: string;
  permit_date: string | null;
  completion_date: string | null;
  status: string;
  invoice_count: number;
  vat_claimed: number;
  vat_eligible: number;
  invoices_by_rating: Record<"STRONG" | "WEAK" | "FAIL" | "PENDING", number>;
}

export interface ProjectInvoice {
  id: number;
  invoice_no: string;
  invoice_date: string;
  supplier_trn: string;
  supplier_name: string | null;
  description: string | null;
  total: number;
  vat_amount: number;
  eligible_vat_amount: number;
  status: string;
  rating: Rating | null;
  officer_decision: unknown;
  has_document: boolean;
  supplier_responded: boolean;
}
