"""
Temporary client debug log relay for mobile/production UX debugging.
Enable with DEBUG_CLIENT_LOG_ENABLED=1 in root .env.
"""
from __future__ import annotations

import hmac
import json
import os
import time
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

router = APIRouter()

# The relay writes to disk, so it needs an explicit session secret: no repository-wide default.
_ALLOWED_SESSION = str(os.getenv("DEBUG_CLIENT_LOG_SESSION", "") or "").strip()
_ENABLED = bool(_ALLOWED_SESSION) and str(os.getenv("DEBUG_CLIENT_LOG_ENABLED", "0")).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
_MAX_ENTRY_BYTES = 16 * 1024
# WEB-itinvent/backend/api/v1 -> repo root Image_scan/
_LOG_FILE = Path(__file__).resolve().parents[4] / f"debug-{_ALLOWED_SESSION or 'disabled'}.log"
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
    if not hmac.compare_digest(session_id.encode("utf-8"), _ALLOWED_SESSION.encode("utf-8")):
        raise HTTPException(status_code=403, detail="Invalid debug session")

    now_mono = time.monotonic()
    if (now_mono - _LAST_WRITE_MONO) < max(0.0, _MIN_WRITE_INTERVAL_SEC):
        _DROP_COUNT += 1
        return {"ok": True, "dropped": 1, "drop_count": _DROP_COUNT}

    entry = payload.model_dump(mode="json")
    if not entry.get("timestamp"):
        entry["timestamp"] = int(time.time() * 1000)

    line = json.dumps(entry, ensure_ascii=False) + "\n"
    if len(line.encode("utf-8")) > _MAX_ENTRY_BYTES:
        raise HTTPException(status_code=413, detail="Debug entry is too large")

    def _append() -> None:
        _LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with _LOG_FILE.open("a", encoding="utf-8") as handle:
            handle.write(line)

    await run_in_threadpool(_append)
    _LAST_WRITE_MONO = now_mono

    return {"ok": True}
