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
/** The agent's recommendation on one invoice (app/assessment.py). Officers decide. */
export type Rating = "STRONG" | "WEAK" | "FAIL";
export type InvoiceType = "FULL" | "SIMPLIFIED";
export type InvoiceDecisionValue = "APPROVED" | "REJECTED";
export type SupplierStatus = "ACTIVE" | "DEREGISTERED";
export type TrustTier = "TRUSTED" | "STANDARD" | "WATCH";

export interface Supplier {
  trn: string;
  legal_name: string;
  address: string;
  emirate: string;
  emaratax_account_id: string | null;
  risk_flag: boolean;
  registry_verified: boolean;
  status: SupplierStatus;
  registered_from: string | null;
  deregistered_on: string | null;
}

export interface Trust {
  tier: TrustTier;
  confirmed: number;
  disputed: number;
  corrected: number;
  no_response: number;
}

export interface Application {
  id: number;
  maskan_ref: string;
  applicant_name: string;
  plot_no: string;
  emirate: string;
  completion_date: string;
  permit_date: string | null;
  contract_value: number | null;
  claim_type: ClaimType;
  status: ApplicationStatus;
  submitted_at: string;
  /** Application-level common-sense flags (CS-01). */
  flags: string[];
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
  invoice_type: InvoiceType | null;
  supplier_address: string;
  recipient_name: string;
  recipient_address: string;
  supply_date: string | null;
  line_items: LineItem[];
  for_applicant_statement: boolean;
  intermediary_no_recovery_confirmed: boolean;
  status: InvoiceStatus;
  eligible_vat_amount: number;
  suggested_eligible_vat: number | null;
  /** null while the supplier step is still open. */
  rating: Rating | null;
  rating_reasons: string[];
  fix_guidance: string[];
  officer_decision: InvoiceDecisionValue | null;
}

export interface LineItem {
  description: string;
  quantity?: number | null;
  unit_price?: number | null;
  amount?: number | null;
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

export interface InvoiceDecision {
  id: number;
  invoice_id: number;
  officer_id: string;
  decision: InvoiceDecisionValue;
  approved_vat_amount: number;
  comment: string;
  agent_rating: Rating | null;
  overrode_agent: boolean;
  signature: string;
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
  invoices_by_rating: Partial<Record<Rating | "PENDING", number>>;
  officer_overrides: number;
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
  invoices_by_rating: Partial<Record<Rating | "PENDING", number>>;
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
  supplier_trust: Trust;
  /** Earlier officer decisions on invoices with the same findings. */
  precedents: InvoiceDecision[];
  officer_decision: InvoiceDecision | null;
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
  trust: Trust;
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
  supplier_address: string;
  invoice_no: string;
  invoice_date: string;
  title: string;
  invoice_type: InvoiceType;
  recipient_name: string;
  recipient_address: string;
  line_items: LineItem[];
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
  permit_date: string | null;
  contract_value: number | null;
  claim_type: ClaimType;
  invoices: IngestInvoice[];
}

/** GET /maskan/applications/{ref}/status: what the applicant sees in Maskan. */
export interface ApplicantStatus {
  maskan_ref: string;
  status: ApplicationStatus;
  invoices: {
    invoice_no: string;
    supplier_trn: string;
    vat_amount: number;
    status: string;
    decided_by_officer: boolean;
    what_you_can_do: string[];
  }[];
}
