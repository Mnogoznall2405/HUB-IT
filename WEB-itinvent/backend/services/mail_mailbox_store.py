from __future__ import annotations

from collections.abc import Callable
from typing import Any


def normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


class MailMailboxStore:
    def __init__(
        self,
        *,
        lock: Any,
        connect: Callable[[], Any],
        table: str,
        now_iso: Callable[[], str],
    ) -> None:
        self._lock = lock
        self._connect = connect
        self._table = table
        self._now_iso = now_iso

    def has_any(self, *, user_id: int) -> bool:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT id FROM {self._table} WHERE user_id = ? LIMIT 1",
                (int(user_id),),
            ).fetchone()
        return row is not None

    def insert_legacy_seed(self, *, user_id: int, seed: dict[str, Any]) -> None:
        now_iso = self._now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT OR IGNORE INTO {self._table}
                (
                    id,
                    user_id,
                    label,
                    mailbox_email,
                    mailbox_login,
                    mailbox_password_enc,
                    auth_mode,
                    is_primary,
                    is_active,
                    sort_order,
                    last_selected_at,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalize_text(seed["id"]),
                    int(user_id),
                    normalize_text(seed["label"]) or "Основной ящик",
                    normalize_text(seed["mailbox_email"]).lower(),
                    normalize_text(seed.get("mailbox_login")) or None,
                    normalize_text(seed.get("mailbox_password_enc")),
                    normalize_text(seed.get("auth_mode"), "stored_credentials"),
                    True,
                    True,
                    int(seed.get("sort_order") or 0),
                    normalize_text(seed.get("last_selected_at")) or now_iso,
                    normalize_text(seed.get("created_at")) or now_iso,
                    normalize_text(seed.get("updated_at")) or now_iso,
                ),
            )
            conn.commit()

    def list_rows(self, *, user_id: int, include_inactive: bool = False) -> list[dict[str, Any]]:
        sql = f"""
            SELECT
                id,
                user_id,
                label,
                mailbox_email,
                mailbox_login,
                mailbox_password_enc,
                auth_mode,
                is_primary,
                is_active,
                sort_order,
                last_selected_at,
                created_at,
                updated_at
            FROM {self._table}
            WHERE user_id = ?
        """
        params: list[Any] = [int(user_id)]
        if not include_inactive:
            sql += " AND is_active = ?"
            params.append(True)
        sql += " ORDER BY is_primary DESC, sort_order ASC, LOWER(mailbox_email) ASC"
        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(row) for row in rows]

    def touch_selected(self, *, user_id: int, mailbox_id: str) -> None:
        normalized_mailbox_id = normalize_text(mailbox_id)
        if not normalized_mailbox_id:
            return
        now_iso = self._now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {self._table}
                SET last_selected_at = ?, updated_at = ?
                WHERE user_id = ? AND id = ?
                """,
                (now_iso, now_iso, int(user_id), normalized_mailbox_id),
            )
            conn.commit()

    def clear_primary_except(self, *, user_id: int, mailbox_id: str) -> None:
        now_iso = self._now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"UPDATE {self._table} SET is_primary = ?, updated_at = ? WHERE user_id = ? AND id <> ?",
                (False, now_iso, int(user_id), normalize_text(mailbox_id)),
            )
            conn.commit()

    def insert_row(
        self,
        *,
        user_id: int,
        mailbox_id: str,
        label: str,
        mailbox_email: str,
        mailbox_login: str = "",
        mailbox_password_enc: str = "",
        auth_mode: str = "stored_credentials",
        is_primary: bool = False,
        is_active: bool = True,
        sort_order: int = 0,
        selected: bool = False,
        clear_existing_primary: bool = False,
    ) -> None:
        now_iso = self._now_iso()
        with self._lock, self._connect() as conn:
            if clear_existing_primary:
                conn.execute(
                    f"UPDATE {self._table} SET is_primary = ?, updated_at = ? WHERE user_id = ?",
                    (False, now_iso, int(user_id)),
                )
            conn.execute(
                f"""
                INSERT INTO {self._table}
                (
                    id,
                    user_id,
                    label,
                    mailbox_email,
                    mailbox_login,
                    mailbox_password_enc,
                    auth_mode,
                    is_primary,
                    is_active,
                    sort_order,
                    last_selected_at,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalize_text(mailbox_id),
                    int(user_id),
                    normalize_text(label) or normalize_text(mailbox_email).lower(),
                    normalize_text(mailbox_email).lower(),
                    normalize_text(mailbox_login) or None,
                    normalize_text(mailbox_password_enc),
                    normalize_text(auth_mode, "stored_credentials"),
                    bool(is_primary),
                    bool(is_active),
                    int(sort_order or 0),
                    now_iso if selected else None,
                    now_iso,
                    now_iso,
                ),
            )
            conn.commit()

    def update_row(
        self,
        *,
        user_id: int,
        mailbox_id: str,
        label: str,
        mailbox_email: str,
        mailbox_login: str = "",
        mailbox_password_enc: str = "",
        auth_mode: str = "stored_credentials",
        is_primary: bool = False,
        is_active: bool = True,
        selected: bool = False,
        clear_existing_primary: bool = False,
    ) -> None:
        now_iso = self._now_iso()
        normalized_mailbox_id = normalize_text(mailbox_id)
        with self._lock, self._connect() as conn:
            if clear_existing_primary:
                conn.execute(
                    f"UPDATE {self._table} SET is_primary = ?, updated_at = ? WHERE user_id = ? AND id <> ?",
                    (False, now_iso, int(user_id), normalized_mailbox_id),
                )
            conn.execute(
                f"""
                UPDATE {self._table}
                SET
                    label = ?,
                    mailbox_email = ?,
                    mailbox_login = ?,
                    mailbox_password_enc = ?,
                    auth_mode = ?,
                    is_primary = ?,
                    is_active = ?,
                    last_selected_at = CASE WHEN ? THEN ? ELSE last_selected_at END,
                    updated_at = ?
                WHERE user_id = ? AND id = ?
                """,
                (
                    normalize_text(label) or normalize_text(mailbox_email).lower(),
                    normalize_text(mailbox_email).lower(),
                    normalize_text(mailbox_login) or None,
                    normalize_text(mailbox_password_enc),
                    normalize_text(auth_mode, "stored_credentials"),
                    bool(is_primary),
                    bool(is_active),
                    bool(selected),
                    now_iso,
                    now_iso,
                    int(user_id),
                    normalized_mailbox_id,
                ),
            )
            conn.commit()

    def delete_row(self, *, user_id: int, mailbox_id: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                f"DELETE FROM {self._table} WHERE user_id = ? AND id = ?",
                (int(user_id), normalize_text(mailbox_id)),
            )
            conn.commit()

    def upsert_primary_stored_credentials(
        self,
        *,
        user_id: int,
        mailbox_id: str,
        label: str,
        mailbox_email: str,
        mailbox_login: str,
        mailbox_password_enc: str,
        sort_order: int = 0,
        update_existing: bool = False,
    ) -> None:
        normalized_mailbox_id = normalize_text(mailbox_id)
        now_iso = self._now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"UPDATE {self._table} SET is_primary = ?, updated_at = ? WHERE user_id = ? AND id <> ?",
                (False, now_iso, int(user_id), normalized_mailbox_id),
            )
            if update_existing:
                conn.execute(
                    f"""
                    UPDATE {self._table}
                    SET
                        label = CASE WHEN label IS NULL OR label = '' THEN ? ELSE label END,
                        mailbox_email = ?,
                        mailbox_login = ?,
                        mailbox_password_enc = ?,
                        auth_mode = ?,
                        is_primary = ?,
                        is_active = ?,
                        last_selected_at = COALESCE(last_selected_at, ?),
                        updated_at = ?
                    WHERE user_id = ? AND id = ?
                    """,
                    (
                        normalize_text(label) or normalize_text(mailbox_email).lower(),
                        normalize_text(mailbox_email).lower(),
                        normalize_text(mailbox_login).lower(),
                        normalize_text(mailbox_password_enc),
                        "stored_credentials",
                        True,
                        True,
                        now_iso,
                        now_iso,
                        int(user_id),
                        normalized_mailbox_id,
                    ),
                )
            else:
                conn.execute(
                    f"""
                    INSERT INTO {self._table}
                    (
                        id,
                        user_id,
                        label,
                        mailbox_email,
                        mailbox_login,
                        mailbox_password_enc,
                        auth_mode,
                        is_primary,
                        is_active,
                        sort_order,
                        last_selected_at,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        normalized_mailbox_id,
                        int(user_id),
                        normalize_text(label) or normalize_text(mailbox_email).lower(),
                        normalize_text(mailbox_email).lower(),
                        normalize_text(mailbox_login).lower(),
                        normalize_text(mailbox_password_enc),
                        "stored_credentials",
                        True,
                        True,
                        int(sort_order or 0),
                        now_iso,
                        now_iso,
                        now_iso,
                    ),
                )
            conn.commit()

    def clear_saved_password(self, *, user_id: int, mailbox_id: str = "") -> str:
        normalized_mailbox_id = normalize_text(mailbox_id)
        with self._lock, self._connect() as conn:
            target_mailbox_id = normalized_mailbox_id
            if not target_mailbox_id:
                row = conn.execute(
                    f"""
                    SELECT id
                    FROM {self._table}
                    WHERE user_id = ? AND auth_mode = 'stored_credentials'
                    ORDER BY is_primary DESC,
                             CASE WHEN last_selected_at IS NULL THEN 1 ELSE 0 END,
                             last_selected_at DESC,
                             sort_order ASC
                    LIMIT 1
                    """,
                    (int(user_id),),
                ).fetchone()
                target_mailbox_id = normalize_text((dict(row) if row is not None else {}).get("id"))
            if target_mailbox_id:
                conn.execute(
                    f"""
                    UPDATE {self._table}
                    SET mailbox_password_enc = '', updated_at = ?
                    WHERE user_id = ? AND id = ?
                    """,
                    (self._now_iso(), int(user_id), target_mailbox_id),
                )
                conn.commit()
            return target_mailbox_id
