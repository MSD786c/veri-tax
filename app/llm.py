"""LLM access via Groq's OpenAI-compatible API. Any OpenAI-compatible server works (set LLM_BASE_URL).

Groq on-demand tier limits (measured 2026-11-23 for qwen/qwen3.8-27b): 1000 OUTPUT tokens/min, 8000 tokens/min.
Without max_completion_tokens Groq reserves ~1300 output tokens per request and rejects it (429 "Request too
large ... OTPM"), so every call sets MAX_TOKENS, calls are serialised, and 429s wait out the window.
ponytail: one global lock = ~2 extractions/min. A higher Groq tier or a token-bucket per model if that is too slow.
"""
import base64
import json
import logging
import os
import re
import threading
import time

import httpx

BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
GEMINI = "generativelanguage.googleapis.com" in BASE_URL  # Gemini's OpenAI-compatible endpoint
API_KEY = os.getenv("GEMINI_API_KEY" if GEMINI else "GROQ_API_KEY", "")
MODEL = os.getenv("LLM_MODEL", "qwen/qwen3.8-27b")
VISION_MODEL = os.getenv("VISION_MODEL", MODEL)
TIMEOUT = float(os.getenv("LLM_TIMEOUT", "120"))
MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "700"))  # must stay under the tier's output-tokens-per-minute
MAX_ATTEMPTS = 4
_lock = threading.Lock()
log = logging.getLogger("veritax.llm")


class LLMError(RuntimeError):
    pass


def enabled() -> bool:
    return bool(API_KEY) or "://localhost" in BASE_URL or "://127.0.0.1" in BASE_URL  # local servers (Ollama) need no key


def status() -> dict:
    return {"configured": enabled(), "base_url": BASE_URL, "model": MODEL, "vision_model": VISION_MODEL}


def available_models() -> list[str]:
    r = httpx.get(f"{BASE_URL}/models", headers={"Authorization": f"Bearer {API_KEY}"}, timeout=20)
    r.raise_for_status()
    return sorted(m["id"] for m in r.json()["data"])


def parse_json(text: str) -> dict:
    """Models wrap JSON in <think> blocks or ``` fences; take the outermost {...}."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise LLMError(f"no JSON object in model output: {text[:200]!r}")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise LLMError(f"invalid JSON from model: {e}") from e


def chat_json(system: str, user: str | list, model: str | None = None) -> dict:
    """One chat completion that must return a JSON object. `user` may be OpenAI content parts (text + images)."""
    if not enabled():
        raise LLMError("LLM not configured: set GROQ_API_KEY in .env")
    body = {
        "model": model or MODEL,
        "temperature": 0,
        "max_completion_tokens": MAX_TOKENS,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    if GEMINI:  # JSON mode: without it Gemini sometimes emits invalid \u escapes in Arabic text
        body["response_format"] = {"type": "json_object"}
    # Every failure leaves as LLMError so callers have one thing to catch.
    with _lock:
        return _post(body)


def _post(body: dict) -> dict:
    last = ""
    for attempt in range(MAX_ATTEMPTS):
        try:
            r = httpx.post(f"{BASE_URL}/chat/completions", json=body, timeout=TIMEOUT,
                           headers={"Authorization": f"Bearer {API_KEY}"})
        except httpx.HTTPError as e:
            last = f"LLM transport error: {e}"
            continue
        if r.status_code in (429, 500, 502, 503) and attempt < MAX_ATTEMPTS - 1:
            last = f"LLM HTTP {r.status_code}: {r.text[:300]}"
            wait = _retry_after(r)
            log.warning("LLM %s, retry %d/%d in %.0fs: %s", r.status_code, attempt + 1, MAX_ATTEMPTS - 1, wait, r.text[:160])
            time.sleep(wait)
            continue
        if r.status_code != 200:
            raise LLMError(f"LLM HTTP {r.status_code}: {r.text[:300]}")
        try:
            content = r.json()["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise LLMError(f"unexpected LLM response: {r.text[:300]}") from e
        return parse_json(content)
    raise LLMError(f"LLM retry exhausted: {last}")


def _retry_after(r: httpx.Response) -> float:
    """Groq sends retry-after; per-minute token windows can need up to ~60s."""
    try:
        return min(max(float(r.headers.get("retry-after", 10)), 1), 60)
    except ValueError:
        return 10


def image_part(jpeg: bytes) -> dict:
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}}
