from __future__ import annotations

import asyncio
import json
import logging
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

if sys.platform.startswith("win") and hasattr(asyncio, "WindowsSelectorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

project_root = Path(__file__).resolve().parent.parent
web_root = project_root / "WEB-itinvent"
if web_root.exists() and str(web_root) not in sys.path:
    sys.path.insert(0, str(web_root))
probe_root = project_root / "telegram_uia_probe"
if probe_root.exists() and str(probe_root) not in sys.path:
    sys.path.insert(0, str(probe_root))

from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.responses import HTMLResponse, Response

from backend import inventory_runtime

from .config import config
from .database import InventoryQueueStore
from .egress_store import EgressEventStore
from .worker import InventoryWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("inventory-server")

store = InventoryQueueStore(db_path=config.db_path)


def _get_egress_store():
    """Prefer PostgreSQL via WEB appdb; SQLite only as last-resort fallback."""
    try:
        from backend.services.fs_egress_store_service import get_egress_store

        return get_egress_store()
    except Exception:
        pass
    import os as _os

    override = str(_os.getenv("FS_EGRESS_DB_PATH", "") or "").strip()
    if override:
        path = Path(override)
    else:
        path = Path(
            _os.getenv("FS_EGRESS_DATA_DIR", str(project_root / "data" / "fs_egress"))
        ) / "fs_egress.db"
    return EgressEventStore(db_path=path)


stop_event = threading.Event()
worker = InventoryWorker(store=store, config=config, stop_event=stop_event)
worker_lock = threading.RLock()


def _create_worker() -> InventoryWorker:
    return InventoryWorker(store=store, config=config, stop_event=stop_event)


def _extract_telegram_egress(
    chats: List[Dict[str, Any]],
    *,
    windows_user: str,
    computer_name: str,
) -> List[Dict[str, Any]]:
    try:
        from telegram_probe.sync import extract_outgoing_file_left
    except Exception:
        return []
    events: List[Dict[str, Any]] = []
    for chat in chats:
        events.extend(
            extract_outgoing_file_left(
                chat.get("messages") or [],
                chat_name=str(chat.get("chat_name") or ""),
                windows_user=windows_user,
                computer_name=computer_name,
            )
        )
    return events


def ensure_worker_alive() -> InventoryWorker:
    global worker
    with worker_lock:
        if worker.is_alive():
            return worker
        stop_event.clear()
        current_worker = worker
        if isinstance(current_worker, threading.Thread) and current_worker.ident is not None:
            current_worker = _create_worker()
            worker = current_worker
        try:
            current_worker.start()
        except RuntimeError:
            current_worker = _create_worker()
            worker = current_worker
            current_worker.start()
        return current_worker


def _key_fingerprint(value: Optional[str]) -> str:
    return inventory_runtime._api_key_fingerprint(value)


def _check_agent_key(x_api_key: Optional[str]) -> None:
    token = str(x_api_key or "").strip()
    if not token or token not in set(config.api_keys):
        logger.warning("Inventory ingest rejected unknown key fingerprint=%s", _key_fingerprint(token))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_worker_alive()
    try:
        yield
    finally:
        stop_event.set()
        with worker_lock:
            current_worker = worker
        if current_worker.is_alive():
            current_worker.join(timeout=5)


app = FastAPI(title="Inventory Ingest Server", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok" if worker.is_alive() else "degraded",
        "worker_alive": worker.is_alive(),
    }


@app.get("/health/ready")
def health_ready() -> dict:
    stats = store.queue_stats()
    return {
        "status": "ok" if worker.is_alive() else "degraded",
        "queue_depth": stats["queue_depth"],
        "oldest_queued_age_sec": stats["oldest_queued_age_sec"],
        "dead_letter_count": stats["dead_letter_count"],
        "worker_alive": worker.is_alive(),
        "last_successful_flush_at": worker.last_successful_flush_at,
    }


@app.post("/api/v1/inventory")
def receive_inventory(
    payload: inventory_runtime.InventoryPayload,
    x_api_key: Optional[str] = Header(None),
) -> dict:
    _check_agent_key(x_api_key)
    ensure_worker_alive()
    payload_dict = inventory_runtime._model_dump(payload)
    dedupe_key = inventory_runtime.build_inventory_dedupe_key(payload_dict)
    queued = store.enqueue(payload_dict, dedupe_key)
    duplicate = bool(queued.get("duplicate"))
    return {
        "success": True,
        "queued": True,
        "duplicate": duplicate,
        "message": "Inventory accepted" if not duplicate else "Inventory already queued",
        "retry_after_sec": 0,
        "queue_id": queued.get("id"),
    }


@app.post("/api/v1/inventory/fs-egress")
async def receive_fs_egress(request: Request, x_api_key: Optional[str] = Header(None)) -> dict:
    _check_agent_key(x_api_key)
    body = await request.json()
    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="events list required")
    inserted = _get_egress_store().ingest_file_left(events)
    return {"success": True, "inserted": inserted}


@app.get("/api/v1/inventory/fs-egress")
def list_fs_egress(
    computer_name: str = "",
    channel: str = "",
    limit: int = 100,
    offset: int = 0,
    x_api_key: Optional[str] = Header(None),
) -> dict:
    _check_agent_key(x_api_key)
    items = _get_egress_store().list_file_left(
        computer_name=computer_name,
        channel=channel,
        limit=limit,
        offset=offset,
    )
    return {"success": True, "items": items, "total": len(items)}


@app.post("/api/v1/inventory/telegram-probe")
async def receive_telegram_probe(request: Request, x_api_key: Optional[str] = Header(None)) -> dict:
    _check_agent_key(x_api_key)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    try:
        from backend.services import fs_egress_store_service as web_store

        result = web_store.ingest_telegram_payload(payload)
        return {"success": True, **result}
    except Exception as exc:
        logger.warning("WEB telegram ingest failed, using local store: %s", exc)
    egress_store = _get_egress_store()
    computer_name = str(payload.get("computer_name") or "").strip() or "unknown"
    windows_user = str(payload.get("windows_user") or "").strip()
    chats = payload.get("chats") if isinstance(payload.get("chats"), list) else []
    chat_count = egress_store.upsert_telegram_chats(
        computer_name=computer_name,
        windows_user=windows_user,
        chats=chats,
    )
    egress_events = _extract_telegram_egress(
        chats, windows_user=windows_user, computer_name=computer_name
    )
    if egress_events:
        egress_store.ingest_file_left(egress_events)
    report_html = payload.get("report_html")
    if isinstance(report_html, str) and report_html.strip():
        egress_store.save_report(
            computer_name=computer_name,
            windows_user=windows_user,
            html=report_html,
        )
    media_items = payload.get("media") if isinstance(payload.get("media"), list) else []
    media_count = 0
    for item in media_items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or f"media_{media_count}")
        b64 = item.get("content_base64")
        if not b64:
            continue
        import base64

        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        egress_store.save_media(
            computer_name=computer_name,
            file_name=name,
            content=raw,
            content_type=str(item.get("content_type") or "application/octet-stream"),
        )
        media_count += 1
    return {
        "success": True,
        "chats": chat_count,
        "media": media_count,
        "egress": len(egress_events),
    }


@app.get("/api/v1/inventory/telegram-probe")
def list_telegram_probe(
    computer_name: str = "",
    limit: int = 100,
    x_api_key: Optional[str] = Header(None),
) -> dict:
    _check_agent_key(x_api_key)
    return {
        "success": True,
        "chats": _get_egress_store().list_telegram_chats(computer_name=computer_name, limit=limit),
    }


@app.get("/api/v1/inventory/telegram-probe/report")
def telegram_probe_report(computer_name: str, x_api_key: Optional[str] = Header(None)):
    _check_agent_key(x_api_key)
    row = _get_egress_store().get_report(computer_name)
    if not row:
        raise HTTPException(status_code=404, detail="report not found")
    return HTMLResponse(content=row.get("html") or "")


@app.post("/api/v1/inventory/browser-probe")
async def receive_browser_probe(request: Request, x_api_key: Optional[str] = Header(None)) -> dict:
    _check_agent_key(x_api_key)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    try:
        from backend.services import fs_egress_store_service as web_store

        result = web_store.ingest_browser_payload(payload)
        return {"success": True, **result}
    except Exception as exc:
        logger.warning("WEB browser ingest failed, using local store: %s", exc)
    egress_store = _get_egress_store()
    computer_name = str(payload.get("computer_name") or "").strip() or "unknown"
    windows_user = str(payload.get("windows_user") or "").strip()
    visits = payload.get("visits") if isinstance(payload.get("visits"), list) else []
    focus_events = (
        payload.get("focus_events") if isinstance(payload.get("focus_events"), list) else []
    )
    visit_count = egress_store.ingest_browser_visits(
        computer_name=computer_name,
        windows_user=windows_user,
        visits=visits,
        focus_events=focus_events,
    )
    media_items = payload.get("media") if isinstance(payload.get("media"), list) else []
    media_count = 0
    for item in media_items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or f"browser_{media_count}")
        b64 = item.get("content_base64")
        if not b64:
            continue
        import base64

        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        egress_store.save_browser_media(
            computer_name=computer_name,
            file_name=name,
            content=raw,
            content_type=str(item.get("content_type") or "image/png"),
        )
        media_count += 1
    return {
        "success": True,
        "visits": visit_count,
        "media": media_count,
        "computer_name": computer_name,
    }


@app.get("/api/v1/inventory/browser-probe")
def list_browser_probe(
    computer_name: str = "",
    category: str = "",
    limit: int = 100,
    offset: int = 0,
    x_api_key: Optional[str] = Header(None),
) -> dict:
    _check_agent_key(x_api_key)
    items = _get_egress_store().list_browser_visits(
        computer_name=computer_name,
        category=category,
        limit=limit,
        offset=offset,
    )
    return {"success": True, "items": items, "total": len(items)}


@app.post("/api/v1/inventory/max-probe")
async def receive_max_probe(request: Request, x_api_key: Optional[str] = Header(None)) -> dict:
    _check_agent_key(x_api_key)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    try:
        from backend.services import fs_egress_store_service as web_store

        result = web_store.ingest_max_payload(payload)
        return {"success": True, **result}
    except Exception as exc:
        logger.warning("WEB max ingest failed, using local store: %s", exc)
    egress_store = _get_egress_store()
    computer_name = str(payload.get("computer_name") or "").strip() or "unknown"
    windows_user = str(payload.get("windows_user") or "").strip()
    chats = payload.get("chats") if isinstance(payload.get("chats"), list) else []
    chat_count = egress_store.upsert_max_chats(
        computer_name=computer_name,
        windows_user=windows_user,
        chats=chats,
    )
    media_items = payload.get("media") if isinstance(payload.get("media"), list) else []
    media_count = 0
    for item in media_items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or f"max_{media_count}")
        b64 = item.get("content_base64")
        if not b64:
            continue
        import base64

        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        egress_store.save_max_media(
            computer_name=computer_name,
            file_name=name.replace("\\", "/").split("/")[-1],
            content=raw,
            content_type=str(item.get("content_type") or "image/png"),
        )
        media_count += 1
    return {
        "success": True,
        "chats": chat_count,
        "media": media_count,
        "computer_name": computer_name,
    }


@app.get("/api/v1/inventory/max-probe")
def list_max_probe(
    computer_name: str = "",
    limit: int = 100,
    x_api_key: Optional[str] = Header(None),
) -> dict:
    _check_agent_key(x_api_key)
    return {
        "success": True,
        "chats": _get_egress_store().list_max_chats(computer_name=computer_name, limit=limit),
    }


@app.get("/api/v1/inventory/max-probe/media/{computer_name}/{file_name}")
def max_probe_media(computer_name: str, file_name: str, x_api_key: Optional[str] = Header(None)):
    _check_agent_key(x_api_key)
    safe_name = str(file_name or "").replace("\\", "/").split("/")[-1].strip()
    if not computer_name.strip() or not safe_name or ".." in safe_name:
        raise HTTPException(status_code=400, detail="invalid media path")
    row = _get_egress_store().get_max_media(computer_name=computer_name.strip(), file_name=safe_name)
    if not row or not row.get("content"):
        raise HTTPException(status_code=404, detail="media not found")
    return Response(
        content=row["content"],
        media_type=str(row.get("content_type") or "application/octet-stream"),
        headers={"Cache-Control": "private, max-age=3600"},
    )
