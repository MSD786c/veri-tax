import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import fta, maskan, supplier
from app.db import init_db
from app.rules import RULESET_VERSION


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if os.getenv("SEED", "1") == "1":
        from app.seed import seed
        seed()
    yield


app = FastAPI(title="veri-tax verification body", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(maskan.router)
app.include_router(supplier.router)
app.include_router(fta.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "ruleset_version": RULESET_VERSION}
