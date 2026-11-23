// Mirrors app/models.py and the response shapes in app/api/*. Dates are ISO strings.

export type InvoiceStatus =
  | "INGESTED"
  | "EXTRACTED"
  | "AUTO_VERIFIED"
  | "NEEDS_SUPPLIER"
  | "AWAITING_SUPPLIER"
  | "SUPPLIER_CONFIRMED"
  | "DISPUTED"
  | "NO_SUPPLIER_RESPONSE"
  | "AUTO_REJECTED"
  | "RECONCILED"
  | "VERIFIED"
  | "FLAGGED"
  | "REJECTED";

export type ApplicationStatus =
  | "RECEIVED"
  | "IN_VERIFICATION"
  | "AWAITING_SUPPLIERS"
  | "READY_FOR_DECISION"
  | "APPROVED"
  | "PARTIALLY_APPROVED"
  | "REJECTED";

export type ClaimType = "NEW_RESIDENCE" | "RETENTION" | "ADDITION";
export type RuleOutcome = "PASS" | "FAIL" | "UNCERTAIN" | "NOT_APPLICABLE";
export type RequestStatus = "PENDING" | "RESPONDED" | "EXPIRED";
export type ConsiderationStatus = "RECEIVED" | "PARTIAL_OR_RETENTION";
export type Decision = "APPROVED" | "PARTIALLY_APPROVED" | "REJECTED";

export interface Supplier {
  trn: string;
  legal_name: string;
  address: string;
  emirate: string;
  emaratax_account_id: string | null;
  risk_flag: boolean;
}

export interface Application {
  id: number;
  maskan_ref: string;
  applicant_name: string;
  plot_no: string;
  emirate: string;
  completion_date: string;
  claim_type: ClaimType;
  status: ApplicationStatus;
  submitted_at: string;
}

export interface Invoice {
  id: number;
  application_id: number;
  supplier_trn: string;
  invoice_no: string;
  invoice_date: string;
  title: string;
  taxable_amount: number;
  vat_amount: number;
  total: number;
  currency: string;
  plot_no: string;
  description: string;
  document_uri: string | null;
  document_hash: string | null;
  status: InvoiceStatus;
  eligible_vat_amount: number;
}

export interface RuleResult {
  id: number;
  invoice_id: number;
  rule_id: string;
  rule_version: string;
  result: RuleOutcome;
  evidence: Record<string, unknown>;
}

export interface ConfirmationRequest {
  id: number;
  invoice_id: number;
  supplier_trn: string;
  sent_at: string;
  due_at: string;
  reminders: number;
  status: RequestStatus;
}

export interface SupplierResponse {
  id: number;
  request_id: number;
  issued: boolean;
  particulars_confirmed: boolean;
  corrections: Record<string, unknown>;
  consideration_status: ConsiderationStatus | null;
  amount_received: number | null;
  received_date: string | null;
  retention_amount: number | null;
  retention_release_date: string | null;
  vat_return_period: string | null;
  declared_by: string;
  declared_at: string;
}

export interface OfficerDecision {
  id: number;
  application_id: number;
  officer_id: string;
  decision: Decision;
  approved_amount: number;
  comments: string;
  decided_at: string;
}

export interface AuditEvent {
  id: number;
  actor: string;
  action: string;
  entity: string;
  detail: Record<string, unknown>;
  at: string;
}

// ---- /meta
export interface RuleInfo {
  group: string;
  title: string;
  description: string;
  implemented: boolean;
}
export interface RuleCatalog {
  ruleset_version: string;
  rules: Record<string, RuleInfo>;
}

// ---- /supplier
export interface RequestView {
  request: ConfirmationRequest;
  invoice: Invoice;
  application: Pick<Application, "maskan_ref" | "applicant_name" | "plot_no" | "emirate">;
  response: SupplierResponse | null;
}

export interface SupplierResponseIn {
  issued: boolean;
  particulars_confirmed: boolean;
  corrections: Record<string, string | number>;
  consideration_status: ConsiderationStatus | null;
  amount_received: number | null;
  received_date: string | null;
  retention_amount: number | null;
  retention_release_date: string | null;
  vat_return_period: string | null;
  declared_by: string;
  declaration: boolean;
}

// ---- /fta
export interface Overview {
  applications_total: number;
  applications_new: { today: number; week: number; month: number };
  applications_by_status: Partial<Record<ApplicationStatus, number>>;
  invoices_total: number;
  invoices_by_status: Partial<Record<InvoiceStatus, number>>;
  refund_requested_aed: number;
  refund_verified_aed: number;
  refund_approved_aed: number;
  rejected_applications: number;
  rejected_refund_aed: number;
  supplier_requests_total: number;
  supplier_requests_pending: number;
  supplier_response_rate: number | null;
  avg_response_hours: number | null;
  top_rule_failures: [string, number][];
}

export interface ApplicationRow extends Application {
  invoice_count: number;
  vat_claimed: number;
  vat_eligible: number;
  issue_count: number;
  failed_rules: string[];
}

export interface InvoiceDetail {
  invoice: Invoice;
  supplier: Supplier;
  rule_results: RuleResult[];
  confirmation_request: ConfirmationRequest | null;
  supplier_response: SupplierResponse | null;
}

export interface ApplicationDetail {
  application: Application;
  invoices: InvoiceDetail[];
  decision: OfficerDecision | null;
  audit: AuditEvent[];
}

export interface SupplierStats extends Supplier {
  application_count: number;
  invoice_count: number;
  vat_claimed: number;
  vat_verified: number;
  vat_rejected: number;
  response_rate: number | null;
}

export interface SupplierInvoiceRow extends Invoice {
  maskan_ref: string;
  application_status: ApplicationStatus;
  failed_rules: string[];
  request_status: RequestStatus | null;
  vat_return_period: string | null;
}

export interface SupplierDetail extends SupplierStats {
  invoices: SupplierInvoiceRow[];
  declared_vat_periods: string[];
  retention_outstanding: number;
}

export interface RejectionRow {
  invoice: Invoice;
  supplier_name: string;
  maskan_ref: string;
  applicant_name: string;
  emirate: string;
  failed_rules: string[];
}

// ---- /maskan
export interface IngestInvoice {
  supplier_trn: string;
  supplier_name: string;
  invoice_no: string;
  invoice_date: string;
  title: string;
  taxable_amount: number;
  vat_amount: number;
  total: number;
  plot_no: string;
  description: string;
}

export interface IngestApplication {
  maskan_ref: string;
  applicant_name: string;
  emirates_id: string;
  plot_no: string;
  emirate: string;
  completion_date: string;
  claim_type: ClaimType;
  invoices: IngestInvoice[];
}
