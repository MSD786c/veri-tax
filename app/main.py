import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from app.api import fta, maskan, meta, supplier
from app.db import init_db
from app.rules import RULESET_VERSION

# Built portal (web/ -> `npm run build`). Served at /portal so its routes never clash with /fta, /supplier.
PORTAL_DIST = Path(os.getenv("PORTAL_DIST", Path(__file__).resolve().parent.parent / "web" / "dist")).resolve()


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
app.include_router(meta.router)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "ruleset_version": RULESET_VERSION}


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/portal/" if (PORTAL_DIST / "index.html").is_file() else "/docs")


@app.get("/portal", include_in_schema=False)
@app.get("/portal/{path:path}", include_in_schema=False)
def portal(path: str = ""):
    """Static files from the built portal; any other path gets index.html (client-side routing)."""
    index = PORTAL_DIST / "index.html"
    if not index.is_file():
        raise HTTPException(404, "portal not built: run `npm ci && npm run build` in web/")
    target = (PORTAL_DIST / path).resolve()
    if path and target.is_relative_to(PORTAL_DIST) and target.is_file():
        return FileResponse(target)
    return FileResponse(index)
