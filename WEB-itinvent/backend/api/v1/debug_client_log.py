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
_ALLOWED_SESSION = str(os.getenv("DEBUG_CLIENT_LOG_SESSION", "20cb37")).strip() or "20cb37"
# WEB-itinvent/backend/api/v1 -> repo root Image_scan/
_LOG_FILE = Path(__file__).resolve().parents[4] / f"debug-{_ALLOWED_SESSION}.log"
_LAST_WRITE_MONO = 0.0
_MIN_WRITE_INTERVAL_SEC = float(os.getenv("DEBUG_CLIENT_LOG_MIN_INTERVAL_SEC", "0.05") or "0.05")
_DROP_COUNT = 0


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
    global _LAST_WRITE_MONO, _DROP_COUNT
    if not _ENABLED:
        # Fast no-op: never compete with mail/chat under load when disabled.
        return {"ok": True, "dropped": 1, "reason": "disabled"}

    session_id = str(x_debug_session_id or payload.sessionId or "").strip()
    if session_id != _ALLOWED_SESSION:
        raise HTTPException(status_code=403, detail="Invalid debug session")

    now_mono = time.monotonic()
    if (now_mono - _LAST_WRITE_MONO) < max(0.0, _MIN_WRITE_INTERVAL_SEC):
        _DROP_COUNT += 1
        return {"ok": True, "dropped": 1, "drop_count": _DROP_COUNT}

    entry = payload.model_dump(mode="json")
    if not entry.get("timestamp"):
        entry["timestamp"] = int(time.time() * 1000)

    _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with _LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    _LAST_WRITE_MONO = now_mono

    return {"ok": True}
