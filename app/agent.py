"""The reasoning agent: OCR extraction and a second opinion on REVIEW items.

Selected by AGENT_PROVIDER. "groq" uses Groq's OpenAI-compatible API (app/llm.py, GROQ_API_KEY);
empty means no agent: the rule engine and the eligibility catalogue still run without it.

Rules for any implementation:
  - it recommends, with reasons and the guide section it relied on; it never decides,
  - a field it cannot read is returned as missing, never guessed,
  - applicant and supplier identifiers are masked before any text leaves this service.
    ponytail: extraction sends the invoice image itself (it must be read); second opinions send
    only item text. Mask names/IDs in agent payloads before any non-UAE-hosted provider is used in production.
"""
import json
import os
from typing import Protocol

from app.eligibility import Classification, Verdict


class Agent(Protocol):
    def extract_invoice(self, document: bytes, content_type: str) -> dict:
        """Read a PDF or image into the IngestInvoice fields, each with a confidence score."""

    def second_opinion(self, classification: Classification) -> Classification:
        """Reason about an item the catalogue marked REVIEW. May only return REVIEW or a cited verdict."""


SECOND_OPINION_SYSTEM = """You advise UAE FTA officers on the New Residences VAT refund (FTA guide VATGRH1, Appendix 1).
Eligible: building works and materials that become part of the residence. Not eligible: furniture, movable
electrical appliances, and anything not part of the building. Decide only if the guide is clear; otherwise REVIEW.
Return ONLY compact JSON: {"verdict": "ELIGIBLE"|"NOT_ELIGIBLE"|"REVIEW", "reason": "...", "citation": "VATGRH1 ..."}"""


class GroqAgent:
    def extract_invoice(self, document: bytes, content_type: str) -> dict:
        from app import documents
        return documents.read_invoice(document, content_type)

    def second_opinion(self, classification: Classification) -> Classification:
        from app import llm
        out = llm.chat_json(SECOND_OPINION_SYSTEM, json.dumps(
            {"item": classification.text, "catalogue_reason": classification.reason, "matches": classification.matches}, default=str))
        verdict = str(out.get("verdict", "REVIEW")).upper()
        citation = str(out.get("citation") or "").strip()
        if verdict not in Verdict.__members__ or (verdict != "REVIEW" and not citation):
            verdict = "REVIEW"  # an uncited verdict is not acceptable
        reason = f"Agent: {out.get('reason', '')}" + (f" ({citation})" if citation else "")
        return Classification(classification.text, Verdict(verdict), reason, classification.matches)


def get_agent() -> Agent | None:
    """None until AGENT_PROVIDER is configured."""
    provider = os.getenv("AGENT_PROVIDER", "").strip().lower()
    if not provider:
        return None
    if provider in ("groq", "local"):  # "local": same OpenAI-compatible client pointed at Ollama (LLM_BASE_URL)
        return GroqAgent()
    raise NotImplementedError(f"No agent implementation for AGENT_PROVIDER={provider!r}")
