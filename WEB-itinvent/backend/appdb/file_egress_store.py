"""PostgreSQL (APP_DATABASE_URL) store for file egress + telegram probe payloads."""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from sqlalchemy import and_, case, func, or_, select, text, tuple_
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from backend.appdb.db import app_session, ensure_app_schema_initialized, is_app_database_configured
from backend.appdb.models import (
    AppBrowserProbeFocusEvent,
    AppDlpActivityBucket,
    AppBrowserProbeMedia,
    AppBrowserProbeVisit,
    AppFileLeftEvent,
    AppInventoryHost,
    AppInventoryHostSqlContext,
    AppMaxProbeChat,
    AppMaxProbeMedia,
    AppTelegramProbeChat,
    AppTelegramProbeMedia,
    AppTelegramProbeReport,
)
from backend.services.dlp_categories import (
    SERVICE_FILE_NAME_SQL_RE,
    category_meta as dlp_category_meta,
    classify_visit as dlp_classify_visit,
    domain_from_url as dlp_domain_from_url,
    is_service_file_name,
)
from shared.browser_focus import browser_focus_event_key


def _fix_mojibake(value: Any) -> str:
    """Repair UTF-8 text that was decoded as cp1252 somewhere upstream.

    Agent-side lower() also folded 'Ð'/'Ñ' into 'ð'/'ñ' — undo that first,
    then try the cp1252→UTF-8 round-trip. Only applied when the result
    actually looks like Cyrillic, so legitimate names are never rewritten.
    """
    s = str(value or "")
    if not s or not any(ch in s for ch in ("ð", "Ð", "Ñ", "ñ")):
        return s
    candidate = s.replace("ð", "Ð").replace("ñ", "Ñ")
    try:
        fixed = candidate.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        try:
            fixed = candidate.encode("cp1252", errors="ignore").decode(
                "utf-8", errors="ignore"
            )
        except Exception:
            return s
    if any("а" <= ch <= "я" or ch in "АЯЁё" for ch in fixed):
        return fixed
    return s


def _strip_nul(value: Any) -> str:
    """PostgreSQL text rejects NUL bytes — one poisoned title otherwise fails
    the whole executemany batch."""
    return str(value or "").replace("\x00", "")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _chunked(seq: List[Any], size: int = 250) -> List[List[Any]]:
    return [seq[i : i + size] for i in range(0, len(seq), size)]


_EXT_BY_TYPE = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "video/mp4": "mp4",
}


def media_storage_root() -> Optional[Path]:
    """External media payload dir; empty env means legacy bytea-only mode."""
    raw = str(os.getenv("DLP_MEDIA_STORAGE_DIR", "") or "").strip()
    return Path(raw) if raw else None


def media_storage_ready(root: Optional[Path]) -> bool:
    """True when root is usable; UNC roots need the HUB-IT SMB session first."""
    if root is None:
        return False
    if not str(root).startswith("\\\\"):
        return True
    try:
        from backend.services.hubit_storage import ensure_connected

        ensure_connected(root)
        return True
    except Exception as exc:
        logger.warning("dlp media storage unavailable root=%s err=%s", root, exc)
        return False


def _media_storage_write(root: Path, table: str, file_name: str, content: bytes, content_type: str) -> Optional[str]:
    """Write payload content-addressed under <root>/<table>/ and return the relative key."""
    if not content or not media_storage_ready(root):
        return None
    digest = hashlib.sha256(content).hexdigest()
    ext = Path(str(file_name)).suffix.lstrip(".").lower()
    if not ext or len(ext) > 8 or not ext.isalnum():
        ext = _EXT_BY_TYPE.get(str(content_type).lower(), "bin")
    rel = f"{table}/{digest[:2]}/{digest}.{ext}"
    target = root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        tmp = target.with_name(f"{target.name}.{uuid.uuid4().hex}.tmp")
        tmp.write_bytes(content)
        tmp.replace(target)
    return rel


def _media_storage_read(storage_path: Optional[str]) -> Optional[bytes]:
    root = media_storage_root()
    if not storage_path or not media_storage_ready(root):
        return None
    try:
        base = root.resolve()
        target = (base / storage_path).resolve()
        if base not in target.parents:
            return None
        return target.read_bytes() if target.is_file() else None
    except OSError:
        return None


def _media_payload_fields(
    table: str, file_name: str, content: bytes, content_type: str
) -> Dict[str, Any]:
    """Store payload on disk when configured; falls back to bytea on write failure."""
    fields: Dict[str, Any] = {
        "content": content,
        "content_type": (content_type or "application/octet-stream")[:128],
        "storage_path": None,
    }
    root = media_storage_root()
    if root is not None and content:
        try:
            rel = _media_storage_write(root, table, file_name, content, fields["content_type"])
        except OSError as exc:
            logger.warning("dlp media disk write failed, falling back to bytea: %s", exc)
            rel = None
        if rel:
            fields["content"] = None
            fields["storage_path"] = rel
    return fields


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


def _parse_day_key(value: Any) -> Optional[Any]:
    raw = str(value or "").strip()
    if len(raw) != 10:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


_FOCUS_VISIT_COND = or_(
    AppBrowserProbeVisit.profile == "focus",
    AppBrowserProbeVisit.dwell_sec > 0,
)

# Agents before 1.4.19 (no ``schema`` or schema < 2) had no idle detection: a
# tab left in foreground overnight produced dwell of many hours. Cap such
# legacy events at 30 minutes and move the surplus to idle so day totals stay
# plausible; schema=2 events already carry a real active/idle split.
LEGACY_FOCUS_MAX_SEC = 1800.0


def _browser_visit_conditions(
    *,
    computer_name: str = "",
    category: str = "",
    day: str = "",
    source: str = "",
    q: str = "",
) -> List[Any]:
    conditions: List[Any] = []
    host = str(computer_name or "").strip()
    if host:
        conditions.append(AppBrowserProbeVisit.computer_name == host)
    cat = str(category or "").strip()
    if cat:
        conditions.append(AppBrowserProbeVisit.category == cat)
    parsed_day = _parse_day_key(day)
    if parsed_day is not None:
        # Range predicate keeps the (computer_name, visited_at) index usable;
        # date(visited_at) = day cannot use it.
        day_start = datetime.combine(parsed_day, datetime.min.time()).astimezone()
        conditions.append(AppBrowserProbeVisit.visited_at >= day_start)
        conditions.append(AppBrowserProbeVisit.visited_at < day_start + timedelta(days=1))
    src = str(source or "").strip().lower()
    if src == "focus":
        conditions.append(_FOCUS_VISIT_COND)
    elif src == "history":
        conditions.append(AppBrowserProbeVisit.profile != "focus")
    needle = str(q or "").strip()
    if needle:
        pattern = "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        conditions.append(
            or_(
                AppBrowserProbeVisit.url.ilike(pattern, escape="\\"),
                AppBrowserProbeVisit.domain.ilike(pattern, escape="\\"),
                AppBrowserProbeVisit.title.ilike(pattern, escape="\\"),
            )
        )
    return conditions


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _local_aware(dt: Any) -> Any:
    """bucket_start reads: aware stays an instant; naive (sqlite storage) holds
    agent-local wall digits, so interpret it as local — not UTC."""
    if getattr(dt, "tzinfo", None) is None:
        return dt.astimezone()
    return dt


def _epoch(dt: Any) -> float:
    """Naive/aware datetime → epoch seconds (tz assumed UTC when missing)."""
    if getattr(dt, "tzinfo", None) is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _service_file_condition(dialect_name: str) -> Any:
    """SQL 'deleted-channel noise' predicate; REGEXP on sqlite, ~ on PostgreSQL."""
    op = "~" if str(dialect_name).lower() == "postgresql" else "REGEXP"
    return and_(
        AppFileLeftEvent.channel == "deleted",
        func.lower(AppFileLeftEvent.file_name).op(op)(SERVICE_FILE_NAME_SQL_RE),
    )


class AppFileEgressStore:
    def __init__(self, *, database_url: str | None = None) -> None:
        self.database_url = database_url

    def ingest_file_left(self, events: List[Dict[str, Any]]) -> int:
        if not is_app_database_configured() and not self.database_url:
            raise RuntimeError("APP_DATABASE_URL is required for file egress store")
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        rows: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for event in events:
            if not isinstance(event, dict):
                continue
            event_id = str(event.get("event_id") or event.get("id") or uuid.uuid4().hex)
            if event_id in seen:
                continue
            seen.add(event_id)
            rows.append(
                {
                    "id": event_id,
                    "ts": _to_int(event.get("ts"), int(time.time())),
                    "channel": str(event.get("channel") or "unknown")[:32],
                    "file_name": _strip_nul(event.get("file_name"))[:512],
                    "dest_path": _strip_nul(event.get("dest_path")),
                    "src_path": _strip_nul(event.get("src_path")),
                    "size": event.get("size") if event.get("size") is None else _to_int(event.get("size")),
                    "sha256": str(event.get("sha256") or "")[:64],
                    "windows_user": str(event.get("windows_user") or "")[:255],
                    "computer_name": str(event.get("computer_name") or "")[:255],
                    "details_json": json.dumps(event.get("details") or {}, ensure_ascii=False),
                    "created_at": now,
                }
            )
        # Service/temp artifacts dominate 'deleted' rows (Outlook .pst.tmp, AutoCAD
        # *.dwl, partial downloads...): skip them at ingest, only for channel='deleted'.
        rows = [
            row
            for row in rows
            if row["channel"] != "deleted" or not is_service_file_name(row["file_name"])
        ]
        if not rows:
            return 0
        with app_session(database_url=self.database_url) as session:
            # 'deleted' rows are re-emitted by the watcher on every scan: keep only the
            # first sighting of (computer_name, file_name) — one EXISTS prefetch, not per row.
            deleted_pairs = {
                (row["computer_name"], row["file_name"])
                for row in rows
                if row["channel"] == "deleted"
            }
            # Bound the prefetch to a ±7d window around the batch's own ts range:
            # (channel, ts)/(computer_name, ts) indexes are used, and the same file
            # deleted again after a week is a genuinely new event, not a re-send.
            deleted_ts = [row["ts"] for row in rows if row["channel"] == "deleted"]
            existing_deleted: set[tuple] = set()
            for chunk in _chunked(sorted(deleted_pairs)):
                existing_deleted.update(
                    session.execute(
                        select(
                            AppFileLeftEvent.computer_name,
                            AppFileLeftEvent.file_name,
                        ).where(
                            AppFileLeftEvent.channel == "deleted",
                            AppFileLeftEvent.ts >= min(deleted_ts) - 7 * 86400,
                            AppFileLeftEvent.ts <= max(deleted_ts) + 7 * 86400,
                            tuple_(
                                AppFileLeftEvent.computer_name,
                                AppFileLeftEvent.file_name,
                            ).in_(chunk),
                        )
                    ).all()
                )
            if deleted_pairs:
                kept: List[Dict[str, Any]] = []
                batch_seen: set[tuple] = set()
                for row in rows:
                    if row["channel"] == "deleted":
                        pair = (row["computer_name"], row["file_name"])
                        # First sighting only: drop pairs already stored or queued in this batch.
                        if pair in existing_deleted or pair in batch_seen:
                            continue
                        batch_seen.add(pair)
                    kept.append(row)
                rows = kept
            if not rows:
                return 0
            ids = [row["id"] for row in rows]
            existing_ids: set[str] = set()
            for chunk in _chunked(ids):
                existing_ids.update(
                    session.execute(
                        select(AppFileLeftEvent.id).where(AppFileLeftEvent.id.in_(chunk))
                    ).scalars()
                )
            to_add = [row for row in rows if row["id"] not in existing_ids]
            if not to_add:
                return 0
            insert_fn = (
                postgres_insert
                if session.connection().dialect.name == "postgresql"
                else sqlite_insert
            )
            for chunk in _chunked(to_add):
                session.execute(
                    insert_fn(AppFileLeftEvent)
                    .values(chunk)
                    .on_conflict_do_nothing(index_elements=["id"])
                )
        return len(to_add)

    @staticmethod
    def _file_left_conditions(
        *,
        computer_name: str = "",
        channel: str = "",
        include_noise: bool = True,
        noise_only: bool = False,
        dialect_name: str = "postgresql",
    ) -> List[Any]:
        conditions: List[Any] = []
        if computer_name:
            conditions.append(AppFileLeftEvent.computer_name == computer_name)
        if channel:
            conditions.append(AppFileLeftEvent.channel == channel)
        noise_cond = _service_file_condition(dialect_name)
        if noise_only:
            conditions.append(noise_cond)
        elif not include_noise:
            conditions.append(~noise_cond)
        return conditions

    @staticmethod
    def _file_left_row(
        row: AppFileLeftEvent,
        *,
        count: int = 1,
        first_ts: Optional[int] = None,
    ) -> Dict[str, Any]:
        try:
            details = json.loads(row.details_json or "{}")
        except Exception:
            details = {}
        return {
            "id": row.id,
            "ts": row.ts,
            "first_ts": first_ts if first_ts is not None else row.ts,
            "last_ts": row.ts,
            "count": count,
            "merged": count > 1,
            "channel": row.channel,
            "file_name": _fix_mojibake(row.file_name),
            "dest_path": _fix_mojibake(row.dest_path),
            "src_path": _fix_mojibake(row.src_path),
            "size": row.size,
            "sha256": row.sha256,
            "windows_user": row.windows_user,
            "computer_name": row.computer_name,
            "details": details,
            "service": bool(
                row.channel == "deleted" and is_service_file_name(row.file_name)
            ),
            "created_at": int(row.created_at.timestamp()) if row.created_at else None,
        }

    def count_file_left(
        self,
        *,
        computer_name: str = "",
        channel: str = "",
        include_noise: bool = True,
        noise_only: bool = False,
    ) -> int:
        ensure_app_schema_initialized(self.database_url)
        with app_session(database_url=self.database_url) as session:
            conditions = self._file_left_conditions(
                computer_name=computer_name,
                channel=channel,
                include_noise=include_noise,
                noise_only=noise_only,
                dialect_name=session.connection().dialect.name,
            )
            total = session.execute(
                select(func.count()).select_from(AppFileLeftEvent).where(*conditions)
            ).scalar()
            return int(total or 0)

    def list_file_left(
        self,
        *,
        computer_name: str = "",
        channel: str = "",
        limit: int = 100,
        offset: int = 0,
        group: bool = False,
        include_noise: bool = True,
    ) -> List[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        page_limit = max(1, min(limit, 500))
        page_offset = max(0, offset)
        with app_session(database_url=self.database_url) as session:
            conditions = self._file_left_conditions(
                computer_name=computer_name,
                channel=channel,
                include_noise=include_noise,
                dialect_name=session.connection().dialect.name,
            )
            if group:
                # One row per (computer, file, sha256, channel, dest_path) with the
                # repeat count and first/last timestamps — 'deleted' re-scans collapse.
                stmt = (
                    select(
                        func.max(AppFileLeftEvent.id).label("id"),
                        AppFileLeftEvent.channel.label("channel"),
                        AppFileLeftEvent.file_name.label("file_name"),
                        AppFileLeftEvent.dest_path.label("dest_path"),
                        func.max(AppFileLeftEvent.src_path).label("src_path"),
                        func.max(AppFileLeftEvent.size).label("size"),
                        AppFileLeftEvent.sha256.label("sha256"),
                        func.max(AppFileLeftEvent.windows_user).label("windows_user"),
                        AppFileLeftEvent.computer_name.label("computer_name"),
                        func.count().label("count"),
                        func.min(AppFileLeftEvent.ts).label("first_ts"),
                        func.max(AppFileLeftEvent.ts).label("last_ts"),
                        func.max(AppFileLeftEvent.created_at).label("created_at"),
                    )
                    .where(*conditions)
                    .group_by(
                        AppFileLeftEvent.computer_name,
                        AppFileLeftEvent.file_name,
                        AppFileLeftEvent.sha256,
                        AppFileLeftEvent.channel,
                        AppFileLeftEvent.dest_path,
                    )
                    .order_by(func.max(AppFileLeftEvent.ts).desc())
                    .limit(page_limit)
                    .offset(page_offset)
                )
                out: List[Dict[str, Any]] = []
                for row in session.execute(stmt):
                    created_at = row.created_at
                    out.append(
                        {
                            "id": row.id,
                            "ts": int(row.last_ts or 0),
                            "first_ts": int(row.first_ts or 0),
                            "last_ts": int(row.last_ts or 0),
                            "count": int(row.count or 1),
                            "merged": int(row.count or 1) > 1,
                            "channel": row.channel,
                            "file_name": _fix_mojibake(row.file_name),
                            "dest_path": _fix_mojibake(row.dest_path),
                            "src_path": _fix_mojibake(row.src_path or ""),
                            "size": row.size,
                            "sha256": row.sha256 or "",
                            "windows_user": row.windows_user or "",
                            "computer_name": row.computer_name,
                            "details": {},
                            "service": bool(
                                row.channel == "deleted"
                                and is_service_file_name(row.file_name)
                            ),
                            "created_at": int(created_at.timestamp()) if created_at else None,
                        }
                    )
                return out
            stmt = (
                select(AppFileLeftEvent)
                .where(*conditions)
                .order_by(AppFileLeftEvent.ts.desc())
                .limit(page_limit)
                .offset(page_offset)
            )
            rows = session.execute(stmt).scalars().all()
            return [self._file_left_row(row) for row in rows]

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
            content = row.content if row.content is not None else _media_storage_read(row.storage_path)
            return {
                "computer_name": row.computer_name,
                "file_name": row.file_name,
                "content": bytes(content or b""),
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
        fields = _media_payload_fields("telegram_probe_media", file_name, content, content_type)
        with app_session(database_url=self.database_url) as session:
            existing = session.get(AppTelegramProbeMedia, row_id)
            if existing is None:
                session.add(
                    AppTelegramProbeMedia(
                        id=row_id[:512],
                        computer_name=computer_name[:255],
                        file_name=file_name[:512],
                        created_at=now,
                        **fields,
                    )
                )
            else:
                existing.content = fields["content"]
                existing.content_type = fields["content_type"]
                existing.storage_path = fields["storage_path"]
                existing.created_at = now

    def _save_media_batch(self, model: Any, items: List[Dict[str, Any]]) -> int:
        """Upsert several media rows in one session/prefetch instead of a session per file."""
        prepared: Dict[str, Dict[str, Any]] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            host = str(item.get("computer_name") or "")[:255]
            name = str(item.get("file_name") or "")[:512]
            if not host or not name:
                continue
            prepared[f"{host}:{name}"[:512]] = {
                "id": f"{host}:{name}"[:512],
                "computer_name": host,
                "file_name": name,
                **_media_payload_fields(
                    model.__tablename__,
                    name,
                    item.get("content") or b"",
                    str(item.get("content_type") or "application/octet-stream"),
                ),
            }
        if not prepared:
            return 0
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        ids = list(prepared)
        with app_session(database_url=self.database_url) as session:
            existing: Dict[str, Any] = {}
            for chunk in _chunked(ids):
                for row in session.execute(select(model).where(model.id.in_(chunk))).scalars():
                    existing[row.id] = row
            for row_id, fields in prepared.items():
                row = existing.get(row_id)
                if row is None:
                    session.add(model(created_at=now, **fields))
                else:
                    row.content = fields["content"]
                    row.content_type = fields["content_type"]
                    row.storage_path = fields["storage_path"]
                    row.created_at = now
        return len(prepared)

    def save_media_batch(self, items: List[Dict[str, Any]]) -> int:
        return self._save_media_batch(AppTelegramProbeMedia, items)

    def save_browser_media_batch(self, items: List[Dict[str, Any]]) -> int:
        return self._save_media_batch(AppBrowserProbeMedia, items)

    def save_max_media_batch(self, items: List[Dict[str, Any]]) -> int:
        return self._save_media_batch(AppMaxProbeMedia, items)

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
        if not visits and not focus_events:
            return 0
        ensure_app_schema_initialized(self.database_url)
        now = _utcnow()
        host = str(computer_name or "").strip() or "unknown"
        user = str(windows_user or "").strip()
        count = 0
        with app_session(database_url=self.database_url) as session:
            connection = session.connection()
            is_postgres = connection.dialect.name == "postgresql"
            if is_postgres:
                # Serialize read/modify/write of the same host's aggregates across workers.
                lock_key = int.from_bytes(
                    hashlib.blake2b(host.encode("utf-8"), digest_size=8, person=b"browser-focus").digest(),
                    "big",
                    signed=True,
                )
                connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
            else:
                connection.exec_driver_sql("BEGIN IMMEDIATE")
            insert_focus_event = postgres_insert if is_postgres else sqlite_insert

            visit_rows: List[tuple[str, Dict[str, Any]]] = []
            for visit in visits or []:
                if not isinstance(visit, dict):
                    continue
                browser = str(visit.get("browser") or "").strip().lower()[:32]
                profile = str(visit.get("profile") or "Default").strip()[:128] or "Default"
                visit_id = str(visit.get("visit_id") or "").strip()
                if not browser or not visit_id:
                    continue
                row_id = f"{host}:{browser}:{profile}:{visit_id}"[:512]
                dwell = visit.get("dwell_sec")
                try:
                    dwell_f = float(dwell) if dwell is not None else None
                except (TypeError, ValueError):
                    dwell_f = None
                domain = _strip_nul(visit.get("domain"))[:255]
                url_raw = _strip_nul(visit.get("url"))[:8000]
                if not domain and url_raw:
                    domain = dlp_domain_from_url(url_raw)[:255]
                title = _strip_nul(visit.get("title"))[:512]
                # Server-side classifier is authoritative for display; the agent
                # category is kept only when the server cannot place the domain.
                server_cat = dlp_classify_visit(domain=domain, title=title, url=url_raw)
                if server_cat == "other":
                    server_cat = str(visit.get("category") or "other")[:32] or "other"
                visit_rows.append(
                    (
                        row_id,
                        {
                            "computer_name": host[:255],
                            "windows_user": user[:255],
                            "browser": browser,
                            "profile": profile,
                            "visit_id": visit_id[:64],
                            "url": url_raw,
                            "title": title,
                            "domain": domain,
                            "category": server_cat,
                            "visited_at": self._parse_iso_dt(visit.get("visited_at")),
                            "dwell_sec": dwell_f,
                            "screenshot_file": str(visit.get("screenshot_file") or "")
                            .replace("\\", "/")
                            .split("/")[-1][:512],
                        },
                    )
                )
            existing_map: Dict[str, AppBrowserProbeVisit] = {}
            for chunk in _chunked([row_id for row_id, _ in visit_rows]):
                for row in session.execute(
                    select(AppBrowserProbeVisit).where(AppBrowserProbeVisit.id.in_(chunk))
                ).scalars():
                    existing_map[row.id] = row
            # History re-uploads re-send the same URL with a fresh visit_id within
            # seconds: prefetch max(visited_at) per URL and drop near-dupes cheaply.
            last_visit_by_url: Dict[str, datetime] = {}
            new_url_rows = [
                f for rid, f in visit_rows if rid not in existing_map and f["url"]
            ]
            new_urls = sorted({f["url"] for f in new_url_rows})
            # Bound the prefetch near the batch's own visited_at range so the
            # (computer_name, visited_at) index serves it instead of a host-wide scan.
            near_ts = [f["visited_at"] for f in new_url_rows if f["visited_at"] is not None]
            near_low = (min(near_ts) - timedelta(minutes=5)) if near_ts else None
            near_high = (max(near_ts) + timedelta(minutes=5)) if near_ts else None
            for chunk in _chunked(new_urls):
                conditions = [
                    AppBrowserProbeVisit.computer_name == host,
                    AppBrowserProbeVisit.url.in_(chunk),
                    AppBrowserProbeVisit.visited_at.isnot(None),
                ]
                if near_low is not None:
                    conditions.append(AppBrowserProbeVisit.visited_at >= near_low)
                if near_high is not None:
                    conditions.append(AppBrowserProbeVisit.visited_at <= near_high)
                for url, last_at in session.execute(
                    select(
                        AppBrowserProbeVisit.url,
                        func.max(AppBrowserProbeVisit.visited_at),
                    )
                    .where(*conditions)
                    .group_by(AppBrowserProbeVisit.url)
                ):
                    if last_at is not None:
                        last_visit_by_url[str(url)] = last_at
            # Pending inserts are invisible to prefetches: track them separately.
            batch_added: Dict[str, AppBrowserProbeVisit] = {}
            batch_last_url_ts: Dict[str, float] = {}
            for row_id, fields in visit_rows:
                existing = batch_added.get(row_id) or existing_map.get(row_id)
                if existing is None:
                    visited_at = fields["visited_at"]
                    last_seen = last_visit_by_url.get(fields["url"])
                    last_epoch = batch_last_url_ts.get(fields["url"])
                    if last_epoch is None and last_seen is not None:
                        last_epoch = _epoch(last_seen)
                    if (
                        visited_at is not None
                        and last_epoch is not None
                        and abs(_epoch(visited_at) - last_epoch) <= 60
                    ):
                        # Same URL already stored/queued within ±60s — History re-read.
                        count += 1
                        continue
                    if visited_at is not None and fields["url"]:
                        batch_last_url_ts[fields["url"]] = _epoch(visited_at)
                    existing = AppBrowserProbeVisit(id=row_id, created_at=now, **fields)
                    session.add(existing)
                    batch_added[row_id] = existing
                else:
                    if fields["screenshot_file"] and not existing.screenshot_file:
                        existing.screenshot_file = fields["screenshot_file"]
                    if fields["dwell_sec"] is not None:
                        existing.dwell_sec = fields["dwell_sec"]
                    if user:
                        existing.windows_user = user[:255]
                    if fields["domain"] and not existing.domain:
                        existing.domain = fields["domain"]
                    if fields["title"] and not existing.title:
                        existing.title = fields["title"]
                    # Upgrade stale "other" when a better category arrives.
                    if fields["category"] != "other" and (existing.category or "other") == "other":
                        existing.category = fields["category"]
                count += 1

            # Normalize focus events first so claiming, lookup and upsert batch
            # into a few round-trips instead of ~4 queries per event.
            prepared_focus: List[tuple[str, Dict[str, Any]]] = []
            for event in focus_events or []:
                if not isinstance(event, dict):
                    continue
                browser = str(event.get("browser") or "").strip().lower()[:32]
                title = _strip_nul(event.get("title")).strip()[:512]
                url = _strip_nul(event.get("url")).strip()[:8000]
                if not browser or (not title and not url):
                    continue
                if not title:
                    title = url[:512]
                try:
                    dwell_f = float(event.get("dwell_sec") or 0)
                except (TypeError, ValueError):
                    dwell_f = 0.0
                if not math.isfinite(dwell_f):
                    dwell_f = 0.0
                try:
                    idle_f = float(event.get("idle_sec") or 0)
                except (TypeError, ValueError):
                    idle_f = 0.0
                if not math.isfinite(idle_f) or idle_f < 0:
                    idle_f = 0.0
                try:
                    session_dwell_f = float(event.get("session_dwell_sec") or 0)
                except (TypeError, ValueError):
                    session_dwell_f = 0.0
                if not math.isfinite(session_dwell_f) or session_dwell_f < 0:
                    session_dwell_f = 0.0
                try:
                    focus_schema = int(event.get("schema") or 0)
                except (TypeError, ValueError):
                    focus_schema = 0
                if focus_schema < 2 and dwell_f > LEGACY_FOCUS_MAX_SEC:
                    idle_f = dwell_f - LEGACY_FOCUS_MAX_SEC
                    dwell_f = LEGACY_FOCUS_MAX_SEC
                if dwell_f <= 0 and idle_f <= 0:
                    continue
                screenshot_file = (
                    str(event.get("screenshot_file") or "").replace("\\", "/").split("/")[-1][:512]
                )
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
                focus_category = dlp_classify_visit(domain=domain, title=title)
                if focus_category == "other":
                    focus_category = str(event.get("category") or "other")[:32] or "other"
                ended = event.get("ended_at")
                try:
                    ended_ts = float(ended) if ended is not None else time.time()
                except (TypeError, ValueError):
                    ended_ts = time.time()
                ended_dt = datetime.fromtimestamp(ended_ts, tz=timezone.utc)
                stable_src = (url or title).encode("utf-8", errors="ignore")
                stable_hash = hashlib.sha1(stable_src).hexdigest()[:16]
                # Day-scoped: each event date accumulates its own row so the
                # day filter shows that day's dwell, not the lifetime sum.
                # Local server date: the server and its users share a TZ —
                # a UTC date would split the workday at 05:00 local. The date
                # also goes into visit_id: (host, browser, profile, visit_id)
                # is UNIQUE, so same-page rows on different days would clash.
                local_day = ended_dt.astimezone().date().isoformat()
                synth_id = f"focus:{stable_hash}"
                prepared_focus.append(
                    (
                        browser_focus_event_key(host, user, event),
                        {
                            "browser": browser,
                            "title": title,
                            "url": url,
                            "dwell_f": dwell_f,
                            "idle_f": idle_f,
                            "session_dwell_f": session_dwell_f,
                            "screenshot_file": screenshot_file,
                            "focus_category": focus_category,
                            "domain": domain,
                            "ended_dt": ended_dt,
                            "row_id": f"{host}:{browser}:focus:{synth_id}:{local_day}"[:512],
                            "synth_id": f"{synth_id}:{local_day}"[:64],
                        },
                    )
                )

            claim_rows = [
                {"event_key": key, "received_at": now}
                for key, _ in prepared_focus
                if key
            ]
            accepted_keys: set[str] = set()
            # Dedup identical keys inside the batch: the first occurrence claims, the
            # rest must not pass — same as sequential ON CONFLICT DO NOTHING.
            for chunk in _chunked(
                list({row["event_key"]: row for row in claim_rows}.values())
            ):
                accepted_keys.update(
                    session.execute(
                        insert_focus_event(AppBrowserProbeFocusEvent)
                        .values(chunk)
                        .on_conflict_do_nothing(index_elements=["event_key"])
                        .returning(AppBrowserProbeFocusEvent.event_key)
                    ).scalars().all()
                )

            surviving: List[Dict[str, Any]] = []
            consumed_keys: set[str] = set()
            for event_key, fields in prepared_focus:
                if event_key:
                    if event_key not in accepted_keys or event_key in consumed_keys:
                        continue
                    consumed_keys.add(event_key)
                surviving.append(fields)

            # Attach dwell to History only when URL matches (never by title alone —
            # SPA/background History must not steal focus from the real tab).
            hist_map: Dict[tuple, AppBrowserProbeVisit] = {}
            hist_pairs = list(
                {(f["browser"], f["url"]) for f in surviving if f["url"]}
            )
            for chunk in _chunked(hist_pairs):
                stmt = (
                    select(AppBrowserProbeVisit)
                    .where(
                        AppBrowserProbeVisit.computer_name == host,
                        AppBrowserProbeVisit.profile != "focus",
                        tuple_(AppBrowserProbeVisit.browser, AppBrowserProbeVisit.url).in_(chunk),
                    )
                    .order_by(AppBrowserProbeVisit.visited_at.desc().nullslast())
                )
                for row in session.execute(stmt).scalars():
                    hist_map.setdefault((row.browser, row.url), row)

            focus_ids = [f["row_id"] for f in surviving]
            focus_map: Dict[str, AppBrowserProbeVisit] = {}
            for chunk in _chunked(focus_ids):
                for row in session.execute(
                    select(AppBrowserProbeVisit).where(AppBrowserProbeVisit.id.in_(chunk))
                ).scalars():
                    focus_map[row.id] = row

            focus_touched: Dict[str, AppBrowserProbeVisit] = {}
            for fields in surviving:
                url = fields["url"]
                browser = fields["browser"]
                dwell_f = fields["dwell_f"]
                idle_f = fields["idle_f"]
                screenshot_file = fields["screenshot_file"]
                focus_category = fields["focus_category"]
                domain = fields["domain"]
                ended_dt = fields["ended_dt"]
                title = fields["title"]

                hist = hist_map.get((browser, url)) if url else None
                if hist is not None:
                    prev = float(hist.dwell_sec or 0)
                    # schema=2 segments are ~60s each; the full session dwell is
                    # what belongs on the History row, not the last segment.
                    hist_dwell = fields["session_dwell_f"] or dwell_f
                    hist.dwell_sec = max(prev, hist_dwell)
                    if screenshot_file and not hist.screenshot_file:
                        hist.screenshot_file = screenshot_file
                    if focus_category != "other" and (hist.category or "other") == "other":
                        hist.category = focus_category

                # Prefer URL for stable id; fall back to title when omnibox empty.
                row_id = fields["row_id"]
                existing_focus = (
                    focus_touched.get(row_id)
                    or batch_added.get(row_id)
                    or focus_map.get(row_id)
                )
                if existing_focus is None:
                    existing_focus = AppBrowserProbeVisit(
                        id=row_id,
                        computer_name=host[:255],
                        windows_user=user[:255],
                        browser=browser,
                        profile="focus",
                        visit_id=fields["synth_id"],
                        url=url,
                        title=title,
                        domain=domain,
                        category=focus_category,
                        visited_at=ended_dt,
                        dwell_sec=dwell_f,
                        idle_sec=idle_f,
                        screenshot_file=screenshot_file,
                        created_at=now,
                    )
                    session.add(existing_focus)
                else:
                    prev = float(existing_focus.dwell_sec or 0)
                    existing_focus.dwell_sec = prev + dwell_f
                    existing_focus.idle_sec = float(existing_focus.idle_sec or 0) + idle_f
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

    _ACTIVITY_MAX_BUCKET_SEC = 330.0  # 5 min + 10% tolerance
    _ACTIVITY_MAX_AGE_DAYS = 14

    def ingest_activity_buckets(
        self,
        *,
        computer_name: str,
        windows_user: str,
        buckets: List[Dict[str, Any]],
    ) -> int:
        """Upsert 5-minute activity rows; PK collision overwrites (idempotent retry)."""
        if not buckets:
            return 0
        ensure_app_schema_initialized(self.database_url)
        host = str(computer_name or "").strip()[:255] or "unknown"
        user = str(windows_user or "").strip()[:255]
        now = _utcnow()
        rows: List[Dict[str, Any]] = []
        for item in buckets:
            if not isinstance(item, dict):
                continue
            bucket_start = self._parse_iso_dt(item.get("bucket_start"))
            if bucket_start is None:
                continue
            if bucket_start > now + timedelta(minutes=10):
                continue
            if bucket_start < now - timedelta(days=self._ACTIVITY_MAX_AGE_DAYS):
                continue
            values: Dict[str, float] = {}
            for field in ("active_sec", "passive_sec", "away_sec", "locked_sec"):
                try:
                    v = float(item.get(field) or 0)
                except (TypeError, ValueError):
                    v = 0.0
                if not math.isfinite(v) or v < 0:
                    v = 0.0
                values[field] = min(v, self._ACTIVITY_MAX_BUCKET_SEC)
            total = sum(values.values())
            if total > self._ACTIVITY_MAX_BUCKET_SEC:
                scale = self._ACTIVITY_MAX_BUCKET_SEC / total
                values = {k: v * scale for k, v in values.items()}
            if total <= 0:
                continue
            apps_raw = item.get("apps")
            apps: Dict[str, float] = {}
            if isinstance(apps_raw, dict):
                for name, sec in list(apps_raw.items())[:10]:
                    try:
                        s = float(sec)
                    except (TypeError, ValueError):
                        continue
                    if math.isfinite(s) and s > 0:
                        apps[str(name)[:64]] = round(min(s, self._ACTIVITY_MAX_BUCKET_SEC), 1)
            rows.append(
                {
                    "computer_name": host,
                    "windows_user": user,
                    "bucket_start": bucket_start,
                    "active_sec": round(values["active_sec"], 1),
                    "passive_sec": round(values["passive_sec"], 1),
                    "away_sec": round(values["away_sec"], 1),
                    "locked_sec": round(values["locked_sec"], 1),
                    "apps": apps or None,
                    "updated_at": now,
                }
            )
        if not rows:
            return 0
        with app_session(database_url=self.database_url) as session:
            is_postgres = session.connection().dialect.name == "postgresql"
            insert = postgres_insert if is_postgres else sqlite_insert
            update_cols = {
                "active_sec": insert(AppDlpActivityBucket).excluded.active_sec,
                "passive_sec": insert(AppDlpActivityBucket).excluded.passive_sec,
                "away_sec": insert(AppDlpActivityBucket).excluded.away_sec,
                "locked_sec": insert(AppDlpActivityBucket).excluded.locked_sec,
                "apps": insert(AppDlpActivityBucket).excluded.apps,
                "updated_at": insert(AppDlpActivityBucket).excluded.updated_at,
            }
            count = 0
            for chunk in _chunked(rows):
                session.execute(
                    insert(AppDlpActivityBucket)
                    .values(chunk)
                    .on_conflict_do_update(
                        index_elements=["computer_name", "windows_user", "bucket_start"],
                        set_=update_cols,
                    )
                )
                count += len(chunk)
        return count

    def _day_range(self, day: str) -> tuple[datetime, datetime]:
        parsed = _parse_day_key(day)
        base = parsed if parsed is not None else datetime.now().astimezone().date()
        day_start = datetime.combine(base, datetime.min.time()).astimezone()
        return day_start, day_start + timedelta(days=1)

    def list_dlp_activity(self, *, computer_name: str, day: str = "") -> Dict[str, Any]:
        """Day's 5-minute buckets for a host, all users merged by bucket_start."""
        ensure_app_schema_initialized(self.database_url)
        host = str(computer_name or "").strip()
        if not host:
            return {"buckets": [], "summary": {}, "apps_top": []}
        day_start, day_end = self._day_range(day)
        with app_session(database_url=self.database_url) as session:
            rows = session.execute(
                select(
                    AppDlpActivityBucket.bucket_start,
                    AppDlpActivityBucket.active_sec,
                    AppDlpActivityBucket.passive_sec,
                    AppDlpActivityBucket.away_sec,
                    AppDlpActivityBucket.locked_sec,
                    AppDlpActivityBucket.apps,
                )
                .where(
                    AppDlpActivityBucket.computer_name == host,
                    AppDlpActivityBucket.bucket_start >= day_start,
                    AppDlpActivityBucket.bucket_start < day_end,
                )
                .order_by(AppDlpActivityBucket.bucket_start)
            ).all()
        merged: Dict[datetime, Dict[str, Any]] = {}
        app_totals: Dict[str, float] = {}
        for bucket_start, active, passive, away, locked, apps in rows:
            bucket_start = _local_aware(bucket_start)
            entry = merged.setdefault(
                bucket_start,
                {"active": 0.0, "passive": 0.0, "away": 0.0, "locked": 0.0, "apps": {}},
            )
            entry["active"] += float(active or 0)
            entry["passive"] += float(passive or 0)
            entry["away"] += float(away or 0)
            entry["locked"] += float(locked or 0)
            if isinstance(apps, dict):
                bucket_apps: Dict[str, float] = entry["apps"]
                for name, sec in apps.items():
                    try:
                        sec_f = float(sec or 0)
                    except (TypeError, ValueError):
                        continue
                    app_totals[str(name)] = app_totals.get(str(name), 0.0) + sec_f
                    bucket_apps[str(name)] = bucket_apps.get(str(name), 0.0) + sec_f
        buckets = [
            {
                "bucket_start": key.isoformat(),
                "active_sec": round(val["active"], 1),
                "passive_sec": round(val["passive"], 1),
                "away_sec": round(val["away"], 1),
                "locked_sec": round(val["locked"], 1),
                "app": (
                    max(val["apps"].items(), key=lambda kv: kv[1])[0]
                    if val["apps"]
                    else None
                ),
            }
            for key, val in sorted(merged.items())
        ]
        active_starts = [
            key for key, val in merged.items() if val["active"] > 0
        ]
        total_active = sum(v["active"] for v in merged.values())
        total_passive = sum(v["passive"] for v in merged.values())
        total_away = sum(v["away"] for v in merged.values())
        total_locked = sum(v["locked"] for v in merged.values())
        awake = total_active + total_passive + total_away
        apps_top = [
            {"app": name, "sec": round(sec, 1)}
            for name, sec in sorted(app_totals.items(), key=lambda kv: kv[1], reverse=True)[:10]
        ]
        return {
            "buckets": buckets,
            "summary": {
                "first_ts": int(min(active_starts).timestamp()) if active_starts else None,
                "last_ts": int(max(active_starts).timestamp()) if active_starts else None,
                "active_sec": round(total_active, 1),
                "passive_sec": round(total_passive, 1),
                "away_sec": round(total_away, 1),
                "locked_sec": round(total_locked, 1),
                "activity_pct": round(total_active / awake * 100.0, 1) if awake > 0 else None,
            },
            "apps_top": apps_top,
        }

    def dlp_attention_stats(self, *, day: str = "") -> List[Dict[str, Any]]:
        """Per-host day rollup: activity + browser focus + usb/messenger files."""
        ensure_app_schema_initialized(self.database_url)
        day_start, day_end = self._day_range(day)
        ts_start, ts_end = int(day_start.timestamp()), int(day_end.timestamp())
        hosts: Dict[str, Dict[str, Any]] = {}

        def entry(name: str) -> Dict[str, Any]:
            return hosts.setdefault(
                str(name or ""),
                {
                    "computer_name": str(name or ""),
                    "active_sec": 0.0,
                    "passive_sec": 0.0,
                    "away_sec": 0.0,
                    "locked_sec": 0.0,
                    "first_ts": None,
                    "last_ts": None,
                    "work_sec": 0.0,
                    "entertainment_sec": 0.0,
                    "browser_idle_sec": 0.0,
                    "usb_files": 0,
                    "usb_bytes": 0,
                    "messenger_files": 0,
                },
            )

        with app_session(database_url=self.database_url) as session:
            dialect = session.connection().dialect.name
            is_postgres = dialect == "postgresql"
            active_cond = AppDlpActivityBucket.active_sec > 0
            for row in session.execute(
                select(
                    AppDlpActivityBucket.computer_name,
                    func.coalesce(func.sum(AppDlpActivityBucket.active_sec), 0),
                    func.coalesce(func.sum(AppDlpActivityBucket.passive_sec), 0),
                    func.coalesce(func.sum(AppDlpActivityBucket.away_sec), 0),
                    func.coalesce(func.sum(AppDlpActivityBucket.locked_sec), 0),
                    func.min(
                        case((active_cond, AppDlpActivityBucket.bucket_start), else_=None)
                    ),
                    func.max(
                        case((active_cond, AppDlpActivityBucket.bucket_start), else_=None)
                    ),
                )
                .where(
                    AppDlpActivityBucket.bucket_start >= day_start,
                    AppDlpActivityBucket.bucket_start < day_end,
                )
                .group_by(AppDlpActivityBucket.computer_name)
            ):
                e = entry(row[0])
                e["active_sec"] = float(row[1] or 0)
                e["passive_sec"] = float(row[2] or 0)
                e["away_sec"] = float(row[3] or 0)
                e["locked_sec"] = float(row[4] or 0)
                e["first_ts"] = (
                    int(_local_aware(row[5]).timestamp()) if row[5] is not None else None
                )
                e["last_ts"] = (
                    int(_local_aware(row[6]).timestamp()) if row[6] is not None else None
                )

            dwell = AppBrowserProbeVisit.dwell_sec
            cat = AppBrowserProbeVisit.category
            for row in session.execute(
                select(
                    AppBrowserProbeVisit.computer_name,
                    func.coalesce(func.sum(case((cat == "work", dwell), else_=0)), 0),
                    func.coalesce(func.sum(case((cat == "entertainment", dwell), else_=0)), 0),
                    func.coalesce(func.sum(AppBrowserProbeVisit.idle_sec), 0),
                )
                .where(
                    _FOCUS_VISIT_COND,
                    AppBrowserProbeVisit.visited_at >= day_start,
                    AppBrowserProbeVisit.visited_at < day_end,
                )
                .group_by(AppBrowserProbeVisit.computer_name)
            ):
                e = entry(row[0])
                e["work_sec"] = float(row[1] or 0)
                e["entertainment_sec"] = float(row[2] or 0)
                e["browser_idle_sec"] = float(row[3] or 0)

            if is_postgres:
                usb_noise = ~func.lower(AppFileLeftEvent.file_name).op("~")(
                    SERVICE_FILE_NAME_SQL_RE
                )
                for row in session.execute(
                    select(
                        AppFileLeftEvent.computer_name,
                        func.coalesce(
                            func.sum(
                                case(
                                    (and_(AppFileLeftEvent.channel == "usb", usb_noise), 1),
                                    else_=0,
                                )
                            ),
                            0,
                        ),
                        func.coalesce(
                            func.sum(
                                case(
                                    (
                                        and_(AppFileLeftEvent.channel == "usb", usb_noise),
                                        AppFileLeftEvent.size,
                                    ),
                                    else_=0,
                                )
                            ),
                            0,
                        ),
                        func.coalesce(
                            func.sum(
                                case(
                                    (AppFileLeftEvent.channel.in_(["telegram", "max"]), 1),
                                    else_=0,
                                )
                            ),
                            0,
                        ),
                    )
                    .where(
                        AppFileLeftEvent.ts >= ts_start,
                        AppFileLeftEvent.ts < ts_end,
                    )
                    .group_by(AppFileLeftEvent.computer_name)
                ):
                    e = entry(row[0])
                    e["usb_files"] = int(row[1] or 0)
                    e["usb_bytes"] = int(row[2] or 0)
                    e["messenger_files"] = int(row[3] or 0)
            else:
                # sqlite has no REGEXP operator — filter temp/service names in Python.
                for row in session.execute(
                    select(
                        AppFileLeftEvent.computer_name,
                        AppFileLeftEvent.channel,
                        AppFileLeftEvent.file_name,
                        AppFileLeftEvent.size,
                    ).where(
                        AppFileLeftEvent.ts >= ts_start,
                        AppFileLeftEvent.ts < ts_end,
                        AppFileLeftEvent.channel.in_(["usb", "telegram", "max"]),
                    )
                ):
                    e = entry(row[0])
                    if row[1] == "usb":
                        if is_service_file_name(row[2] or ""):
                            continue
                        e["usb_files"] += 1
                        e["usb_bytes"] += int(row[3] or 0)
                    else:
                        e["messenger_files"] += 1
        out = []
        for e in hosts.values():
            if not any(
                e[k]
                for k in (
                    "active_sec",
                    "passive_sec",
                    "away_sec",
                    "locked_sec",
                    "work_sec",
                    "entertainment_sec",
                    "browser_idle_sec",
                    "usb_files",
                    "usb_bytes",
                    "messenger_files",
                )
            ):
                continue
            out.append(e)
        out.sort(key=lambda item: item["computer_name"].lower())
        return out

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
        fields = _media_payload_fields("browser_probe_media", file_name, content, content_type)
        with app_session(database_url=self.database_url) as session:
            existing = session.get(AppBrowserProbeMedia, row_id)
            if existing is None:
                session.add(
                    AppBrowserProbeMedia(
                        id=row_id[:512],
                        computer_name=computer_name[:255],
                        file_name=file_name[:512],
                        created_at=now,
                        **fields,
                    )
                )
            else:
                existing.content = fields["content"]
                existing.content_type = fields["content_type"]
                existing.storage_path = fields["storage_path"]
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
            content = row.content if row.content is not None else _media_storage_read(row.storage_path)
            return {
                "computer_name": row.computer_name,
                "file_name": row.file_name,
                "content": bytes(content or b""),
                "content_type": row.content_type or "application/octet-stream",
            }

    @staticmethod
    def _live_screenshot_pairs(
        session: Any, rows: List[AppBrowserProbeVisit]
    ) -> set[tuple[str, str]]:
        pairs = {
            (
                str(row.computer_name or ""),
                str(row.screenshot_file or "").replace("\\", "/").split("/")[-1],
            )
            for row in rows
            if str(row.screenshot_file or "").strip()
        }
        if not pairs:
            return set()
        found = session.execute(
            select(AppBrowserProbeMedia.computer_name, AppBrowserProbeMedia.file_name).where(
                tuple_(
                    AppBrowserProbeMedia.computer_name, AppBrowserProbeMedia.file_name
                ).in_(pairs)
            )
        ).all()
        return {(str(c or ""), str(f or "")) for c, f in found}

    @staticmethod
    def _browser_visit_row(
        row: AppBrowserProbeVisit, shot: str
    ) -> Dict[str, Any]:
        category_display = dlp_classify_visit(domain=row.domain, title=row.title, url=row.url)
        return {
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
            # Stored category is kept as-is; display uses the server classifier so
            # historical 'other' rows are re-labelled without rewriting the table.
            "category_display": category_display,
            "category_meta": dlp_category_meta(category_display),
            "visited_at": row.visited_at.isoformat().replace("+00:00", "Z")
            if row.visited_at
            else None,
            "first_visited_at": row.visited_at.isoformat().replace("+00:00", "Z")
            if row.visited_at
            else None,
            "dwell_sec": row.dwell_sec,
            "dwell_total": row.dwell_sec,
            "idle_sec": row.idle_sec,
            "idle_total": row.idle_sec,
            "count": 1,
            "merged": False,
            "screenshot_file": shot,
            "created_at": int(row.created_at.timestamp()) if row.created_at else None,
            "_visited_at_raw": row.visited_at,
        }

    @staticmethod
    def _merge_visit_rows(rows: List[Dict[str, Any]], gap_seconds: int = 1800) -> List[Dict[str, Any]]:
        """Collapse consecutive same (computer,browser,profile,domain) rows when the
        time gap is <30min. Rows are already ordered visited_at DESC."""
        merged: List[Dict[str, Any]] = []
        for row in rows:
            if merged:
                prev = merged[-1]
                same = (
                    prev["computer_name"] == row["computer_name"]
                    and prev["browser"] == row["browser"]
                    and prev["profile"] == row["profile"]
                    and (prev["domain"] or "") == (row["domain"] or "")
                )
                gap_ok = False
                if same and prev["_visited_at_raw"] and row["_visited_at_raw"]:
                    gap_ok = abs(_epoch(prev["_visited_at_raw"]) - _epoch(row["_visited_at_raw"])) < gap_seconds
                if same and gap_ok:
                    prev["count"] += 1
                    prev["merged"] = True
                    prev["first_visited_at"] = row["visited_at"]
                    prev["_visited_at_raw"] = row["_visited_at_raw"]
                    dwell = row.get("dwell_sec")
                    if dwell is not None:
                        prev["dwell_total"] = (prev.get("dwell_total") or 0) + dwell
                    idle = row.get("idle_sec")
                    if idle is not None:
                        prev["idle_total"] = (prev.get("idle_total") or 0) + idle
                    if not prev["screenshot_file"] and row["screenshot_file"]:
                        prev["screenshot_file"] = row["screenshot_file"]
                    continue
            merged.append(row)
        for row in merged:
            row.pop("_visited_at_raw", None)
        return merged

    def list_browser_visits(
        self,
        *,
        computer_name: str = "",
        category: str = "",
        day: str = "",
        source: str = "",
        q: str = "",
        limit: int = 100,
        offset: int = 0,
        merge: bool = False,
    ) -> List[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        conditions = _browser_visit_conditions(
            computer_name=computer_name,
            category=category,
            day=day,
            source=source,
            q=q,
        )
        stmt = (
            select(AppBrowserProbeVisit)
            .where(*conditions)
            .order_by(
                AppBrowserProbeVisit.visited_at.desc().nullslast(),
                AppBrowserProbeVisit.created_at.desc(),
            )
            .offset(max(0, offset))
            .limit(max(1, min(limit, 500)))
        )
        with app_session(database_url=self.database_url) as session:
            rows = list(session.execute(stmt).scalars().all())
            live_shots = self._live_screenshot_pairs(session, rows)
            out: List[Dict[str, Any]] = []
            for row in rows:
                shot = str(row.screenshot_file or "")
                shot_name = shot.replace("\\", "/").split("/")[-1]
                if shot and (row.computer_name, shot_name) not in live_shots:
                    shot = ""
                out.append(self._browser_visit_row(row, shot))
        if not merge:
            for row in out:
                row.pop("_visited_at_raw", None)
            return out
        return self._merge_visit_rows(out)

    def count_browser_visits(
        self,
        *,
        computer_name: str = "",
        category: str = "",
        day: str = "",
        source: str = "",
        q: str = "",
    ) -> int:
        ensure_app_schema_initialized(self.database_url)
        conditions = _browser_visit_conditions(
            computer_name=computer_name,
            category=category,
            day=day,
            source=source,
            q=q,
        )
        with app_session(database_url=self.database_url) as session:
            total = session.execute(
                select(func.count()).select_from(AppBrowserProbeVisit).where(*conditions)
            ).scalar()
            return int(total or 0)

    def list_browser_hosts(self) -> List[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        stmt = (
            select(
                AppBrowserProbeVisit.computer_name.label("computer_name"),
                func.max(AppBrowserProbeVisit.windows_user).label("windows_user"),
                func.count().label("visits"),
                func.coalesce(func.sum(case((_FOCUS_VISIT_COND, 1), else_=0)), 0).label(
                    "focus_visits"
                ),
                func.coalesce(
                    func.sum(
                        case((AppBrowserProbeVisit.screenshot_file != "", 1), else_=0)
                    ),
                    0,
                ).label("with_screenshot"),
                func.max(AppBrowserProbeVisit.visited_at).label("last_visited_at"),
            )
            .group_by(AppBrowserProbeVisit.computer_name)
            .order_by(func.max(AppBrowserProbeVisit.visited_at).desc().nullslast())
        )
        with app_session(database_url=self.database_url) as session:
            out: List[Dict[str, Any]] = []
            for row in session.execute(stmt):
                last = row.last_visited_at
                out.append(
                    {
                        "computer_name": row.computer_name,
                        "windows_user": row.windows_user or "",
                        "visits": int(row.visits or 0),
                        "focus_visits": int(row.focus_visits or 0),
                        "with_screenshot": int(row.with_screenshot or 0),
                        "last_visited_at": last.isoformat().replace("+00:00", "Z")
                        if last
                        else None,
                        "last_ts": int(last.timestamp()) if last else 0,
                    }
                )
            return out

    def list_browser_days(
        self, *, computer_name: str, source: str = ""
    ) -> List[Dict[str, Any]]:
        ensure_app_schema_initialized(self.database_url)
        host = str(computer_name or "").strip()
        if not host:
            return []
        day_col = func.date(AppBrowserProbeVisit.visited_at)
        cat = AppBrowserProbeVisit.category
        other_cond = ~cat.in_(["work", "entertainment"])
        dwell = AppBrowserProbeVisit.dwell_sec
        conditions = [
            AppBrowserProbeVisit.computer_name == host,
            AppBrowserProbeVisit.visited_at.isnot(None),
        ]
        src = str(source or "").strip().lower()
        if src == "focus":
            conditions.append(_FOCUS_VISIT_COND)
        elif src == "history":
            conditions.append(AppBrowserProbeVisit.profile != "focus")
        stmt = (
            select(
                day_col.label("day"),
                func.count().label("visits"),
                func.coalesce(func.sum(case((cat == "work", 1), else_=0)), 0).label("work"),
                func.coalesce(func.sum(case((cat == "entertainment", 1), else_=0)), 0).label(
                    "entertainment"
                ),
                func.coalesce(func.sum(case((other_cond, 1), else_=0)), 0).label("other"),
                func.coalesce(func.sum(case((cat == "work", dwell), else_=0)), 0).label(
                    "work_dwell"
                ),
                func.coalesce(
                    func.sum(case((cat == "entertainment", dwell), else_=0)), 0
                ).label("entertainment_dwell"),
                func.coalesce(func.sum(case((other_cond, dwell), else_=0)), 0).label(
                    "other_dwell"
                ),
                func.coalesce(func.sum(AppBrowserProbeVisit.idle_sec), 0).label(
                    "idle_dwell"
                ),
            )
            .where(*conditions)
            .group_by(day_col)
            .order_by(day_col.desc())
        )
        with app_session(database_url=self.database_url) as session:
            out: List[Dict[str, Any]] = []
            for row in session.execute(stmt):
                day_value = row.day
                key = (
                    day_value.isoformat()
                    if hasattr(day_value, "isoformat")
                    else str(day_value or "")
                )
                out.append(
                    {
                        "day": key,
                        "visits": int(row.visits or 0),
                        "work": int(row.work or 0),
                        "entertainment": int(row.entertainment or 0),
                        "other": int(row.other or 0),
                        "work_dwell": float(row.work_dwell or 0),
                        "entertainment_dwell": float(row.entertainment_dwell or 0),
                        "other_dwell": float(row.other_dwell or 0),
                        "idle_dwell": float(row.idle_dwell or 0),
                    }
                )
            return out

    def list_dlp_host_stats(self) -> List[Dict[str, Any]]:
        """Per-computer aggregates over file_left + browser visits + inventory join.

        Returns raw stats; the service layer resolves branch/full-name via AD context.
        """
        ensure_app_schema_initialized(self.database_url)
        channel = AppFileLeftEvent.channel
        with app_session(database_url=self.database_url) as session:
            noise_cond = _service_file_condition(session.connection().dialect.name)
            file_stmt = (
                select(
                    AppFileLeftEvent.computer_name.label("computer_name"),
                    func.max(AppFileLeftEvent.windows_user).label("windows_user"),
                    func.count().label("file_events"),
                    func.coalesce(func.sum(case((noise_cond, 1), else_=0)), 0).label(
                        "service_files"
                    ),
                    func.coalesce(
                        func.sum(case((channel == "usb", 1), else_=0)), 0
                    ).label("usb_events"),
                    func.coalesce(
                        func.sum(case((channel == "telegram", 1), else_=0)), 0
                    ).label("telegram_events"),
                    func.coalesce(
                        func.sum(case((channel == "max", 1), else_=0)), 0
                    ).label("max_events"),
                    func.coalesce(
                        func.sum(case((channel == "deleted", 1), else_=0)), 0
                    ).label("deleted_events"),
                    func.max(AppFileLeftEvent.ts).label("last_file_ts"),
                )
                .group_by(AppFileLeftEvent.computer_name)
            )
            # The hosts page needs recency, not lifetime totals: a full 576k-row
            # Seq Scan ran on every cold open. `visits` now means "last 30 days".
            visits_cutoff = _utcnow() - timedelta(days=30)
            visit_stmt = (
                select(
                    AppBrowserProbeVisit.computer_name.label("computer_name"),
                    func.count().label("visits"),
                    func.max(AppBrowserProbeVisit.windows_user).label("windows_user"),
                    func.max(AppBrowserProbeVisit.visited_at).label("last_visited_at"),
                )
                .where(AppBrowserProbeVisit.visited_at >= visits_cutoff)
                .group_by(AppBrowserProbeVisit.computer_name)
            )
            hosts: Dict[str, Dict[str, Any]] = {}
            for row in session.execute(file_stmt):
                hosts[str(row.computer_name or "")] = {
                    "computer_name": row.computer_name,
                    "windows_user": row.windows_user or "",
                    "file_events": int(row.file_events or 0),
                    "service_files": int(row.service_files or 0),
                    "usb_events": int(row.usb_events or 0),
                    "telegram_events": int(row.telegram_events or 0),
                    "max_events": int(row.max_events or 0),
                    "deleted_events": int(row.deleted_events or 0),
                    "visits": 0,
                    "visits_window_days": 30,
                    "last_ts": int(row.last_file_ts or 0),
                }
            for row in session.execute(visit_stmt):
                name = str(row.computer_name or "")
                entry = hosts.setdefault(
                    name,
                    {
                        "computer_name": row.computer_name,
                        "windows_user": "",
                        "file_events": 0,
                        "service_files": 0,
                        "usb_events": 0,
                        "telegram_events": 0,
                        "max_events": 0,
                        "deleted_events": 0,
                        "visits": 0,
                        "visits_window_days": 30,
                        "last_ts": 0,
                    },
                )
                entry["visits"] = int(row.visits or 0)
                entry["visits_window_days"] = 30
                if not entry["windows_user"] and row.windows_user:
                    entry["windows_user"] = row.windows_user
                last_at = row.last_visited_at
                if last_at is not None:
                    entry["last_ts"] = max(entry["last_ts"], int(_epoch(last_at)))
                entry["last_visited_at"] = (
                    last_at.isoformat().replace("+00:00", "Z") if last_at else None
                )

            names = [name for name in hosts if name]
            inv_rows: Dict[str, tuple] = {}
            ctx_rows: Dict[str, tuple] = {}
            for chunk in _chunked(sorted(names)):
                upper_chunk = [n.upper() for n in chunk]
                for hostname, user_login, user_full_name, ip_primary in session.execute(
                    select(
                        AppInventoryHost.hostname,
                        AppInventoryHost.user_login,
                        AppInventoryHost.user_full_name,
                        AppInventoryHost.ip_primary,
                    ).where(
                        func.upper(AppInventoryHost.hostname).in_(upper_chunk)
                    )
                ):
                    key = str(hostname or "").upper()
                    login_s = str(user_login or "")
                    # A host may have several inventory rows (local + domain users):
                    # prefer the DOMAIN\login row — it is the one that maps to a branch.
                    prev = inv_rows.get(key)
                    if prev is None or ("\\" not in prev[0] and "\\" in login_s):
                        inv_rows[key] = (login_s, str(user_full_name or ""), str(ip_primary or ""))
                for hostname, branch_no, branch_name in session.execute(
                    select(
                        AppInventoryHostSqlContext.hostname,
                        AppInventoryHostSqlContext.branch_no,
                        AppInventoryHostSqlContext.branch_name,
                    ).where(
                        func.upper(AppInventoryHostSqlContext.hostname).in_(upper_chunk)
                    )
                ):
                    key = str(hostname or "").upper()
                    prev = ctx_rows.get(key)
                    # Prefer a row that actually carries a branch binding.
                    if prev is None or (not prev[1] and branch_name):
                        ctx_rows[key] = (branch_no, branch_name)
            for name, entry in hosts.items():
                login, full_name, ip_primary = inv_rows.get(name.upper(), ("", "", ""))
                entry["user_login"] = login
                entry["user_full_name"] = full_name
                entry["ip_primary"] = ip_primary
                sql_no, sql_name = ctx_rows.get(name.upper(), (None, None))
                entry["sql_branch_no"] = sql_no
                entry["sql_branch_name"] = sql_name
            return sorted(
                hosts.values(), key=lambda item: int(item.get("last_ts") or 0), reverse=True
            )

    def list_today_category_hosts(self, category: str) -> set:
        """Hosts that recorded a visit with the stored ``category`` today."""
        cat = str(category or "").strip()
        if not cat:
            return set()
        ensure_app_schema_initialized(self.database_url)
        start = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
        with app_session(database_url=self.database_url) as session:
            return set(
                session.execute(
                    select(AppBrowserProbeVisit.computer_name)
                    .where(
                        AppBrowserProbeVisit.visited_at >= start,
                        AppBrowserProbeVisit.category == cat,
                    )
                    .distinct()
                ).scalars()
            )

    def dlp_summary(self) -> Dict[str, Any]:
        """Current-day counters + category breakdown (display categories)."""
        ensure_app_schema_initialized(self.database_url)
        start = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
        start_ts = int(start.timestamp())
        with app_session(database_url=self.database_url) as session:
            file_hosts = set(
                session.execute(
                    select(AppFileLeftEvent.computer_name).distinct()
                ).scalars()
            )
            visit_hosts = set(
                session.execute(
                    select(AppBrowserProbeVisit.computer_name).distinct()
                ).scalars()
            )
            today_file_hosts = set(
                session.execute(
                    select(AppFileLeftEvent.computer_name)
                    .where(AppFileLeftEvent.ts >= start_ts)
                    .distinct()
                ).scalars()
            )
            today_visit_hosts = set(
                session.execute(
                    select(AppBrowserProbeVisit.computer_name)
                    .where(AppBrowserProbeVisit.visited_at >= start)
                    .distinct()
                ).scalars()
            )
            file_events_today = int(
                session.execute(
                    select(func.count())
                    .select_from(AppFileLeftEvent)
                    .where(AppFileLeftEvent.ts >= start_ts)
                ).scalar()
                or 0
            )
            category_rows = session.execute(
                select(
                    AppBrowserProbeVisit.domain,
                    AppBrowserProbeVisit.title,
                    func.max(AppBrowserProbeVisit.url),
                    func.count(),
                )
                .where(AppBrowserProbeVisit.visited_at >= start)
                .group_by(AppBrowserProbeVisit.domain, AppBrowserProbeVisit.title)
            ).all()
        categories: Dict[str, int] = {}
        visits_today = 0
        for domain, title, url, cnt in category_rows:
            cat = dlp_classify_visit(domain=domain, title=title, url=url or "")
            categories[cat] = categories.get(cat, 0) + int(cnt or 0)
            visits_today += int(cnt or 0)
        return {
            "hosts_total": len(file_hosts | visit_hosts),
            "hosts_active_today": len(today_file_hosts | today_visit_hosts),
            "visits_today": visits_today,
            "file_events_today": file_events_today,
            "categories_today": categories,
        }

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
        fields = _media_payload_fields("max_probe_media", file_name, content, content_type)
        with app_session(database_url=self.database_url) as session:
            existing = session.get(AppMaxProbeMedia, row_id)
            if existing is None:
                session.add(
                    AppMaxProbeMedia(
                        id=row_id[:512],
                        computer_name=computer_name[:255],
                        file_name=file_name[:512],
                        created_at=now,
                        **fields,
                    )
                )
            else:
                existing.content = fields["content"]
                existing.content_type = fields["content_type"]
                existing.storage_path = fields["storage_path"]
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
            content = row.content if row.content is not None else _media_storage_read(row.storage_path)
            return {
                "computer_name": row.computer_name,
                "file_name": row.file_name,
                "content": bytes(content or b""),
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
