"""Request bodies (API contract). Response bodies are the table models or plain dicts."""
from datetime import date
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models import ClaimType, ConsiderationStatus, Decision, InvoiceDecisionValue, InvoiceType
from app.rules import PERIOD_RE


class LineItem(BaseModel):
    description: str
    quantity: float | None = None
    unit_price: float | None = None
    amount: float | None = Field(None, description="Net amount of the line in AED, before VAT")


class IngestInvoice(BaseModel):
    supplier_trn: str
    supplier_name: str
    invoice_no: str
    invoice_date: date
    title: str = "Tax Invoice"
    taxable_amount: float = Field(ge=0)
    vat_amount: float = Field(ge=0)
    total: float = Field(ge=0)
    currency: str = "AED"
    plot_no: str = ""
    description: str = ""
    document_uri: str | None = None
    # Article 59 particulars from extraction. Leave a field out if it was not read; never guess it.
    invoice_type: InvoiceType | None = Field(None, description="FULL or SIMPLIFIED, as read from the document")
    supplier_address: str = ""
    recipient_name: str = ""
    recipient_address: str = ""
    supply_date: date | None = None
    line_items: list[LineItem] = []
    for_applicant_statement: bool = False
    intermediary_no_recovery_confirmed: bool = False


class IngestApplication(BaseModel):
    maskan_ref: str
    applicant_name: str
    emirates_id: str = Field(description="Hashed before storage, never persisted in clear")
    plot_no: str
    emirate: str
    completion_date: date
    permit_no: str = Field("", description="Building permit number; the FTA groups claims into projects by it")
    permit_date: date | None = None
    contract_value: float | None = Field(None, ge=0, description="Construction contract value in AED, incl. VAT")
    claim_type: ClaimType = ClaimType.NEW_RESIDENCE
    invoices: list[IngestInvoice] = Field(min_length=1)


class SupplierResponseIn(BaseModel):
    issued: bool
    particulars_confirmed: bool = False
    corrections: dict[str, Any] = {}
    consideration_status: ConsiderationStatus | None = None
    amount_received: float | None = None
    received_date: date | None = None
    retention_amount: float | None = None
    retention_release_date: date | None = None
    vat_return_period: str | None = Field(None, examples=["2026-Q4", "Nov-2026"])
    declared_by: str
    declaration: bool = Field(description="Supplier confirms the information is correct")

    @field_validator("vat_return_period")
    @classmethod
    def _period(cls, v: str | None) -> str | None:
        v = (v or "").strip() or None
        if v is not None and not PERIOD_RE.match(v):
            raise ValueError(f"vat_return_period must be a quarter like 2026-Q4 or a month like Nov-2026, got {v!r}")
        return v

    @model_validator(mode="after")
    def _declared(self):
        if not self.declaration:
            raise ValueError("declaration must be accepted")
        return self


class BulkResponseItem(SupplierResponseIn):
    request_id: int


class BulkResponseIn(BaseModel):
    """Several responses in one call (bulk confirm or CSV upload). All are saved or none."""
    items: list[BulkResponseItem] = Field(min_length=1, max_length=500)


class DecisionIn(BaseModel):
    decision: Decision
    approved_amount: float = Field(ge=0)
    comments: str = ""


class InvoiceDecisionIn(BaseModel):
    decision: InvoiceDecisionValue
    approved_vat_amount: float | None = Field(None, ge=0, description="Defaults to the eligible VAT on the invoice")
    comment: str = ""
