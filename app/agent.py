"""Hook for the reasoning agent (OCR extraction and a second opinion on REVIEW items).

Not wired to a model yet: the team has not chosen a provider. The rule engine and the
eligibility catalogue run without it. When a provider is chosen, implement `Agent` and
return it from `get_agent()`; nothing else in the pipeline needs to change.

Rules for any implementation:
  - it recommends, with reasons and the guide section it relied on; it never decides,
  - a field it cannot read is returned as missing, never guessed,
  - applicant and supplier identifiers are masked before any text leaves this service.
"""
import os
from typing import Protocol

from app.eligibility import Classification


class Agent(Protocol):
    def extract_invoice(self, document: bytes, content_type: str) -> dict:
        """Read a PDF or image into the IngestInvoice fields, each with a confidence score."""

    def second_opinion(self, classification: Classification) -> Classification:
        """Reason about an item the catalogue marked REVIEW. May only return REVIEW or a cited verdict."""


def get_agent() -> Agent | None:
    """None until AGENT_PROVIDER is configured and an implementation exists for it."""
    if not os.getenv("AGENT_PROVIDER"):
        return None
    raise NotImplementedError("No agent implementation yet: see the module docstring")
