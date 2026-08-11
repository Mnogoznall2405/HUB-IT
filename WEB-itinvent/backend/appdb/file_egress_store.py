"""PostgreSQL (APP_DATABASE_URL) store for file egress + telegram probe payloads."""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from backend.appdb.db import app_session, ensure_app_schema_initialized, is_app_database_configured
from backend.appdb.models import (
    AppBrowserProbeMedia,
    AppBrowserProbeVisit,
    AppFileLeftEvent,
    AppMaxProbeChat,
    AppMaxProbeMedia,
    AppTelegramProbeChat,
    AppTelegramProbeMedia,
    AppTelegramProbeReport,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _unpack_chat_blob(raw: str) -> tuple[List[Any], List[str]]:
    try:
        data = json.loads(raw or "[]")
    except Exception:
        return [], []
    if isinstance(data, list):
        return data, []
    if isinstance(data, dict):
        messages = data.get("messages") if isinstance(data.get("messages"), list) else []
        shots = data.get("screenshots") if isinstance(data.get("screenshots"), list) else []
        return messages, [str(x) for x in shots if str(x).strip()]
    return [], []


def _pack_chat_blob(messages: List[Any], screenshots: List[str]) -> str:
    return json.dumps(
        {
            "messages": messages if isinstance(messages, list) else [],
            "screenshots": [str(x) for x in (screenshots or []) if str(x).strip()][-50:],
        },
        ensure_ascii=False,
    )


def _merge_screenshots(prev: List[str], incoming: List[str]) -> List[str]:
    out: List[str] = []
    for item in list(prev or []) + list(incoming or []):
        text = str(item or "").replace("\\", "/").strip()
        if text and text not in out:
            out.append(text)
    return out[-50:]


def _message_identity(msg: Any) -> str:
    if not isinstance(msg, dict):
        return ""
    key = str(msg.get("msg_key") or "").strip()
    if key:
        return key.lower()
    return "|".join(
        [
            str(msg.get("direction") or "").strip().lower(),
            str(msg.get("time") or "").strip().lower(),
            str(msg.get("sender") or "").strip().lower(),
            str(msg.get("text") or msg.get("media") or "").strip().lower(),
        ]
    )


def _is_human_chat_name(name: Any, chat_id: str = "") -> bool:
    text = str(name or "").strip()
    cid = str(chat_id or "").strip()
    if not text:
        return False
    if cid and text == cid:
        return False
    if text.startswith("[") or text.startswith("{"):
        return False
    if text.startswith("Чат ") and len(text) <= 20:
        return False
    # Raw hex peer ids are not useful titles.
    if len(text) in {8, 10, 16} and all(c in "0123456789abcdefABCDEF" for c in text):
        return False
    return True


def _prefer_chat_name(existing: Any, incoming: Any, chat_id: str) -> str:
    """Keep a readable dialog title; never let raw ids wipe a good name."""
    cid = str(chat_id or "").strip()
    old = str(existing or "").strip()
    new = str(incoming or "").strip()
    if _is_human_chat_name(new, cid):
        return new[:512]
    if _is_human_chat_name(old, cid):
        return old[:512]
    return (new or old or cid)[:512]


def _bbox_sort_key(msg: Dict[str, Any]) -> tuple[int, int] | None:
    bbox = msg.get("bbox")
    if not isinstance(bbox, (list, tuple)) or len(bbox) < 2:
        return None
    try:
        return (int(bbox[1]), int(bbox[0]))
    except Exception:
        return None


def _reorder_same_capture_by_bbox(messages: List[Any]) -> List[Any]:
    """
    Within one UIA capture (same recorded_at) MAX may upload bottom→top DOM order.
    Re-sort those groups by on-screen Y (top→bottom = older→newer).
    """
    if len(messages) < 2:
        return messages
    groups: Dict[str, List[tuple[int, Dict[str, Any]]]] = {}
    stamp_order: List[str] = []
    for idx, msg in enumerate(messages):
        if not isinstance(msg, dict):
            continue
        stamp = str(msg.get("recorded_at") or "").strip() or f"__idx_{idx}"
        if stamp not in groups:
            stamp_order.append(stamp)
            groups[stamp] = []
        groups[stamp].append((idx, msg))
    out: List[Any] = []
    for stamp in stamp_order:
        chunk = groups[stamp]
        if len(chunk) < 2:
            out.append(chunk[0][1])
            continue
        keyed = [(_bbox_sort_key(m), i, m) for i, m in chunk]
        if all(k is not None for k, _, _ in keyed):
            keyed.sort(key=lambda row: (row[0], row[1]))  # type: ignore[arg-type, return-value]
            out.extend(m for _, _, m in keyed)
        else:
            out.extend(m for _, m in chunk)
    return out


def _merge_messages(prev: List[Any], incoming: List[Any]) -> List[Any]:
    """Append incoming messages, keeping order and dropping duplicates by msg_key."""
    out: List[Any] = []
    seen: set[str] = set()
    for msg in list(prev or []) + list(incoming or []):
        if not isinstance(msg, dict):
            continue
        key = _message_identity(msg)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(msg)
    return _reorder_same_capture_by_bbox(out)[-5000:]


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


class AppFileEgressStore:
    def __init__(self, *, database_url: str | None = None) -> None:
        self.database_url = database_url

    def ingest_file_left(self, events: List[Dict[str, Any]]) -> int:
        if not is_app_database_configured() and not self.database_url:
            raise RuntimeError("APP_DATABASE_URL is required for file egress store")
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        inserted = 0
        with app_session(database_url=self.database_url) as session:
            for event in events:
                if not isinstance(event, dict):
                    continue
                event_id = str(event.get("event_id") or event.get("id") or uuid.uuid4().hex)
                existing = session.get(AppFileLeftEvent, event_id)
                if existing is not None:
                    continue
                session.add(
                    AppFileLeftEvent(
                        id=event_id,
                        ts=_to_int(event.get("ts"), int(time.time())),
                        channel=str(event.get("channel") or "unknown")[:32],
                        file_name=str(event.get("file_name") or "")[:512],
                        dest_path=str(event.get("dest_path") or ""),
                        src_path=str(event.get("src_path") or ""),
                        size=event.get("size") if event.get("size") is None else _to_int(event.get("size")),
                        sha256=str(event.get("sha256") or "")[:64],
                        windows_user=str(event.get("windows_user") or "")[:255],
                        computer_name=str(event.get("computer_name") or "")[:255],
                        details_json=json.dumps(event.get("details") or {}, ensure_ascii=False),
                        created_at=now,
                    )
                )
                inserted += 1
        return inserted

    def list_file_left(
        self,
        *,
        computer_name: str = "",
        channel: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        stmt = select(AppFileLeftEvent).order_by(AppFileLeftEvent.ts.desc())
        if computer_name:
            stmt = stmt.where(AppFileLeftEvent.computer_name == computer_name)
        if channel:
            stmt = stmt.where(AppFileLeftEvent.channel == channel)
        stmt = stmt.limit(max(1, min(limit, 500))).offset(max(0, offset))
        with app_session(database_url=self.database_url) as session:
            rows = session.execute(stmt).scalars().all()
        out: List[Dict[str, Any]] = []
        for row in rows:
            try:
                details = json.loads(row.details_json or "{}")
            except Exception:
                details = {}
            out.append(
                {
                    "id": row.id,
                    "ts": row.ts,
                    "channel": row.channel,
                    "file_name": row.file_name,
                    "dest_path": row.dest_path,
                    "src_path": row.src_path,
                    "size": row.size,
                    "sha256": row.sha256,
                    "windows_user": row.windows_user,
                    "computer_name": row.computer_name,
                    "details": details,
                    "created_at": int(row.created_at.timestamp()) if row.created_at else None,
                }
            )
        return out

    def upsert_telegram_chats(
        self,
        *,
        computer_name: str,
        windows_user: str,
        chats: List[Dict[str, Any]],
    ) -> int:
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        count = 0
        with app_session(database_url=self.database_url) as session:
            for chat in chats:
                chat_id = str(chat.get("chat_id") or "").strip()
                if not chat_id:
                    continue
                row_id = f"{computer_name}:{chat_id}"
                existing = session.get(AppTelegramProbeChat, row_id)
                messages = list(chat.get("messages") or [])
                screenshots = [
                    str(x).replace("\\", "/").strip()
                    for x in (chat.get("screenshots") or [])
                    if str(x).strip()
                ]
                if existing is not None:
                    prev_messages, prev_shots = _unpack_chat_blob(existing.messages_json or "[]")
                    if messages:
                        messages = _merge_messages(prev_messages, messages)
                    else:
                        messages = _merge_messages(prev_messages, [])
                    screenshots = _merge_screenshots(prev_shots, screenshots)
                    existing.windows_user = windows_user[:255]
                    existing.chat_name = str(chat.get("chat_name") or chat_id)[:512]
                    existing.messages_json = _pack_chat_blob(messages, screenshots)
                    existing.updated_at = now
                else:
                    session.add(
                        AppTelegramProbeChat(
                            id=row_id,
                            computer_name=computer_name[:255],
                            windows_user=windows_user[:255],
                            chat_id=chat_id[:128],
                            chat_name=str(chat.get("chat_name") or chat_id)[:512],
                            messages_json=_pack_chat_blob(_merge_messages([], messages), screenshots),
                            updated_at=now,
                        )
                    )
                count += 1
        return count

    def save_report(self, *, computer_name: str, windows_user: str, html: str) -> None:
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        with app_session(database_url=self.database_url) as session:
            existing = session.get(AppTelegramProbeReport, computer_name)
            if existing is None:
                session.add(
                    AppTelegramProbeReport(
                        computer_name=computer_name[:255],
                        windows_user=windows_user[:255],
                        html=html or "",
                        updated_at=now,
                    )
                )
            else:
                existing.windows_user = windows_user[:255]
                existing.html = html or ""
                existing.updated_at = now

    def get_media(self, *, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        host = str(computer_name or "").strip()
        name = str(file_name or "").strip().replace("\\", "/").split("/")[-1]
        if not host or not name:
            return None
        row_id = f"{host}:{name}"
        with app_session(database_url=self.database_url) as session:
            row = session.get(AppTelegramProbeMedia, row_id)
            if row is None:
                # tolerate id without exact case / legacy keys
                stmt = select(AppTelegramProbeMedia).where(
                    AppTelegramProbeMedia.computer_name == host,
                    AppTelegramProbeMedia.file_name == name,
                )
                row = session.execute(stmt).scalars().first()
            if row is None:
                return None
            return {
                "computer_name": row.computer_name,
                "file_name": row.file_name,
                "content": bytes(row.content or b""),
                "content_type": row.content_type or "application/octet-stream",
            }

    def save_media(
        self,
        *,
        computer_name: str,
        file_name: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> None:
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        row_id = f"{computer_name}:{file_name}"
        with app_session(database_url=self.database_url) as session:
            existing = session.get(AppTelegramProbeMedia, row_id)
            if existing is None:
                session.add(
                    AppTelegramProbeMedia(
                        id=row_id[:512],
                        computer_name=computer_name[:255],
                        file_name=file_name[:512],
                        content=content,
                        content_type=(content_type or "application/octet-stream")[:128],
                        created_at=now,
                    )
                )
            else:
                existing.content = content
                existing.content_type = (content_type or "application/octet-stream")[:128]
                existing.created_at = now

    def list_telegram_chats(self, *, computer_name: str = "", limit: int = 100) -> List[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        stmt = select(AppTelegramProbeChat).order_by(AppTelegramProbeChat.updated_at.desc())
        if computer_name:
            stmt = stmt.where(AppTelegramProbeChat.computer_name == computer_name)
        stmt = stmt.limit(max(1, min(limit, 500)))
        with app_session(database_url=self.database_url) as session:
            rows = list(session.execute(stmt).scalars().all())
            out: List[Dict[str, Any]] = []
            for row in rows:
                messages, screenshots = _unpack_chat_blob(row.messages_json or "[]")
                cleaned = _merge_messages(messages, [])
                if cleaned != messages:
                    row.messages_json = _pack_chat_blob(cleaned, screenshots)
                messages = cleaned
                out.append(
                    {
                        "computer_name": row.computer_name,
                        "windows_user": row.windows_user,
                        "chat_id": row.chat_id,
                        "chat_name": row.chat_name,
                        "updated_at": int(row.updated_at.timestamp()) if row.updated_at else None,
                        "messages": messages,
                        "screenshots": screenshots,
                    }
                )
            return out

    def get_report(self, computer_name: str) -> Optional[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        with app_session(database_url=self.database_url) as session:
            row = session.get(AppTelegramProbeReport, computer_name)
            if row is None:
                return None
            return {
                "computer_name": row.computer_name,
                "windows_user": row.windows_user,
                "html": row.html,
                "updated_at": int(row.updated_at.timestamp()) if row.updated_at else None,
            }

    @staticmethod
    def _parse_iso_dt(value: Any) -> Optional[datetime]:
        raw = str(value or "").strip()
        if not raw:
            return None
        try:
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return None

    def ingest_browser_visits(
        self,
        *,
        computer_name: str,
        windows_user: str,
        visits: List[Dict[str, Any]],
        focus_events: Optional[List[Dict[str, Any]]] = None,
    ) -> int:
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        host = str(computer_name or "").strip() or "unknown"
        user = str(windows_user or "").strip()
        count = 0
        with app_session(database_url=self.database_url) as session:
            for visit in visits or []:
                if not isinstance(visit, dict):
                    continue
                browser = str(visit.get("browser") or "").strip().lower()[:32]
                profile = str(visit.get("profile") or "Default").strip()[:128] or "Default"
                visit_id = str(visit.get("visit_id") or "").strip()
                if not browser or not visit_id:
                    continue
                row_id = f"{host}:{browser}:{profile}:{visit_id}"[:512]
                existing = session.get(AppBrowserProbeVisit, row_id)
                visited_at = self._parse_iso_dt(visit.get("visited_at"))
                screenshot_file = str(visit.get("screenshot_file") or "").replace("\\", "/").split("/")[-1][:512]
                dwell = visit.get("dwell_sec")
                try:
                    dwell_f = float(dwell) if dwell is not None else None
                except (TypeError, ValueError):
                    dwell_f = None
                category = str(visit.get("category") or "other")[:32] or "other"
                domain = str(visit.get("domain") or "")[:255]
                title = str(visit.get("title") or "")[:512]
                url = str(visit.get("url") or "")[:8000]
                if existing is None:
                    session.add(
                        AppBrowserProbeVisit(
                            id=row_id,
                            computer_name=host[:255],
                            windows_user=user[:255],
                            browser=browser,
                            profile=profile,
                            visit_id=visit_id[:64],
                            url=url,
                            title=title,
                            domain=domain,
                            category=category,
                            visited_at=visited_at,
                            dwell_sec=dwell_f,
                            screenshot_file=screenshot_file,
                            created_at=now,
                        )
                    )
                    count += 1
                else:
                    if screenshot_file and not existing.screenshot_file:
                        existing.screenshot_file = screenshot_file
                    if dwell_f is not None:
                        existing.dwell_sec = dwell_f
                    if user:
                        existing.windows_user = user[:255]
                    if domain and not existing.domain:
                        existing.domain = domain
                    if title and not existing.title:
                        existing.title = title
                    # Upgrade stale "other" when a better category arrives.
                    if category != "other" and (existing.category or "other") == "other":
                        existing.category = category
                    count += 1

            # Track in-batch focus rows: session.get() alone can miss pending inserts
            # when several focus_events share the same stable id in one payload.
            focus_touched: Dict[str, AppBrowserProbeVisit] = {}
            for event in focus_events or []:
                if not isinstance(event, dict):
                    continue
                browser = str(event.get("browser") or "").strip().lower()[:32]
                title = str(event.get("title") or "").strip()[:512]
                url = str(event.get("url") or "").strip()[:8000]
                if not browser or (not title and not url):
                    continue
                if not title:
                    title = url[:512]
                try:
                    dwell_f = float(event.get("dwell_sec") or 0)
                except (TypeError, ValueError):
                    dwell_f = 0.0
                screenshot_file = (
                    str(event.get("screenshot_file") or "").replace("\\", "/").split("/")[-1][:512]
                )
                focus_category = str(event.get("category") or "other")[:32] or "other"
                domain = str(event.get("domain") or "").strip()[:255]
                if not domain and url:
                    try:
                        from urllib.parse import urlparse

                        host_part = urlparse(url if "://" in url else f"https://{url}").hostname or ""
                        domain = host_part.lower().strip(".")
                        if domain.startswith("www."):
                            domain = domain[4:]
                        domain = domain[:255]
                    except Exception:
                        domain = ""
                ended = event.get("ended_at")
                try:
                    ended_ts = float(ended) if ended is not None else time.time()
                except (TypeError, ValueError):
                    ended_ts = time.time()
                ended_dt = datetime.fromtimestamp(ended_ts, tz=timezone.utc)

                # Attach dwell to History only when URL matches (never by title alone —
                # SPA/background History must not steal focus from the real tab).
                if url:
                    hist = session.execute(
                        select(AppBrowserProbeVisit)
                        .where(
                            AppBrowserProbeVisit.computer_name == host,
                            AppBrowserProbeVisit.browser == browser,
                            AppBrowserProbeVisit.url == url,
                            AppBrowserProbeVisit.profile != "focus",
                        )
                        .order_by(AppBrowserProbeVisit.visited_at.desc().nullslast())
                        .limit(1)
                    ).scalars().first()
                    if hist is not None:
                        prev = float(hist.dwell_sec or 0)
                        hist.dwell_sec = max(prev, dwell_f)
                        if screenshot_file and not hist.screenshot_file:
                            hist.screenshot_file = screenshot_file
                        if focus_category != "other" and (hist.category or "other") == "other":
                            hist.category = focus_category

                # Prefer URL for stable id; fall back to title when omnibox empty.
                stable_src = (url or title).encode("utf-8", errors="ignore")
                stable_hash = hashlib.sha1(stable_src).hexdigest()[:16]
                synth_id = f"focus:{stable_hash}"
                row_id = f"{host}:{browser}:focus:{synth_id}"[:512]
                existing_focus = focus_touched.get(row_id) or session.get(AppBrowserProbeVisit, row_id)
                if existing_focus is None:
                    existing_focus = AppBrowserProbeVisit(
                        id=row_id,
                        computer_name=host[:255],
                        windows_user=user[:255],
                        browser=browser,
                        profile="focus",
                        visit_id=synth_id[:64],
                        url=url,
                        title=title,
                        domain=domain,
                        category=focus_category,
                        visited_at=ended_dt,
                        dwell_sec=dwell_f,
                        screenshot_file=screenshot_file,
                        created_at=now,
                    )
                    session.add(existing_focus)
                else:
                    prev = float(existing_focus.dwell_sec or 0)
                    existing_focus.dwell_sec = prev + dwell_f
                    existing_focus.visited_at = ended_dt
                    if title:
                        existing_focus.title = title
                    if url:
                        existing_focus.url = url
                    if domain:
                        existing_focus.domain = domain
                    if focus_category != "other" and (existing_focus.category or "other") == "other":
                        existing_focus.category = focus_category
                    if screenshot_file:
                        existing_focus.screenshot_file = screenshot_file
                    if user:
                        existing_focus.windows_user = user[:255]
                focus_touched[row_id] = existing_focus
                count += 1
        return count

    def save_browser_media(
        self,
        *,
        computer_name: str,
        file_name: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> None:
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        row_id = f"{computer_name}:{file_name}"
        with app_session(database_url=self.database_url) as session:
            existing = session.get(AppBrowserProbeMedia, row_id)
            if existing is None:
                session.add(
                    AppBrowserProbeMedia(
                        id=row_id[:512],
                        computer_name=computer_name[:255],
                        file_name=file_name[:512],
                        content=content,
                        content_type=(content_type or "application/octet-stream")[:128],
                        created_at=now,
                    )
                )
            else:
                existing.content = content
                existing.content_type = (content_type or "application/octet-stream")[:128]
                existing.created_at = now

    def get_browser_media(self, *, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        host = str(computer_name or "").strip()
        name = str(file_name or "").strip().replace("\\", "/").split("/")[-1]
        if not host or not name:
            return None
        row_id = f"{host}:{name}"
        with app_session(database_url=self.database_url) as session:
            row = session.get(AppBrowserProbeMedia, row_id)
            if row is None:
                stmt = select(AppBrowserProbeMedia).where(
                    AppBrowserProbeMedia.computer_name == host,
                    AppBrowserProbeMedia.file_name == name,
                )
                row = session.execute(stmt).scalars().first()
            if row is None:
                return None
            return {
                "computer_name": row.computer_name,
                "file_name": row.file_name,
                "content": bytes(row.content or b""),
                "content_type": row.content_type or "application/octet-stream",
            }

    def list_browser_visits(
        self,
        *,
        computer_name: str = "",
        category: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        stmt = select(AppBrowserProbeVisit).order_by(
            AppBrowserProbeVisit.visited_at.desc().nullslast(),
            AppBrowserProbeVisit.created_at.desc(),
        )
        if computer_name:
            stmt = stmt.where(AppBrowserProbeVisit.computer_name == computer_name)
        if category:
            stmt = stmt.where(AppBrowserProbeVisit.category == category)
        stmt = stmt.offset(max(0, offset)).limit(max(1, min(limit, 500)))
        with app_session(database_url=self.database_url) as session:
            rows = list(session.execute(stmt).scalars().all())
            out: List[Dict[str, Any]] = []
            for row in rows:
                out.append(
                    {
                        "id": row.id,
                        "computer_name": row.computer_name,
                        "windows_user": row.windows_user,
                        "browser": row.browser,
                        "profile": row.profile,
                        "visit_id": row.visit_id,
                        "url": row.url,
                        "title": row.title,
                        "domain": row.domain,
                        "category": row.category,
                        "visited_at": row.visited_at.isoformat().replace("+00:00", "Z")
                        if row.visited_at
                        else None,
                        "dwell_sec": row.dwell_sec,
                        "screenshot_file": row.screenshot_file or "",
                        "created_at": int(row.created_at.timestamp()) if row.created_at else None,
                    }
                )
            return out

    def upsert_max_chats(
        self,
        *,
        computer_name: str,
        windows_user: str,
        chats: List[Dict[str, Any]],
    ) -> int:
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        count = 0
        with app_session(database_url=self.database_url) as session:
            for chat in chats:
                chat_id = str(chat.get("chat_id") or "").strip()
                if not chat_id or "\x00" in chat_id or chat_id in {"0", "\\x00"}:
                    continue
                row_id = f"{computer_name}:{chat_id}"
                existing = session.get(AppMaxProbeChat, row_id)
                messages = list(chat.get("messages") or [])
                screenshots = [
                    str(x).replace("\\", "/").strip()
                    for x in (chat.get("screenshots") or [])
                    if str(x).strip()
                ]
                for msg in messages:
                    if not isinstance(msg, dict):
                        continue
                    path = str(msg.get("screenshot_path") or "").replace("\\", "/").strip()
                    if path and path not in screenshots:
                        screenshots.append(path)
                if existing is not None:
                    prev_messages, prev_shots = _unpack_chat_blob(existing.messages_json or "[]")
                    if messages:
                        messages = _merge_messages(prev_messages, messages)
                    else:
                        messages = _merge_messages(prev_messages, [])
                    screenshots = _merge_screenshots(prev_shots, screenshots)
                    existing.windows_user = windows_user[:255]
                    existing.chat_name = _prefer_chat_name(
                        existing.chat_name, chat.get("chat_name"), chat_id
                    )
                    existing.messages_json = _pack_chat_blob(messages, screenshots)
                    existing.updated_at = now
                else:
                    session.add(
                        AppMaxProbeChat(
                            id=row_id,
                            computer_name=computer_name[:255],
                            windows_user=windows_user[:255],
                            chat_id=chat_id[:128],
                            chat_name=_prefer_chat_name("", chat.get("chat_name"), chat_id),
                            messages_json=_pack_chat_blob(_merge_messages([], messages), screenshots),
                            updated_at=now,
                        )
                    )
                count += 1
        return count

    def save_max_media(
        self,
        *,
        computer_name: str,
        file_name: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> None:
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        row_id = f"{computer_name}:{file_name}"
        with app_session(database_url=self.database_url) as session:
            existing = session.get(AppMaxProbeMedia, row_id)
            if existing is None:
                session.add(
                    AppMaxProbeMedia(
                        id=row_id[:512],
                        computer_name=computer_name[:255],
                        file_name=file_name[:512],
                        content=content,
                        content_type=(content_type or "application/octet-stream")[:128],
                        created_at=now,
                    )
                )
            else:
                existing.content = content
                existing.content_type = (content_type or "application/octet-stream")[:128]
                existing.created_at = now

    def get_max_media(self, *, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        host = str(computer_name or "").strip()
        name = str(file_name or "").strip().replace("\\", "/").split("/")[-1]
        if not host or not name:
            return None
        row_id = f"{host}:{name}"
        with app_session(database_url=self.database_url) as session:
            row = session.get(AppMaxProbeMedia, row_id)
            if row is None:
                stmt = select(AppMaxProbeMedia).where(
                    AppMaxProbeMedia.computer_name == host,
                    AppMaxProbeMedia.file_name == name,
                )
                row = session.execute(stmt).scalars().first()
            if row is None:
                return None
            return {
                "computer_name": row.computer_name,
                "file_name": row.file_name,
                "content": bytes(row.content or b""),
                "content_type": row.content_type or "application/octet-stream",
            }

    def list_max_chats(self, *, computer_name: str = "", limit: int = 100) -> List[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        stmt = select(AppMaxProbeChat).order_by(AppMaxProbeChat.updated_at.desc())
        if computer_name:
            stmt = stmt.where(AppMaxProbeChat.computer_name == computer_name)
        stmt = stmt.limit(max(1, min(limit, 500)))
        with app_session(database_url=self.database_url) as session:
            rows = list(session.execute(stmt).scalars().all())
            out: List[Dict[str, Any]] = []
            for row in rows:
                messages, screenshots = _unpack_chat_blob(row.messages_json or "[]")
                cleaned = _merge_messages(messages, [])
                if cleaned != messages:
                    row.messages_json = _pack_chat_blob(cleaned, screenshots)
                messages = cleaned
                out.append(
                    {
                        "computer_name": row.computer_name,
                        "windows_user": row.windows_user,
                        "chat_id": row.chat_id,
                        "chat_name": row.chat_name,
                        "updated_at": int(row.updated_at.timestamp()) if row.updated_at else None,
                        "messages": messages,
                        "screenshots": screenshots,
                    }
                )
            return out
