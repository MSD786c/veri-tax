"""Core data model. Mirrors the README "Data model" section.

ponytail: Applicant is folded into Application and ExtractedInvoice is skipped until
OCR (roadmap phase 1) lands — add them as tables when they carry real data.
"""
from datetime import date, datetime, timezone
from enum import StrEnum
from typing import Any

from sqlmodel import JSON, Column, Field, SQLModel


def now() -> datetime:
    return datetime.now(timezone.utc)


class InvoiceStatus(StrEnum):
    INGESTED = "INGESTED"
    EXTRACTED = "EXTRACTED"
    AUTO_VERIFIED = "AUTO_VERIFIED"
    NEEDS_SUPPLIER = "NEEDS_SUPPLIER"
    AWAITING_SUPPLIER = "AWAITING_SUPPLIER"
    SUPPLIER_CONFIRMED = "SUPPLIER_CONFIRMED"
    DISPUTED = "DISPUTED"
    NO_SUPPLIER_RESPONSE = "NO_SUPPLIER_RESPONSE"
    AUTO_REJECTED = "AUTO_REJECTED"
    RECONCILED = "RECONCILED"
    VERIFIED = "VERIFIED"
    FLAGGED = "FLAGGED"
    REJECTED = "REJECTED"


class ApplicationStatus(StrEnum):
    RECEIVED = "RECEIVED"
    IN_VERIFICATION = "IN_VERIFICATION"
    AWAITING_SUPPLIERS = "AWAITING_SUPPLIERS"
    READY_FOR_DECISION = "READY_FOR_DECISION"
    APPROVED = "APPROVED"
    PARTIALLY_APPROVED = "PARTIALLY_APPROVED"
    REJECTED = "REJECTED"


class ClaimType(StrEnum):
    NEW_RESIDENCE = "NEW_RESIDENCE"
    RETENTION = "RETENTION"
    ADDITION = "ADDITION"


class RuleOutcome(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNCERTAIN = "UNCERTAIN"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class RequestStatus(StrEnum):
    PENDING = "PENDING"
    RESPONDED = "RESPONDED"
    EXPIRED = "EXPIRED"


class ConsiderationStatus(StrEnum):
    RECEIVED = "RECEIVED"
    PARTIAL_OR_RETENTION = "PARTIAL_OR_RETENTION"


class Decision(StrEnum):
    APPROVED = "APPROVED"
    PARTIALLY_APPROVED = "PARTIALLY_APPROVED"
    REJECTED = "REJECTED"


class Supplier(SQLModel, table=True):
    trn: str = Field(primary_key=True)
    legal_name: str
    address: str = ""
    emirate: str = ""
    emaratax_account_id: str | None = None
    risk_flag: bool = False


class Application(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    maskan_ref: str = Field(index=True, unique=True)
    applicant_name: str
    emirates_id_hash: str
    plot_no: str
    emirate: str
    completion_date: date
    claim_type: ClaimType = ClaimType.NEW_RESIDENCE
    status: ApplicationStatus = ApplicationStatus.RECEIVED
    submitted_at: datetime = Field(default_factory=now)


class Invoice(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    application_id: int = Field(foreign_key="application.id", index=True)
    supplier_trn: str = Field(foreign_key="supplier.trn", index=True)
    invoice_no: str
    invoice_date: date
    title: str = "Tax Invoice"
    taxable_amount: float
    vat_amount: float
    total: float
    currency: str = "AED"
    plot_no: str = ""
    description: str = ""
    document_uri: str | None = None
    document_hash: str | None = None
    status: InvoiceStatus = InvoiceStatus.INGESTED
    eligible_vat_amount: float = 0


class RuleResult(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    invoice_id: int = Field(foreign_key="invoice.id", index=True)
    rule_id: str
    rule_version: str
    result: RuleOutcome
    evidence: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))


class ConfirmationRequest(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    invoice_id: int = Field(foreign_key="invoice.id", index=True)
    supplier_trn: str = Field(foreign_key="supplier.trn", index=True)
    sent_at: datetime = Field(default_factory=now)
    due_at: datetime
    reminders: int = 0
    status: RequestStatus = RequestStatus.PENDING


class SupplierResponse(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    request_id: int = Field(foreign_key="confirmationrequest.id", unique=True)
    issued: bool
    particulars_confirmed: bool
    corrections: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    consideration_status: ConsiderationStatus | None = None
    amount_received: float | None = None
    received_date: date | None = None
    retention_amount: float | None = None
    retention_release_date: date | None = None
    vat_return_period: str | None = None
    declared_by: str
    declared_at: datetime = Field(default_factory=now)


class OfficerDecision(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    application_id: int = Field(foreign_key="application.id", index=True)
    officer_id: str
    decision: Decision
    approved_amount: float
    comments: str = ""
    decided_at: datetime = Field(default_factory=now)


class AuditEvent(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    actor: str
    action: str
    entity: str
    detail: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    at: datetime = Field(default_factory=now)
