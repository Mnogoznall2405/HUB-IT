"""Internal-only ASGI app for sandbox worker content transfer.

Run this service on a dedicated control-network listener. It is intentionally
not included by ``main.py`` or ``chat_main.py`` and must never be proxied by
the public IIS `/api/v1/chat` route.
"""
from __future__ import annotations

from fastapi import FastAPI

from backend.api.v1.chat.ai_sandbox_internal import router as internal_router


app = FastAPI(
    title="HUB AI Sandbox Internal Control",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.include_router(internal_router, prefix="/api/v1/chat")


@app.get("/health", include_in_schema=False)
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-sandbox-control"}
