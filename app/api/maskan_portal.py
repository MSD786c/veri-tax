"""Maskan portal API: /maskan/portal/<random token>. The main entry for pulling invoice documents in.

Original tax invoices are uploaded here, read by the vision agent, matched to Maskan invoices by
supplier TRN + invoice number, and tracked live. No login; the unguessable token is the access control.
The portal only ever sees documents uploaded through it (documents attached to a specific Maskan
invoice via POST /maskan/invoices/{id}/document are visible to FTA officers only).

ponytail: one shared token. Per-uploader tokens + expiry when this leaves the team.
"""
import secrets
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from sqlmodel import Session, col, select

from app import documents
from app.db import get_session
from app import eligibility, rules
from app.models import Application, Document, DocumentStatus, ExtractedInvoice, Invoice, Supplier

router = APIRouter(prefix="/maskan/portal/{token}", tags=["maskan portal (invoice intake)"])
SOURCE = "maskan-portal"
PAGE = (Path(__file__).parent.parent / "static" / "maskan_portal.html").read_text()


def check_token(token: str) -> None:
    if not secrets.compare_digest(token.encode(), documents.portal_token().encode()):
        raise HTTPException(404)


def _own(doc_id: int, session: Session, token: str) -> Document:
    check_token(token)
    doc = session.get(Document, doc_id)
    if not doc or doc.source != SOURCE:
        raise HTTPException(404)
    return doc


def _registered(session: Session, trn) -> bool:
    """Vendor is in the FTA registry data (TI-03). An invoice with no TRN can't be from a registered vendor."""
    s = session.get(Supplier, str(trn)) if trn else None
    return bool(s and s.registry_verified)


def _not_eligible(ext: ExtractedInvoice) -> str | None:
    """NR-02 on what was read, at upload time: the same Appendix 1 catalogue the rule engine uses."""
    f = ext.fields or {}
    val = lambda k: (f.get(k) or {}).get("value")  # noqa: E731
    lines = [li for li in (val("line_items") or []) if isinstance(li, dict) and li.get("description")]
    texts = [str(li["description"]) for li in lines] or [str(val("description") or "")]
    bad = [c for c in (eligibility.classify(t) for t in texts if t.strip()) if c.verdict == eligibility.Verdict.NOT_ELIGIBLE]
    if not bad:
        return None
    if any("furniture" in c.reason.lower() for c in bad):
        return "Not eligible · Furniture is not included in the refund programme (VATGRH1 Appendix 1)"
    return f"Not eligible · {bad[0].reason}"


def document_view(session: Session, doc: Document) -> dict:
    ext = session.exec(select(ExtractedInvoice).where(ExtractedInvoice.document_id == doc.id)).first()
    invs = session.exec(select(Invoice).where(Invoice.document_hash == doc.sha256)).all()
    trns = [i.supplier_trn for i in invs] or ([rules.trusted(ext.model_dump(), "supplier_trn")] if ext else [])
    flags = []
    if doc.status == DocumentStatus.EXTRACTED and not all(_registered(session, t) for t in trns or [None]):
        flags.append("Not a registered vendor")
    if ext and doc.status == DocumentStatus.EXTRACTED and (why := _not_eligible(ext)):
        flags.append(why)
    return {
        "document": doc.model_dump(exclude={"path"}),
        "extraction": ext,
        "flags": flags,  # shown on the Maskan portal at upload time, before any Maskan claim is matched
        "flag": flags[0] if flags else None,
        "linked_invoices": [{"invoice_id": i.id, "invoice_no": i.invoice_no, "status": i.status,
                             "maskan_ref": session.get(Application, i.application_id).maskan_ref} for i in invs],
    }


@router.get("", response_class=HTMLResponse, include_in_schema=False)
def page(token: str):
    check_token(token)
    return PAGE


@router.get("/documents")
def list_documents(token: str, session: Session = Depends(get_session)):
    check_token(token)
    docs = session.exec(select(Document).where(Document.source == SOURCE).order_by(col(Document.uploaded_at).desc())).all()
    return [document_view(session, d) for d in docs]


@router.post("/documents", status_code=201)
async def upload(token: str, background: BackgroundTasks, files: list[UploadFile] = File(...),
                 label: str = Form(""), session: Session = Depends(get_session)):
    check_token(token)
    out = []
    for f in files:
        try:
            data = await f.read(documents.MAX_BYTES + 1)  # bounded: never hold more than the limit
            doc, created = documents.store(session, data, f.filename or "invoice", f.content_type or "", SOURCE, label)
        except ValueError as e:
            out.append({"filename": f.filename, "error": str(e)})
            continue
        if created:
            background.add_task(documents.extract, doc.id)
        out.append({"filename": f.filename, "document_id": doc.id, "duplicate": not created})
    return out


@router.post("/documents/{doc_id}/retry")
def retry(token: str, doc_id: int, background: BackgroundTasks, session: Session = Depends(get_session)):
    _own(doc_id, session, token)
    background.add_task(documents.extract, doc_id)  # extract() ignores it if already running
    return {"queued": doc_id}


@router.get("/documents/{doc_id}/file")
def original(token: str, doc_id: int, session: Session = Depends(get_session)):
    doc = _own(doc_id, session, token)
    return FileResponse(doc.path, media_type=doc.content_type, filename=doc.filename)
