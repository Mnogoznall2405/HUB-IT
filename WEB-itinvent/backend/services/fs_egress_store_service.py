"""File egress / telegram probe persistence: PostgreSQL primary, SQLite fallback for tests."""
from __future__ import annotations

import base64
import logging
import os
import re
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


class _EgressStoreProto(Protocol):
    def ingest_file_left(self, events: List[Dict[str, Any]]) -> int: ...
    def list_file_left(
        self,
        *,
        computer_name: str = "",
        channel: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]: ...
    def upsert_telegram_chats(
        self,
        *,
        computer_name: str,
        windows_user: str,
        chats: List[Dict[str, Any]],
    ) -> int: ...
    def save_report(self, *, computer_name: str, windows_user: str, html: str) -> None: ...
    def save_media(
        self,
        *,
        computer_name: str,
        file_name: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> None: ...
    def list_telegram_chats(self, *, computer_name: str = "", limit: int = 100) -> List[Dict[str, Any]]: ...
    def get_report(self, computer_name: str) -> Optional[Dict[str, Any]]: ...


def _sqlite_db_path() -> Path:
    override = str(os.getenv("FS_EGRESS_DB_PATH", "") or "").strip()
    if override:
        return Path(override)
    data_dir = Path(os.getenv("FS_EGRESS_DATA_DIR", str(PROJECT_ROOT / "data" / "fs_egress")))
    return data_dir / "fs_egress.db"


@lru_cache(maxsize=1)
def get_egress_store() -> _EgressStoreProto:
    """Prefer APP_DATABASE_URL (PostgreSQL). SQLite only if app DB is unavailable."""
    try:
        from backend.appdb.db import is_app_database_configured
        from backend.appdb.file_egress_store import AppFileEgressStore

        if is_app_database_configured():
            logger.info("file egress store: PostgreSQL (APP_DATABASE_URL)")
            return AppFileEgressStore()
    except Exception as exc:
        logger.warning("file egress PostgreSQL store unavailable: %s", exc)

    from inventory_server.egress_store import EgressEventStore

    path = _sqlite_db_path()
    logger.warning("file egress store: SQLite fallback at %s", path)
    return EgressEventStore(db_path=path)


def ingest_events(events: List[Dict[str, Any]]) -> int:
    return get_egress_store().ingest_file_left(events)


def list_events(
    *,
    computer_name: str = "",
    channel: str = "",
    limit: int = 100,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    return get_egress_store().list_file_left(
        computer_name=computer_name,
        channel=channel,
        limit=limit,
        offset=offset,
    )


def ingest_telegram_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    store = get_egress_store()
    computer_name = str(payload.get("computer_name") or "").strip() or "unknown"
    windows_user = str(payload.get("windows_user") or "").strip()
    chats = payload.get("chats") if isinstance(payload.get("chats"), list) else []
    chat_count = store.upsert_telegram_chats(
        computer_name=computer_name,
        windows_user=windows_user,
        chats=chats,
    )
    probe_root = PROJECT_ROOT / "telegram_uia_probe"
    if str(probe_root) not in sys.path:
        sys.path.insert(0, str(probe_root))
    egress_events: List[Dict[str, Any]] = []
    try:
        from telegram_probe.sync import extract_outgoing_file_left

        for chat in chats:
            egress_events.extend(
                extract_outgoing_file_left(
                    chat.get("messages") or [],
                    chat_name=str(chat.get("chat_name") or ""),
                    windows_user=windows_user,
                    computer_name=computer_name,
                )
            )
    except Exception:
        egress_events = []
    if egress_events:
        store.ingest_file_left(egress_events)
    report_html = payload.get("report_html")
    if isinstance(report_html, str) and report_html.strip():
        store.save_report(computer_name=computer_name, windows_user=windows_user, html=report_html)
    media_count = 0
    for item in payload.get("media") or []:
        if not isinstance(item, dict):
            continue
        b64 = item.get("content_base64")
        if not b64:
            continue
        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        store.save_media(
            computer_name=computer_name,
            file_name=str(item.get("name") or f"media_{media_count}"),
            content=raw,
            content_type=str(item.get("content_type") or "application/octet-stream"),
        )
        media_count += 1
    return {
        "chats": chat_count,
        "media": media_count,
        "egress": len(egress_events),
        "computer_name": computer_name,
        "backend": "postgresql" if _using_postgres() else "sqlite",
    }


def _using_postgres() -> bool:
    try:
        from backend.appdb.db import is_app_database_configured
        from backend.appdb.file_egress_store import AppFileEgressStore

        return is_app_database_configured() and isinstance(get_egress_store(), AppFileEgressStore)
    except Exception:
        return False


def list_telegram_chats(*, computer_name: str = "", limit: int = 100) -> List[Dict[str, Any]]:
    return get_egress_store().list_telegram_chats(computer_name=computer_name, limit=limit)


def get_telegram_report(computer_name: str) -> Optional[Dict[str, Any]]:
    return get_egress_store().get_report(computer_name)


def get_telegram_media(*, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
    store = get_egress_store()
    getter = getattr(store, "get_media", None)
    if not callable(getter):
        return None
    return getter(computer_name=computer_name, file_name=file_name)


def _reclassify_browser_items(
    visits: List[Dict[str, Any]],
    focus_events: List[Dict[str, Any]],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Enrich category/domain; drop NTP / empty-tab noise."""
    try:
        from browser_probe.classify import classify_title, classify_visit, is_noise_visit
    except Exception:
        return visits, focus_events

    out_visits: List[Dict[str, Any]] = []
    for visit in visits:
        if not isinstance(visit, dict):
            continue
        row = dict(visit)
        url = str(row.get("url") or "")
        title = str(row.get("title") or "")
        if is_noise_visit(url, title):
            continue
        domain, category = classify_visit(url, title)
        if domain:
            row["domain"] = domain
        # Prefer non-other classification (server-side heuristics win over stale agent other).
        prev = str(row.get("category") or "other")
        if category != "other" or prev == "other":
            row["category"] = category
        out_visits.append(row)

    out_focus: List[Dict[str, Any]] = []
    for event in focus_events:
        if not isinstance(event, dict):
            continue
        row = dict(event)
        title = str(row.get("title") or "")
        if is_noise_visit(str(row.get("url") or ""), title):
            continue
        cat = classify_title(title)
        prev = str(row.get("category") or "other")
        if cat != "other" or prev == "other":
            row["category"] = cat
        out_focus.append(row)
    return out_visits, out_focus


def ingest_browser_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    store = get_egress_store()
    computer_name = str(payload.get("computer_name") or "").strip() or "unknown"
    windows_user = str(payload.get("windows_user") or "").strip()
    visits = payload.get("visits") if isinstance(payload.get("visits"), list) else []
    focus_events = (
        payload.get("focus_events") if isinstance(payload.get("focus_events"), list) else []
    )
    visits, focus_events = _reclassify_browser_items(visits, focus_events)
    ingest_fn = getattr(store, "ingest_browser_visits", None)
    visit_count = 0
    if callable(ingest_fn):
        visit_count = int(
            ingest_fn(
                computer_name=computer_name,
                windows_user=windows_user,
                visits=visits,
                focus_events=focus_events,
            )
            or 0
        )
    media_count = 0
    save_media = getattr(store, "save_browser_media", None) or getattr(store, "save_media", None)
    for item in payload.get("media") or []:
        if not isinstance(item, dict) or not callable(save_media):
            continue
        b64 = item.get("content_base64")
        if not b64:
            continue
        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        save_media(
            computer_name=computer_name,
            file_name=str(item.get("name") or f"browser_{media_count}"),
            content=raw,
            content_type=str(item.get("content_type") or "image/png"),
        )
        media_count += 1
    return {
        "visits": visit_count,
        "media": media_count,
        "computer_name": computer_name,
        "backend": "postgresql" if _using_postgres() else "sqlite",
    }


def list_browser_visits(
    *,
    computer_name: str = "",
    category: str = "",
    limit: int = 100,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    store = get_egress_store()
    lister = getattr(store, "list_browser_visits", None)
    if not callable(lister):
        return []
    return lister(
        computer_name=computer_name,
        category=category,
        limit=limit,
        offset=offset,
    )


def get_browser_media(*, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
    store = get_egress_store()
    getter = getattr(store, "get_browser_media", None)
    if not callable(getter):
        # Fallback: reuse telegram media table only if names collide — prefer dedicated.
        getter = getattr(store, "get_media", None)
    if not callable(getter):
        return None
    return getter(computer_name=computer_name, file_name=file_name)


def ingest_max_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    store = get_egress_store()
    computer_name = str(payload.get("computer_name") or "").strip() or "unknown"
    windows_user = str(payload.get("windows_user") or "").strip()
    chats = payload.get("chats") if isinstance(payload.get("chats"), list) else []
    upsert = getattr(store, "upsert_max_chats", None)
    chat_count = 0
    if callable(upsert):
        chat_count = int(
            upsert(computer_name=computer_name, windows_user=windows_user, chats=chats) or 0
        )
    # Outgoing MAX files → file_left
    egress_events: List[Dict[str, Any]] = []
    for chat in chats:
        if not isinstance(chat, dict):
            continue
        chat_name = str(chat.get("chat_name") or "")
        for msg in chat.get("messages") or []:
            if not isinstance(msg, dict):
                continue
            direction = str(msg.get("direction") or "").lower()
            if direction not in {"out", "outgoing", "sent"} and not msg.get("outgoing"):
                continue
            media = str(msg.get("media") or "").strip()
            text = str(msg.get("text") or "").strip()
            blob = media or text
            if not blob:
                continue
            if not re.match(
                r"^(Файл|File|Документ|Document|Фото|Photo|Видео|Video|GIF|Sticker|Стикер)\b",
                blob,
                re.IGNORECASE,
            ):
                continue
            import time
            import uuid

            egress_events.append(
                {
                    "event_id": uuid.uuid4().hex,
                    "ts": int(time.time()),
                    "channel": "max",
                    "file_name": blob[:180],
                    "dest_path": f"max:{chat_name}",
                    "src_path": "",
                    "size": None,
                    "sha256": "",
                    "windows_user": windows_user,
                    "computer_name": computer_name,
                    "details": {
                        "chat_name": chat_name,
                        "message_key": msg.get("msg_key"),
                        "text": text[:300],
                        "media": media[:300],
                        "source": "max_web_ext",
                    },
                }
            )
    if egress_events:
        store.ingest_file_left(egress_events)
    media_count = 0
    save_media = getattr(store, "save_max_media", None)
    for item in payload.get("media") or []:
        if not isinstance(item, dict) or not callable(save_media):
            continue
        b64 = item.get("content_base64")
        if not b64:
            continue
        try:
            raw = base64.b64decode(b64)
        except Exception:
            continue
        name = str(item.get("name") or f"max_{media_count}.png")
        if "/" in name.replace("\\", "/"):
            name = name.replace("\\", "/").split("/")[-1]
        save_media(
            computer_name=computer_name,
            file_name=name,
            content=raw,
            content_type=str(item.get("content_type") or "image/png"),
        )
        media_count += 1
    return {
        "chats": chat_count,
        "media": media_count,
        "egress": len(egress_events),
        "computer_name": computer_name,
        "backend": "postgresql" if _using_postgres() else "sqlite",
    }


def list_max_chats(*, computer_name: str = "", limit: int = 100) -> List[Dict[str, Any]]:
    store = get_egress_store()
    lister = getattr(store, "list_max_chats", None)
    if not callable(lister):
        return []
    return lister(computer_name=computer_name, limit=limit)


def get_max_media(*, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
    store = get_egress_store()
    getter = getattr(store, "get_max_media", None)
    if not callable(getter):
        return None
    return getter(computer_name=computer_name, file_name=file_name)
