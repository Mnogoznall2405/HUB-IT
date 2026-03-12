"""
Mail service for Exchange (EWS/NTLM) inbox access, sending and IT request templates.
"""
from __future__ import annotations

import base64
import email.policy
import html
import json
import logging
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from email.parser import BytesParser
from pathlib import Path
from threading import RLock
from typing import Any, Optional

from local_store import get_local_store
from backend.services.secret_crypto_service import SecretCryptoError, decrypt_secret
from backend.services.user_service import user_service

logger = logging.getLogger(__name__)
_UNSET = object()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _plain_text_to_html(text: Any) -> str:
    value = str(text or "")
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    return html.escape(normalized).replace("\n", "<br>")


def _to_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return bool(default)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _parse_date_filter(value: Any) -> date | None:
    raw = _normalize_text(value)
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except Exception:
        raise MailServiceError("Date filters must be in YYYY-MM-DD format")


def _parse_recipients(value: str | None) -> list[str]:
    text = _normalize_text(value)
    if not text:
        return []
    result: list[str] = []
    seen: set[str] = set()
    for part in re.split(r"[;,]+", text):
        email = _normalize_text(part).lower()
        if not email:
            continue
        if email in seen:
            continue
        seen.add(email)
        result.append(email)
    return result


class MailServiceError(RuntimeError):
    """Domain error for mail service operations."""


class MailPayloadTooLargeError(MailServiceError):
    """Payload is too large (attachments count/size limits)."""


class MailService:
    _TEMPLATES_TABLE = "mail_it_templates"
    _LOG_TABLE = "mail_messages_log"
    _RESTORE_HINTS_TABLE = "mail_restore_hints"
    _DRAFT_CONTEXT_TABLE = "mail_draft_context"
    _FOLDER_FAVORITES_TABLE = "mail_folder_favorites"
    _VISIBLE_CUSTOM_FOLDERS_TABLE = "mail_visible_custom_folders"
    _USER_PREFS_TABLE = "mail_user_preferences"
    _ATTACHMENT_TOKEN_PREFIX = "att1_"
    _IT_REQUEST_RECIPIENTS = ["it@zsgp.ru"]
    _SEARCH_WINDOW_LIMIT = 5000
    _SEARCH_BATCH_SIZE = 250
    _MAX_IT_FILES = 10
    _MAX_IT_FILE_SIZE = 15 * 1024 * 1024
    _MAX_IT_TOTAL_SIZE = 25 * 1024 * 1024
    _MAX_MAIL_FILES = 10
    _MAX_MAIL_FILE_SIZE = 15 * 1024 * 1024
    _MAX_MAIL_TOTAL_SIZE = 25 * 1024 * 1024
    _MAIL_LOG_RETENTION_DAYS_DEFAULT = 90
    _FIELD_TYPES = {"text", "textarea", "select", "multiselect", "date", "checkbox", "email", "tel"}
    _STANDARD_FOLDERS = {
        "inbox": {"label": "Входящие", "icon_key": "inbox", "scope": "mailbox"},
        "sent": {"label": "Отправленные", "icon_key": "send", "scope": "mailbox"},
        "drafts": {"label": "Черновики", "icon_key": "drafts", "scope": "mailbox"},
        "trash": {"label": "Удаленные", "icon_key": "trash", "scope": "mailbox"},
        "junk": {"label": "Нежелательные", "icon_key": "junk", "scope": "mailbox"},
        "archive": {"label": "Архив", "icon_key": "archive", "scope": "archive"},
    }
    _DEFAULT_PREFERENCES = {
        "reading_pane": "right",
        "density": "comfortable",
        "mark_read_on_select": False,
        "show_preview_snippets": True,
        "show_favorites_first": True,
    }

    def __init__(self) -> None:
        store = get_local_store()
        self.db_path = Path(store.db_path)
        self._lock = RLock()
        self._last_log_cleanup_at: datetime | None = None
        self._ensure_schema()
        self._migrate_legacy_template_fields()
        self._cleanup_message_log()
        # Globally disable TLS verification for Exchange connections if configured.
        if not self.verify_tls:
            self._disable_tls_verification()

    def _disable_tls_verification(self) -> None:
        """Set NoVerifyHTTPAdapter globally and suppress SSL warnings."""
        try:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        except Exception:
            pass
        try:
            from exchangelib.protocol import BaseProtocol, NoVerifyHTTPAdapter
            BaseProtocol.HTTP_ADAPTER_CLS = NoVerifyHTTPAdapter
        except Exception:
            pass

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                f"""
                CREATE TABLE IF NOT EXISTS {self._TEMPLATES_TABLE} (
                    id TEXT PRIMARY KEY,
                    code TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT '',
                    subject_template TEXT NOT NULL,
                    body_template_md TEXT NOT NULL DEFAULT '',
                    required_fields_json TEXT NOT NULL DEFAULT '[]',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_by_user_id INTEGER NOT NULL DEFAULT 0,
                    created_by_username TEXT NOT NULL DEFAULT '',
                    updated_by_user_id INTEGER NOT NULL DEFAULT 0,
                    updated_by_username TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS {self._LOG_TABLE} (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL DEFAULT 0,
                    username TEXT NOT NULL DEFAULT '',
                    direction TEXT NOT NULL DEFAULT 'outgoing',
                    folder_hint TEXT NOT NULL DEFAULT '',
                    subject TEXT NOT NULL DEFAULT '',
                    recipients_json TEXT NOT NULL DEFAULT '[]',
                    sent_at TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'sent',
                    exchange_item_id TEXT NULL,
                    error_text TEXT NULL
                );

                CREATE TABLE IF NOT EXISTS {self._RESTORE_HINTS_TABLE} (
                    user_id INTEGER NOT NULL,
                    trash_exchange_id TEXT NOT NULL,
                    restore_folder TEXT NOT NULL DEFAULT 'inbox',
                    source_exchange_id TEXT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, trash_exchange_id)
                );

                CREATE TABLE IF NOT EXISTS {self._DRAFT_CONTEXT_TABLE} (
                    draft_exchange_id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL DEFAULT 0,
                    compose_mode TEXT NOT NULL DEFAULT 'draft',
                    reply_to_message_id TEXT NULL,
                    forward_message_id TEXT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS {self._FOLDER_FAVORITES_TABLE} (
                    user_id INTEGER NOT NULL,
                    folder_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, folder_id)
                );

                CREATE TABLE IF NOT EXISTS {self._VISIBLE_CUSTOM_FOLDERS_TABLE} (
                    user_id INTEGER NOT NULL,
                    folder_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, folder_id)
                );

                CREATE TABLE IF NOT EXISTS {self._USER_PREFS_TABLE} (
                    user_id INTEGER PRIMARY KEY,
                    prefs_json TEXT NOT NULL DEFAULT '{{}}',
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_{self._TEMPLATES_TABLE}_active
                    ON {self._TEMPLATES_TABLE}(is_active, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._LOG_TABLE}_user_time
                    ON {self._LOG_TABLE}(user_id, sent_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._RESTORE_HINTS_TABLE}_created
                    ON {self._RESTORE_HINTS_TABLE}(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._DRAFT_CONTEXT_TABLE}_user_updated
                    ON {self._DRAFT_CONTEXT_TABLE}(user_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._FOLDER_FAVORITES_TABLE}_user_created
                    ON {self._FOLDER_FAVORITES_TABLE}(user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._VISIBLE_CUSTOM_FOLDERS_TABLE}_user_created
                    ON {self._VISIBLE_CUSTOM_FOLDERS_TABLE}(user_id, created_at DESC);
                """
            )
            conn.commit()

    @property
    def exchange_host(self) -> str:
        return _normalize_text(os.getenv("MAIL_EXCHANGE_HOST"), "10.103.0.50")

    @property
    def exchange_ews_url(self) -> str:
        raw = _normalize_text(os.getenv("MAIL_EWS_URL"))
        if raw:
            return raw
        return f"https://{self.exchange_host}/EWS/Exchange.asmx"

    @property
    def verify_tls(self) -> bool:
        return _to_bool(os.getenv("MAIL_VERIFY_TLS"), default=False)

    @property
    def it_request_recipients(self) -> list[str]:
        return _parse_recipients(os.getenv("MAIL_IT_RECIPIENTS", ""))

    @property
    def mail_log_retention_days(self) -> int:
        raw = _normalize_text(
            os.getenv("MAIL_LOG_RETENTION_DAYS"),
            str(self._MAIL_LOG_RETENTION_DAYS_DEFAULT),
        )
        try:
            return max(0, int(raw))
        except Exception:
            return self._MAIL_LOG_RETENTION_DAYS_DEFAULT

    @property
    def search_window_limit(self) -> int:
        raw = _normalize_text(os.getenv("MAIL_SEARCH_WINDOW_LIMIT"), str(self._SEARCH_WINDOW_LIMIT))
        try:
            return max(500, min(20000, int(raw)))
        except Exception:
            return self._SEARCH_WINDOW_LIMIT

    @property
    def max_mail_files(self) -> int:
        raw = _normalize_text(os.getenv("MAIL_MAX_FILES"), str(self._MAX_MAIL_FILES))
        try:
            return max(1, min(50, int(raw)))
        except Exception:
            return self._MAX_MAIL_FILES

    @property
    def max_mail_file_size(self) -> int:
        raw = _normalize_text(
            os.getenv("MAIL_MAX_FILE_SIZE_MB"),
            str(self._MAX_MAIL_FILE_SIZE // (1024 * 1024)),
        )
        try:
            return max(1, min(200, int(raw))) * 1024 * 1024
        except Exception:
            return self._MAX_MAIL_FILE_SIZE

    @property
    def max_mail_total_size(self) -> int:
        raw = _normalize_text(
            os.getenv("MAIL_MAX_TOTAL_SIZE_MB"),
            str(self._MAX_MAIL_TOTAL_SIZE // (1024 * 1024)),
        )
        try:
            return max(1, min(500, int(raw))) * 1024 * 1024
        except Exception:
            return self._MAX_MAIL_TOTAL_SIZE

    def _maybe_cleanup_message_log(self) -> None:
        now = datetime.now(timezone.utc)
        if self._last_log_cleanup_at and (now - self._last_log_cleanup_at) < timedelta(hours=1):
            return
        self._cleanup_message_log()
        self._last_log_cleanup_at = now

    def _cleanup_message_log(self) -> None:
        retention_days = self.mail_log_retention_days
        if retention_days <= 0:
            return
        cutoff = (datetime.now(timezone.utc) - timedelta(days=retention_days)).isoformat()
        try:
            with self._lock, self._connect() as conn:
                cursor = conn.execute(
                    f"DELETE FROM {self._LOG_TABLE} WHERE sent_at < ?",
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

    @staticmethod
    def _encode_message_id(folder: str, exchange_id: str) -> str:
        raw = f"{_normalize_text(folder, 'inbox')}::{_normalize_text(exchange_id)}"
        return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").rstrip("=")

    @staticmethod
    def _decode_message_id(token: str) -> tuple[str, str]:
        value = _normalize_text(token)
        if not value:
            raise MailServiceError("Message id is required")
        padded = value + "=" * ((4 - len(value) % 4) % 4)
        try:
            raw = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        except Exception as exc:
            raise MailServiceError("Invalid message id") from exc
        if "::" not in raw:
            raise MailServiceError("Invalid message id payload")
        folder, exchange_id = raw.split("::", 1)
        if not exchange_id:
            raise MailServiceError("Invalid message id payload")
        return _normalize_text(folder, "inbox").lower(), exchange_id

    @staticmethod
    def _encode_folder_id(scope: str, exchange_id: str) -> str:
        raw = f"{_normalize_text(scope, 'mailbox')}::{_normalize_text(exchange_id)}"
        return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").rstrip("=")

    @staticmethod
    def _decode_folder_id(token: str) -> tuple[str, str]:
        value = _normalize_text(token)
        if not value:
            raise MailServiceError("Folder id is required")
        padded = value + "=" * ((4 - len(value) % 4) % 4)
        try:
            raw = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        except Exception as exc:
            raise MailServiceError("Invalid folder id") from exc
        if "::" not in raw:
            raise MailServiceError("Invalid folder id payload")
        scope, exchange_id = raw.split("::", 1)
        if not exchange_id:
            raise MailServiceError("Invalid folder id payload")
        return _normalize_text(scope, "mailbox").lower(), exchange_id

    @staticmethod
    def _encode_attachment_token(attachment_id: str) -> str:
        value = _normalize_text(attachment_id)
        if not value:
            return ""
        encoded = base64.urlsafe_b64encode(value.encode("utf-8")).decode("utf-8").rstrip("=")
        return f"{MailService._ATTACHMENT_TOKEN_PREFIX}{encoded}"

    @staticmethod
    def _decode_attachment_token(token: str) -> str:
        value = _normalize_text(token)
        if not value:
            raise MailServiceError("Attachment token is required")
        if not value.startswith(MailService._ATTACHMENT_TOKEN_PREFIX):
            raise MailServiceError("Attachment token format is invalid")
        encoded_part = value[len(MailService._ATTACHMENT_TOKEN_PREFIX):]
        if not encoded_part:
            raise MailServiceError("Attachment token payload is empty")
        padded = encoded_part + "=" * ((4 - len(encoded_part) % 4) % 4)
        try:
            raw = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        except Exception as exc:
            raise MailServiceError("Attachment token payload is invalid") from exc
        resolved = _normalize_text(raw)
        if not resolved:
            raise MailServiceError("Attachment token payload is invalid")
        return resolved

    def resolve_attachment_id(self, token_or_id: str) -> str:
        value = _normalize_text(token_or_id)
        if not value:
            raise MailServiceError("Attachment id is required")
        if value.startswith(self._ATTACHMENT_TOKEN_PREFIX):
            return self._decode_attachment_token(value)
        # Backward-compatible fallback for legacy clients sending raw exchangelib attachment id.
        return value

    def _resolve_user_mail_profile(self, user_id: int, *, require_password: bool) -> dict[str, Any]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")
        email = _normalize_text(user.get("mailbox_email") or user.get("email")).lower()
        login = _normalize_text(user.get("mailbox_login") or email)
        signature = _normalize_text(user.get("mail_signature_html"))
        password_enc = _normalize_text(user.get("mailbox_password_enc"))
        if not email:
            raise MailServiceError("Mailbox email is not configured")
        if not login:
            raise MailServiceError("Mailbox login is not configured")
        password = ""
        if require_password:
            if not password_enc:
                raise MailServiceError("Mailbox password is not configured")
            try:
                password = decrypt_secret(password_enc)
            except SecretCryptoError as exc:
                raise MailServiceError(str(exc)) from exc
            if not password:
                raise MailServiceError("Mailbox password is empty")
        return {
            "user": user,
            "email": email,
            "login": login,
            "password": password,
            "signature": signature,
        }

    @contextmanager
    def _exchange_protocol_context(self):
        if self.verify_tls:
            yield
            return
        try:
            from exchangelib.protocol import BaseProtocol, NoVerifyHTTPAdapter
        except Exception:
            # If exchangelib is unavailable, downstream connection call will fail with explicit error.
            yield
            return
        old_adapter = BaseProtocol.HTTP_ADAPTER_CLS
        BaseProtocol.HTTP_ADAPTER_CLS = NoVerifyHTTPAdapter
        try:
            yield
        finally:
            BaseProtocol.HTTP_ADAPTER_CLS = old_adapter

    def _create_account(self, *, email: str, login: str, password: str):
        try:
            from exchangelib import Account, Configuration, Credentials, DELEGATE, NTLM
        except Exception as exc:
            raise MailServiceError("exchangelib package is not installed") from exc

        config_kwargs = {
            "credentials": Credentials(username=login, password=password),
            "auth_type": NTLM,
        }
        ews_url = self.exchange_ews_url
        if ews_url:
            config_kwargs["service_endpoint"] = ews_url
        else:
            config_kwargs["server"] = self.exchange_host

        with self._exchange_protocol_context():
            cfg = Configuration(**config_kwargs)
            return Account(
                primary_smtp_address=email,
                config=cfg,
                autodiscover=False,
                access_type=DELEGATE,
            )

    @staticmethod
    def _safe_folder_attr(target, attr_name: str):
        try:
            return getattr(target, attr_name, None)
        except Exception:
            return None

    def _standard_folders(self, account) -> dict[str, Any]:
        mapping = {
            "inbox": self._safe_folder_attr(account, "inbox"),
            "sent": self._safe_folder_attr(account, "sent"),
            "drafts": self._safe_folder_attr(account, "drafts"),
            "trash": self._safe_folder_attr(account, "trash"),
            "junk": self._safe_folder_attr(account, "junk"),
        }
        archive_inbox = self._safe_folder_attr(account, "archive_inbox")
        if archive_inbox is not None:
            mapping["archive"] = archive_inbox
        return {key: value for key, value in mapping.items() if value is not None}

    def _list_favorite_folder_ids(self, *, user_id: int) -> set[str]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT folder_id FROM {self._FOLDER_FAVORITES_TABLE} WHERE user_id = ?",
                (int(user_id),),
            ).fetchall()
        return {
            _normalize_text(row["folder_id"])
            for row in rows
            if _normalize_text(row["folder_id"])
        }

    def _list_visible_custom_folder_ids(self, *, user_id: int) -> set[str]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT folder_id FROM {self._VISIBLE_CUSTOM_FOLDERS_TABLE} WHERE user_id = ?",
                (int(user_id),),
            ).fetchall()
        return {
            _normalize_text(row["folder_id"])
            for row in rows
            if _normalize_text(row["folder_id"]) and _normalize_text(row["folder_id"]) not in self._STANDARD_FOLDERS
        }

    def _set_custom_folder_visible(self, *, user_id: int, folder_id: str, visible: bool) -> None:
        normalized_folder_id = _normalize_text(folder_id)
        if not normalized_folder_id or normalized_folder_id in self._STANDARD_FOLDERS:
            return
        with self._lock, self._connect() as conn:
            if visible:
                conn.execute(
                    f"""
                    INSERT INTO {self._VISIBLE_CUSTOM_FOLDERS_TABLE} (user_id, folder_id, created_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, folder_id) DO NOTHING
                    """,
                    (int(user_id), normalized_folder_id, _utc_now_iso()),
                )
            else:
                conn.execute(
                    f"DELETE FROM {self._VISIBLE_CUSTOM_FOLDERS_TABLE} WHERE user_id = ? AND folder_id = ?",
                    (int(user_id), normalized_folder_id),
                )
            conn.commit()

    def _purge_custom_folder_visibility(self, *, user_id: int, folder_ids: set[str]) -> None:
        normalized_ids = sorted({
            _normalize_text(folder_id)
            for folder_id in (folder_ids or set())
            if _normalize_text(folder_id) and _normalize_text(folder_id) not in self._STANDARD_FOLDERS
        })
        if not normalized_ids:
            return
        with self._lock, self._connect() as conn:
            conn.executemany(
                f"DELETE FROM {self._VISIBLE_CUSTOM_FOLDERS_TABLE} WHERE user_id = ? AND folder_id = ?",
                [(int(user_id), folder_id) for folder_id in normalized_ids],
            )
            conn.commit()

    def set_folder_favorite(self, *, user_id: int, folder_id: str, favorite: bool) -> dict[str, Any]:
        normalized_folder_id = _normalize_text(folder_id)
        if not normalized_folder_id:
            raise MailServiceError("Folder id is required")
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            if favorite:
                conn.execute(
                    f"""
                    INSERT INTO {self._FOLDER_FAVORITES_TABLE} (user_id, folder_id, created_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, folder_id) DO NOTHING
                    """,
                    (int(user_id), normalized_folder_id, now_iso),
                )
            else:
                conn.execute(
                    f"DELETE FROM {self._FOLDER_FAVORITES_TABLE} WHERE user_id = ? AND folder_id = ?",
                    (int(user_id), normalized_folder_id),
                )
            conn.commit()
        return {"ok": True, "folder_id": normalized_folder_id, "favorite": bool(favorite)}

    def _get_preferences_row(self, *, user_id: int) -> dict[str, Any]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT prefs_json, updated_at FROM {self._USER_PREFS_TABLE} WHERE user_id = ?",
                (int(user_id),),
            ).fetchone()
        if row is None:
            return {"prefs": dict(self._DEFAULT_PREFERENCES), "updated_at": None}
        try:
            parsed = json.loads(_normalize_text(row["prefs_json"], "{}"))
        except Exception:
            parsed = {}
        prefs = dict(self._DEFAULT_PREFERENCES)
        if isinstance(parsed, dict):
            prefs.update({key: parsed.get(key) for key in self._DEFAULT_PREFERENCES.keys() if key in parsed})
        return {"prefs": prefs, "updated_at": _normalize_text(row["updated_at"]) or None}

    def get_preferences(self, *, user_id: int) -> dict[str, Any]:
        row = self._get_preferences_row(user_id=int(user_id))
        return {
            "user_id": int(user_id),
            "preferences": row["prefs"],
            "updated_at": row["updated_at"],
        }

    def update_preferences(self, *, user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        current = self._get_preferences_row(user_id=int(user_id))["prefs"]
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
                INSERT INTO {self._USER_PREFS_TABLE} (user_id, prefs_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    prefs_json = excluded.prefs_json,
                    updated_at = excluded.updated_at
                """,
                (int(user_id), json.dumps(next_prefs, ensure_ascii=False), now_iso),
            )
            conn.commit()
        return {"user_id": int(user_id), "preferences": next_prefs, "updated_at": now_iso}

    def _folder_scope_for_alias(self, alias: str) -> str:
        return str((self._STANDARD_FOLDERS.get(alias) or {}).get("scope") or "mailbox")

    def _folder_id_from_object(self, account, folder_obj, *, scope_hint: str = "mailbox") -> str:
        exchange_id = _normalize_text(getattr(folder_obj, "id", None))
        standard = self._standard_folders(account)
        for alias, standard_folder in standard.items():
            if _normalize_text(getattr(standard_folder, "id", None)) == exchange_id and exchange_id:
                return alias
        if not exchange_id:
            return ""
        return self._encode_folder_id(scope_hint, exchange_id)

    def _walk_folder_targets(self, account) -> list[tuple[Any, str, str]]:
        standard = self._standard_folders(account)
        visited: set[str] = set()
        result: list[tuple[Any, str, str]] = []

        def add_folder(folder_obj, folder_key: str, scope_key: str) -> None:
            exchange_id = _normalize_text(getattr(folder_obj, "id", None))
            if exchange_id and exchange_id in visited:
                return
            if exchange_id:
                visited.add(exchange_id)
            result.append((folder_obj, folder_key, scope_key))

        for alias, folder_obj in standard.items():
            add_folder(folder_obj, alias, self._folder_scope_for_alias(alias))

        for scope_key, root_attr in (("mailbox", "msg_folder_root"), ("archive", "archive_msg_folder_root")):
            root_folder = self._safe_folder_attr(account, root_attr)
            root_exchange_id = _normalize_text(getattr(root_folder, "id", None))
            if root_folder is None:
                continue
            try:
                folders = list(root_folder.walk())
            except Exception:
                folders = []
            for folder_obj in folders:
                exchange_id = _normalize_text(getattr(folder_obj, "id", None))
                if not exchange_id or exchange_id == root_exchange_id:
                    continue
                add_folder(folder_obj, self._encode_folder_id(scope_key, exchange_id), scope_key)
        return result

    def _resolve_folder(self, account, folder: str):
        key = _normalize_text(folder, "inbox")
        normalized = key.lower()
        standard = self._standard_folders(account)
        aliases = {
            "inbox": "inbox",
            "sent": "sent",
            "sentitems": "sent",
            "drafts": "drafts",
            "trash": "trash",
            "deleted": "trash",
            "junk": "junk",
            "spam": "junk",
            "archive": "archive",
        }
        alias = aliases.get(normalized)
        if alias and alias in standard:
            return standard[alias], alias
        if alias and alias not in standard:
            raise MailServiceError(f"Folder is not available: {alias}")

        scope_key, exchange_id = self._decode_folder_id(key)
        root_attr = "archive_msg_folder_root" if scope_key == "archive" else "msg_folder_root"
        root_folder = self._safe_folder_attr(account, root_attr)
        if root_folder is None:
            raise MailServiceError(f"Folder root is not available: {scope_key}")
        try:
            for folder_obj in root_folder.walk():
                if _normalize_text(getattr(folder_obj, "id", None)) == exchange_id:
                    return folder_obj, key
        except Exception as exc:
            raise MailServiceError(f"Failed to resolve folder: {exc}") from exc
        raise MailServiceError(f"Folder not found: {exchange_id}")

    def _search_target_folders(self, account, *, folder: str, folder_scope: str = "current") -> list[tuple[Any, str]]:
        if _normalize_text(folder_scope, "current").lower() != "all":
            folder_obj, folder_key = self._resolve_folder(account, folder)
            return [(folder_obj, folder_key)]
        return [(folder_obj, folder_key) for folder_obj, folder_key, _ in self._walk_folder_targets(account)]

    def _custom_folder_root(self, account, scope_key: str):
        normalized_scope = _normalize_text(scope_key, "mailbox").lower()
        if normalized_scope == "archive":
            archive_inbox = self._safe_folder_attr(account, "archive_inbox")
            archive_parent = self._safe_folder_attr(archive_inbox, "parent") if archive_inbox is not None else None
            if archive_parent is not None:
                return archive_parent
            return self._safe_folder_attr(account, "archive_msg_folder_root")
        inbox = self._safe_folder_attr(account, "inbox")
        inbox_parent = self._safe_folder_attr(inbox, "parent") if inbox is not None else None
        if inbox_parent is not None:
            return inbox_parent
        return self._safe_folder_attr(account, "msg_folder_root")

    def _find_existing_child_folder(self, parent_folder, folder_name: str):
        target_name = _normalize_text(folder_name).lower()
        parent_exchange_id = _normalize_text(getattr(parent_folder, "id", None))
        if not target_name or not parent_exchange_id:
            return None
        try:
            for folder_obj in parent_folder.walk():
                exchange_id = _normalize_text(getattr(folder_obj, "id", None))
                if not exchange_id:
                    continue
                current_parent_id = _normalize_text(getattr(getattr(folder_obj, "parent", None), "id", None))
                if current_parent_id != parent_exchange_id:
                    continue
                if _normalize_text(getattr(folder_obj, "name", None)).lower() == target_name:
                    return folder_obj
        except Exception:
            return None
        return None

    @staticmethod
    def _item_sender(item) -> str:
        sender = getattr(item, "sender", None)
        if sender is not None:
            value = _normalize_text(getattr(sender, "email_address", None))
            if value:
                return value.lower()
        author = getattr(item, "author", None)
        if author is not None:
            value = _normalize_text(getattr(author, "email_address", None))
            if value:
                return value.lower()
        return ""

    @staticmethod
    def _item_recipients(item) -> list[str]:
        recipients: list[str] = []
        seen: set[str] = set()
        for attr in ("to_recipients", "cc_recipients"):
            values = getattr(item, attr, None) or []
            for rec in values:
                email = _normalize_text(getattr(rec, "email_address", None)).lower()
                if not email or email in seen:
                    continue
                seen.add(email)
                recipients.append(email)
        return recipients

    @staticmethod
    def _item_bcc_recipients(item) -> list[str]:
        recipients: list[str] = []
        seen: set[str] = set()
        for rec in getattr(item, "bcc_recipients", None) or []:
            email = _normalize_text(getattr(rec, "email_address", None)).lower()
            if not email or email in seen:
                continue
            seen.add(email)
            recipients.append(email)
        return recipients

    @staticmethod
    def _item_message_id(item) -> str:
        return _normalize_text(getattr(item, "message_id", None)).strip()

    @staticmethod
    def _normalize_subject_for_conversation(subject: Any) -> str:
        value = _normalize_text(subject).lower()
        if not value:
            return "(без темы)"
        normalized = re.sub(r"^(?:(?:re|fwd?|fw)\s*:\s*)+", "", value, flags=re.IGNORECASE).strip()
        return normalized or "(без темы)"

    def _item_conversation_key(self, item) -> str:
        conversation_id = getattr(item, "conversation_id", None)
        if conversation_id is not None:
            value = _normalize_text(getattr(conversation_id, "id", None) or conversation_id)
            if value:
                return value
        return self._normalize_subject_for_conversation(getattr(item, "subject", ""))

    @staticmethod
    def _item_importance(item) -> str:
        value = _normalize_text(getattr(item, "importance", None), "normal").lower()
        if value in {"high", "low", "normal"}:
            return value
        return "normal"

    @staticmethod
    def _message_sort_attr(folder_key: str) -> str:
        return "-datetime_created" if folder_key == "drafts" else "-datetime_received"

    def _folder_queryset(self, folder_obj, folder_key: str):
        return folder_obj.all().order_by(self._message_sort_attr(folder_key))

    def _build_quote_html(self, item) -> str:
        sender = self._item_sender(item) or "-"
        subject = _normalize_text(getattr(item, "subject", "")) or "(без темы)"
        received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
        received_label = received.strftime("%d.%m.%Y %H:%M") if received else "-"
        body_html = _normalize_text(getattr(item, "body", None))
        if not body_html:
            body_html = _plain_text_to_html(_normalize_text(getattr(item, "text_body", None)))
        header = (
            f"<p><strong>От:</strong> {html.escape(sender)}</p>"
            f"<p><strong>Дата:</strong> {html.escape(received_label)}</p>"
            f"<p><strong>Тема:</strong> {html.escape(subject)}</p>"
        )
        return f"<div class=\"quoted-mail\"><br><br>{header}<blockquote>{body_html}</blockquote></div>"

    def build_compose_context(self, item, mailbox_email: str) -> dict[str, Any]:
        mailbox = _normalize_text(mailbox_email).lower()
        subject = _normalize_text(getattr(item, "subject", "")) or "(без темы)"
        sender = self._item_sender(item)
        to_values = self._item_recipients(item)
        cc_values = [
            _normalize_text(getattr(rec, "email_address", None)).lower()
            for rec in (getattr(item, "cc_recipients", None) or [])
            if _normalize_text(getattr(rec, "email_address", None))
        ]

        def _dedupe(values: list[str]) -> list[str]:
            result: list[str] = []
            seen: set[str] = set()
            for value in values:
                email = _normalize_text(value).lower()
                if not email or email == mailbox or email in seen:
                    continue
                seen.add(email)
                result.append(email)
            return result

        quote_html = self._build_quote_html(item)
        reply_subject = subject if re.match(r"(?i)^re:\s*", subject) else f"Re: {subject}"
        forward_subject = subject if re.match(r"(?i)^fwd?:\s*", subject) else f"Fwd: {subject}"

        reply_all_to = _dedupe([sender, *to_values])
        if sender and sender in reply_all_to:
            filtered_to = [sender]
            filtered_to.extend([value for value in reply_all_to if value != sender])
            reply_all_to = filtered_to

        return {
            "reply": {
                "subject": reply_subject,
                "to": _dedupe([sender]),
                "cc": [],
                "quote_html": quote_html,
            },
            "reply_all": {
                "subject": reply_subject,
                "to": reply_all_to,
                "cc": _dedupe(cc_values),
                "quote_html": quote_html,
            },
            "forward": {
                "subject": forward_subject,
                "to": [],
                "cc": [],
                "quote_html": quote_html,
            },
        }

    def _serialize_message_detail(
        self,
        *,
        item,
        folder_key: str,
        mailbox_email: str,
        restore_hint_folder: str | None = None,
        draft_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
        received_iso = received.isoformat() if received else None
        body_html = _normalize_text(getattr(item, "body", None))
        body_text = _normalize_text(getattr(item, "text_body", None))
        if not body_text and body_html:
            body_text = _normalize_text(re.sub(r"<[^>]+>", " ", body_html))

        attachments = []
        for att in (getattr(item, "attachments", None) or []):
            attachment_raw_id = _normalize_text(getattr(getattr(att, "attachment_id", None), "id", ""))
            attachments.append(
                {
                    "id": attachment_raw_id,
                    "download_token": self._encode_attachment_token(attachment_raw_id),
                    "name": _normalize_text(getattr(att, "name", "attachment.bin")),
                    "content_type": _normalize_text(getattr(att, "content_type", "")),
                    "size": int(getattr(att, "size", 0) or 0),
                }
            )

        return {
            "id": self._encode_message_id(folder_key, _normalize_text(getattr(item, "id", ""))),
            "exchange_id": _normalize_text(getattr(item, "id", "")),
            "folder": folder_key,
            "subject": _normalize_text(getattr(item, "subject", "")),
            "sender": self._item_sender(item),
            "to": [
                _normalize_text(getattr(rec, "email_address", None)).lower()
                for rec in (getattr(item, "to_recipients", None) or [])
                if _normalize_text(getattr(rec, "email_address", None))
            ],
            "cc": [
                _normalize_text(getattr(rec, "email_address", None)).lower()
                for rec in (getattr(item, "cc_recipients", None) or [])
                if _normalize_text(getattr(rec, "email_address", None))
            ],
            "bcc": self._item_bcc_recipients(item),
            "received_at": received_iso,
            "is_read": bool(getattr(item, "is_read", False)),
            "body_html": body_html,
            "body_text": body_text,
            "importance": self._item_importance(item),
            "categories": [str(value).strip() for value in (getattr(item, "categories", None) or []) if str(value).strip()],
            "reminder_is_set": bool(getattr(item, "reminder_is_set", False)),
            "reminder_due_by": (
                getattr(item, "reminder_due_by", None).isoformat()
                if getattr(item, "reminder_due_by", None) is not None
                else None
            ),
            "internet_message_id": self._item_message_id(item) or None,
            "conversation_id": self._item_conversation_key(item),
            "restore_hint_folder": restore_hint_folder,
            "attachments": attachments,
            "compose_context": self.build_compose_context(item, mailbox_email),
            "draft_context": draft_context or None,
            "has_external_images": bool(re.search(r"<img[^>]+src=['\"]https?://", body_html, flags=re.IGNORECASE)),
            "can_archive": not str(folder_key).startswith("archive"),
            "can_move": True,
        }

    def _set_restore_hint(
        self,
        *,
        user_id: int,
        trash_exchange_id: str,
        restore_folder: str,
        source_exchange_id: str | None = None,
    ) -> None:
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self._RESTORE_HINTS_TABLE}
                (user_id, trash_exchange_id, restore_folder, source_exchange_id, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, trash_exchange_id) DO UPDATE SET
                    restore_folder = excluded.restore_folder,
                    source_exchange_id = excluded.source_exchange_id,
                    created_at = excluded.created_at
                """,
                (
                    int(user_id),
                    _normalize_text(trash_exchange_id),
                    _normalize_text(restore_folder, "inbox"),
                    _normalize_text(source_exchange_id) or None,
                    now_iso,
                ),
            )
            conn.commit()

    def _get_restore_hint(self, *, user_id: int, trash_exchange_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT restore_folder, source_exchange_id, created_at
                FROM {self._RESTORE_HINTS_TABLE}
                WHERE user_id = ? AND trash_exchange_id = ?
                """,
                (int(user_id), _normalize_text(trash_exchange_id)),
            ).fetchone()
        if row is None:
            return None
        return {
            "restore_folder": _normalize_text(row["restore_folder"], "inbox"),
            "source_exchange_id": _normalize_text(row["source_exchange_id"]) or None,
            "created_at": _normalize_text(row["created_at"]) or None,
        }

    def _delete_restore_hint(self, *, user_id: int, trash_exchange_id: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                f"DELETE FROM {self._RESTORE_HINTS_TABLE} WHERE user_id = ? AND trash_exchange_id = ?",
                (int(user_id), _normalize_text(trash_exchange_id)),
            )
            conn.commit()

    def _save_draft_context(
        self,
        *,
        user_id: int,
        draft_exchange_id: str,
        compose_mode: str,
        reply_to_message_id: str | None = None,
        forward_message_id: str | None = None,
    ) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self._DRAFT_CONTEXT_TABLE}
                (draft_exchange_id, user_id, compose_mode, reply_to_message_id, forward_message_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(draft_exchange_id) DO UPDATE SET
                    user_id = excluded.user_id,
                    compose_mode = excluded.compose_mode,
                    reply_to_message_id = excluded.reply_to_message_id,
                    forward_message_id = excluded.forward_message_id,
                    updated_at = excluded.updated_at
                """,
                (
                    _normalize_text(draft_exchange_id),
                    int(user_id),
                    _normalize_text(compose_mode, "draft"),
                    _normalize_text(reply_to_message_id) or None,
                    _normalize_text(forward_message_id) or None,
                    _utc_now_iso(),
                ),
            )
            conn.commit()

    def _get_draft_context(self, *, user_id: int, draft_exchange_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT compose_mode, reply_to_message_id, forward_message_id, updated_at
                FROM {self._DRAFT_CONTEXT_TABLE}
                WHERE user_id = ? AND draft_exchange_id = ?
                """,
                (int(user_id), _normalize_text(draft_exchange_id)),
            ).fetchone()
        if row is None:
            return None
        return {
            "compose_mode": _normalize_text(row["compose_mode"], "draft"),
            "reply_to_message_id": _normalize_text(row["reply_to_message_id"]) or None,
            "forward_message_id": _normalize_text(row["forward_message_id"]) or None,
            "updated_at": _normalize_text(row["updated_at"]) or None,
        }

    def _delete_draft_context(self, *, draft_exchange_id: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                f"DELETE FROM {self._DRAFT_CONTEXT_TABLE} WHERE draft_exchange_id = ?",
                (_normalize_text(draft_exchange_id),),
            )
            conn.commit()

    def _serialize_message_preview(self, item, folder_key: str) -> dict[str, Any]:
        received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
        received_iso = received.isoformat() if received else None
        body_text = _normalize_text(getattr(item, "text_body", None))
        if not body_text:
            body_text = _normalize_text(getattr(item, "body", None))
        body_preview = body_text[:350]
        attachments_count = len(getattr(item, "attachments", None) or [])
        return {
            "id": self._encode_message_id(folder_key, _normalize_text(getattr(item, "id", ""))),
            "exchange_id": _normalize_text(getattr(item, "id", "")),
            "folder": folder_key,
            "subject": _normalize_text(getattr(item, "subject", "")),
            "sender": self._item_sender(item),
            "recipients": self._item_recipients(item),
            "received_at": received_iso,
            "is_read": bool(getattr(item, "is_read", False)),
            "has_attachments": attachments_count > 0,
            "attachments_count": attachments_count,
            "body_preview": body_preview,
            "importance": self._item_importance(item),
            "categories": [str(value).strip() for value in (getattr(item, "categories", None) or []) if str(value).strip()],
        }

    def _message_matches_filters(
        self,
        item,
        *,
        query_text: str = "",
        has_attachments: bool = False,
        date_from: date | None = None,
        date_to: date | None = None,
        from_filter: str = "",
        to_filter: str = "",
        subject_filter: str = "",
        body_filter: str = "",
        importance_filter: str = "",
    ) -> bool:
        if has_attachments and not bool(getattr(item, "attachments", None) or []):
            return False

        received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
        if received is not None:
            try:
                received_date = received.date()
            except Exception:
                received_date = None
        else:
            received_date = None

        if date_from and (received_date is None or received_date < date_from):
            return False
        if date_to and (received_date is None or received_date > date_to):
            return False

        if from_filter:
            sender = self._item_sender(item).lower()
            if from_filter not in sender:
                return False

        if to_filter:
            recipients = " ".join(self._item_recipients(item)).lower()
            if to_filter not in recipients:
                return False

        if subject_filter:
            subject = _normalize_text(getattr(item, "subject", "")).lower()
            if subject_filter not in subject:
                return False

        if body_filter:
            body_preview = _normalize_text(getattr(item, "text_body", None))
            if not body_preview:
                body_preview = _normalize_text(getattr(item, "body", None))
            if body_filter not in body_preview.lower():
                return False

        if importance_filter:
            if self._item_importance(item) != importance_filter:
                return False

        if query_text:
            subject = _normalize_text(getattr(item, "subject", "")).lower()
            sender = self._item_sender(item).lower()
            body_preview = _normalize_text(getattr(item, "text_body", "")).lower()
            if query_text not in subject and query_text not in sender and query_text not in body_preview:
                return False

        return True

    def list_messages(
        self,
        *,
        user_id: int,
        folder: str = "inbox",
        folder_scope: str = "current",
        limit: int = 50,
        offset: int = 0,
        q: str = "",
        unread_only: bool = False,
        has_attachments: bool = False,
        date_from: str = "",
        date_to: str = "",
        from_filter: str = "",
        to_filter: str = "",
        subject_filter: str = "",
        body_filter: str = "",
        importance: str = "",
    ) -> dict[str, Any]:
        safe_limit = max(1, min(200, int(limit or 50)))
        safe_offset = max(0, int(offset or 0))
        query_text = _normalize_text(q).lower()
        normalized_from = _normalize_text(from_filter).lower()
        normalized_to = _normalize_text(to_filter).lower()
        normalized_subject = _normalize_text(subject_filter).lower()
        normalized_body = _normalize_text(body_filter).lower()
        normalized_importance = _normalize_text(importance).lower()
        parsed_date_from = _parse_date_filter(date_from)
        parsed_date_to = _parse_date_filter(date_to)
        filters_active = bool(
            query_text
            or has_attachments
            or parsed_date_from
            or parsed_date_to
            or normalized_from
            or normalized_to
            or normalized_subject
            or normalized_body
            or normalized_importance
        )

        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        targets = self._search_target_folders(
            account,
            folder=_normalize_text(folder, "inbox"),
            folder_scope=_normalize_text(folder_scope, "current"),
        )
        searched_window = 0
        if len(targets) == 1 and _normalize_text(folder_scope, "current").lower() != "all" and not filters_active:
            folder_obj, folder_key = targets[0]
            queryset = self._folder_queryset(folder_obj, folder_key)
            if unread_only:
                queryset = queryset.filter(is_read=False)
            try:
                total = int(queryset.count())
            except Exception:
                total = 0
            page_items = list(queryset[safe_offset : safe_offset + safe_limit])
            items = [self._serialize_message_preview(item, folder_key) for item in page_items]
        else:
            serialized_items: list[dict[str, Any]] = []
            for folder_obj, folder_key in targets:
                queryset = self._folder_queryset(folder_obj, folder_key)
                if unread_only:
                    queryset = queryset.filter(is_read=False)
                scanned = 0
                while True:
                    batch_items = list(queryset[scanned : scanned + self._SEARCH_BATCH_SIZE])
                    if not batch_items:
                        break
                    for item in batch_items:
                        if not self._message_matches_filters(
                            item,
                            query_text=query_text,
                            has_attachments=bool(has_attachments),
                            date_from=parsed_date_from,
                            date_to=parsed_date_to,
                            from_filter=normalized_from,
                            to_filter=normalized_to,
                            subject_filter=normalized_subject,
                            body_filter=normalized_body,
                            importance_filter=normalized_importance,
                        ):
                            continue
                        serialized_items.append(self._serialize_message_preview(item, folder_key))
                    searched_window += len(batch_items)
                    scanned += len(batch_items)
                    if len(batch_items) < self._SEARCH_BATCH_SIZE:
                        break
            serialized_items.sort(
                key=lambda item: (
                    item.get("received_at") or "",
                    item.get("id") or "",
                ),
                reverse=True,
            )
            total = len(serialized_items)
            items = serialized_items[safe_offset : safe_offset + safe_limit]
            folder_key = _normalize_text(folder, "inbox")

        next_offset = safe_offset + len(items)
        return {
            "items": items,
            "folder": folder_key,
            "limit": safe_limit,
            "offset": safe_offset,
            "total": max(total, safe_offset + len(items)),
            "has_more": next_offset < max(total, safe_offset + len(items)),
            "next_offset": next_offset if next_offset < max(total, safe_offset + len(items)) else None,
            "search_limited": False,
            "searched_window": searched_window,
        }

    def list_folder_summary(self, *, user_id: int) -> dict[str, dict[str, int]]:
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )

        result: dict[str, dict[str, int]] = {}
        mapping = self._standard_folders(account)

        for key, folder_obj in mapping.items():
            try:
                total = int(folder_obj.all().count())
            except Exception:
                total = 0
            try:
                unread = int(folder_obj.filter(is_read=False).count())
            except Exception:
                unread = 0
            result[key] = {
                "total": total,
                "unread": unread,
            }

        return result

    def _folder_counts(self, folder_obj) -> tuple[int, int]:
        try:
            total = int(folder_obj.all().count())
        except Exception:
            total = 0
        try:
            unread = int(folder_obj.filter(is_read=False).count())
        except Exception:
            unread = 0
        return total, unread

    def _serialize_folder_node(
        self,
        account,
        folder_obj,
        *,
        folder_key: str,
        scope: str,
        parent_id: str | None,
        favorite_ids: set[str],
    ) -> dict[str, Any]:
        total, unread = self._folder_counts(folder_obj)
        well_known_key = folder_key if folder_key in self._STANDARD_FOLDERS else None
        standard_meta = self._STANDARD_FOLDERS.get(folder_key) if well_known_key else None
        return {
            "id": folder_key,
            "exchange_id": _normalize_text(getattr(folder_obj, "id", None)) or None,
            "name": _normalize_text(getattr(folder_obj, "name", None)) or (standard_meta or {}).get("label") or folder_key,
            "label": (standard_meta or {}).get("label") or _normalize_text(getattr(folder_obj, "name", None), folder_key),
            "scope": scope,
            "icon_key": (standard_meta or {}).get("icon_key") or "folder",
            "well_known_key": well_known_key,
            "parent_id": parent_id,
            "is_favorite": folder_key in favorite_ids,
            "is_distinguished": bool(well_known_key),
            "can_rename": not bool(well_known_key),
            "can_delete": not bool(well_known_key),
            "can_create_children": True,
            "total": total,
            "unread": unread,
            "child_folder_count": int(getattr(folder_obj, "child_folder_count", 0) or 0),
        }

    def list_folder_tree(self, *, user_id: int) -> dict[str, Any]:
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        favorites = self._list_favorite_folder_ids(user_id=int(user_id))
        visible_custom_folder_ids = self._list_visible_custom_folder_ids(user_id=int(user_id))
        standard = self._standard_folders(account)
        standard_exchange_map = {
            _normalize_text(getattr(folder_obj, "id", None)): alias
            for alias, folder_obj in standard.items()
            if _normalize_text(getattr(folder_obj, "id", None))
        }
        mailbox_root_id = _normalize_text(getattr(self._safe_folder_attr(account, "msg_folder_root"), "id", None))
        archive_root_id = _normalize_text(getattr(self._safe_folder_attr(account, "archive_msg_folder_root"), "id", None))
        mailbox_custom_root_id = _normalize_text(getattr(self._custom_folder_root(account, "mailbox"), "id", None))
        archive_custom_root_id = _normalize_text(getattr(self._custom_folder_root(account, "archive"), "id", None))

        def resolve_parent_id(folder_obj, scope: str) -> str | None:
            parent = getattr(folder_obj, "parent", None)
            parent_exchange_id = _normalize_text(getattr(parent, "id", None))
            if not parent_exchange_id:
                return None
            if parent_exchange_id in standard_exchange_map:
                return standard_exchange_map[parent_exchange_id]
            root_ids = {mailbox_root_id, archive_root_id}
            if scope == "archive":
                root_ids.add(archive_custom_root_id)
            else:
                root_ids.add(mailbox_custom_root_id)
            if parent_exchange_id in root_ids:
                return None
            parent_scope = "archive" if scope == "archive" else "mailbox"
            parent_folder_id = self._encode_folder_id(parent_scope, parent_exchange_id)
            return parent_folder_id if parent_folder_id in visible_custom_folder_ids else None

        items: list[dict[str, Any]] = []
        for alias, folder_obj in standard.items():
            scope = self._folder_scope_for_alias(alias)
            items.append(
                self._serialize_folder_node(
                    account,
                    folder_obj,
                    folder_key=alias,
                    scope=scope,
                    parent_id=resolve_parent_id(folder_obj, scope),
                    favorite_ids=favorites,
                )
            )

        stale_folder_ids: set[str] = set()
        for folder_id in sorted(visible_custom_folder_ids):
            try:
                folder_obj, folder_key = self._resolve_folder(account, folder_id)
            except MailServiceError:
                stale_folder_ids.add(folder_id)
                continue
            if folder_key in self._STANDARD_FOLDERS:
                stale_folder_ids.add(folder_id)
                continue
            scope, _ = self._decode_folder_id(folder_key)
            items.append(
                self._serialize_folder_node(
                    account,
                    folder_obj,
                    folder_key=folder_key,
                    scope=scope,
                    parent_id=resolve_parent_id(folder_obj, scope),
                    favorite_ids=favorites,
                )
            )

        if stale_folder_ids:
            self._purge_custom_folder_visibility(user_id=int(user_id), folder_ids=stale_folder_ids)

        items.sort(
            key=lambda item: (
                item.get("scope") != "mailbox",
                0 if item.get("well_known_key") else 1,
                str(item.get("label") or "").lower(),
            )
        )
        return {
            "items": items,
            "favorites": [item["id"] for item in items if item.get("is_favorite")],
        }

    def create_folder(
        self,
        *,
        user_id: int,
        name: str,
        parent_folder_id: str = "",
        scope: str = "mailbox",
    ) -> dict[str, Any]:
        folder_name = _normalize_text(name)
        if not folder_name:
            raise MailServiceError("Folder name is required")
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        scope_key = _normalize_text(scope, "mailbox").lower()
        parent_folder = None
        visible_custom_folder_ids = self._list_visible_custom_folder_ids(user_id=int(user_id))
        if _normalize_text(parent_folder_id):
            parent_folder, parent_key = self._resolve_folder(account, parent_folder_id)
            if str(parent_key) in self._STANDARD_FOLDERS:
                scope_key = self._folder_scope_for_alias(str(parent_key))
            else:
                if str(parent_key) not in visible_custom_folder_ids:
                    raise MailServiceError("Parent folder is not visible in application")
                resolved_scope, _ = self._decode_folder_id(str(parent_key))
                scope_key = resolved_scope
        if parent_folder is None:
            parent_folder = self._custom_folder_root(account, scope_key)
        if parent_folder is None:
            raise MailServiceError(f"Folder root is not available: {scope_key}")
        try:
            from exchangelib.folders import Folder
        except Exception as exc:
            raise MailServiceError("exchangelib package is not installed") from exc
        created = None
        create_errors: list[str] = []
        create_parents = [parent_folder]
        fallback_root = self._safe_folder_attr(account, "archive_msg_folder_root") if scope_key == "archive" else self._safe_folder_attr(account, "msg_folder_root")
        fallback_root_id = _normalize_text(getattr(fallback_root, "id", None))
        primary_root_id = _normalize_text(getattr(parent_folder, "id", None))
        if fallback_root is not None and fallback_root_id and fallback_root_id != primary_root_id:
            create_parents.append(fallback_root)
        for candidate_parent in create_parents:
            try:
                created = Folder(parent=candidate_parent, name=folder_name)
                created.save()
                parent_folder = candidate_parent
                break
            except Exception as exc:
                existing_folder = self._find_existing_child_folder(candidate_parent, folder_name)
                if existing_folder is not None:
                    created = existing_folder
                    parent_folder = candidate_parent
                    break
                create_errors.append(str(exc))
                created = None
        if created is None:
            joined_errors = "; ".join(error for error in create_errors if error) or "unknown error"
            raise MailServiceError(f"Failed to create folder: {joined_errors}")
        parent_exchange_id = _normalize_text(getattr(parent_folder, "id", None))
        standard_exchange_map = {
            _normalize_text(getattr(folder_obj, "id", None)): alias
            for alias, folder_obj in self._standard_folders(account).items()
            if _normalize_text(getattr(folder_obj, "id", None))
        }
        parent_id = standard_exchange_map.get(parent_exchange_id)
        if parent_id is None and parent_exchange_id:
            root_exchange_id = _normalize_text(getattr(self._custom_folder_root(account, scope_key), "id", None))
            if parent_exchange_id != root_exchange_id:
                parent_id = self._encode_folder_id(scope_key, parent_exchange_id)
        created_folder_id = self._encode_folder_id(scope_key, _normalize_text(getattr(created, "id", None)))
        self._set_custom_folder_visible(user_id=int(user_id), folder_id=created_folder_id, visible=True)
        return self._serialize_folder_node(
            account,
            created,
            folder_key=created_folder_id,
            scope=scope_key,
            parent_id=parent_id,
            favorite_ids=self._list_favorite_folder_ids(user_id=int(user_id)),
        )

    def rename_folder(self, *, user_id: int, folder_id: str, name: str) -> dict[str, Any]:
        next_name = _normalize_text(name)
        if not next_name:
            raise MailServiceError("Folder name is required")
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        folder_obj, folder_key = self._resolve_folder(account, folder_id)
        if folder_key in self._STANDARD_FOLDERS:
            raise MailServiceError("Standard folders cannot be renamed")
        try:
            folder_obj.name = next_name
            folder_obj.save(update_fields=["name"])
        except Exception as exc:
            raise MailServiceError(f"Failed to rename folder: {exc}") from exc
        scope_key, _ = self._decode_folder_id(folder_key)
        parent = getattr(folder_obj, "parent", None)
        parent_exchange_id = _normalize_text(getattr(parent, "id", None))
        parent_id = None
        if parent_exchange_id:
            standard_exchange_map = {
                _normalize_text(getattr(item, "id", None)): alias
                for alias, item in self._standard_folders(account).items()
                if _normalize_text(getattr(item, "id", None))
            }
            parent_id = standard_exchange_map.get(parent_exchange_id)
            if parent_id is None:
                root_exchange_id = _normalize_text(getattr(self._safe_folder_attr(account, "archive_msg_folder_root" if scope_key == "archive" else "msg_folder_root"), "id", None))
                if parent_exchange_id != root_exchange_id:
                    parent_id = self._encode_folder_id(scope_key, parent_exchange_id)
        return self._serialize_folder_node(
            account,
            folder_obj,
            folder_key=folder_key,
            scope=scope_key,
            parent_id=parent_id,
            favorite_ids=self._list_favorite_folder_ids(user_id=int(user_id)),
        )

    def delete_folder(self, *, user_id: int, folder_id: str) -> dict[str, Any]:
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        folder_obj, folder_key = self._resolve_folder(account, folder_id)
        if folder_key in self._STANDARD_FOLDERS:
            raise MailServiceError("Standard folders cannot be deleted")
        try:
            folder_obj.delete()
        except Exception as exc:
            raise MailServiceError(f"Failed to delete folder: {exc}") from exc
        self.set_folder_favorite(user_id=int(user_id), folder_id=folder_key, favorite=False)
        self._set_custom_folder_visible(user_id=int(user_id), folder_id=folder_key, visible=False)
        return {"ok": True, "folder_id": folder_key}

    def _get_message_context(self, *, user_id: int, message_id: str) -> dict[str, Any]:
        folder_key, exchange_id = self._decode_message_id(message_id)
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        folder_obj, folder_key = self._resolve_folder(account, folder_key)
        try:
            item = folder_obj.get(id=exchange_id)
        except Exception as exc:
            raise MailServiceError(f"Message not found: {exchange_id}") from exc
        return {
            "account": account,
            "profile": profile,
            "folder_obj": folder_obj,
            "folder_key": folder_key,
            "exchange_id": exchange_id,
            "item": item,
        }

    def get_message(self, *, user_id: int, message_id: str) -> dict[str, Any]:
        context = self._get_message_context(user_id=int(user_id), message_id=message_id)
        item = context["item"]
        folder_key = context["folder_key"]
        profile = context["profile"]
        exchange_id = context["exchange_id"]
        restore_hint = self._get_restore_hint(user_id=int(user_id), trash_exchange_id=exchange_id) if folder_key == "trash" else None
        draft_context = self._get_draft_context(user_id=int(user_id), draft_exchange_id=exchange_id) if folder_key == "drafts" else None
        return self._serialize_message_detail(
            item=item,
            folder_key=folder_key,
            mailbox_email=profile["email"],
            restore_hint_folder=(restore_hint or {}).get("restore_folder"),
            draft_context=draft_context,
        )

    def mark_as_read(self, *, user_id: int, message_id: str) -> bool:
        """Mark a message as read in the Exchange server."""
        folder_key, exchange_id = self._decode_message_id(message_id)
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        folder_obj, _ = self._resolve_folder(account, folder_key)
        try:
            item = folder_obj.get(id=exchange_id)
            if getattr(item, "is_read", None) is False:
                item.is_read = True
                item.save(update_fields=["is_read"])
            return True
        except Exception as exc:
            raise MailServiceError(f"Failed to mark message as read: {exc}") from exc

    def mark_as_unread(self, *, user_id: int, message_id: str) -> bool:
        folder_key, exchange_id = self._decode_message_id(message_id)
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        folder_obj, _ = self._resolve_folder(account, folder_key)
        try:
            item = folder_obj.get(id=exchange_id)
            if getattr(item, "is_read", None) is True:
                item.is_read = False
                item.save(update_fields=["is_read"])
            return True
        except Exception as exc:
            raise MailServiceError(f"Failed to mark message as unread: {exc}") from exc

    def mark_all_as_read(self, *, user_id: int, folder: str = "inbox", folder_scope: str = "current") -> dict[str, Any]:
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        changed = 0
        failed = 0
        for folder_obj, _folder_key in self._search_target_folders(account, folder=_normalize_text(folder, "inbox"), folder_scope=_normalize_text(folder_scope, "current")):
            try:
                items = list(folder_obj.filter(is_read=False))
            except Exception:
                items = []
            for item in items:
                try:
                    item.is_read = True
                    item.save(update_fields=["is_read"])
                    changed += 1
                except Exception:
                    failed += 1
        return {
            "ok": failed == 0,
            "changed": changed,
            "failed": failed,
            "folder": _normalize_text(folder, "inbox"),
            "folder_scope": _normalize_text(folder_scope, "current"),
        }

    def bulk_message_action(
        self,
        *,
        user_id: int,
        message_ids: list[str],
        action: str,
        target_folder: str = "",
        permanent: bool = False,
    ) -> dict[str, Any]:
        normalized_action = _normalize_text(action).lower()
        valid_actions = {"mark_read", "mark_unread", "move", "delete", "archive"}
        if normalized_action not in valid_actions:
            raise MailServiceError(f"Unsupported bulk action: {normalized_action}")
        items = [_normalize_text(item) for item in (message_ids or []) if _normalize_text(item)]
        if not items:
            raise MailServiceError("At least one message id is required")
        results: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for message_id in items:
            try:
                if normalized_action == "mark_read":
                    result = {"ok": self.mark_as_read(user_id=int(user_id), message_id=message_id)}
                elif normalized_action == "mark_unread":
                    result = {"ok": self.mark_as_unread(user_id=int(user_id), message_id=message_id)}
                elif normalized_action == "move":
                    result = self.move_message(user_id=int(user_id), message_id=message_id, target_folder=_normalize_text(target_folder, "inbox"))
                elif normalized_action == "archive":
                    result = self.move_message(user_id=int(user_id), message_id=message_id, target_folder="archive")
                else:
                    result = self.delete_message(user_id=int(user_id), message_id=message_id, permanent=bool(permanent))
                results.append({"message_id": message_id, "result": result})
            except MailServiceError as exc:
                errors.append({"message_id": message_id, "detail": str(exc)})
        return {
            "ok": len(errors) == 0,
            "action": normalized_action,
            "processed": len(items),
            "succeeded": len(results),
            "failed": len(errors),
            "results": results,
            "errors": errors,
        }

    def _message_mime_content(self, item) -> bytes:
        mime_content = getattr(item, "mime_content", None)
        if isinstance(mime_content, (bytes, bytearray)):
            return bytes(mime_content)
        return b""

    def get_message_source(self, *, user_id: int, message_id: str) -> tuple[str, bytes]:
        context = self._get_message_context(user_id=int(user_id), message_id=message_id)
        item = context["item"]
        source = self._message_mime_content(item)
        if not source:
            raise MailServiceError("Raw message source is not available")
        subject = _normalize_text(getattr(item, "subject", None), "message")
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", subject).strip("._") or "message"
        return f"{safe_name}.eml", source

    def get_message_headers(self, *, user_id: int, message_id: str) -> dict[str, Any]:
        filename, source = self.get_message_source(user_id=int(user_id), message_id=message_id)
        parsed = BytesParser(policy=email.policy.default).parsebytes(source)
        items = [{"name": str(name), "value": str(value)} for name, value in parsed.raw_items()]
        return {
            "message_id": message_id,
            "source_name": filename,
            "items": items,
        }

    def move_message(self, *, user_id: int, message_id: str, target_folder: str) -> dict[str, Any]:
        folder_key, exchange_id = self._decode_message_id(message_id)
        normalized_target = _normalize_text(target_folder, "inbox")
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        source_folder_obj, source_folder_key = self._resolve_folder(account, folder_key)
        target_folder_obj, target_folder_key = self._resolve_folder(account, normalized_target)
        try:
            item = source_folder_obj.get(id=exchange_id)
        except Exception as exc:
            raise MailServiceError(f"Message not found: {exchange_id}") from exc

        try:
            moved_item = item.move(target_folder_obj)
            new_exchange_id = _normalize_text(getattr(moved_item, "id", None) or getattr(item, "id", None))
            if target_folder_key == "trash":
                self._set_restore_hint(
                    user_id=int(user_id),
                    trash_exchange_id=new_exchange_id,
                    restore_folder=source_folder_key,
                    source_exchange_id=exchange_id,
                )
            elif source_folder_key == "trash":
                self._delete_restore_hint(user_id=int(user_id), trash_exchange_id=exchange_id)

            return {
                "ok": True,
                "message_id": self._encode_message_id(target_folder_key, new_exchange_id),
                "folder": target_folder_key,
            }
        except Exception as exc:
            raise MailServiceError(f"Failed to move message: {exc}") from exc

    def delete_message(self, *, user_id: int, message_id: str, permanent: bool = False) -> dict[str, Any]:
        folder_key, exchange_id = self._decode_message_id(message_id)
        if permanent and folder_key != "trash":
            raise MailServiceError("Permanent delete is allowed only from trash")
        if not permanent and folder_key != "trash":
            return self.move_message(user_id=int(user_id), message_id=message_id, target_folder="trash")

        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        folder_obj, _ = self._resolve_folder(account, folder_key)
        try:
            item = folder_obj.get(id=exchange_id)
            item.delete()
            self._delete_restore_hint(user_id=int(user_id), trash_exchange_id=exchange_id)
            self._delete_draft_context(draft_exchange_id=exchange_id)
            return {"ok": True, "permanent": True}
        except Exception as exc:
            raise MailServiceError(f"Failed to delete message: {exc}") from exc

    def restore_message(self, *, user_id: int, message_id: str, target_folder: str = "") -> dict[str, Any]:
        folder_key, exchange_id = self._decode_message_id(message_id)
        if folder_key != "trash":
            raise MailServiceError("Only messages from trash can be restored")

        hint = self._get_restore_hint(user_id=int(user_id), trash_exchange_id=exchange_id) or {}
        restore_folder = _normalize_text(target_folder, hint.get("restore_folder") or "inbox")
        return self.move_message(user_id=int(user_id), message_id=message_id, target_folder=restore_folder)

    def get_unread_count(self, *, user_id: int) -> int:
        """Get the total number of unread messages in the inbox."""
        try:
            profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
            account = self._create_account(
                email=profile["email"],
                login=profile["login"],
                password=profile["password"],
            )
            return int(account.inbox.filter(is_read=False).count())
        except Exception:
            return 0

    def list_conversations(
        self,
        *,
        user_id: int,
        folder: str = "inbox",
        folder_scope: str = "current",
        limit: int = 50,
        offset: int = 0,
        q: str = "",
        unread_only: bool = False,
        has_attachments: bool = False,
        date_from: str = "",
        date_to: str = "",
        from_filter: str = "",
        to_filter: str = "",
        subject_filter: str = "",
        body_filter: str = "",
        importance: str = "",
    ) -> dict[str, Any]:
        safe_limit = max(1, min(200, int(limit or 50)))
        safe_offset = max(0, int(offset or 0))
        query_text = _normalize_text(q).lower()
        normalized_from = _normalize_text(from_filter).lower()
        normalized_to = _normalize_text(to_filter).lower()
        normalized_subject = _normalize_text(subject_filter).lower()
        normalized_body = _normalize_text(body_filter).lower()
        normalized_importance = _normalize_text(importance).lower()
        parsed_date_from = _parse_date_filter(date_from)
        parsed_date_to = _parse_date_filter(date_to)

        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        scanned = 0
        grouped: dict[str, dict[str, Any]] = {}
        targets = self._search_target_folders(
            account,
            folder=_normalize_text(folder, "inbox"),
            folder_scope=_normalize_text(folder_scope, "current"),
        )

        for folder_obj, _folder_key in targets:
            queryset = self._folder_queryset(folder_obj, _folder_key)
            scan_offset = 0
            while True:
                batch_items = list(queryset[scan_offset: scan_offset + self._SEARCH_BATCH_SIZE])
                if not batch_items:
                    break
                for item in batch_items:
                    if not self._message_matches_filters(
                        item,
                        query_text=query_text,
                        has_attachments=bool(has_attachments),
                        date_from=parsed_date_from,
                        date_to=parsed_date_to,
                        from_filter=normalized_from,
                        to_filter=normalized_to,
                        subject_filter=normalized_subject,
                        body_filter=normalized_body,
                        importance_filter=normalized_importance,
                    ):
                        continue
                    key = self._item_conversation_key(item)
                    group = grouped.get(key)
                    received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
                    received_iso = received.isoformat() if received else None
                    sender = self._item_sender(item)
                    participants = [sender, *self._item_recipients(item)]
                    if group is None:
                        group = {
                            "conversation_id": key,
                            "subject": _normalize_text(getattr(item, "subject", "")) or "(без темы)",
                            "participants": [],
                            "participants_set": set(),
                            "messages_count": 0,
                            "unread_count": 0,
                            "last_received_at": received_iso,
                            "has_attachments": False,
                            "attachments_count": 0,
                            "preview": _normalize_text(getattr(item, "text_body", None))[:280],
                        }
                        grouped[key] = group
                    group["messages_count"] += 1
                    if not bool(getattr(item, "is_read", False)):
                        group["unread_count"] += 1
                    attachments_count = len(getattr(item, "attachments", None) or [])
                    group["has_attachments"] = bool(group["has_attachments"] or attachments_count > 0)
                    group["attachments_count"] = max(int(group["attachments_count"]), attachments_count)
                    if received_iso and (
                        not group.get("last_received_at")
                        or str(received_iso) > str(group.get("last_received_at"))
                    ):
                        group["last_received_at"] = received_iso
                        group["preview"] = _normalize_text(getattr(item, "text_body", None))[:280]
                        group["subject"] = _normalize_text(getattr(item, "subject", "")) or "(без темы)"
                    for participant in participants:
                        value = _normalize_text(participant).lower()
                        if value and value not in group["participants_set"]:
                            group["participants_set"].add(value)
                            group["participants"].append(value)
                scanned += len(batch_items)
                scan_offset += len(batch_items)
                if len(batch_items) < self._SEARCH_BATCH_SIZE:
                    break

        conversations = [
            {
                "conversation_id": item["conversation_id"],
                "subject": item["subject"],
                "participants": item["participants"],
                "messages_count": int(item["messages_count"]),
                "unread_count": int(item["unread_count"]),
                "last_received_at": item["last_received_at"],
                "has_attachments": bool(item["has_attachments"]),
                "attachments_count": int(item["attachments_count"]),
                "preview": item["preview"],
            }
            for item in grouped.values()
            if not unread_only or int(item["unread_count"]) > 0
        ]
        conversations.sort(key=lambda item: item.get("last_received_at") or "", reverse=True)
        total = len(conversations)
        page_items = conversations[safe_offset: safe_offset + safe_limit]
        next_offset = safe_offset + len(page_items)
        return {
            "items": page_items,
            "folder": _normalize_text(folder, "inbox"),
            "limit": safe_limit,
            "offset": safe_offset,
            "total": total,
            "has_more": next_offset < total,
            "next_offset": next_offset if next_offset < total else None,
            "search_limited": False,
            "searched_window": scanned,
        }

    def get_conversation(
        self,
        *,
        user_id: int,
        conversation_id: str,
        folder: str = "inbox",
        folder_scope: str = "current",
    ) -> dict[str, Any]:
        conversation_key = _normalize_text(conversation_id)
        if not conversation_key:
            raise MailServiceError("Conversation id is required")

        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        items_raw = []
        last_folder_key = _normalize_text(folder, "inbox")
        targets = self._search_target_folders(
            account,
            folder=_normalize_text(folder, "inbox"),
            folder_scope=_normalize_text(folder_scope, "current"),
        )
        for folder_obj, folder_key in targets:
            last_folder_key = folder_key
            queryset = self._folder_queryset(folder_obj, folder_key)
            scanned = 0
            while True:
                batch_items = list(queryset[scanned: scanned + self._SEARCH_BATCH_SIZE])
                if not batch_items:
                    break
                for item in batch_items:
                    if self._item_conversation_key(item) == conversation_key:
                        items_raw.append((item, folder_key))
                scanned += len(batch_items)
                if len(batch_items) < self._SEARCH_BATCH_SIZE:
                    break

        # Fallback: some clients may accidentally pass an Exchange item id
        # instead of conversation key. Resolve and retry by derived key.
        if not items_raw:
            try:
                folder_key_from_message, exchange_id = self._decode_message_id(conversation_key)
                folder_obj, last_folder_key = self._resolve_folder(account, folder_key_from_message)
                direct_item = folder_obj.get(id=exchange_id)
            except Exception:
                direct_item = None
            if direct_item is not None:
                conversation_key = self._item_conversation_key(direct_item)
            try:
                if direct_item is None:
                    folder_obj, last_folder_key = self._resolve_folder(account, folder)
                    direct_item = folder_obj.get(id=conversation_key)
            except Exception:
                direct_item = None

            if direct_item is not None:
                derived_key = self._item_conversation_key(direct_item)
                if derived_key:
                    conversation_key = derived_key
                items_raw = []
                for folder_obj, folder_key in targets:
                    last_folder_key = folder_key
                    queryset = self._folder_queryset(folder_obj, folder_key)
                    scanned = 0
                    while True:
                        batch_items = list(queryset[scanned: scanned + self._SEARCH_BATCH_SIZE])
                        if not batch_items:
                            break
                        for item in batch_items:
                            if self._item_conversation_key(item) == conversation_key:
                                items_raw.append((item, folder_key))
                        scanned += len(batch_items)
                        if len(batch_items) < self._SEARCH_BATCH_SIZE:
                            break
                if not items_raw:
                    items_raw = [(direct_item, last_folder_key)]

        if not items_raw:
            raise MailServiceError("Conversation not found")

        items_raw.sort(key=lambda pair: getattr(pair[0], "datetime_received", None) or getattr(pair[0], "datetime_created", None) or datetime.min.replace(tzinfo=timezone.utc))
        items = [
            self._serialize_message_detail(
                item=item,
                folder_key=item_folder_key,
                mailbox_email=profile["email"],
            )
            for item, item_folder_key in items_raw
        ]
        participants: list[str] = []
        seen: set[str] = set()
        for item in items:
            for value in [item.get("sender"), *(item.get("to") or []), *(item.get("cc") or [])]:
                email = _normalize_text(value).lower()
                if not email or email in seen:
                    continue
                seen.add(email)
                participants.append(email)

        return {
            "conversation_id": conversation_key,
            "subject": items[-1].get("subject") or "(без темы)",
            "participants": participants,
            "messages_count": len(items),
            "unread_count": sum(1 for item in items if not item.get("is_read")),
            "last_received_at": items[-1].get("received_at"),
            "items": items,
        }

    def save_draft(
        self,
        *,
        user_id: int,
        draft_id: str = "",
        compose_mode: str = "draft",
        to: list[str] | None = None,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
        subject: str = "",
        body: str = "",
        is_html: bool = True,
        reply_to_message_id: str = "",
        forward_message_id: str = "",
        retain_existing_attachments: list[str] | None = None,
        attachments: list[tuple[str, bytes]] | None = None,
    ) -> dict[str, Any]:
        safe_attachments = attachments or []
        self._validate_outgoing_attachments_dynamic(safe_attachments)
        retain_tokens = [self.resolve_attachment_id(token) for token in (retain_existing_attachments or []) if _normalize_text(token)]

        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )

        try:
            from exchangelib import HTMLBody, Mailbox, Message
            from exchangelib.attachments import FileAttachment
        except Exception as exc:
            raise MailServiceError("exchangelib package is not installed") from exc

        existing_item = None
        draft_exchange_id = ""
        if draft_id:
            folder_key, draft_exchange_id = self._decode_message_id(draft_id)
            if folder_key != "drafts":
                raise MailServiceError("Draft id must point to drafts folder")
            try:
                existing_item = account.drafts.get(id=draft_exchange_id)
            except Exception:
                existing_item = None

        to_recipients = [Mailbox(email_address=email) for email in _parse_recipients(";".join(to or []))]
        cc_recipients = [Mailbox(email_address=email) for email in _parse_recipients(";".join(cc or []))]
        bcc_recipients = [Mailbox(email_address=email) for email in _parse_recipients(";".join(bcc or []))]
        body_payload = HTMLBody(_normalize_text(body)) if is_html else _normalize_text(body)

        try:
            if existing_item is None:
                draft_item = Message(
                    account=account,
                    folder=account.drafts,
                    subject=_normalize_text(subject),
                    body=body_payload,
                    to_recipients=to_recipients,
                    cc_recipients=cc_recipients,
                    bcc_recipients=bcc_recipients,
                )
                for filename, content in safe_attachments:
                    draft_item.attach(FileAttachment(name=filename, content=content))
                draft_item.save()
            else:
                draft_item = existing_item
                draft_item.subject = _normalize_text(subject)
                draft_item.body = body_payload
                draft_item.to_recipients = to_recipients
                draft_item.cc_recipients = cc_recipients
                draft_item.bcc_recipients = bcc_recipients
                for att in list(getattr(draft_item, "attachments", None) or []):
                    att_id = _normalize_text(getattr(getattr(att, "attachment_id", None), "id", ""))
                    if att_id and att_id in retain_tokens:
                        continue
                    try:
                        att.detach()
                    except Exception:
                        pass
                for filename, content in safe_attachments:
                    draft_item.attach(FileAttachment(name=filename, content=content))
                draft_item.save(update_fields=["subject", "body", "to_recipients", "cc_recipients", "bcc_recipients"])

            draft_exchange_id = _normalize_text(getattr(draft_item, "id", ""))
            self._save_draft_context(
                user_id=int(user_id),
                draft_exchange_id=draft_exchange_id,
                compose_mode=_normalize_text(compose_mode, "draft"),
                reply_to_message_id=_normalize_text(reply_to_message_id) or None,
                forward_message_id=_normalize_text(forward_message_id) or None,
            )
            detail = self._serialize_message_detail(
                item=draft_item,
                folder_key="drafts",
                mailbox_email=profile["email"],
                draft_context=self._get_draft_context(user_id=int(user_id), draft_exchange_id=draft_exchange_id),
            )
            return {
                "ok": True,
                "draft_id": detail["id"],
                "saved_at": _utc_now_iso(),
                "attachments": detail["attachments"],
                "message": detail,
            }
        except Exception as exc:
            raise MailServiceError(f"Failed to save draft: {exc}") from exc

    def delete_draft(self, *, user_id: int, draft_id: str) -> dict[str, Any]:
        folder_key, exchange_id = self._decode_message_id(draft_id)
        if folder_key != "drafts":
            raise MailServiceError("Draft id must point to drafts folder")
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        try:
            item = account.drafts.get(id=exchange_id)
            item.delete()
            self._delete_draft_context(draft_exchange_id=exchange_id)
            return {"ok": True, "draft_id": draft_id}
        except Exception as exc:
            raise MailServiceError(f"Failed to delete draft: {exc}") from exc

    def download_attachment(self, *, user_id: int, message_id: str, attachment_id: str) -> tuple[str, str, bytes]:
        folder_key, exchange_id = self._decode_message_id(message_id)
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        folder_obj, _ = self._resolve_folder(account, folder_key)
        try:
            item = folder_obj.get(id=exchange_id)
        except Exception as exc:
            raise MailServiceError(f"Message not found: {exchange_id}") from exc

        try:
            from exchangelib.attachments import FileAttachment
            for att in getattr(item, "attachments", []) or []:
                att_id = _normalize_text(getattr(getattr(att, "attachment_id", None), "id", ""))
                if att_id == attachment_id:
                    if isinstance(att, FileAttachment):
                        content = att.content
                        if not content:
                            # Sometimes we need to download it explicitly if not pre-fetched
                            account.protocol.get_attachments([att])
                            content = att.content
                        return (
                            _normalize_text(getattr(att, "name", "attachment.bin")),
                            _normalize_text(getattr(att, "content_type", "application/octet-stream")),
                            content or b"",
                        )
            raise MailServiceError(f"Attachment not found: {attachment_id}")
        except Exception as exc:
            raise MailServiceError(f"Failed to download attachment: {exc}") from exc

    def _log_message(
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
        exchange_item_id: Optional[str] = None,
        error_text: Optional[str] = None,
    ) -> None:
        self._maybe_cleanup_message_log()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self._LOG_TABLE}
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

    def send_message(
        self,
        *,
        user_id: int,
        to: list[str],
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
        subject: str,
        body: str,
        is_html: bool = True,
        attachments: list[tuple[str, bytes]] = None,
        reply_to_message_id: str = "",
        forward_message_id: str = "",
        draft_id: str = "",
    ) -> dict[str, Any]:
        recipients = [item for item in _parse_recipients(";".join(to or [])) if item]
        cc_recipients = [item for item in _parse_recipients(";".join(cc or [])) if item]
        bcc_recipients = [item for item in _parse_recipients(";".join(bcc or [])) if item]
        if not recipients:
            raise MailServiceError("At least one recipient is required")
        safe_attachments = attachments or []
        self._validate_outgoing_attachments_dynamic(safe_attachments)

        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )

        message_id = _normalize_text(base64.urlsafe_b64encode(os.urandom(12)).decode("utf-8"))
        final_subject = _normalize_text(subject)
        final_body = _normalize_text(body)
        signature = _normalize_text(profile["signature"])
        if signature:
            separator = "<br><br>" if is_html else "\n\n"
            final_body = f"{final_body}{separator}{signature}" if final_body else signature

        try:
            from exchangelib import HTMLBody, Mailbox, Message
            from exchangelib.attachments import FileAttachment
        except Exception as exc:
            raise MailServiceError("exchangelib package is not installed") from exc

        try:
            to_recipients = [Mailbox(email_address=email) for email in recipients]
            cc_mailboxes = [Mailbox(email_address=email) for email in cc_recipients]
            bcc_mailboxes = [Mailbox(email_address=email) for email in bcc_recipients]
            body_payload = HTMLBody(final_body) if is_html else final_body
            msg_kwargs = dict(
                account=account,
                folder=account.sent,
                subject=final_subject,
                body=body_payload,
                to_recipients=to_recipients,
                cc_recipients=cc_mailboxes,
                bcc_recipients=bcc_mailboxes,
            )
            reply_source_id = _normalize_text(reply_to_message_id)
            forward_source_id = _normalize_text(forward_message_id)
            reference_ids: list[str] = []

            if reply_source_id:
                reply_folder_key, reply_exchange_id = self._decode_message_id(reply_source_id)
                reply_folder_obj, _ = self._resolve_folder(account, reply_folder_key)
                try:
                    reply_item = reply_folder_obj.get(id=reply_exchange_id)
                except Exception as exc:
                    raise MailServiceError(f"Reply source message not found: {exc}") from exc
                reply_message_id = self._item_message_id(reply_item)
                if reply_message_id:
                    msg_kwargs["in_reply_to"] = reply_message_id
                    reference_ids.append(reply_message_id)
                existing_references = _normalize_text(getattr(reply_item, "references", None))
                if existing_references:
                    reference_ids.extend([part for part in existing_references.split() if part])

            if forward_source_id:
                forward_folder_key, forward_exchange_id = self._decode_message_id(forward_source_id)
                forward_folder_obj, _ = self._resolve_folder(account, forward_folder_key)
                try:
                    forward_item = forward_folder_obj.get(id=forward_exchange_id)
                except Exception as exc:
                    raise MailServiceError(f"Forward source message not found: {exc}") from exc
                forward_message_id_value = self._item_message_id(forward_item)
                if forward_message_id_value:
                    reference_ids.append(forward_message_id_value)

            if reference_ids:
                unique_references: list[str] = []
                seen_references: set[str] = set()
                for value in reference_ids:
                    item_value = _normalize_text(value)
                    if not item_value or item_value in seen_references:
                        continue
                    seen_references.add(item_value)
                    unique_references.append(item_value)
                if unique_references:
                    msg_kwargs["references"] = " ".join(unique_references)

            msg = Message(**msg_kwargs)
            if safe_attachments:
                for filename, content in safe_attachments:
                    att = FileAttachment(name=filename, content=content)
                    msg.attach(att)

            msg.send_and_save()
            if draft_id:
                try:
                    self.delete_draft(user_id=int(user_id), draft_id=draft_id)
                except Exception:
                    logger.warning("Mail draft cleanup failed after send: draft_id=%s", draft_id)
            self._log_message(
                message_id=message_id,
                user_id=int(profile["user"]["id"]),
                username=_normalize_text(profile["user"].get("username")),
                direction="outgoing",
                folder_hint="sent",
                subject=final_subject,
                recipients=recipients,
                status="sent",
                exchange_item_id=_normalize_text(getattr(msg, "id", "")) or None,
            )
            return {
                "ok": True,
                "message_id": message_id,
                "subject": final_subject,
                "recipients": recipients,
                "cc": cc_recipients,
                "bcc": bcc_recipients,
            }
        except Exception as exc:
            self._log_message(
                message_id=message_id,
                user_id=int(profile["user"]["id"]),
                username=_normalize_text(profile["user"].get("username")),
                direction="outgoing",
                folder_hint="sent",
                subject=final_subject,
                recipients=recipients,
                status="failed",
                error_text=str(exc),
            )
            raise MailServiceError(f"Failed to send message: {exc}") from exc

    @classmethod
    def _normalize_field_options(cls, value: Any) -> list[str]:
        if value is None:
            return []
        raw_options: list[Any]
        if isinstance(value, str):
            raw_options = [part for part in re.split(r"[;\n]+", value) if _normalize_text(part)]
        elif isinstance(value, list):
            raw_options = value
        else:
            raise MailServiceError("Template field options must be an array or string")

        normalized: list[str] = []
        seen: set[str] = set()
        for item in raw_options:
            if isinstance(item, dict):
                option_value = _normalize_text(item.get("value") or item.get("label"))
            else:
                option_value = _normalize_text(item)
            if not option_value:
                continue
            if option_value in seen:
                continue
            seen.add(option_value)
            normalized.append(option_value)
        return normalized

    @classmethod
    def _normalize_template_field(cls, raw_field: Any, index: int = 0) -> dict[str, Any]:
        if not isinstance(raw_field, dict):
            raise MailServiceError("Each template field must be an object")
        key = _normalize_text(raw_field.get("key")).lower()
        key = re.sub(r"[^a-z0-9_.-]", "_", key)
        key = re.sub(r"_+", "_", key).strip("_")
        if not key:
            raise MailServiceError("Template field key is required")

        field_type = _normalize_text(raw_field.get("type"), "text").lower()
        if field_type not in cls._FIELD_TYPES:
            raise MailServiceError(f"Unsupported template field type: {field_type}")

        label = _normalize_text(raw_field.get("label"), key)
        placeholder = _normalize_text(raw_field.get("placeholder"))
        help_text = _normalize_text(raw_field.get("help_text"))
        default_value = raw_field.get("default_value")
        required = bool(raw_field.get("required", True))
        try:
            order = int(raw_field.get("order", index))
        except Exception:
            order = index
        options = cls._normalize_field_options(raw_field.get("options"))
        if field_type in {"select", "multiselect"} and not options:
            raise MailServiceError(f"Field '{key}' requires non-empty options")
        if field_type not in {"select", "multiselect"}:
            options = []

        if field_type == "checkbox":
            default_normalized: Any = bool(default_value)
        elif field_type == "multiselect":
            if isinstance(default_value, list):
                default_normalized = [item for item in cls._normalize_field_options(default_value) if item in options]
            else:
                default_normalized = []
        else:
            default_normalized = _normalize_text(default_value)

        return {
            "key": key,
            "label": label,
            "type": field_type,
            "required": required,
            "placeholder": placeholder,
            "help_text": help_text,
            "default_value": default_normalized,
            "options": options,
            "order": order,
        }

    @classmethod
    def _normalize_template_fields(cls, raw_fields: Any) -> list[dict[str, Any]]:
        if not isinstance(raw_fields, list):
            raise MailServiceError("Template fields must be an array")
        normalized = [cls._normalize_template_field(item, idx) for idx, item in enumerate(raw_fields)]
        normalized.sort(key=lambda item: int(item.get("order", 0)))
        return normalized

    @classmethod
    def _parse_template_fields_json(cls, raw_json: str) -> list[dict[str, Any]]:
        try:
            loaded = json.loads(raw_json or "[]")
        except Exception as exc:
            raise MailServiceError("Template fields JSON is invalid") from exc
        return cls._normalize_template_fields(loaded)

    def _migrate_legacy_template_fields(self) -> None:
        migrated_count = 0
        deactivated_count = 0
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT id, required_fields_json, is_active FROM {self._TEMPLATES_TABLE}"
            ).fetchall()
            for row in rows:
                template_id = _normalize_text(row["id"])
                raw = _normalize_text(row["required_fields_json"], "[]")
                try:
                    loaded = json.loads(raw or "[]")
                except Exception:
                    conn.execute(
                        f"UPDATE {self._TEMPLATES_TABLE} SET is_active = 0, updated_at = ? WHERE id = ?",
                        (_utc_now_iso(), template_id),
                    )
                    deactivated_count += 1
                    logger.warning("Template %s disabled during migration: invalid fields JSON", template_id)
                    continue

                if not isinstance(loaded, list):
                    conn.execute(
                        f"UPDATE {self._TEMPLATES_TABLE} SET is_active = 0, updated_at = ? WHERE id = ?",
                        (_utc_now_iso(), template_id),
                    )
                    deactivated_count += 1
                    logger.warning("Template %s disabled during migration: fields payload is not an array", template_id)
                    continue

                is_new_schema = all(isinstance(item, dict) and _normalize_text(item.get("type")) for item in loaded)
                try:
                    if is_new_schema:
                        normalized = self._normalize_template_fields(loaded)
                    else:
                        converted = []
                        for index, item in enumerate(loaded):
                            if not isinstance(item, dict):
                                raise MailServiceError("Legacy field entry must be an object")
                            converted.append(
                                {
                                    "key": _normalize_text(item.get("key")).lower(),
                                    "label": _normalize_text(item.get("label")),
                                    "type": "text",
                                    "required": bool(item.get("required", True)),
                                    "placeholder": _normalize_text(item.get("placeholder")),
                                    "help_text": "",
                                    "default_value": "",
                                    "options": [],
                                    "order": index,
                                }
                            )
                        normalized = self._normalize_template_fields(converted)
                    serialized = json.dumps(normalized, ensure_ascii=False)
                    if serialized != raw:
                        conn.execute(
                            f"UPDATE {self._TEMPLATES_TABLE} SET required_fields_json = ?, updated_at = ? WHERE id = ?",
                            (serialized, _utc_now_iso(), template_id),
                        )
                        migrated_count += 1
                except Exception as exc:
                    conn.execute(
                        f"UPDATE {self._TEMPLATES_TABLE} SET is_active = 0, updated_at = ? WHERE id = ?",
                        (_utc_now_iso(), template_id),
                    )
                    deactivated_count += 1
                    logger.warning("Template %s disabled during migration: %s", template_id, exc)
            conn.commit()

        if migrated_count or deactivated_count:
            logger.info(
                "IT template migration completed: migrated=%s deactivated=%s",
                migrated_count,
                deactivated_count,
            )

    @staticmethod
    def _value_to_template_string(value: Any) -> str:
        if isinstance(value, list):
            return ", ".join(_normalize_text(item) for item in value if _normalize_text(item))
        if isinstance(value, bool):
            return "Да" if value else "Нет"
        return _normalize_text(value)

    @classmethod
    def _render_template(cls, text: str, values: dict[str, Any]) -> str:
        source = _normalize_text(text)

        def _replace(match: re.Match[str]) -> str:
            key = _normalize_text(match.group(1))
            return cls._value_to_template_string(values.get(key))

        return re.sub(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}", _replace, source)

    @classmethod
    def _coerce_field_value(cls, field: dict[str, Any], raw_value: Any) -> Any:
        field_type = _normalize_text(field.get("type"), "text").lower()
        options = field.get("options") if isinstance(field.get("options"), list) else []
        default_value = field.get("default_value")
        value = raw_value if raw_value is not None else default_value

        if field_type == "checkbox":
            if isinstance(value, bool):
                return value
            return str(value).strip().lower() in {"1", "true", "yes", "on", "да"}

        if field_type == "multiselect":
            if isinstance(value, list):
                values = [_normalize_text(item) for item in value]
            else:
                values = [part for part in re.split(r"[;,]+", _normalize_text(value)) if _normalize_text(part)]
            filtered: list[str] = []
            seen: set[str] = set()
            for item in values:
                if item in seen:
                    continue
                if options and item not in options:
                    continue
                seen.add(item)
                filtered.append(item)
            return filtered

        text = _normalize_text(value)
        if field_type == "select":
            if not text:
                return ""
            if options and text not in options:
                raise MailServiceError(f"Field '{field.get('key')}' has unsupported value")
            return text
        if field_type == "email":
            if text and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", text):
                raise MailServiceError(f"Field '{field.get('key')}' must contain a valid email")
            return text
        if field_type == "tel":
            if text and not re.match(r"^[0-9+\-() ]{5,}$", text):
                raise MailServiceError(f"Field '{field.get('key')}' must contain a valid phone")
            return text
        if field_type == "date":
            if text and not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
                raise MailServiceError(f"Field '{field.get('key')}' must be in YYYY-MM-DD format")
            return text
        return text

    @classmethod
    def _validate_template_values(cls, template_fields: list[dict[str, Any]], values: dict[str, Any]) -> dict[str, Any]:
        normalized_values: dict[str, Any] = {}
        missing: list[str] = []
        for field in template_fields:
            key = _normalize_text(field.get("key"))
            if not key:
                continue
            coerced = cls._coerce_field_value(field, values.get(key))
            normalized_values[key] = coerced

            if not bool(field.get("required", True)):
                continue
            field_type = _normalize_text(field.get("type"))
            if field_type == "checkbox":
                if coerced is not True:
                    missing.append(key)
                continue
            if field_type == "multiselect":
                if not isinstance(coerced, list) or len(coerced) == 0:
                    missing.append(key)
                continue
            if not _normalize_text(coerced):
                missing.append(key)

        if missing:
            raise MailServiceError(f"Missing required template fields: {', '.join(missing)}")
        return normalized_values

    @classmethod
    def _validate_attachments_limits(
        cls,
        attachments: list[tuple[str, bytes]],
        *,
        max_files: int,
        max_file_size: int,
        max_total_size: int,
    ) -> None:
        safe_attachments = attachments or []
        if len(safe_attachments) > int(max_files):
            raise MailPayloadTooLargeError(
                f"Too many attachments. Maximum is {int(max_files)}"
            )
        total_size = 0
        for filename, content in safe_attachments:
            size = len(content or b"")
            if size > int(max_file_size):
                raise MailPayloadTooLargeError(
                    f"Attachment '{_normalize_text(filename, 'attachment.bin')}' exceeds {int(max_file_size) // (1024 * 1024)}MB limit"
                )
            total_size += size
            if total_size > int(max_total_size):
                raise MailPayloadTooLargeError(
                    f"Total attachment size exceeds {int(max_total_size) // (1024 * 1024)}MB limit"
                )

    @classmethod
    def _validate_it_attachments(cls, attachments: list[tuple[str, bytes]]) -> None:
        cls._validate_attachments_limits(
            attachments,
            max_files=cls._MAX_IT_FILES,
            max_file_size=cls._MAX_IT_FILE_SIZE,
            max_total_size=cls._MAX_IT_TOTAL_SIZE,
        )

    @classmethod
    def _validate_outgoing_attachments(cls, attachments: list[tuple[str, bytes]]) -> None:
        cls._validate_attachments_limits(
            attachments,
            max_files=cls._MAX_MAIL_FILES,
            max_file_size=cls._MAX_MAIL_FILE_SIZE,
            max_total_size=cls._MAX_MAIL_TOTAL_SIZE,
        )

    def _validate_outgoing_attachments_dynamic(self, attachments: list[tuple[str, bytes]]) -> None:
        self._validate_attachments_limits(
            attachments,
            max_files=self.max_mail_files,
            max_file_size=self.max_mail_file_size,
            max_total_size=self.max_mail_total_size,
        )

    def search_contacts(self, user_id: int, q: str) -> list[dict[str, str]]:
        query = _normalize_text(q)
        if len(query) < 2:
            return []
        
        try:
            profile = self._resolve_user_mail_profile(user_id, require_password=True)
            account = self._create_account(
                email=profile["email"],
                login=profile["login"],
                password=profile["password"]
            )
            # resolve_names searches in GAL and personal contacts
            results = account.protocol.resolve_names(
                names=[query], 
                search_scope='ActiveDirectory', 
                return_full_contact_data=False
            )
            contacts = []
            for item in results:
                name = _normalize_text(item.name)
                email = _normalize_text(item.email_address)
                if email and {'name': name, 'email': email} not in contacts:
                    contacts.append({"name": name, "email": email})
            return contacts
        except Exception as exc:
            logger.warning("Error searching contacts in GAL (user_id=%s, q=%s): %s", user_id, query, exc)
            raise MailServiceError(f"Failed to search contacts: {exc}") from exc

    def list_templates(self, *, active_only: bool = True) -> list[dict[str, Any]]:
        where_sql = "WHERE is_active = 1" if active_only else ""
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT *
                FROM {self._TEMPLATES_TABLE}
                {where_sql}
                ORDER BY updated_at DESC, title COLLATE NOCASE
                """
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            try:
                item["fields"] = self._parse_template_fields_json(item.get("required_fields_json") or "[]")
            except MailServiceError:
                item["fields"] = []
            result.append(item)
        return result

    def get_template(self, template_id: str, *, active_only: bool = False) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(template_id)
        if not normalized_id:
            return None
        sql = f"SELECT * FROM {self._TEMPLATES_TABLE} WHERE id = ?"
        params: list[Any] = [normalized_id]
        if active_only:
            sql += " AND is_active = 1"
        with self._lock, self._connect() as conn:
            row = conn.execute(sql, tuple(params)).fetchone()
        if row is None:
            return None
        item = dict(row)
        try:
            item["fields"] = self._parse_template_fields_json(item.get("required_fields_json") or "[]")
        except MailServiceError:
            item["fields"] = []
        return item

    def create_template(self, *, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
        if "required_fields" in payload:
            raise MailServiceError("required_fields is no longer supported. Use fields")
        template_id = _normalize_text(payload.get("id")) or base64.urlsafe_b64encode(os.urandom(9)).decode("utf-8")
        code = _normalize_text(payload.get("code")).lower()
        title = _normalize_text(payload.get("title"))
        subject_template = _normalize_text(payload.get("subject_template"))
        body_template_md = _normalize_text(payload.get("body_template_md"))
        category = _normalize_text(payload.get("category"))
        template_fields = self._normalize_template_fields(payload.get("fields") or [])
        if not code:
            raise MailServiceError("Template code is required")
        if not title:
            raise MailServiceError("Template title is required")
        if not subject_template:
            raise MailServiceError("Template subject is required")
        now = _utc_now_iso()

        with self._lock, self._connect() as conn:
            exists = conn.execute(
                f"SELECT id FROM {self._TEMPLATES_TABLE} WHERE code = ?",
                (code,),
            ).fetchone()
            if exists is not None:
                raise MailServiceError(f"Template code already exists: {code}")
            conn.execute(
                f"""
                INSERT INTO {self._TEMPLATES_TABLE}
                (id, code, title, category, subject_template, body_template_md, required_fields_json, is_active,
                 created_by_user_id, created_by_username, updated_by_user_id, updated_by_username, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
                """,
                (
                    template_id,
                    code,
                    title,
                    category,
                    subject_template,
                    body_template_md,
                    json.dumps(template_fields, ensure_ascii=False),
                    int(actor.get("id") or 0),
                    _normalize_text(actor.get("username")),
                    int(actor.get("id") or 0),
                    _normalize_text(actor.get("username")),
                    now,
                    now,
                ),
            )
            conn.commit()
        created = self.get_template(template_id)
        if not created:
            raise MailServiceError("Template was not created")
        return created

    def update_template(self, *, template_id: str, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
        current = self.get_template(template_id, active_only=False)
        if current is None:
            raise MailServiceError("Template not found")
        if "required_fields" in payload:
            raise MailServiceError("required_fields is no longer supported. Use fields")
        fields: list[str] = []
        params: list[Any] = []

        if "code" in payload:
            code = _normalize_text(payload.get("code")).lower()
            if not code:
                raise MailServiceError("Template code cannot be empty")
            fields.append("code = ?")
            params.append(code)
        if "title" in payload:
            title = _normalize_text(payload.get("title"))
            if not title:
                raise MailServiceError("Template title cannot be empty")
            fields.append("title = ?")
            params.append(title)
        if "category" in payload:
            fields.append("category = ?")
            params.append(_normalize_text(payload.get("category")))
        if "subject_template" in payload:
            subject_template = _normalize_text(payload.get("subject_template"))
            if not subject_template:
                raise MailServiceError("Template subject cannot be empty")
            fields.append("subject_template = ?")
            params.append(subject_template)
        if "body_template_md" in payload:
            fields.append("body_template_md = ?")
            params.append(_normalize_text(payload.get("body_template_md")))
        if "fields" in payload:
            template_fields = self._normalize_template_fields(payload.get("fields") or [])
            fields.append("required_fields_json = ?")
            params.append(json.dumps(template_fields, ensure_ascii=False))
        if "is_active" in payload:
            fields.append("is_active = ?")
            params.append(1 if bool(payload.get("is_active")) else 0)

        if not fields:
            return current
        fields.extend(["updated_by_user_id = ?", "updated_by_username = ?", "updated_at = ?"])
        params.extend([int(actor.get("id") or 0), _normalize_text(actor.get("username")), _utc_now_iso()])
        params.append(_normalize_text(template_id))

        with self._lock, self._connect() as conn:
            conn.execute(
                f"UPDATE {self._TEMPLATES_TABLE} SET {', '.join(fields)} WHERE id = ?",
                tuple(params),
            )
            conn.commit()
        updated = self.get_template(template_id, active_only=False)
        if updated is None:
            raise MailServiceError("Template not found after update")
        return updated

    def delete_template(self, *, template_id: str, actor: dict[str, Any]) -> bool:
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT id FROM {self._TEMPLATES_TABLE} WHERE id = ?", (_normalize_text(template_id),)).fetchone()
            if row is None:
                return False
            conn.execute(
                f"""
                UPDATE {self._TEMPLATES_TABLE}
                SET is_active = 0, updated_by_user_id = ?, updated_by_username = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    int(actor.get("id") or 0),
                    _normalize_text(actor.get("username")),
                    _utc_now_iso(),
                    _normalize_text(template_id),
                ),
            )
            conn.commit()
        return True

    def get_my_config(self, *, user_id: int) -> dict[str, Any]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")
        mailbox_email = _normalize_text(user.get("mailbox_email") or user.get("email")) or None
        mailbox_login = _normalize_text(user.get("mailbox_login") or mailbox_email) or None
        signature = _normalize_text(user.get("mail_signature_html")) or None
        password_enc = _normalize_text(user.get("mailbox_password_enc"))
        return {
            "user_id": int(user.get("id") or 0),
            "username": _normalize_text(user.get("username")),
            "mailbox_email": mailbox_email,
            "mailbox_login": mailbox_login,
            "mail_signature_html": signature,
            "mail_is_configured": bool(mailbox_email and mailbox_login and password_enc),
            "mail_updated_at": _normalize_text(user.get("mail_updated_at")) or None,
        }

    def update_user_config(
        self,
        *,
        user_id: int,
        mailbox_email: Optional[str] | object = _UNSET,
        mailbox_login: Optional[str] | object = _UNSET,
        mailbox_password: Optional[str] | object = _UNSET,
        mail_signature_html: Optional[str] | object = _UNSET,
    ) -> dict[str, Any]:
        update_payload: dict[str, Any] = {}
        if mailbox_email is not _UNSET:
            update_payload["mailbox_email"] = mailbox_email
        if mailbox_login is not _UNSET:
            update_payload["mailbox_login"] = mailbox_login
        if mailbox_password is not _UNSET:
            update_payload["mailbox_password"] = mailbox_password
        if mail_signature_html is not _UNSET:
            update_payload["mail_signature_html"] = mail_signature_html
        updated = user_service.update_user(
            int(user_id),
            **update_payload,
        )
        if not updated:
            raise MailServiceError("User not found")
        return self.get_my_config(user_id=int(user_id))

    def test_connection(self, *, user_id: int) -> dict[str, Any]:
        profile = self._resolve_user_mail_profile(int(user_id), require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        inbox = account.inbox
        sample = list(inbox.all().order_by("-datetime_received")[:1])
        return {
            "ok": True,
            "exchange_host": self.exchange_host,
            "ews_url": self.exchange_ews_url,
            "mailbox_email": profile["email"],
            "sample_size": len(sample),
        }

    def send_it_request(
        self,
        *,
        user_id: int,
        template_id: str,
        fields: dict[str, Any],
        attachments: Optional[list[tuple[str, bytes]]] = None,
    ) -> dict[str, Any]:
        template = self.get_template(template_id, active_only=True)
        if template is None:
            raise MailServiceError("Template not found")

        recipients = list(self._IT_REQUEST_RECIPIENTS)

        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")

        template_fields = template.get("fields") if isinstance(template.get("fields"), list) else []
        normalized_user_fields = self._validate_template_values(template_fields, fields or {})

        values = {
            "full_name": _normalize_text(user.get("full_name") or user.get("username")),
            "username": _normalize_text(user.get("username")),
            "mailbox_email": _normalize_text(user.get("mailbox_email") or user.get("email")),
            "date": datetime.now().strftime("%Y-%m-%d"),
            **normalized_user_fields,
        }

        subject = self._render_template(_normalize_text(template.get("subject_template")), values)
        body = self._render_template(_normalize_text(template.get("body_template_md")), values)
        body_html = _plain_text_to_html(body)
        safe_attachments = attachments or []
        self._validate_it_attachments(safe_attachments)

        return self.send_message(
            user_id=int(user_id),
            to=recipients,
            subject=subject,
            body=body_html,
            is_html=True,
            attachments=safe_attachments,
        )


mail_service = MailService()
