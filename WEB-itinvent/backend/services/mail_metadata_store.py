from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, ContextManager

from backend.services.mail_reference_codec import make_scoped_storage_key, split_scoped_storage_key

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


class MailMetadataStore:
    def __init__(
        self,
        *,
        lock: Any,
        connect: Callable[[], ContextManager[Any]],
        log_table: str,
        log_retention_days_getter: Callable[[], int],
        restore_hints_table: str,
        draft_context_table: str,
        folder_favorites_table: str,
        visible_custom_folders_table: str,
        user_preferences_table: str,
        standard_folders: set[str],
        default_preferences: dict[str, Any],
    ) -> None:
        self._lock = lock
        self._connect = connect
        self._log_table = log_table
        self._log_retention_days_getter = log_retention_days_getter
        self._restore_hints_table = restore_hints_table
        self._draft_context_table = draft_context_table
        self._folder_favorites_table = folder_favorites_table
        self._visible_custom_folders_table = visible_custom_folders_table
        self._user_preferences_table = user_preferences_table
        self._standard_folders = set(standard_folders or set())
        self._default_preferences = dict(default_preferences or {})
        self._last_log_cleanup_at: datetime | None = None

    def _scoped_key(self, *, mailbox_id: str | None = None, value: Any) -> str:
        return make_scoped_storage_key(
            mailbox_id=mailbox_id,
            value=_normalize_text(value),
        )

    def set_restore_hint(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        trash_exchange_id: str,
        restore_folder: str,
        source_exchange_id: str | None = None,
    ) -> None:
        scoped_trash_exchange_id = self._scoped_key(mailbox_id=mailbox_id, value=trash_exchange_id)
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self._restore_hints_table}
                (user_id, trash_exchange_id, restore_folder, source_exchange_id, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, trash_exchange_id) DO UPDATE SET
                    restore_folder = excluded.restore_folder,
                    source_exchange_id = excluded.source_exchange_id,
                    created_at = excluded.created_at
                """,
                (
                    int(user_id),
                    scoped_trash_exchange_id,
                    _normalize_text(restore_folder, "inbox"),
                    _normalize_text(source_exchange_id) or None,
                    _utc_now_iso(),
                ),
            )
            conn.commit()

    def get_restore_hint(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        trash_exchange_id: str,
    ) -> dict[str, Any] | None:
        row = self._get_by_scoped_or_legacy_key(
            table=self._restore_hints_table,
            columns="restore_folder, source_exchange_id, created_at",
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            key_column="trash_exchange_id",
            key_value=trash_exchange_id,
        )
        if row is None:
            return None
        return {
            "restore_folder": _normalize_text(row["restore_folder"], "inbox"),
            "source_exchange_id": _normalize_text(row["source_exchange_id"]) or None,
            "created_at": _normalize_text(row["created_at"]) or None,
        }

    def delete_restore_hint(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        trash_exchange_id: str,
    ) -> None:
        scoped_trash_exchange_id = self._scoped_key(mailbox_id=mailbox_id, value=trash_exchange_id)
        with self._lock, self._connect() as conn:
            conn.execute(
                f"DELETE FROM {self._restore_hints_table} WHERE user_id = ? AND trash_exchange_id IN (?, ?)",
                (int(user_id), scoped_trash_exchange_id, _normalize_text(trash_exchange_id)),
            )
            conn.commit()

    def save_draft_context(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        draft_exchange_id: str,
        compose_mode: str,
        reply_to_message_id: str | None = None,
        forward_message_id: str | None = None,
        compose_mailbox_id: str | None = None,
    ) -> None:
        scoped_draft_exchange_id = self._scoped_key(mailbox_id=mailbox_id, value=draft_exchange_id)
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self._draft_context_table}
                (draft_exchange_id, user_id, compose_mode, reply_to_message_id, forward_message_id, compose_mailbox_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(draft_exchange_id) DO UPDATE SET
                    user_id = excluded.user_id,
                    compose_mode = excluded.compose_mode,
                    reply_to_message_id = excluded.reply_to_message_id,
                    forward_message_id = excluded.forward_message_id,
                    compose_mailbox_id = excluded.compose_mailbox_id,
                    updated_at = excluded.updated_at
                """,
                (
                    scoped_draft_exchange_id,
                    int(user_id),
                    _normalize_text(compose_mode, "draft"),
                    _normalize_text(reply_to_message_id) or None,
                    _normalize_text(forward_message_id) or None,
                    _normalize_text(compose_mailbox_id) or None,
                    _utc_now_iso(),
                ),
            )
            conn.commit()

    def get_draft_context(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        draft_exchange_id: str,
    ) -> dict[str, Any] | None:
        row = self._get_by_scoped_or_legacy_key(
            table=self._draft_context_table,
            columns="compose_mode, reply_to_message_id, forward_message_id, updated_at, compose_mailbox_id",
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            key_column="draft_exchange_id",
            key_value=draft_exchange_id,
        )
        if row is None:
            return None
        return {
            "compose_mode": _normalize_text(row["compose_mode"], "draft"),
            "reply_to_message_id": _normalize_text(row["reply_to_message_id"]) or None,
            "forward_message_id": _normalize_text(row["forward_message_id"]) or None,
            "updated_at": _normalize_text(row["updated_at"]) or None,
            "mailbox_id": _normalize_text(row["compose_mailbox_id"]) or None,
        }

    def delete_draft_context(
        self,
        *,
        mailbox_id: str | None = None,
        draft_exchange_id: str,
    ) -> None:
        scoped_draft_exchange_id = self._scoped_key(mailbox_id=mailbox_id, value=draft_exchange_id)
        with self._lock, self._connect() as conn:
            conn.execute(
                f"DELETE FROM {self._draft_context_table} WHERE draft_exchange_id IN (?, ?)",
                (scoped_draft_exchange_id, _normalize_text(draft_exchange_id)),
            )
            conn.commit()

    def list_favorite_folder_ids(self, *, user_id: int, mailbox_id: str | None = None) -> set[str]:
        return self._list_scoped_folder_ids(
            table=self._folder_favorites_table,
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            exclude_standard=False,
        )

    def list_visible_custom_folder_ids(self, *, user_id: int, mailbox_id: str | None = None) -> set[str]:
        return self._list_scoped_folder_ids(
            table=self._visible_custom_folders_table,
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            exclude_standard=True,
        )

    def set_custom_folder_visible(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        folder_id: str,
        visible: bool,
    ) -> None:
        normalized_folder_id = _normalize_text(folder_id)
        if not normalized_folder_id or normalized_folder_id in self._standard_folders:
            return
        scoped_folder_id = self._scoped_key(mailbox_id=mailbox_id, value=normalized_folder_id)
        with self._lock, self._connect() as conn:
            if visible:
                conn.execute(
                    f"""
                    INSERT INTO {self._visible_custom_folders_table} (user_id, folder_id, created_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, folder_id) DO NOTHING
                    """,
                    (int(user_id), scoped_folder_id, _utc_now_iso()),
                )
            else:
                conn.execute(
                    f"DELETE FROM {self._visible_custom_folders_table} WHERE user_id = ? AND folder_id IN (?, ?)",
                    (int(user_id), scoped_folder_id, normalized_folder_id),
                )
            conn.commit()

    def purge_custom_folder_visibility(self, *, user_id: int, folder_ids: set[str]) -> None:
        normalized_ids = sorted(
            {
                _normalize_text(folder_id)
                for folder_id in (folder_ids or set())
                if _normalize_text(folder_id) and _normalize_text(folder_id) not in self._standard_folders
            }
        )
        if not normalized_ids:
            return
        with self._lock, self._connect() as conn:
            conn.executemany(
                f"DELETE FROM {self._visible_custom_folders_table} WHERE user_id = ? AND folder_id = ?",
                [(int(user_id), folder_id) for folder_id in normalized_ids],
            )
            conn.commit()

    def set_folder_favorite(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        folder_id: str,
        favorite: bool,
    ) -> dict[str, Any]:
        normalized_folder_id = _normalize_text(folder_id)
        if not normalized_folder_id:
            raise ValueError("Folder id is required")
        scoped_folder_id = self._scoped_key(mailbox_id=mailbox_id, value=normalized_folder_id)
        with self._lock, self._connect() as conn:
            if favorite:
                conn.execute(
                    f"""
                    INSERT INTO {self._folder_favorites_table} (user_id, folder_id, created_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, folder_id) DO NOTHING
                    """,
                    (int(user_id), scoped_folder_id, _utc_now_iso()),
                )
            else:
                conn.execute(
                    f"DELETE FROM {self._folder_favorites_table} WHERE user_id = ? AND folder_id IN (?, ?)",
                    (int(user_id), scoped_folder_id, normalized_folder_id),
                )
            conn.commit()
        return {"ok": True, "folder_id": normalized_folder_id, "favorite": bool(favorite)}

    def get_preferences_row(self, *, user_id: int) -> dict[str, Any]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT prefs_json, updated_at FROM {self._user_preferences_table} WHERE user_id = ?",
                (int(user_id),),
            ).fetchone()
        if row is None:
            return {"prefs": dict(self._default_preferences), "updated_at": None}
        try:
            parsed = json.loads(_normalize_text(row["prefs_json"], "{}"))
        except Exception:
            parsed = {}
        prefs = dict(self._default_preferences)
        if isinstance(parsed, dict):
            prefs.update({key: parsed.get(key) for key in self._default_preferences.keys() if key in parsed})
        return {"prefs": prefs, "updated_at": _normalize_text(row["updated_at"]) or None}

    def update_preferences(self, *, user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        current = self.get_preferences_row(user_id=int(user_id))["prefs"]
        next_prefs = dict(current)
        reading_pane = _normalize_text((payload or {}).get("reading_pane"), next_prefs["reading_pane"]).lower()
        if reading_pane not in {"right", "bottom", "off"}:
            reading_pane = next_prefs["reading_pane"]
        density = _normalize_text((payload or {}).get("density"), next_prefs["density"]).lower()
        if density not in {"comfortable", "compact"}:
            density = next_prefs["density"]
        next_prefs["reading_pane"] = reading_pane
        next_prefs["density"] = density
        for key in ("mark_read_on_select", "show_preview_snippets", "show_favorites_first"):
            if key in (payload or {}):
                next_prefs[key] = bool((payload or {}).get(key))
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self._user_preferences_table} (user_id, prefs_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    prefs_json = excluded.prefs_json,
                    updated_at = excluded.updated_at
                """,
                (int(user_id), json.dumps(next_prefs, ensure_ascii=False), now_iso),
            )
            conn.commit()
        return {"user_id": int(user_id), "preferences": next_prefs, "updated_at": now_iso}

    def maybe_cleanup_message_log(self) -> None:
        now = datetime.now(timezone.utc)
        if self._last_log_cleanup_at and (now - self._last_log_cleanup_at) < timedelta(hours=1):
            return
        self.cleanup_message_log()
        self._last_log_cleanup_at = now

    def cleanup_message_log(self) -> None:
        retention_days = int(self._log_retention_days_getter() or 0)
        if retention_days <= 0:
            return
        cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
        try:
            with self._lock, self._connect() as conn:
                cursor = conn.execute(
                    f"DELETE FROM {self._log_table} WHERE sent_at < ?",
                    (cutoff,),
                )
                conn.commit()
                deleted = int(cursor.rowcount or 0)
            if deleted > 0:
                logger.info(
                    "Mail log retention cleanup completed: deleted=%s retention_days=%s",
                    deleted,
                    retention_days,
                )
        except Exception as exc:
            logger.warning("Mail log retention cleanup failed: %s", exc)

    def log_message(
        self,
        *,
        message_id: str,
        user_id: int,
        username: str,
        direction: str,
        folder_hint: str,
        subject: str,
        recipients: list[str],
        status: str,
        exchange_item_id: str | None = None,
        error_text: str | None = None,
    ) -> None:
        self.maybe_cleanup_message_log()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self._log_table}
                (id, user_id, username, direction, folder_hint, subject, recipients_json, sent_at, status, exchange_item_id, error_text)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    _normalize_text(message_id),
                    int(user_id),
                    _normalize_text(username),
                    _normalize_text(direction, "outgoing"),
                    _normalize_text(folder_hint),
                    _normalize_text(subject),
                    json.dumps(recipients or [], ensure_ascii=False),
                    _utc_now_iso(),
                    _normalize_text(status, "sent"),
                    _normalize_text(exchange_item_id) or None,
                    _normalize_text(error_text) or None,
                ),
            )
            conn.commit()

    def _list_scoped_folder_ids(
        self,
        *,
        table: str,
        user_id: int,
        mailbox_id: str | None,
        exclude_standard: bool,
    ) -> set[str]:
        normalized_mailbox_id = _normalize_text(mailbox_id)
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT folder_id FROM {table} WHERE user_id = ?",
                (int(user_id),),
            ).fetchall()
        scoped_values: set[str] = set()
        legacy_values: set[str] = set()
        for row in rows:
            stored_value = _normalize_text(row["folder_id"])
            scoped_mailbox_id, payload = split_scoped_storage_key(stored_value)
            if not payload or (exclude_standard and payload in self._standard_folders):
                continue
            if scoped_mailbox_id:
                if scoped_mailbox_id == normalized_mailbox_id:
                    scoped_values.add(payload)
            else:
                legacy_values.add(payload)
        return scoped_values or legacy_values

    def _get_by_scoped_or_legacy_key(
        self,
        *,
        table: str,
        columns: str,
        user_id: int,
        mailbox_id: str | None,
        key_column: str,
        key_value: str,
    ) -> Any | None:
        scoped_key = self._scoped_key(mailbox_id=mailbox_id, value=key_value)
        legacy_key = _normalize_text(key_value)
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT {columns}
                FROM {table}
                WHERE user_id = ? AND {key_column} = ?
                """,
                (int(user_id), scoped_key),
            ).fetchone()
            if row is None and scoped_key != legacy_key:
                row = conn.execute(
                    f"""
                    SELECT {columns}
                    FROM {table}
                    WHERE user_id = ? AND {key_column} = ?
                    """,
                    (int(user_id), legacy_key),
                ).fetchone()
        return row
