"""Public, read-only reference data for the portals."""
from fastapi import APIRouter

from app.rules import RULE_CATALOG, RULESET_VERSION

router = APIRouter(prefix="/meta", tags=["meta"])


@router.get("/rules")
def rule_catalog():
    return {"ruleset_version": RULESET_VERSION, "rules": RULE_CATALOG}
