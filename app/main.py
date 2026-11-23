import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from app import agents, db, documents, llm
from app.api import fta, maskan, maskan_portal, supplier
from app.assessment import TEXT
from app.rules import RULESET_VERSION

log = logging.getLogger("uvicorn.error")
@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    if n := documents.reset_interrupted():
        log.warning("%d document extraction(s) were interrupted by a restart; marked FAILED (retry them)", n)
    if os.getenv("SEED", "1") == "1":
        from app.seed import seed
        seed()
    log.info("Maskan portal: http://localhost:%s/maskan/portal/%s", os.getenv("PORT", "8000"), documents.portal_token())
    if not agents.enabled():
        log.warning("No agent: set AGENT_PROVIDER=groq and GROQ_API_KEY to enable extraction and agents")
    # Supplier time limits are enforced inline when the dashboard loads (pipeline.expire_overdue).
    yield


app = FastAPI(title="veri-tax verification body", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(maskan.router)
app.include_router(supplier.router)
app.include_router(fta.router)
app.include_router(maskan_portal.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "ruleset_version": RULESET_VERSION, "agent_enabled": agents.enabled(), "llm": llm.status()}


@app.get("/health/llm", tags=["meta"])
def health_llm():
    """Checks the key works and the configured models exist on the provider."""
    if not llm.enabled():
        return {**llm.status(), "reachable": False, "error": "GROQ_API_KEY not set"}
    try:
        models = llm.available_models()
    except Exception as e:  # noqa: BLE001
        return {**llm.status(), "reachable": False, "error": str(e)[:300]}
    return {**llm.status(), "reachable": True, "model_available": llm.MODEL in models,
            "vision_model_available": llm.VISION_MODEL in models, "available_models": models}


@app.get("/rules", tags=["meta"])
def list_rules():
    return {"ruleset_version": RULESET_VERSION, "rules": {k: v[0] for k, v in TEXT.items()}}
