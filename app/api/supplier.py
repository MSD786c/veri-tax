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
from app.schemas import SupplierResponseIn

router = APIRouter(prefix="/supplier", tags=["supplier portal (EmaraTax)"])


def current_supplier(x_supplier_trn: str = Header(), session: Session = Depends(get_session)) -> Supplier:
    supplier = session.get(Supplier, x_supplier_trn)
    if not supplier:
        raise HTTPException(401, "unknown supplier TRN")
    return supplier


def _request_view(session: Session, req: ConfirmationRequest) -> dict:
    inv = session.get(Invoice, req.invoice_id)
    app = session.get(Application, inv.application_id)
    resp = session.exec(select(SupplierResponse).where(SupplierResponse.request_id == req.id)).first()
    return {
        "request": req,
        "invoice": inv,
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


@router.post("/requests/{request_id}/respond")
def respond(request_id: int, body: SupplierResponseIn, background: BackgroundTasks, supplier: Supplier = Depends(current_supplier), session: Session = Depends(get_session)):
    req = _own_request(request_id, supplier, session)
    if req.status != RequestStatus.PENDING:
        raise HTTPException(409, f"request is {req.status}")
    resp = SupplierResponse(request_id=req.id, **body.model_dump(exclude={"declaration"}))
    session.add(resp)
    session.flush()
    audit(session, f"supplier:{supplier.trn}", "respond", f"request:{req.id}", declared_by=body.declared_by)
    inv = pipeline.reconcile(session, req, resp)
    session.commit()
    app = session.get(Application, inv.application_id)
    if app.status == ApplicationStatus.READY_FOR_DECISION:
        background.add_task(agents.summary_background, app.id)  # decision brief for the officer
    return _request_view(session, req)
