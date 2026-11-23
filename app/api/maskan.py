"""Maskan connector (ingestion). ponytail: push endpoint only; polling/webhook auth TBD (README open question)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app import pipeline
from app.db import get_session
from app.models import Application
from app.schemas import IngestApplication

router = APIRouter(prefix="/maskan", tags=["maskan (ingestion)"])


@router.post("/applications", response_model=Application, status_code=201)
def ingest_application(payload: IngestApplication, session: Session = Depends(get_session)):
    if session.exec(select(Application).where(Application.maskan_ref == payload.maskan_ref)).first():
        raise HTTPException(409, f"application {payload.maskan_ref} already ingested")
    return pipeline.ingest(session, payload)
