"""Internal-only ASGI app for sandbox worker content transfer.

Run this service on a dedicated control-network listener. It is intentionally
not included by ``main.py`` or ``chat_main.py`` and must never be proxied by
the public IIS `/api/v1/chat` route.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi import Request
from fastapi.responses import JSONResponse
import os

from backend.api.v1.chat.ai_sandbox_internal import router as internal_router


app = FastAPI(
    title="HUB AI Sandbox Internal Control",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.include_router(internal_router, prefix="/api/v1/chat")


@app.middleware("http")
async def restrict_control_network(request: Request, call_next):
    # Uvicorn runs with proxy_headers=False: this is the transport peer,
    # never an X-Forwarded-For value supplied by a caller.
    allowed = {value.strip() for value in os.getenv("AI_SANDBOX_CONTROL_ALLOWED_IPS", "").split(",") if value.strip()}
    if request.client is None or request.client.host not in allowed:
        return JSONResponse({"detail": "Control network access denied"}, status_code=403)
    return await call_next(request)


@app.get("/health", include_in_schema=False)
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-sandbox-control"}
