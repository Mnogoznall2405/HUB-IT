from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


class EgressEventStore:
    def __init__(self, *, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn

    def _initialize(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS file_left_events (
                    id TEXT PRIMARY KEY,
                    ts INTEGER NOT NULL,
                    channel TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    dest_path TEXT NOT NULL,
                    src_path TEXT NOT NULL DEFAULT '',
                    size INTEGER,
                    sha256 TEXT NOT NULL DEFAULT '',
                    windows_user TEXT NOT NULL DEFAULT '',
                    computer_name TEXT NOT NULL DEFAULT '',
                    details_json TEXT NOT NULL DEFAULT '{}',
                    created_at INTEGER NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_file_left_ts ON file_left_events(ts DESC)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_file_left_host ON file_left_events(computer_name, ts DESC)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS telegram_probe_chats (
                    id TEXT PRIMARY KEY,
                    computer_name TEXT NOT NULL,
                    windows_user TEXT NOT NULL DEFAULT '',
                    chat_id TEXT NOT NULL,
                    chat_name TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    messages_json TEXT NOT NULL DEFAULT '[]',
                    UNIQUE(computer_name, chat_id)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS telegram_probe_media (
                    id TEXT PRIMARY KEY,
                    computer_name TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    content BLOB,
                    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                    created_at INTEGER NOT NULL,
                    UNIQUE(computer_name, file_name)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS telegram_probe_reports (
                    computer_name TEXT PRIMARY KEY,
                    windows_user TEXT NOT NULL DEFAULT '',
                    html TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS browser_probe_visits (
                    id TEXT PRIMARY KEY,
                    computer_name TEXT NOT NULL,
                    windows_user TEXT NOT NULL DEFAULT '',
                    browser TEXT NOT NULL DEFAULT '',
                    profile TEXT NOT NULL DEFAULT '',
                    visit_id TEXT NOT NULL DEFAULT '',
                    url TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL DEFAULT '',
                    domain TEXT NOT NULL DEFAULT '',
                    category TEXT NOT NULL DEFAULT 'other',
                    visited_at TEXT,
                    dwell_sec REAL,
                    screenshot_file TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    UNIQUE(computer_name, browser, profile, visit_id)
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_browser_visits_host
                ON browser_probe_visits(computer_name, visited_at DESC)
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS browser_probe_media (
                    id TEXT PRIMARY KEY,
                    computer_name TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    content BLOB,
                    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                    created_at INTEGER NOT NULL,
                    UNIQUE(computer_name, file_name)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS max_probe_chats (
                    id TEXT PRIMARY KEY,
                    computer_name TEXT NOT NULL,
                    windows_user TEXT NOT NULL DEFAULT '',
                    chat_id TEXT NOT NULL,
                    chat_name TEXT NOT NULL DEFAULT '',
                    updated_at INTEGER NOT NULL,
                    messages_json TEXT NOT NULL DEFAULT '[]',
                    UNIQUE(computer_name, chat_id)
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_max_probe_chats_updated
                ON max_probe_chats(updated_at DESC)
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS max_probe_media (
                    id TEXT PRIMARY KEY,
                    computer_name TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    content BLOB,
                    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                    created_at INTEGER NOT NULL,
                    UNIQUE(computer_name, file_name)
                )
                """
            )
            conn.commit()

    def ingest_file_left(self, events: List[Dict[str, Any]]) -> int:
        now = int(time.time())
        inserted = 0
        with self._lock, self._connect() as conn:
            for event in events:
                if not isinstance(event, dict):
                    continue
                event_id = str(event.get("event_id") or uuid.uuid4().hex)
                try:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO file_left_events (
                            id, ts, channel, file_name, dest_path, src_path, size, sha256,
                            windows_user, computer_name, details_json, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            event_id,
                            int(event.get("ts") or now),
                            str(event.get("channel") or "unknown"),
                            str(event.get("file_name") or ""),
                            str(event.get("dest_path") or ""),
                            str(event.get("src_path") or ""),
                            event.get("size"),
                            str(event.get("sha256") or ""),
                            str(event.get("windows_user") or ""),
                            str(event.get("computer_name") or ""),
                            json.dumps(event.get("details") or {}, ensure_ascii=False),
                            now,
                        ),
                    )
                    inserted += 1
                except Exception:
                    continue
            conn.commit()
        return inserted

    def list_file_left(
        self,
        *,
        computer_name: str = "",
        channel: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        clauses = []
        params: List[Any] = []
        if computer_name:
            clauses.append("computer_name = ?")
            params.append(computer_name)
        if channel:
            clauses.append("channel = ?")
            params.append(channel)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"""
            SELECT id, ts, channel, file_name, dest_path, src_path, size, sha256,
                   windows_user, computer_name, details_json, created_at
            FROM file_left_events
            {where}
            ORDER BY ts DESC
            LIMIT ? OFFSET ?
        """
        params.extend([max(1, min(limit, 500)), max(0, offset)])
        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        out: List[Dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            try:
                item["details"] = json.loads(item.pop("details_json") or "{}")
            except Exception:
                item["details"] = {}
            out.append(item)
        return out

    def upsert_telegram_chats(
        self,
        *,
        computer_name: str,
        windows_user: str,
        chats: List[Dict[str, Any]],
    ) -> int:
        now = int(time.time())
        count = 0
        with self._lock, self._connect() as conn:
            for chat in chats:
                chat_id = str(chat.get("chat_id") or "")
                if not chat_id:
                    continue
                row_id = f"{computer_name}:{chat_id}"
                existing = conn.execute(
                    "SELECT messages_json FROM telegram_probe_chats WHERE id = ?",
                    (row_id,),
                ).fetchone()
                messages = list(chat.get("messages") or [])
                if existing:
                    try:
                        prev = json.loads(existing["messages_json"] or "[]")
                    except Exception:
                        prev = []
                    if isinstance(prev, list):
                        messages = prev + messages
                        # cap
                        messages = messages[-5000:]
                conn.execute(
                    """
                    INSERT INTO telegram_probe_chats (
                        id, computer_name, windows_user, chat_id, chat_name, updated_at, messages_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        windows_user=excluded.windows_user,
                        chat_name=excluded.chat_name,
                        updated_at=excluded.updated_at,
                        messages_json=excluded.messages_json
                    """,
                    (
                        row_id,
                        computer_name,
                        windows_user,
                        chat_id,
                        str(chat.get("chat_name") or chat_id),
                        now,
                        json.dumps(messages, ensure_ascii=False),
                    ),
                )
                count += 1
            conn.commit()
        return count

    def save_report(self, *, computer_name: str, windows_user: str, html: str) -> None:
        now = int(time.time())
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO telegram_probe_reports (computer_name, windows_user, html, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(computer_name) DO UPDATE SET
                    windows_user=excluded.windows_user,
                    html=excluded.html,
                    updated_at=excluded.updated_at
                """,
                (computer_name, windows_user, html, now),
            )
            conn.commit()

    def save_media(
        self,
        *,
        computer_name: str,
        file_name: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> None:
        now = int(time.time())
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO telegram_probe_media (id, computer_name, file_name, content, content_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(computer_name, file_name) DO UPDATE SET
                    content=excluded.content,
                    content_type=excluded.content_type,
                    created_at=excluded.created_at
                """,
                (f"{computer_name}:{file_name}", computer_name, file_name, content, content_type, now),
            )
            conn.commit()

    def list_telegram_chats(self, *, computer_name: str = "", limit: int = 100) -> List[Dict[str, Any]]:
        params: List[Any] = []
        where = ""
        if computer_name:
            where = "WHERE computer_name = ?"
            params.append(computer_name)
        sql = f"""
            SELECT computer_name, windows_user, chat_id, chat_name, updated_at, messages_json
            FROM telegram_probe_chats
            {where}
            ORDER BY updated_at DESC
            LIMIT ?
        """
        params.append(max(1, min(limit, 500)))
        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            try:
                item["messages"] = json.loads(item.pop("messages_json") or "[]")
            except Exception:
                item["messages"] = []
            out.append(item)
        return out

    def get_report(self, computer_name: str) -> Optional[Dict[str, Any]]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT computer_name, windows_user, html, updated_at FROM telegram_probe_reports WHERE computer_name = ?",
                (computer_name,),
            ).fetchone()
        return dict(row) if row else None

    def ingest_browser_visits(
        self,
        *,
        computer_name: str,
        windows_user: str,
        visits: List[Dict[str, Any]],
        focus_events: Optional[List[Dict[str, Any]]] = None,
    ) -> int:
        now = int(time.time())
        host = str(computer_name or "").strip() or "unknown"
        user = str(windows_user or "").strip()
        count = 0
        with self._lock, self._connect() as conn:
            for visit in visits or []:
                if not isinstance(visit, dict):
                    continue
                browser = str(visit.get("browser") or "").strip().lower()
                profile = str(visit.get("profile") or "Default").strip() or "Default"
                visit_id = str(visit.get("visit_id") or "").strip()
                if not browser or not visit_id:
                    continue
                row_id = f"{host}:{browser}:{profile}:{visit_id}"
                dwell = visit.get("dwell_sec")
                try:
                    dwell_f = float(dwell) if dwell is not None else None
                except (TypeError, ValueError):
                    dwell_f = None
                screenshot_file = str(visit.get("screenshot_file") or "").replace("\\", "/").split("/")[-1]
                conn.execute(
                    """
                    INSERT INTO browser_probe_visits (
                        id, computer_name, windows_user, browser, profile, visit_id,
                        url, title, domain, category, visited_at, dwell_sec, screenshot_file, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(computer_name, browser, profile, visit_id) DO UPDATE SET
                        windows_user=excluded.windows_user,
                        dwell_sec=COALESCE(excluded.dwell_sec, browser_probe_visits.dwell_sec),
                        screenshot_file=CASE
                            WHEN excluded.screenshot_file != '' THEN excluded.screenshot_file
                            ELSE browser_probe_visits.screenshot_file
                        END
                    """,
                    (
                        row_id,
                        host,
                        user,
                        browser,
                        profile,
                        visit_id,
                        str(visit.get("url") or ""),
                        str(visit.get("title") or ""),
                        str(visit.get("domain") or ""),
                        str(visit.get("category") or "other"),
                        str(visit.get("visited_at") or "") or None,
                        dwell_f,
                        screenshot_file,
                        now,
                    ),
                )
                count += 1
            for event in focus_events or []:
                if not isinstance(event, dict):
                    continue
                browser = str(event.get("browser") or "").strip().lower()
                title = str(event.get("title") or "").strip()
                url = str(event.get("url") or "").strip()
                if not browser or (not title and not url):
                    continue
                if not title:
                    title = url
                try:
                    dwell_f = float(event.get("dwell_sec") or 0)
                except (TypeError, ValueError):
                    dwell_f = 0.0
                screenshot_file = str(event.get("screenshot_file") or "").replace("\\", "/").split("/")[-1]
                domain = str(event.get("domain") or "").strip()
                category = str(event.get("category") or "other").strip() or "other"
                ended = event.get("ended_at")
                try:
                    ended_ts = float(ended) if ended is not None else time.time()
                except (TypeError, ValueError):
                    ended_ts = time.time()
                visited_at = datetime.fromtimestamp(ended_ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")

                if url:
                    hist = conn.execute(
                        """
                        SELECT id, dwell_sec, screenshot_file FROM browser_probe_visits
                        WHERE computer_name = ? AND browser = ? AND url = ? AND profile != 'focus'
                        ORDER BY visited_at DESC
                        LIMIT 1
                        """,
                        (host, browser, url),
                    ).fetchone()
                    if hist:
                        prev = float(hist["dwell_sec"] or 0)
                        conn.execute(
                            """
                            UPDATE browser_probe_visits
                            SET dwell_sec = ?, screenshot_file = CASE
                                WHEN ? != '' AND screenshot_file = '' THEN ?
                                ELSE screenshot_file
                            END
                            WHERE id = ?
                            """,
                            (max(prev, dwell_f), screenshot_file, screenshot_file, hist["id"]),
                        )

                stable_src = (url or title).encode("utf-8", errors="ignore")
                stable_hash = hashlib.sha1(stable_src).hexdigest()[:16]
                synth_id = f"focus:{stable_hash}"
                row_id = f"{host}:{browser}:focus:{synth_id}"
                existing_focus = conn.execute(
                    "SELECT id, dwell_sec FROM browser_probe_visits WHERE id = ?",
                    (row_id,),
                ).fetchone()
                if existing_focus:
                    prev = float(existing_focus["dwell_sec"] or 0)
                    conn.execute(
                        """
                        UPDATE browser_probe_visits
                        SET dwell_sec = ?, visited_at = ?, title = ?, url = ?,
                            domain = CASE WHEN ? != '' THEN ? ELSE domain END,
                            category = CASE WHEN ? != 'other' AND category = 'other' THEN ? ELSE category END,
                            screenshot_file = CASE WHEN ? != '' THEN ? ELSE screenshot_file END,
                            windows_user = CASE WHEN ? != '' THEN ? ELSE windows_user END
                        WHERE id = ?
                        """,
                        (
                            prev + dwell_f,
                            visited_at,
                            title,
                            url,
                            domain,
                            domain,
                            category,
                            category,
                            screenshot_file,
                            screenshot_file,
                            user,
                            user,
                            row_id,
                        ),
                    )
                else:
                    conn.execute(
                        """
                        INSERT INTO browser_probe_visits (
                            id, computer_name, windows_user, browser, profile, visit_id,
                            url, title, domain, category, visited_at, dwell_sec, screenshot_file, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            row_id,
                            host,
                            user,
                            browser,
                            "focus",
                            synth_id,
                            url,
                            title,
                            domain,
                            category,
                            visited_at,
                            dwell_f,
                            screenshot_file,
                            now,
                        ),
                    )
                count += 1
            conn.commit()
        return count

    def save_browser_media(
        self,
        *,
        computer_name: str,
        file_name: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> None:
        now = int(time.time())
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO browser_probe_media (id, computer_name, file_name, content, content_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(computer_name, file_name) DO UPDATE SET
                    content=excluded.content,
                    content_type=excluded.content_type,
                    created_at=excluded.created_at
                """,
                (f"{computer_name}:{file_name}", computer_name, file_name, content, content_type, now),
            )
            conn.commit()

    def get_browser_media(self, *, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT computer_name, file_name, content, content_type
                FROM browser_probe_media
                WHERE computer_name = ? AND file_name = ?
                """,
                (computer_name, file_name),
            ).fetchone()
        if not row:
            return None
        return {
            "computer_name": row["computer_name"],
            "file_name": row["file_name"],
            "content": bytes(row["content"] or b""),
            "content_type": row["content_type"] or "application/octet-stream",
        }

    def list_browser_visits(
        self,
        *,
        computer_name: str = "",
        category: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        clauses: List[str] = []
        params: List[Any] = []
        if computer_name:
            clauses.append("computer_name = ?")
            params.append(computer_name)
        if category:
            clauses.append("category = ?")
            params.append(category)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"""
            SELECT id, computer_name, windows_user, browser, profile, visit_id,
                   url, title, domain, category, visited_at, dwell_sec, screenshot_file, created_at
            FROM browser_probe_visits
            {where}
            ORDER BY visited_at DESC, created_at DESC
            LIMIT ? OFFSET ?
        """
        params.extend([max(1, min(limit, 500)), max(0, offset)])
        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _reorder_same_capture_by_bbox(messages: List[Any]) -> List[Any]:
        """Top→bottom by bbox Y within the same recorded_at capture."""
        if len(messages) < 2:
            return messages

        def bbox_key(msg: Dict[str, Any]) -> tuple[int, int] | None:
            bbox = msg.get("bbox")
            if not isinstance(bbox, (list, tuple)) or len(bbox) < 2:
                return None
            try:
                return (int(bbox[1]), int(bbox[0]))
            except Exception:
                return None

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
            keyed = [(bbox_key(m), i, m) for i, m in chunk]
            if all(k is not None for k, _, _ in keyed):
                keyed.sort(key=lambda row: (row[0], row[1]))  # type: ignore[arg-type, return-value]
                out.extend(m for _, _, m in keyed)
            else:
                out.extend(m for _, m in chunk)
        return out

    @staticmethod
    def _unpack_max_blob(raw: str) -> tuple:
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

    @staticmethod
    def _pack_max_blob(messages: List[Any], screenshots: List[str]) -> str:
        return json.dumps(
            {
                "messages": messages if isinstance(messages, list) else [],
                "screenshots": [str(x) for x in (screenshots or []) if str(x).strip()][-50:],
            },
            ensure_ascii=False,
        )

    def upsert_max_chats(
        self,
        *,
        computer_name: str,
        windows_user: str,
        chats: List[Dict[str, Any]],
    ) -> int:
        now = int(time.time())
        count = 0
        with self._lock, self._connect() as conn:
            for chat in chats:
                if not isinstance(chat, dict):
                    continue
                chat_id = str(chat.get("chat_id") or "").strip()
                if not chat_id:
                    continue
                row_id = f"{computer_name}:{chat_id}"
                incoming = list(chat.get("messages") or [])
                shots = [
                    str(x).replace("\\", "/").strip()
                    for x in (chat.get("screenshots") or [])
                    if str(x).strip()
                ]
                for msg in incoming:
                    if isinstance(msg, dict) and msg.get("screenshot_path"):
                        path = str(msg.get("screenshot_path") or "").replace("\\", "/").strip()
                        if path and path not in shots:
                            shots.append(path)
                existing = conn.execute(
                    "SELECT messages_json, chat_name FROM max_probe_chats WHERE id = ?",
                    (row_id,),
                ).fetchone()
                prev_messages: List[Any] = []
                prev_shots: List[str] = []
                prev_name = ""
                if existing:
                    prev_messages, prev_shots = self._unpack_max_blob(existing["messages_json"] or "[]")
                    prev_name = str(existing["chat_name"] or "")
                # append + dedupe by msg_key; normalize same-capture MAX order by bbox Y
                merged: List[Any] = []
                seen: set = set()
                for msg in list(prev_messages) + list(incoming):
                    if not isinstance(msg, dict):
                        continue
                    key = str(msg.get("msg_key") or "").strip().lower()
                    if not key:
                        key = "|".join(
                            [
                                str(msg.get("direction") or "").strip().lower(),
                                str(msg.get("time") or "").strip().lower(),
                                str(msg.get("text") or msg.get("media") or "").strip().lower(),
                            ]
                        )
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    merged.append(msg)
                merged = self._reorder_same_capture_by_bbox(merged)[-5000:]
                for item in prev_shots:
                    if item and item not in shots:
                        shots.append(item)
                shots = shots[-50:]
                incoming_name = str(chat.get("chat_name") or "").strip()
                cid = chat_id

                def _human(name: str) -> bool:
                    text = str(name or "").strip()
                    if not text or text == cid:
                        return False
                    if text.startswith("[") or text.startswith("{"):
                        return False
                    if len(text) in {8, 10, 16} and all(c in "0123456789abcdefABCDEF" for c in text):
                        return False
                    return True

                if _human(incoming_name):
                    chat_name = incoming_name
                elif _human(prev_name):
                    chat_name = prev_name
                else:
                    chat_name = incoming_name or prev_name or chat_id
                conn.execute(
                    """
                    INSERT INTO max_probe_chats (
                        id, computer_name, windows_user, chat_id, chat_name, updated_at, messages_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        windows_user=excluded.windows_user,
                        chat_name=excluded.chat_name,
                        updated_at=excluded.updated_at,
                        messages_json=excluded.messages_json
                    """,
                    (
                        row_id,
                        computer_name,
                        windows_user,
                        chat_id,
                        chat_name[:512],
                        now,
                        self._pack_max_blob(merged, shots),
                    ),
                )
                count += 1
            conn.commit()
        return count

    def save_max_media(
        self,
        *,
        computer_name: str,
        file_name: str,
        content: bytes,
        content_type: str = "application/octet-stream",
    ) -> None:
        now = int(time.time())
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO max_probe_media (id, computer_name, file_name, content, content_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(computer_name, file_name) DO UPDATE SET
                    content=excluded.content,
                    content_type=excluded.content_type,
                    created_at=excluded.created_at
                """,
                (f"{computer_name}:{file_name}", computer_name, file_name, content, content_type, now),
            )
            conn.commit()

    def get_max_media(self, *, computer_name: str, file_name: str) -> Optional[Dict[str, Any]]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT computer_name, file_name, content, content_type
                FROM max_probe_media
                WHERE computer_name = ? AND file_name = ?
                """,
                (computer_name, file_name),
            ).fetchone()
        if not row:
            return None
        return {
            "computer_name": row["computer_name"],
            "file_name": row["file_name"],
            "content": bytes(row["content"] or b""),
            "content_type": row["content_type"] or "application/octet-stream",
        }

    def list_max_chats(self, *, computer_name: str = "", limit: int = 100) -> List[Dict[str, Any]]:
        params: List[Any] = []
        where = ""
        if computer_name:
            where = "WHERE computer_name = ?"
            params.append(computer_name)
        sql = f"""
            SELECT computer_name, windows_user, chat_id, chat_name, updated_at, messages_json
            FROM max_probe_chats
            {where}
            ORDER BY updated_at DESC
            LIMIT ?
        """
        params.append(max(1, min(limit, 500)))
        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        out = []
        for row in rows:
            item = dict(row)
            messages, screenshots = self._unpack_max_blob(item.pop("messages_json") or "[]")
            item["messages"] = messages
            item["screenshots"] = screenshots
            out.append(item)
        return out
