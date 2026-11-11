"""Internal-only OpenAI-compatible LLM gateway for sandbox containers.

Bind this ASGI app only to the rootless Podman internal network. It has no
OpenAPI/docs/CORS surface and is intentionally absent from main/chat routers.
"""
from __future__ import annotations

from fastapi import FastAPI

from backend.ai_sandbox.gateway import router as gateway_router


app = FastAPI(
    title="HUB AI Sandbox LLM Gateway",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.include_router(gateway_router)


@app.get("/health", include_in_schema=False)
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-sandbox-gateway"}
