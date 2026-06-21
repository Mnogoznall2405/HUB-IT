"""
Temporary client debug log relay for mobile/production UX debugging.
Enable with DEBUG_CLIENT_LOG_ENABLED=1 in root .env.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

_ENABLED = str(os.getenv("DEBUG_CLIENT_LOG_ENABLED", "0")).strip().lower() in {"1", "true", "yes", "on"}
_ALLOWED_SESSION = str(os.getenv("DEBUG_CLIENT_LOG_SESSION", "891634")).strip() or "891634"
_LOG_FILE = Path(__file__).resolve().parents[3] / f"debug-{_ALLOWED_SESSION}.log"


class ClientLogEntry(BaseModel):
    sessionId: Optional[str] = None
    location: str = ""
    message: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    timestamp: Optional[int] = None
    hypothesisId: Optional[str] = None
    runId: Optional[str] = None


@router.post("/client-log")
async def ingest_client_log(
    payload: ClientLogEntry,
    x_debug_session_id: Optional[str] = Header(default=None, alias="X-Debug-Session-Id"),
):
    if not _ENABLED:
        raise HTTPException(status_code=404, detail="Not found")

    session_id = str(x_debug_session_id or payload.sessionId or "").strip()
    if session_id != _ALLOWED_SESSION:
        raise HTTPException(status_code=403, detail="Invalid debug session")

    entry = payload.model_dump(mode="json")
    if not entry.get("timestamp"):
        entry["timestamp"] = int(time.time() * 1000)

    _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with _LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return {"ok": True}
