"""Request bodies (API contract). Response bodies are the table models or plain dicts."""
from datetime import date
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.models import ClaimType, ConsiderationStatus, Decision


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


class IngestApplication(BaseModel):
    maskan_ref: str
    applicant_name: str
    emirates_id: str = Field(description="Hashed before storage, never persisted in clear")
    plot_no: str
    emirate: str
    completion_date: date
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
    vat_return_period: str | None = Field(None, examples=["2026-Q2", "Apr-2026"])
    declared_by: str
    declaration: bool = Field(description="Supplier confirms the information is correct")

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
