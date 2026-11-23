"""EmaraTax supplier portal API. A supplier only ever sees requests under its own TRN.

ponytail: identity is the X-Supplier-TRN header. Replace with EmaraTax / UAE PASS token
validation before anything real touches this.
"""
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from sqlmodel import Session, select

from app import agents, pipeline
from app.db import audit, get_session
from app.models import (
    Application,
    ApplicationStatus,
    ConfirmationRequest,
    Invoice,
    RequestStatus,
    Supplier,
    SupplierResponse,
)
from app.schemas import BulkResponseIn, SupplierResponseIn

router = APIRouter(prefix="/supplier", tags=["supplier portal (EmaraTax)"])


def current_supplier(x_supplier_trn: str = Header(), session: Session = Depends(get_session)) -> Supplier:
    supplier = session.get(Supplier, x_supplier_trn)
    if not supplier:
        raise HTTPException(401, "unknown supplier TRN")
    return supplier


# The FTA's own assessment of an invoice never goes to the supplier (only to officers via /fta).
FTA_INTERNAL = {"rating", "rating_reasons", "fix_guidance", "suggested_eligible_vat", "eligible_vat_amount",
                "officer_decision", "document_hash"}


def _request_view(session: Session, req: ConfirmationRequest) -> dict:
    inv = session.get(Invoice, req.invoice_id)
    app = session.get(Application, inv.application_id)
    resp = session.exec(select(SupplierResponse).where(SupplierResponse.request_id == req.id)).first()
    return {
        "request": req,
        "invoice": inv.model_dump(exclude=FTA_INTERNAL),
        # Supplier sees only what it needs to confirm, not the applicant's Emirates ID.
        "application": {"maskan_ref": app.maskan_ref, "applicant_name": app.applicant_name, "plot_no": app.plot_no, "emirate": app.emirate},
        "response": resp,
    }


@router.get("/me", response_model=Supplier)
def me(supplier: Supplier = Depends(current_supplier)):
    return supplier


@router.get("/requests")
def list_requests(status: RequestStatus | None = None, supplier: Supplier = Depends(current_supplier), session: Session = Depends(get_session)):
    q = select(ConfirmationRequest).where(ConfirmationRequest.supplier_trn == supplier.trn)
    if status:
        q = q.where(ConfirmationRequest.status == status)
    return [_request_view(session, r) for r in session.exec(q.order_by(ConfirmationRequest.due_at)).all()]


def _own_request(request_id: int, supplier: Supplier, session: Session) -> ConfirmationRequest:
    req = session.get(ConfirmationRequest, request_id)
    if not req or req.supplier_trn != supplier.trn:
        raise HTTPException(404, "request not found")
    return req


@router.get("/requests/{request_id}")
def get_request(request_id: int, supplier: Supplier = Depends(current_supplier), session: Session = Depends(get_session)):
    return _request_view(session, _own_request(request_id, supplier, session))


def _apply_response(session: Session, supplier: Supplier, req: ConfirmationRequest, body: SupplierResponseIn) -> Invoice:
    resp = SupplierResponse(request_id=req.id, **body.model_dump(exclude={"declaration", "request_id"}))
    session.add(resp)
    session.flush()
    audit(session, f"supplier:{supplier.trn}", "respond", f"request:{req.id}", declared_by=body.declared_by)
    return pipeline.reconcile(session, req, resp)


def _brief_ready_applications(session: Session, background: BackgroundTasks, app_ids: set[int]) -> None:
    """Queue the officer's decision brief for every application this response made ready."""
    for app_id in sorted(app_ids):
        if session.get(Application, app_id).status == ApplicationStatus.READY_FOR_DECISION:
            background.add_task(agents.summary_background, app_id)


@router.post("/requests/{request_id}/respond")
def respond(request_id: int, body: SupplierResponseIn, background: BackgroundTasks, supplier: Supplier = Depends(current_supplier), session: Session = Depends(get_session)):
    req = _own_request(request_id, supplier, session)
    if req.status != RequestStatus.PENDING:
        raise HTTPException(409, f"request is {req.status}")
    inv = _apply_response(session, supplier, req, body)
    session.commit()
    _brief_ready_applications(session, background, {inv.application_id})  # decision brief for the officer
    return _request_view(session, req)


@router.post("/requests/bulk-respond")
def bulk_respond(body: BulkResponseIn, background: BackgroundTasks, supplier: Supplier = Depends(current_supplier), session: Session = Depends(get_session)):
    """Respond to many requests at once (bulk confirm, CSV upload). All-or-nothing: any bad row saves nothing."""
    errors, todo, seen = [], [], set()
    for item in body.items:
        req = session.get(ConfirmationRequest, item.request_id)
        if item.request_id in seen:
            errors.append({"request_id": item.request_id, "error": "listed more than once"})
        elif not req or req.supplier_trn != supplier.trn:
            errors.append({"request_id": item.request_id, "error": "request not found"})
        elif req.status != RequestStatus.PENDING:
            errors.append({"request_id": item.request_id, "error": f"request is {req.status}"})
        else:
            todo.append((req, item))
        seen.add(item.request_id)
    if errors:
        raise HTTPException(409, {"message": "no responses were saved", "errors": errors})
    app_ids = {_apply_response(session, supplier, req, item).application_id for req, item in todo}
    session.commit()
    _brief_ready_applications(session, background, app_ids)
    return [_request_view(session, req) for req, _ in todo]
