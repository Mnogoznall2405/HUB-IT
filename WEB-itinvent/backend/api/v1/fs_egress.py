from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, Response

from backend.api.deps import get_current_admin_user
from backend.services import dlp_report_service, fs_egress_store_service as store

logger = logging.getLogger(__name__)
router = APIRouter()
# Temporary: DLP UI/API read path is admin-only while the page is mothballed.
_DLP_READ = [Depends(get_current_admin_user)]


def _load_agent_api_keys() -> List[str]:
    keys: List[str] = []
    ring = str(os.getenv("ITINV_AGENT_API_KEYS", "") or "").strip()
    if ring:
        for part in ring.split(","):
            key = part.strip()
            if key and key not in keys:
                keys.append(key)
    legacy = str(os.getenv("ITINV_AGENT_API_KEY", "") or "").strip()
    if legacy and legacy not in keys:
        keys.append(legacy)
    return keys


def _is_valid_agent_api_key(candidate: Optional[str]) -> bool:
    token = str(candidate or "").strip()
    if not token:
        return False
    return token in set(_load_agent_api_keys())


@router.post("/fs-egress")
async def ingest_fs_egress(request: Request, x_api_key: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not _is_valid_agent_api_key(x_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")
    body = await request.json()
    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="events list required")
    inserted = store.ingest_events(events)
    return {"success": True, "inserted": inserted}


@router.get("/fs-egress", dependencies=_DLP_READ)
def list_fs_egress(
    computer_name: str = Query(""),
    channel: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> Dict[str, Any]:
    items = store.list_events(
        computer_name=computer_name,
        channel=channel,
        limit=limit,
        offset=offset,
    )
    return {"success": True, "items": items, "total": len(items)}


@router.post("/telegram-probe")
async def ingest_telegram_probe(request: Request, x_api_key: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not _is_valid_agent_api_key(x_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    result = store.ingest_telegram_payload(payload)
    return {"success": True, **result}


@router.get("/telegram-probe", dependencies=_DLP_READ)
def list_telegram_probe(
    computer_name: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
) -> Dict[str, Any]:
    return {
        "success": True,
        "chats": store.list_telegram_chats(computer_name=computer_name, limit=limit),
    }


@router.get("/telegram-probe/report", dependencies=_DLP_READ)
def telegram_probe_report(
    computer_name: str = Query(...),
):
    """Always build the current report on the server (single live snapshot per PC)."""
    try:
        row = dlp_report_service.get_current_report_html(computer_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return HTMLResponse(content=row.get("html") or "")


@router.get(
    "/telegram-probe/media/{computer_name}/{file_name}",
    dependencies=_DLP_READ,
)
def telegram_probe_media(computer_name: str, file_name: str):
    """Serve uploaded Telegram probe media (photo/video/file) for DLP UI."""
    safe_name = str(file_name or "").replace("\\", "/").split("/")[-1].strip()
    if not computer_name.strip() or not safe_name or ".." in safe_name:
        raise HTTPException(status_code=400, detail="invalid media path")
    row = store.get_telegram_media(computer_name=computer_name.strip(), file_name=safe_name)
    if not row or not row.get("content"):
        raise HTTPException(status_code=404, detail="media not found")
    return Response(
        content=row["content"],
        media_type=str(row.get("content_type") or "application/octet-stream"),
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/browser-probe")
async def ingest_browser_probe(request: Request, x_api_key: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not _is_valid_agent_api_key(x_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    result = store.ingest_browser_payload(payload)
    return {"success": True, **result}


@router.get("/browser-probe", dependencies=_DLP_READ)
def list_browser_probe(
    computer_name: str = Query(""),
    category: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> Dict[str, Any]:
    items = store.list_browser_visits(
        computer_name=computer_name,
        category=category,
        limit=limit,
        offset=offset,
    )
    return {"success": True, "items": items, "total": len(items)}


@router.get(
    "/browser-probe/media/{computer_name}/{file_name}",
    dependencies=_DLP_READ,
)
def browser_probe_media(computer_name: str, file_name: str):
    """Serve uploaded browser probe screenshots for DLP UI."""
    safe_name = str(file_name or "").replace("\\", "/").split("/")[-1].strip()
    if not computer_name.strip() or not safe_name or ".." in safe_name:
        raise HTTPException(status_code=400, detail="invalid media path")
    row = store.get_browser_media(computer_name=computer_name.strip(), file_name=safe_name)
    if not row or not row.get("content"):
        raise HTTPException(status_code=404, detail="media not found")
    return Response(
        content=row["content"],
        media_type=str(row.get("content_type") or "image/png"),
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/max-probe")
async def ingest_max_probe(request: Request, x_api_key: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not _is_valid_agent_api_key(x_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API Key")
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    result = store.ingest_max_payload(payload)
    return {"success": True, **result}


@router.get("/max-probe", dependencies=_DLP_READ)
def list_max_probe(
    computer_name: str = Query(""),
    limit: int = Query(100, ge=1, le=500),
) -> Dict[str, Any]:
    return {
        "success": True,
        "chats": store.list_max_chats(computer_name=computer_name, limit=limit),
    }


@router.get(
    "/max-probe/media/{computer_name}/{file_name}",
    dependencies=_DLP_READ,
)
def max_probe_media(computer_name: str, file_name: str):
    safe_name = str(file_name or "").replace("\\", "/").split("/")[-1].strip()
    if not computer_name.strip() or not safe_name or ".." in safe_name:
        raise HTTPException(status_code=400, detail="invalid media path")
    row = store.get_max_media(computer_name=computer_name.strip(), file_name=safe_name)
    if not row or not row.get("content"):
        raise HTTPException(status_code=404, detail="media not found")
    return Response(
        content=row["content"],
        media_type=str(row.get("content_type") or "application/octet-stream"),
        headers={"Cache-Control": "private, max-age=3600"},
    )
