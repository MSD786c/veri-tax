"""Document store + vision extraction (README step 2, "Extract").

Files live unchanged under DATA_DIR/documents/<sha256><ext>. Extraction renders PDF pages to
JPEG and asks the vision model for structured fields with a confidence per field.
"""
import hashlib
import io
import os
import re
import secrets
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageOps
from sqlalchemy import update
from sqlmodel import Session, col, select

from app import db, llm, pipeline
from app.models import Document, DocumentStatus, ExtractedInvoice, Invoice

DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
DOC_DIR = DATA_DIR / "documents"
MAX_BYTES = 15 * 1024 * 1024
MAX_PAGES = 5  # Groq accepts up to 5 images per request
ALLOWED = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAGIC = {"application/pdf": b"%PDF-", "image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG", "image/webp": b"RIFF"}
MAX_PIXELS = 40_000_000  # decompression-bomb guard for uploaded images
MAX_SIDE = 2000  # px sent to the model
LOCAL_OCR = os.getenv("LOCAL_OCR", "").lower() in ("1", "true", "yes", "paddle")  # text layer / PaddleOCR + text model
OCR_ALWAYS = os.getenv("LOCAL_OCR", "").lower() == "paddle"  # skip the PDF text layer, OCR every page (demo)
PROMPT_VERSION = "extract-2026.11-4" + ("-text" if LOCAL_OCR else "")
FIELDS = ["title", "invoice_type", "supplier_name", "supplier_address", "supplier_trn", "invoice_no", "invoice_date",
          "supply_date", "recipient_name", "recipient_address", "for_applicant_statement", "plot_no", "description",
          "line_items", "taxable_amount", "vat_rate", "vat_amount", "total", "currency"]

EXTRACT_SYSTEM = f"""You read UAE supplier invoices (English and/or Arabic) for the Federal Tax Authority.
Return ONLY compact single-line JSON (no markdown, no indentation, no prose):
{{"document_type": "TAX_INVOICE" | "QUOTATION" | "PROFORMA" | "RECEIPT" | "OTHER",
 "fields": {{<name>: {{"value": <string or number or null>, "confidence": <0..1>}}}}}}
Field names: {", ".join(FIELDS)}.
- Copy values exactly as printed; dates as YYYY-MM-DD; amounts as plain numbers without currency or commas.
- supplier_trn is the 15-digit Tax Registration Number of the issuer. Copy it digit by digit and count: exactly 15 digits.
- invoice_type: "FULL" (shows recipient, line items with unit price and quantity) or "SIMPLIFIED".
- line_items: {{"value": [{{"description","quantity","unit_price","amount"}}, ...], "confidence": ...}} (at most 10 lines), amounts before VAT.
- for_applicant_statement: true only if the invoice says it is for the use of a named individual's residence.
- description: short summary of the goods/services. plot_no: plot number or residence address if shown.
- If a field is not on the document use null with confidence 0. Never guess: lower the confidence instead."""


def portal_token() -> str:
    """Secret path segment for the Maskan portal. Env wins; otherwise generated once and kept in DATA_DIR."""
    if tok := os.getenv("MASKAN_PORTAL_TOKEN"):
        return tok
    f = DATA_DIR / "maskan_portal_token"
    old = DATA_DIR / "upload_token"  # pre-rename location: keep the same link working
    if not f.exists() and old.exists():
        old.rename(f)
    if not f.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        f.write_text(secrets.token_urlsafe(18))
    return f.read_text().strip()


def store(session: Session, data: bytes, filename: str, content_type: str, source: str, label: str = "") -> tuple[Document, bool]:
    """Save a file once per content hash. Returns (document, created)."""
    if content_type not in ALLOWED:
        raise ValueError(f"unsupported file type {content_type}; use PDF, JPEG, PNG or WebP")
    if len(data) > MAX_BYTES:
        raise ValueError("file larger than 15 MB")
    if not data.startswith(MAGIC[content_type]) or (content_type == "image/webp" and data[8:12] != b"WEBP"):
        raise ValueError("file content does not match its type")
    sha = hashlib.sha256(data).hexdigest()
    if existing := session.exec(select(Document).where(Document.sha256 == sha)).first():
        return existing, False
    DOC_DIR.mkdir(parents=True, exist_ok=True)
    path = DOC_DIR / f"{sha}{ALLOWED[content_type]}"
    path.write_bytes(data)
    doc = Document(sha256=sha, filename=filename, content_type=content_type, size=len(data), path=str(path), source=source, label=label)
    session.add(doc)
    db.audit(session, source, "upload", f"document:{sha[:12]}", filename=filename)
    session.commit()
    session.refresh(doc)
    return doc, True


def page_images(data: bytes, content_type: str) -> list[bytes]:
    """PDF -> up to MAX_PAGES JPEGs; images re-encoded as JPEG, longest side <= 2000px."""
    if content_type == "application/pdf":
        pdf = pdfium.PdfDocument(data)
        # One page at a time, scaled so the longest side is <= MAX_SIDE px (huge-page PDFs can't blow memory).
        images = (p.render(scale=min(2, MAX_SIDE / max(p.get_size()))).to_pil()
                  for p in (pdf[i] for i in range(min(len(pdf), MAX_PAGES))))
    else:
        im = Image.open(io.BytesIO(data), formats=["JPEG", "PNG", "WEBP"])
        if im.width * im.height > MAX_PIXELS:
            raise ValueError("image too large")
        im.draft("RGB", (MAX_SIDE, MAX_SIDE))
        images = [ImageOps.exif_transpose(im)]  # phone photos arrive rotated otherwise
    out = []
    for im in images:
        im = im.convert("RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        out.append(buf.getvalue())
    return out


TRN_SYSTEM = """Read ONLY the supplier's Tax Registration Number (TRN) printed on this invoice.
Return compact JSON {"trn_digits": "1 0 0 ..."} with every digit separated by one space, exactly as printed,
or {"trn_digits": ""} if there is none."""


_paddle = None


def ocr_image(jpeg: bytes) -> str:
    """PaddleOCR, fully local. Models download once (~100 MB) on first use, then load in a few seconds."""
    global _paddle
    if _paddle is None:
        import numpy as np  # noqa: F401 — paddleocr dependency
        from paddleocr import PaddleOCR
        # ponytail: mobile models, ~9 s/page on an M5 CPU (server models ~15 s, same TRN accuracy on the test set).
        _paddle = PaddleOCR(text_detection_model_name="PP-OCRv5_mobile_det", text_recognition_model_name="en_PP-OCRv5_mobile_rec",
                            use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False)
    import numpy as np
    res = _paddle.predict(np.array(Image.open(io.BytesIO(jpeg)).convert("RGB")))[0]
    # Boxes are [x1, y1, x2, y2] from the top-left: group into rows (~12 px), then left to right.
    items = sorted(zip(res["rec_texts"], res["rec_boxes"].tolist()), key=lambda t: (round(t[1][1] / 12), t[1][0]))
    return "\n".join(t for t, _ in items)


def document_text(data: bytes, content_type: str) -> str:
    """LOCAL_OCR mode: the PDF's own text layer, or PaddleOCR for scans and photos (LOCAL_OCR=paddle: always OCR)."""
    pages = []
    if content_type == "application/pdf" and not OCR_ALWAYS:
        pdf = pdfium.PdfDocument(data)
        pages = [pdf[i].get_textpage().get_text_range() for i in range(min(len(pdf), MAX_PAGES))]
    if sum(len(p.strip()) for p in pages) < 50:  # no usable text layer: OCR the page images
        pages = [ocr_image(jpeg) for jpeg in page_images(data, content_type)]
    return "\n\n".join(pages).strip()


def read_invoice(data: bytes, content_type: str) -> dict:
    """Raw model reading of one document (used by app.agent.GroqAgent.extract_invoice)."""
    if LOCAL_OCR:
        text = document_text(data, content_type)
        if not text:
            raise ValueError("no text found in the document")
        return llm.chat_json(EXTRACT_SYSTEM, f"Extract this invoice. Its text, in reading order:\n\n{text}")
    images = page_images(data, content_type)
    parts: list = [{"type": "text", "text": "Extract this invoice."}] + [llm.image_part(img) for img in images]
    return fix_trn(images, llm.chat_json(EXTRACT_SYSTEM, parts, model=llm.VISION_MODEL))


def fix_trn(images: list[bytes], raw: dict) -> dict:
    """Second, digit-by-digit look at a TRN that came back with the wrong length.

    Measured on the 60-invoice test set: TRNs with long runs of one digit (100555555500003) were read
    with one digit too many at confidence 1.0. Asking for the digits space-separated fixes the run length.
    Only a 15-digit second reading replaces the first; otherwise the impossible TRN stays untrusted.
    """
    f = (raw.get("fields") or {}).get("supplier_trn")
    value = f.get("value") if isinstance(f, dict) else f
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits or len(digits) == 15 or LOCAL_OCR:  # a text reading has no image to look at again
        return raw
    out = llm.chat_json(TRN_SYSTEM, [{"type": "text", "text": "Read the TRN."}, llm.image_part(images[0])], model=llm.VISION_MODEL)
    second = re.sub(r"\D", "", str(out.get("trn_digits") or ""))
    if len(second) == 15:
        raw["fields"]["supplier_trn"] = {"value": second, "confidence": 0.8, "first_reading": value}
    return raw


def _clean(raw: dict) -> tuple[str, dict]:
    fields = {}
    for name in FIELDS:
        f = (raw.get("fields") or {}).get(name)
        f = f if isinstance(f, dict) else {"value": f, "confidence": 0.5 if f not in (None, "") else 0}
        try:  # models return 0.95, "0.95" or "95%"
            c = float(str(f.get("confidence")).strip().rstrip("%"))
            c = c / 100 if c > 1 else c
        except (TypeError, ValueError):
            c = 0.0
        fields[name] = {"value": f.get("value"), "confidence": max(0.0, min(1.0, c))}
    _self_check(fields)
    dtype = re.sub(r"[\s\-]+", "_", str(raw.get("document_type") or "OTHER").strip()).upper()
    return dtype if dtype in {"TAX_INVOICE", "QUOTATION", "PROFORMA", "RECEIPT", "OTHER"} else "OTHER", fields


def _self_check(fields: dict) -> None:
    """Confidence from the document's own consistency, not only the model's say-so (measured on the
    60-invoice test set: the model reported 1.0 confidence on a 16-digit misread TRN)."""
    trn = fields["supplier_trn"]
    if trn["value"] is not None:
        digits = re.sub(r"[\s\-]", "", str(trn["value"]))
        trn["value"] = digits
        if not re.fullmatch(r"\d{15}", digits):
            trn["confidence"] = min(trn["confidence"], 0.3)  # impossible TRN: treat as not read, never as a hard fact
    lines = fields["line_items"]
    if isinstance(lines["value"], list):
        amounts = [_num(li.get("amount")) for li in lines["value"] if isinstance(li, dict)]
        taxable = _num(fields["taxable_amount"]["value"])
        adds_up = bool(amounts) and None not in amounts and taxable is not None and abs(sum(amounts) - taxable) <= 1
        # ponytail: lines that sum to the taxable amount are trusted; otherwise they stay below the threshold
        lines["confidence"] = 0.9 if adds_up else min(lines["confidence"], 0.5)


def _num(v):
    from app.rules import to_number
    return None if v in (None, "") else to_number(v)


def extract(document_id: int) -> None:
    """Background job. Never raises: failures land on Document.status/error for retry."""
    with Session(db.engine) as session:
        # Atomic claim: concurrent retries/attaches can't run two extractions of one document.
        claimed = session.execute(update(Document).where(
            Document.id == document_id, Document.status != DocumentStatus.EXTRACTING
        ).values(status=DocumentStatus.EXTRACTING, error=None)).rowcount
        session.commit()
        if not claimed:
            return
        doc = session.get(Document, document_id)
        try:
            from app.agent import get_agent  # the team's agent hook; AGENT_PROVIDER=groq selects ours
            agent = get_agent()
            if agent is None:
                raise llm.LLMError("No agent configured: set AGENT_PROVIDER=groq and GROQ_API_KEY in .env")
            dtype, fields = _clean(agent.extract_invoice(Path(doc.path).read_bytes(), doc.content_type))
            old = session.exec(select(ExtractedInvoice).where(ExtractedInvoice.document_id == doc.id)).first()
            if old:
                session.delete(old)
                session.flush()
            ext = ExtractedInvoice(document_id=doc.id, document_type=dtype, fields=fields, model=llm.VISION_MODEL, prompt_version=PROMPT_VERSION)
            session.add(ext)
            doc.status = DocumentStatus.EXTRACTED
            db.audit(session, "extraction", "extract", f"document:{doc.id}", model=llm.VISION_MODEL, document_type=dtype)
            session.flush()
            linked = [inv.id for inv in pipeline.link_document(session, doc, ext)]  # ids: objects expire on commit
            session.commit()
        except Exception as e:  # noqa: BLE001 — job boundary: record and move on
            session.rollback()
            doc = session.get(Document, document_id)
            doc.status, doc.error = DocumentStatus.FAILED, str(e)[:500]
            session.commit()
            return
    # Compliance review for newly linked invoices runs after the extraction commit.
    from app import agents
    for invoice_id in linked:
        agents.compliance_review_background(invoice_id)
    with Session(db.engine) as session:  # a document can be what makes an application ready
        app_ids = {session.get(Invoice, i).application_id for i in linked}
        ready = pipeline.ready_applications(session, app_ids)
    for app_id in ready:
        agents.summary_background(app_id)


def reset_interrupted() -> int:
    """At startup: in-process jobs died with the old worker, so mark them FAILED (retryable).
    ponytail: assumes a single worker; use a job queue before running several."""
    with Session(db.engine) as session:
        stuck = session.exec(select(Document).where(
            col(Document.status).in_([DocumentStatus.UPLOADED, DocumentStatus.EXTRACTING]))).all()
        for d in stuck:
            d.status, d.error = DocumentStatus.FAILED, "interrupted by restart; retry"
        session.commit()
        return len(stuck)
