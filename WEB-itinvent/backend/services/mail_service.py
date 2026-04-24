"""
Mail service for Exchange (EWS/NTLM) inbox access, sending and IT request templates.
"""
from __future__ import annotations

import base64
from collections import OrderedDict
from dataclasses import dataclass, field
import email.policy
import html
from html.parser import HTMLParser
import json
import logging
import os
import re
import sqlite3
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime, timedelta, timezone
from email.parser import BytesParser
from pathlib import Path
from threading import Event, RLock
from typing import Any, Optional
from urllib.parse import quote

from backend.appdb.db import get_app_database_url, get_app_engine, initialize_app_schema, is_app_database_configured
from backend.appdb.sql_compat import SqlAlchemyCompatConnection
from backend.db_schema import schema_name
from local_store import get_local_store
from backend.services.secret_crypto_service import SecretCryptoError, decrypt_secret, encrypt_secret
from backend.services.request_auth_context_service import get_request_session_id
from backend.services.session_auth_context_service import normalize_exchange_login, session_auth_context_service
from backend.services.user_service import build_default_ldap_mailbox_email, user_service

logger = logging.getLogger(__name__)
_UNSET = object()
_MAIL_REQUEST_CONTEXT: ContextVar[dict[str, Any] | None] = ContextVar("mail_request_context", default=None)
_MAIL_REQUEST_METRICS: ContextVar[dict[str, Any] | None] = ContextVar("mail_request_metrics", default=None)


@dataclass
class _RuntimeCacheEntry:
    bucket: str
    expires_at: datetime
    value: Any
    size_bytes: int = 0


@dataclass(frozen=True)
class _RuntimeCachePolicy:
    max_entries: int
    ttl_sec: int
    max_total_bytes: int | None = None
    max_entry_bytes: int | None = None


@dataclass
class _SingleflightCall:
    event: Event = field(default_factory=Event)
    result: Any = None
    error: Exception | None = None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _plain_text_to_html(text: Any) -> str:
    value = str(text or "")
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    return html.escape(normalized).replace("\n", "<br>")


_OUTGOING_MAIL_BODY_STYLE = (
    "margin:0;"
    "padding:0;"
    "font-family:Aptos, Calibri, Arial, Helvetica, sans-serif;"
    "font-size:11pt;"
    "line-height:1.5;"
)
_OUTGOING_WRAPPER_PATTERN = re.compile(
    r'^\s*<div\b[^>]*data-mail-outgoing=(["\'])true\1[^>]*>(?P<body>[\s\S]*)</div>\s*$',
    re.IGNORECASE,
)
_OUTGOING_SIGNATURE_WRAPPER_PATTERN = re.compile(
    r'^\s*<div\b[^>]*data-mail-signature=(["\'])true\1[^>]*>(?P<body>[\s\S]*)</div>\s*$',
    re.IGNORECASE,
)
_OUTGOING_QUOTED_MARKERS = (
    '<div class="quoted-mail"',
    "<div class='quoted-mail'",
    'class="quoted-mail"',
    "class='quoted-mail'",
    'class="gmail_quote"',
    "class='gmail_quote'",
    'class="protonmail_quote"',
    "class='protonmail_quote'",
    'class="yahoo_quoted"',
    "class='yahoo_quoted'",
    'class="moz-cite-prefix"',
    "class='moz-cite-prefix'",
    'data-mail-quoted-history',
)
_OUTGOING_QUOTED_HEADER_PATTERN = re.compile(r"(from|sent|date|to|subject|от|дата|кому|тема)\s*:", re.IGNORECASE)
_SIGNATURE_LINE_STYLE_PROPS = {
    "margin": "0 0 4px 0",
    "line-height": "1.35",
}
_OUTGOING_DEFAULT_TEXT_COLOR = "#000000"
_OUTGOING_LOW_CONTRAST_ON_WHITE = 2.4
_OUTGOING_NAMED_COLORS = {
    "black": "#000000",
    "white": "#ffffff",
}


def _parse_css_color_component(value: Any) -> int:
    raw = _normalize_text(value)
    if not raw:
        return 0
    try:
        if raw.endswith("%"):
            return round((float(raw[:-1]) / 100) * 255)
        return round(float(raw))
    except Exception:
        return 0


def _parse_css_alpha_component(value: Any) -> float:
    raw = _normalize_text(value)
    if not raw:
        return 1.0
    try:
        if raw.endswith("%"):
            return max(0.0, min(1.0, float(raw[:-1]) / 100))
        return max(0.0, min(1.0, float(raw)))
    except Exception:
        return 1.0


def _clamp_color_byte(value: int) -> int:
    return max(0, min(255, int(value)))


def _parse_outgoing_css_color(value: Any) -> dict[str, float] | None:
    raw = _normalize_text(value).lower()
    raw = re.sub(r"\s*!important\s*$", "", raw, flags=re.IGNORECASE).strip()
    if not raw or raw in {"transparent", "inherit", "initial", "currentcolor"}:
        return None
    raw = _OUTGOING_NAMED_COLORS.get(raw, raw)

    hex_match = re.match(r"^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$", raw, re.IGNORECASE)
    if hex_match:
        hex_value = hex_match.group(1)
        if len(hex_value) <= 4:
            parts = [part * 2 for part in [hex_value[0], hex_value[1], hex_value[2], hex_value[3] if len(hex_value) > 3 else "f"]]
        else:
            parts = [hex_value[0:2], hex_value[2:4], hex_value[4:6], hex_value[6:8] or "ff"]
        return {
            "r": int(parts[0], 16),
            "g": int(parts[1], 16),
            "b": int(parts[2], 16),
            "a": int(parts[3], 16) / 255,
        }

    rgb_match = re.match(r"^rgba?\((.+)\)$", raw, re.IGNORECASE)
    if not rgb_match:
        return None
    parts = [part for part in re.split(r"[,\s]+", re.sub(r"\s*/\s*", " ", rgb_match.group(1))) if part]
    if len(parts) < 3:
        return None
    return {
        "r": _clamp_color_byte(_parse_css_color_component(parts[0])),
        "g": _clamp_color_byte(_parse_css_color_component(parts[1])),
        "b": _clamp_color_byte(_parse_css_color_component(parts[2])),
        "a": _parse_css_alpha_component(parts[3]) if len(parts) >= 4 else 1.0,
    }


def _srgb_to_linear(value: float) -> float:
    normalized = value / 255
    if normalized <= 0.03928:
        return normalized / 12.92
    return ((normalized + 0.055) / 1.055) ** 2.4


def _relative_luminance(color: dict[str, float]) -> float:
    return (
        (0.2126 * _srgb_to_linear(color["r"]))
        + (0.7152 * _srgb_to_linear(color["g"]))
        + (0.0722 * _srgb_to_linear(color["b"]))
    )


def _contrast_ratio(left_color: dict[str, float], right_color: dict[str, float]) -> float:
    left = _relative_luminance(left_color)
    right = _relative_luminance(right_color)
    lighter = max(left, right)
    darker = min(left, right)
    return (lighter + 0.05) / (darker + 0.05)


def _is_low_contrast_outgoing_text_color(value: Any) -> bool:
    color = _parse_outgoing_css_color(value)
    if not color or color["a"] <= 0.05:
        return False
    return _contrast_ratio(color, {"r": 255, "g": 255, "b": 255, "a": 1}) < _OUTGOING_LOW_CONTRAST_ON_WHITE


def _merge_outgoing_readable_text_style(style_value: Any) -> str:
    declarations: list[str] = []
    changed = False
    for part in str(style_value or "").split(";"):
        declaration = part.strip()
        if not declaration or ":" not in declaration:
            continue
        name, raw_value = declaration.split(":", 1)
        if name.strip().lower() == "color" and _is_low_contrast_outgoing_text_color(raw_value):
            declarations.append(f"color:{_OUTGOING_DEFAULT_TEXT_COLOR}")
            changed = True
        else:
            declarations.append(declaration)
    if not changed:
        return str(style_value or "")
    return ";".join(declarations) + ";"


def _merge_signature_line_style(style_value: Any) -> str:
    normalized_style = _merge_outgoing_readable_text_style(style_value)
    declarations: list[str] = []
    for part in str(normalized_style or "").split(";"):
        declaration = part.strip()
        if not declaration or ":" not in declaration:
            continue
        name = declaration.split(":", 1)[0].strip().lower()
        if name in _SIGNATURE_LINE_STYLE_PROPS:
            continue
        declarations.append(declaration)
    declarations.extend(f"{name}:{value}" for name, value in _SIGNATURE_LINE_STYLE_PROPS.items())
    return ";".join(declarations) + ";"


class _SignatureSpacingHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []

    @staticmethod
    def _format_attrs(attrs: list[tuple[str, str | None]]) -> str:
        formatted: list[str] = []
        for name, value in attrs:
            if value is None:
                formatted.append(f" {name}")
                continue
            formatted.append(f' {name}="{html.escape(str(value), quote=True)}"')
        return "".join(formatted)

    @staticmethod
    def _should_compact(tag: str, attrs: list[tuple[str, str | None]]) -> bool:
        if tag.lower() not in {"p", "div"}:
            return False
        attr_names = {str(name or "").lower() for name, _ in attrs}
        return "data-mail-outgoing" not in attr_names and "data-mail-signature" not in attr_names

    @classmethod
    def _compact_attrs(cls, tag: str, attrs: list[tuple[str, str | None]]) -> list[tuple[str, str | None]]:
        if not cls._should_compact(tag, attrs):
            return attrs
        next_attrs: list[tuple[str, str | None]] = []
        style_seen = False
        for name, value in attrs:
            if str(name or "").lower() == "style":
                next_attrs.append((name, _merge_signature_line_style(value)))
                style_seen = True
            else:
                next_attrs.append((name, value))
        if not style_seen:
            next_attrs.append(("style", _merge_signature_line_style("")))
        return next_attrs

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.parts.append(f"<{tag}{self._format_attrs(self._compact_attrs(tag, attrs))}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.parts.append(f"<{tag}{self._format_attrs(self._compact_attrs(tag, attrs))}>")

    def handle_endtag(self, tag: str) -> None:
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.parts.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str) -> None:
        self.parts.append(f"<!{decl}>")

    def get_html(self) -> str:
        return "".join(self.parts)


class _OutgoingReadableTextHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []

    @staticmethod
    def _format_attrs(attrs: list[tuple[str, str | None]]) -> str:
        formatted: list[str] = []
        for name, value in attrs:
            if value is None:
                formatted.append(f" {name}")
                continue
            formatted.append(f' {name}="{html.escape(str(value), quote=True)}"')
        return "".join(formatted)

    @staticmethod
    def _normalize_attrs(attrs: list[tuple[str, str | None]]) -> list[tuple[str, str | None]]:
        next_attrs: list[tuple[str, str | None]] = []
        for name, value in attrs:
            if str(name or "").lower() == "style":
                next_attrs.append((name, _merge_outgoing_readable_text_style(value)))
            else:
                next_attrs.append((name, value))
        return next_attrs

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.parts.append(f"<{tag}{self._format_attrs(self._normalize_attrs(attrs))}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.parts.append(f"<{tag}{self._format_attrs(self._normalize_attrs(attrs))}>")

    def handle_endtag(self, tag: str) -> None:
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.parts.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str) -> None:
        self.parts.append(f"<!{decl}>")

    def get_html(self) -> str:
        return "".join(self.parts)


def _normalize_outgoing_readable_text_colors(value: Any) -> str:
    source = _normalize_text(value)
    if not source:
        return ""
    parser = _OutgoingReadableTextHtmlParser()
    try:
        parser.feed(source)
        parser.close()
    except Exception:
        return source
    return _normalize_text(parser.get_html())


def _normalize_signature_line_spacing(value: Any) -> str:
    source = _normalize_text(value)
    if not source:
        return ""
    parser = _SignatureSpacingHtmlParser()
    try:
        parser.feed(source)
        parser.close()
    except Exception:
        return source
    return _normalize_text(parser.get_html())


def _unwrap_outgoing_html_wrapper(value: Any, *, pattern: re.Pattern[str]) -> str:
    source = _normalize_text(value)
    if not source:
        return ""
    match = pattern.match(source)
    if not match:
        return source
    return _normalize_text(match.group("body"))


def _normalize_signature_html(value: Any) -> str:
    without_outgoing_wrapper = _unwrap_outgoing_html_wrapper(value, pattern=_OUTGOING_WRAPPER_PATTERN)
    without_signature_wrapper = _unwrap_outgoing_html_wrapper(
        without_outgoing_wrapper,
        pattern=_OUTGOING_SIGNATURE_WRAPPER_PATTERN,
    )
    return _normalize_outgoing_readable_text_colors(_normalize_signature_line_spacing(without_signature_wrapper))


def _split_outgoing_html_for_signature(body_html: Any, *, prefer_blockquote_split: bool = False) -> tuple[str, str]:
    source = _normalize_text(body_html)
    if not source:
        return "", ""

    lowered = source.lower()
    split_indexes: list[int] = []
    for marker in _OUTGOING_QUOTED_MARKERS:
        idx = lowered.find(marker.lower())
        if idx > 0:
            split_indexes.append(idx)

    if prefer_blockquote_split and not split_indexes:
        blockquote_idx = lowered.find("<blockquote")
        if blockquote_idx > 0 and _OUTGOING_QUOTED_HEADER_PATTERN.search(source[:blockquote_idx]):
            split_indexes.append(blockquote_idx)

    if not split_indexes:
        return source, ""

    split_index = min(split_indexes)
    primary_html = source[:split_index].rstrip()
    quoted_html = source[split_index:].lstrip()
    return primary_html, quoted_html


def _wrap_outgoing_html_fragment(fragment_html: Any) -> str:
    source = _normalize_text(fragment_html)
    if not source:
        return ""
    return f'<div data-mail-outgoing="true" style="{_OUTGOING_MAIL_BODY_STYLE}">{source}</div>'


def _build_outgoing_html_body(
    body_html: Any,
    signature_html: Any = "",
    *,
    prefer_signature_before_quote: bool = False,
) -> str:
    body_source = _normalize_outgoing_readable_text_colors(body_html)
    signature_source = _normalize_signature_html(signature_html)

    primary_html, quoted_html = _split_outgoing_html_for_signature(
        body_source,
        prefer_blockquote_split=prefer_signature_before_quote,
    ) if prefer_signature_before_quote else (body_source, "")

    has_primary_html = bool(primary_html)
    has_signature_html = bool(signature_source)

    parts: list[str] = []
    if primary_html:
        parts.append(primary_html)
    if signature_source:
        signature_margin_top = "16px" if has_primary_html else "0"
        parts.append(
            f'<div data-mail-signature="true" style="margin:{signature_margin_top} 0 0 0;">{signature_source}</div>'
        )
    if quoted_html:
        quoted_margin_top = "16px" if (has_primary_html or has_signature_html) else "0"
        parts.append(
            f'<div data-mail-quoted-block="true" style="margin:{quoted_margin_top} 0 0 0;">{quoted_html}</div>'
        )

    if not parts and body_source:
        parts.append(body_source)
    if not parts and signature_source:
        parts.append(signature_source)

    return _wrap_outgoing_html_fragment("".join(parts))


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

    def __init__(self, message: str, *, code: str = "MAIL_ERROR", status_code: int = 400) -> None:
        super().__init__(message)
        self.code = str(code or "MAIL_ERROR")
        self.status_code = int(status_code or 400)


class MailPayloadTooLargeError(MailServiceError):
    """Payload is too large (attachments count/size limits)."""


class MailService:
    _USER_MAILBOXES_TABLE = "user_mailboxes"
    _TEMPLATES_TABLE = "mail_it_templates"
    _LOG_TABLE = "mail_messages_log"
    _RESTORE_HINTS_TABLE = "mail_restore_hints"
    _DRAFT_CONTEXT_TABLE = "mail_draft_context"
    _FOLDER_FAVORITES_TABLE = "mail_folder_favorites"
    _VISIBLE_CUSTOM_FOLDERS_TABLE = "mail_visible_custom_folders"
    _USER_PREFS_TABLE = "mail_user_preferences"
    _ATTACHMENT_TOKEN_PREFIX = "att2_"
    _ATTACHMENT_TOKEN_PREFIX_LEGACY = "att1_"
    _IT_REQUEST_RECIPIENTS = ["it@zsgp.ru"]
    _SEARCH_WINDOW_LIMIT = 1000
    _SEARCH_BATCH_SIZE = 250
    _MAX_IT_FILES = 10
    _MAX_IT_FILE_SIZE = 15 * 1024 * 1024
    _MAX_IT_TOTAL_SIZE = 25 * 1024 * 1024
    _MAX_MAIL_FILES = 10
    _MAX_MAIL_FILE_SIZE = 15 * 1024 * 1024
    _MAX_MAIL_TOTAL_SIZE = 25 * 1024 * 1024
    _INLINE_ATTACHMENT_EMBED_MAX_SIZE = 256 * 1024
    _MAIL_LOG_RETENTION_DAYS_DEFAULT = 90
    _MAIL_CACHE_TTL_SEC_DEFAULT = 90
    _MAIL_BOOTSTRAP_DEFAULT_LIMIT = 20
    _CACHE_BUCKET_POLICIES = {
        "folder_summary": _RuntimeCachePolicy(max_entries=200, ttl_sec=90),
        "folder_tree": _RuntimeCachePolicy(max_entries=100, ttl_sec=90),
        "unread_count": _RuntimeCachePolicy(max_entries=200, ttl_sec=60),
        "messages": _RuntimeCachePolicy(max_entries=300, ttl_sec=90),
        "message_detail": _RuntimeCachePolicy(max_entries=300, ttl_sec=180),
        "conversation_detail": _RuntimeCachePolicy(max_entries=100, ttl_sec=120),
        "attachment_content": _RuntimeCachePolicy(
            max_entries=32,
            ttl_sec=60,
            max_total_bytes=64 * 1024 * 1024,
            max_entry_bytes=2 * 1024 * 1024,
        ),
        "notification_feed": _RuntimeCachePolicy(max_entries=100, ttl_sec=30),
    }
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
    _ACTIVE_MAILBOX_PREF_KEY = "active_mailbox_id"
    _PASSWORD_REQUIRED_MESSAGES = {
        "mailbox password is not configured",
        "mailbox password is empty",
        "mailbox password is required",
    }
    _AUTH_FAILURE_MARKERS = (
        "401",
        "unauthorized",
        "unauthorised",
        "invalid credentials",
        "authentication failed",
        "auth failed",
        "logon failure",
        "password is incorrect",
        "password incorrect",
        "user name or password is incorrect",
        "the specified network password is not correct",
        "network password is not correct",
        "access is denied",
    )

    def __init__(self, *, database_url: str | None = None) -> None:
        explicit_database_url = str(database_url or "").strip() or None
        self._database_url = get_app_database_url(explicit_database_url) if (explicit_database_url or is_app_database_configured()) else None
        self._use_app_db = bool(self._database_url)
        self.db_path = None if self._use_app_db else Path(get_local_store().db_path)
        self._app_schema = schema_name("app", self._database_url)
        self._lock = RLock()
        self._last_log_cleanup_at: datetime | None = None
        self._cache_lock = RLock()
        self._runtime_cache: OrderedDict[str, _RuntimeCacheEntry] = OrderedDict()
        self._singleflight_lock = RLock()
        self._singleflight_calls: dict[str, _SingleflightCall] = {}
        if self._use_app_db and self._database_url:
            if str(self._database_url).lower().startswith("sqlite"):
                logger.warning(
                    "Mail runtime is using SQLite-backed APP_DATABASE_URL; use a PostgreSQL-compatible app DB for stable multi-user mail load."
                )
            initialize_app_schema(self._database_url)
        self._ensure_schema()
        self._migrate_legacy_template_fields()
        self._cleanup_message_log()
        # Globally disable TLS verification for Exchange connections if configured.
        if not self.verify_tls:
            self._disable_tls_verification()

    @property
    def mail_cache_ttl_sec(self) -> int:
        raw = _normalize_text(
            os.getenv("MAIL_CACHE_TTL_SEC"),
            str(self._MAIL_CACHE_TTL_SEC_DEFAULT),
        )
        try:
            return max(5, min(300, int(raw)))
        except Exception:
            return self._MAIL_CACHE_TTL_SEC_DEFAULT

    @property
    def mail_bootstrap_default_limit(self) -> int:
        raw = _normalize_text(
            os.getenv("MAIL_BOOTSTRAP_DEFAULT_LIMIT"),
            str(self._MAIL_BOOTSTRAP_DEFAULT_LIMIT),
        )
        try:
            return max(10, min(100, int(raw)))
        except Exception:
            return self._MAIL_BOOTSTRAP_DEFAULT_LIMIT

    def _cache_policy(self, bucket: str) -> _RuntimeCachePolicy:
        normalized_bucket = _normalize_text(bucket)
        return self._CACHE_BUCKET_POLICIES.get(
            normalized_bucket,
            _RuntimeCachePolicy(max_entries=100, ttl_sec=self.mail_cache_ttl_sec),
        )

    def _cache_key(self, *, user_id: int, bucket: str, extra: str = "", mailbox_scope: str = "") -> str:
        normalized_extra = _normalize_text(extra)
        normalized_scope = _normalize_text(mailbox_scope, "global")
        return f"{int(user_id)}::{_normalize_text(bucket)}::{normalized_scope}::{normalized_extra}"

    def _singleflight_key(self, *, user_id: int, bucket: str, extra: str = "", mailbox_scope: str = "") -> str:
        return f"singleflight::{self._cache_key(user_id=int(user_id), bucket=bucket, extra=extra, mailbox_scope=mailbox_scope)}"

    @classmethod
    def _estimate_cache_value_size(cls, value: Any) -> int:
        if value is None:
            return 0
        if isinstance(value, (bytes, bytearray)):
            return len(value)
        if isinstance(value, str):
            return len(value.encode("utf-8", "ignore"))
        if isinstance(value, bool):
            return 1
        if isinstance(value, (int, float)):
            return 8
        if isinstance(value, dict):
            return sum(
                cls._estimate_cache_value_size(key) + cls._estimate_cache_value_size(item)
                for key, item in value.items()
            )
        if isinstance(value, (list, tuple, set, frozenset)):
            return sum(cls._estimate_cache_value_size(item) for item in value)
        return len(repr(value).encode("utf-8", "ignore"))

    def _remove_cache_entry_locked(self, key: str) -> _RuntimeCacheEntry | None:
        return self._runtime_cache.pop(key, None)

    def _prune_expired_cache_locked(self, *, now: datetime | None = None) -> int:
        current_time = now or datetime.now(timezone.utc)
        removed = 0
        for key, entry in list(self._runtime_cache.items()):
            if entry.expires_at > current_time:
                continue
            self._remove_cache_entry_locked(key)
            removed += 1
        return removed

    def _bucket_cache_stats_locked(self, bucket: str) -> tuple[int, int]:
        count = 0
        total_bytes = 0
        for entry in self._runtime_cache.values():
            if entry.bucket != bucket:
                continue
            count += 1
            total_bytes += max(0, int(entry.size_bytes or 0))
        return count, total_bytes

    def _enforce_cache_policy_locked(self, bucket: str, policy: _RuntimeCachePolicy) -> int:
        removed = 0
        count, total_bytes = self._bucket_cache_stats_locked(bucket)
        while count > policy.max_entries or (
            policy.max_total_bytes is not None and total_bytes > policy.max_total_bytes
        ):
            removed_key = None
            removed_entry = None
            for key, entry in self._runtime_cache.items():
                if entry.bucket != bucket:
                    continue
                removed_key = key
                removed_entry = entry
                break
            if removed_key is None or removed_entry is None:
                break
            self._remove_cache_entry_locked(removed_key)
            removed += 1
            count -= 1
            total_bytes -= max(0, int(removed_entry.size_bytes or 0))
        return removed

    def _cache_get(self, *, user_id: int, bucket: str, extra: str = "", mailbox_scope: str = "") -> Any:
        key = self._cache_key(user_id=int(user_id), bucket=bucket, extra=extra, mailbox_scope=mailbox_scope)
        normalized_bucket = _normalize_text(bucket)
        self._set_request_metric("cache_bucket", normalized_bucket)
        with self._cache_lock:
            entry = self._runtime_cache.get(key)
            if not entry:
                return None
            if entry.expires_at <= datetime.now(timezone.utc):
                self._remove_cache_entry_locked(key)
                return None
            self._runtime_cache.move_to_end(key)
            return entry.value

    def _cache_set(
        self,
        *,
        user_id: int,
        bucket: str,
        value: Any,
        extra: str = "",
        ttl_sec: int | None = None,
        mailbox_scope: str = "",
    ) -> Any:
        normalized_bucket = _normalize_text(bucket)
        policy = self._cache_policy(normalized_bucket)
        ttl = max(1, int(ttl_sec or policy.ttl_sec))
        entry_size = self._estimate_cache_value_size(value)
        if policy.max_entry_bytes is not None and entry_size > policy.max_entry_bytes:
            self._set_request_metric("cache_bucket", normalized_bucket)
            return value
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=ttl)
        key = self._cache_key(user_id=int(user_id), bucket=normalized_bucket, extra=extra, mailbox_scope=mailbox_scope)
        evicted = 0
        with self._cache_lock:
            evicted += self._prune_expired_cache_locked(now=now)
            if key in self._runtime_cache:
                self._remove_cache_entry_locked(key)
            self._runtime_cache[key] = _RuntimeCacheEntry(
                bucket=normalized_bucket,
                expires_at=expires_at,
                value=value,
                size_bytes=entry_size,
            )
            self._runtime_cache.move_to_end(key)
            evicted += self._enforce_cache_policy_locked(normalized_bucket, policy)
        self._set_request_metric("cache_bucket", normalized_bucket)
        if evicted > 0:
            current_evicted = int(self.get_request_metrics().get("cache_evicted") or 0)
            self._set_request_metric("cache_evicted", current_evicted + int(evicted))
        return value

    def invalidate_user_cache(self, *, user_id: int, prefixes: list[str] | tuple[str, ...] | None = None) -> None:
        normalized_prefixes = {
            _normalize_text(prefix)
            for prefix in (prefixes or ())
            if _normalize_text(prefix)
        }
        if "message_detail" in normalized_prefixes:
            normalized_prefixes.add("attachment_content")
        user_prefix = f"{int(user_id)}::"
        with self._cache_lock:
            keys_to_delete = []
            for key in list(self._runtime_cache.keys()):
                if not key.startswith(user_prefix):
                    continue
                if normalized_prefixes:
                    if not any(key.startswith(f"{user_prefix}{prefix}::") for prefix in normalized_prefixes):
                        continue
                keys_to_delete.append(key)
            for key in keys_to_delete:
                self._remove_cache_entry_locked(key)

    def _cached_summary(self, *, user_id: int, mailbox_id: str = "") -> dict[str, dict[str, int]] | None:
        return self._cache_get(user_id=int(user_id), bucket="folder_summary", mailbox_scope=mailbox_id)

    def _cached_tree(self, *, user_id: int, mailbox_id: str = "") -> dict[str, Any] | None:
        return self._cache_get(user_id=int(user_id), bucket="folder_tree", mailbox_scope=mailbox_id)

    def _cached_unread_count(self, *, user_id: int, mailbox_scope: str = "aggregate") -> int | None:
        return self._cache_get(user_id=int(user_id), bucket="unread_count", mailbox_scope=mailbox_scope)

    def _cached_messages(
        self,
        *,
        user_id: int,
        mailbox_id: str = "",
        folder: str,
        folder_scope: str,
        limit: int,
        offset: int,
        unread_only: bool,
    ) -> dict[str, Any] | None:
        extra = f"{folder}|{folder_scope}|{limit}|{offset}|{int(bool(unread_only))}"
        return self._cache_get(
            user_id=int(user_id),
            bucket="messages",
            extra=extra,
            mailbox_scope=mailbox_id,
        )

    def _cached_message_detail(self, *, user_id: int, mailbox_id: str = "", message_id: str) -> dict[str, Any] | None:
        return self._cache_get(
            user_id=int(user_id),
            bucket="message_detail",
            extra=_normalize_text(message_id),
            mailbox_scope=mailbox_id,
        )

    def _update_cached_message_detail_read_state(
        self,
        *,
        user_id: int,
        mailbox_id: str = "",
        message_id: str,
        is_read: bool,
    ) -> None:
        cache_key = self._cache_key(
            user_id=int(user_id),
            bucket="message_detail",
            extra=_normalize_text(message_id),
            mailbox_scope=mailbox_id,
        )
        now = datetime.now(timezone.utc)
        with self._cache_lock:
            entry = self._runtime_cache.get(cache_key)
            if not entry:
                return
            if entry.expires_at <= now:
                self._remove_cache_entry_locked(cache_key)
                return
            value = entry.value
            if not isinstance(value, dict):
                return
            next_value = dict(value)
            next_value["is_read"] = bool(is_read)
            entry.value = next_value
            self._runtime_cache.move_to_end(cache_key)

    def _cached_attachment_content(
        self,
        *,
        user_id: int,
        mailbox_id: str = "",
        message_id: str,
        attachment_id: str,
    ) -> tuple[str, str, bytes] | None:
        return self._cache_get(
            user_id=int(user_id),
            bucket="attachment_content",
            extra=f"{_normalize_text(message_id)}|{_normalize_text(attachment_id)}",
            mailbox_scope=mailbox_id,
        )

    def _cached_conversation_detail(
        self,
        *,
        user_id: int,
        mailbox_id: str = "",
        conversation_id: str,
        folder: str,
        folder_scope: str,
    ) -> dict[str, Any] | None:
        extra = f"{_normalize_text(conversation_id)}|{_normalize_text(folder, 'inbox')}|{_normalize_text(folder_scope, 'current')}"
        return self._cache_get(
            user_id=int(user_id),
            bucket="conversation_detail",
            extra=extra,
            mailbox_scope=mailbox_id,
        )

    def push_request_context(self) -> tuple[Any, Any]:
        return _MAIL_REQUEST_CONTEXT.set({}), _MAIL_REQUEST_METRICS.set({})

    def pop_request_context(self, tokens: tuple[Any, Any]) -> None:
        context_token, metrics_token = tokens
        _MAIL_REQUEST_CONTEXT.reset(context_token)
        _MAIL_REQUEST_METRICS.reset(metrics_token)

    def get_request_metrics(self) -> dict[str, Any]:
        metrics = _MAIL_REQUEST_METRICS.get()
        if not metrics:
            return {}
        return dict(metrics)

    def _set_request_metric(self, key: str, value: Any) -> None:
        metrics = _MAIL_REQUEST_METRICS.get()
        if metrics is None:
            return
        metrics[str(key)] = value

    def _run_singleflight(self, *, key: str, producer) -> Any:
        with self._singleflight_lock:
            call = self._singleflight_calls.get(key)
            if call is None:
                call = _SingleflightCall()
                self._singleflight_calls[key] = call
                leader = True
                self._set_request_metric("singleflight_hit", 0)
            else:
                leader = False
                self._set_request_metric("singleflight_hit", 1)

        if not leader:
            call.event.wait()
            if call.error is not None:
                raise call.error
            return call.result

        try:
            call.result = producer()
            return call.result
        except Exception as exc:
            call.error = exc
            raise
        finally:
            call.event.set()
            with self._singleflight_lock:
                if self._singleflight_calls.get(key) is call:
                    self._singleflight_calls.pop(key, None)

    def _resolve_account_context(self, *, user_id: int, mailbox_id: str | None = None, require_password: bool) -> dict[str, Any]:
        normalized_user_id = int(user_id)
        resolved_mailbox_id = _normalize_text(mailbox_id)
        request_context = _MAIL_REQUEST_CONTEXT.get()
        if (
            request_context
            and request_context.get("user_id") == normalized_user_id
            and _normalize_text(request_context.get("mailbox_id")) == resolved_mailbox_id
            and bool(request_context.get("require_password")) == bool(require_password)
            and request_context.get("profile")
            and request_context.get("account") is not None
        ):
            self._set_request_metric("account_reused", 1)
            return request_context

        profile = self._resolve_mail_profile(
            user_id=normalized_user_id,
            mailbox_id=resolved_mailbox_id or None,
            require_password=bool(require_password),
        )
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        context = {
            "user_id": normalized_user_id,
            "mailbox_id": _normalize_text(profile.get("mailbox_id")) or resolved_mailbox_id,
            "require_password": bool(require_password),
            "profile": profile,
            "account": account,
        }
        if request_context is not None:
            request_context.clear()
            request_context.update(context)
        self._set_request_metric("account_reused", 0)
        return context

    def _resolve_mail_profile(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        require_password: bool,
    ) -> dict[str, Any]:
        normalized_mailbox_id = _normalize_text(mailbox_id)
        if normalized_mailbox_id:
            return self._resolve_user_mail_profile(
                int(user_id),
                mailbox_id=normalized_mailbox_id,
                require_password=bool(require_password),
            )
        return self._resolve_user_mail_profile(
            int(user_id),
            require_password=bool(require_password),
        )

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
        if self._use_app_db and self._database_url:
            return SqlAlchemyCompatConnection(
                get_app_engine(self._database_url),
                table_names=self._mail_table_names(),
                schema=self._app_schema,
            )
        conn = sqlite3.connect(str(self.db_path), timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _mail_table_names(self) -> set[str]:
        return {
            self._USER_MAILBOXES_TABLE,
            self._TEMPLATES_TABLE,
            self._LOG_TABLE,
            self._RESTORE_HINTS_TABLE,
            self._DRAFT_CONTEXT_TABLE,
            self._FOLDER_FAVORITES_TABLE,
            self._VISIBLE_CUSTOM_FOLDERS_TABLE,
            self._USER_PREFS_TABLE,
        }

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

                CREATE TABLE IF NOT EXISTS {self._USER_MAILBOXES_TABLE} (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    label TEXT NOT NULL DEFAULT '',
                    mailbox_email TEXT NOT NULL,
                    mailbox_login TEXT NULL,
                    mailbox_password_enc TEXT NOT NULL DEFAULT '',
                    auth_mode TEXT NOT NULL DEFAULT 'stored_credentials',
                    is_primary INTEGER NOT NULL DEFAULT 0,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    last_selected_at TEXT NULL,
                    created_at TEXT NOT NULL,
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
                CREATE UNIQUE INDEX IF NOT EXISTS idx_{self._USER_MAILBOXES_TABLE}_user_email
                    ON {self._USER_MAILBOXES_TABLE}(user_id, mailbox_email);
                CREATE INDEX IF NOT EXISTS idx_{self._USER_MAILBOXES_TABLE}_user_active
                    ON {self._USER_MAILBOXES_TABLE}(user_id, is_active, sort_order);
                CREATE INDEX IF NOT EXISTS idx_{self._USER_MAILBOXES_TABLE}_user_primary
                    ON {self._USER_MAILBOXES_TABLE}(user_id, is_primary);
                """
            )
            conn.commit()
        self._migrate_legacy_user_mailboxes()

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

    def _generate_mailbox_id(self) -> str:
        return base64.urlsafe_b64encode(os.urandom(12)).decode("utf-8").rstrip("=")

    @staticmethod
    def _legacy_user_mail_auth_mode(user: dict[str, Any] | None) -> str:
        if _normalize_text((user or {}).get("mailbox_password_enc")):
            return "stored_credentials"
        return "primary_session" if MailService._mail_auth_mode_for_user(user) == "ad_auto" else "stored_credentials"

    def _build_legacy_mailbox_seed(self, user: dict[str, Any] | None) -> dict[str, Any] | None:
        if not user:
            return None
        mailbox_email = self._build_effective_mailbox_email(user)
        if not mailbox_email:
            return None
        return {
            "id": f"legacy-{int(user.get('id') or 0)}",
            "user_id": int(user.get("id") or 0),
            "label": _normalize_text(user.get("mailbox_email") or user.get("email") or mailbox_email) or "Основной ящик",
            "mailbox_email": mailbox_email,
            "mailbox_login": _normalize_text(user.get("mailbox_login")) or None,
            "mailbox_password_enc": _normalize_text(user.get("mailbox_password_enc")),
            "auth_mode": self._legacy_user_mail_auth_mode(user),
            "is_primary": True,
            "is_active": True,
            "sort_order": 0,
            "last_selected_at": None,
            "created_at": _normalize_text(user.get("created_at")) or _utc_now_iso(),
            "updated_at": _normalize_text(user.get("updated_at")) or _utc_now_iso(),
        }

    def _ensure_user_mailboxes_seeded(self, *, user_id: int) -> None:
        normalized_user_id = int(user_id)
        with self._lock, self._connect() as conn:
            existing = conn.execute(
                f"SELECT id FROM {self._USER_MAILBOXES_TABLE} WHERE user_id = ? LIMIT 1",
                (normalized_user_id,),
            ).fetchone()
            if existing is not None:
                return
        user = user_service.get_by_id(normalized_user_id)
        seed = self._build_legacy_mailbox_seed(user)
        if not seed:
            return
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT OR IGNORE INTO {self._USER_MAILBOXES_TABLE}
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
                    _normalize_text(seed["id"]),
                    normalized_user_id,
                    _normalize_text(seed["label"]) or "Основной ящик",
                    _normalize_text(seed["mailbox_email"]).lower(),
                    _normalize_text(seed.get("mailbox_login")) or None,
                    _normalize_text(seed.get("mailbox_password_enc")),
                    _normalize_text(seed.get("auth_mode"), "stored_credentials"),
                    True,
                    True,
                    int(seed.get("sort_order") or 0),
                    _normalize_text(seed.get("last_selected_at")) or now_iso,
                    _normalize_text(seed.get("created_at")) or now_iso,
                    _normalize_text(seed.get("updated_at")) or now_iso,
                ),
            )
            conn.commit()

    def _migrate_legacy_user_mailboxes(self) -> None:
        try:
            for user in user_service.list_users():
                user_id = int(user.get("id") or 0)
                if user_id <= 0:
                    continue
                self._ensure_user_mailboxes_seeded(user_id=user_id)
        except Exception:
            logger.warning("Mail legacy mailbox migration failed", exc_info=True)

    def _list_user_mailboxes_rows(
        self,
        *,
        user_id: int,
        include_inactive: bool = False,
    ) -> list[dict[str, Any]]:
        normalized_user_id = int(user_id)
        self._ensure_user_mailboxes_seeded(user_id=normalized_user_id)
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
            FROM {self._USER_MAILBOXES_TABLE}
            WHERE user_id = ?
        """
        params: list[Any] = [normalized_user_id]
        if not include_inactive:
            sql += " AND is_active = ?"
            params.append(True)
        sql += " ORDER BY is_primary DESC, sort_order ASC, LOWER(mailbox_email) ASC"
        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, tuple(params)).fetchall()
        return [dict(row) for row in rows]

    def _touch_mailbox_selected(self, *, user_id: int, mailbox_id: str) -> None:
        normalized_mailbox_id = _normalize_text(mailbox_id)
        if not normalized_mailbox_id:
            return
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {self._USER_MAILBOXES_TABLE}
                SET last_selected_at = ?, updated_at = ?
                WHERE user_id = ? AND id = ?
                """,
                (now_iso, now_iso, int(user_id), normalized_mailbox_id),
            )
            conn.commit()

    def _resolve_mailbox_row(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        allow_inactive: bool = False,
    ) -> dict[str, Any]:
        rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
        if not rows:
            raise MailServiceError("Mailbox email is not configured")
        normalized_mailbox_id = _normalize_text(mailbox_id)
        if normalized_mailbox_id:
            for row in rows:
                if _normalize_text(row.get("id")) == normalized_mailbox_id:
                    if not allow_inactive and not _to_bool(row.get("is_active"), default=False):
                        raise MailServiceError("Mailbox is inactive", status_code=409)
                    return row
            raise MailServiceError("Mailbox not found", status_code=404)

        def _row_sort_key(row: dict[str, Any]) -> tuple[int, float, int, str]:
            is_active = 1 if _to_bool(row.get("is_active"), default=True) else 0
            last_selected_raw = _normalize_text(row.get("last_selected_at"))
            try:
                last_selected = datetime.fromisoformat(last_selected_raw.replace("Z", "+00:00")).timestamp() if last_selected_raw else 0.0
            except Exception:
                last_selected = 0.0
            return (
                is_active,
                last_selected,
                1 if _to_bool(row.get("is_primary"), default=False) else 0,
                -int(row.get("sort_order") or 0),
            )

        candidates = rows if allow_inactive else [row for row in rows if _to_bool(row.get("is_active"), default=True)]
        if not candidates:
            raise MailServiceError("Mailbox is inactive", status_code=409)
        return sorted(candidates, key=_row_sort_key, reverse=True)[0]

    def _resolve_primary_mailbox_row(self, *, user_id: int, allow_inactive: bool = True) -> dict[str, Any] | None:
        rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
        for row in rows:
            if not _to_bool(row.get("is_primary"), default=False):
                continue
            if not allow_inactive and not _to_bool(row.get("is_active"), default=True):
                continue
            return row
        return None

    def _sync_primary_mailbox_to_legacy_user(self, *, user_id: int) -> None:
        user = user_service.get_by_id(int(user_id))
        if not user:
            return
        row = self._resolve_primary_mailbox_row(user_id=int(user_id), allow_inactive=True)
        if not row:
            return
        update_payload: dict[str, Any] = {
            "mailbox_email": _normalize_text(row.get("mailbox_email")) or None,
            "mailbox_login": _normalize_text(row.get("mailbox_login")) or None,
        }
        if _normalize_text(row.get("auth_mode")) == "stored_credentials":
            try:
                password = decrypt_secret(_normalize_text(row.get("mailbox_password_enc")))
            except Exception:
                password = ""
            if password:
                update_payload["mailbox_password"] = password
        updated = user_service.update_user(int(user_id), **update_payload)
        if not updated:
            logger.warning("Failed to sync primary mailbox to legacy user storage: user_id=%s", int(user_id))

    def _build_mailbox_profile(
        self,
        *,
        user: dict[str, Any],
        mailbox_row: dict[str, Any],
        require_password: bool,
    ) -> dict[str, Any]:
        auth_mode = _normalize_text(mailbox_row.get("auth_mode"), "stored_credentials").lower()
        email = _normalize_text(mailbox_row.get("mailbox_email")).lower()
        login = _normalize_text(mailbox_row.get("mailbox_login")).lower()
        signature = _normalize_signature_html(user.get("mail_signature_html"))
        if not email:
            raise MailServiceError("Mailbox email is not configured")
        if auth_mode == "primary_session":
            session_id = get_request_session_id()
            session_context = session_auth_context_service.get_session_context(
                session_id,
                user_id=int(user.get("id") or 0),
            )
            session_login = _normalize_text((session_context or {}).get("exchange_login")).lower()
            if session_login:
                login = session_login
            elif not login:
                username = _normalize_text((user or {}).get("username")).lower()
                login = normalize_exchange_login(username) if username else ""
        elif not login:
            login = email
        if not login:
            raise MailServiceError("Mailbox login is not configured")

        password = ""
        mail_requires_password = False
        mail_requires_relogin = False
        if require_password:
            if auth_mode == "primary_session":
                session_id = get_request_session_id()
                session_context = session_auth_context_service.get_session_context(
                    session_id,
                    user_id=int(user.get("id") or 0),
                )
                if not session_context:
                    raise MailServiceError(
                        "Mail access requires re-login",
                        code="MAIL_RELOGIN_REQUIRED",
                        status_code=409,
                    )
                password = session_auth_context_service.resolve_session_password(session_id, user_id=int(user.get("id") or 0))
                if not password:
                    raise MailServiceError(
                        "Mail access requires re-login",
                        code="MAIL_RELOGIN_REQUIRED",
                        status_code=409,
                    )
            else:
                password_enc = _normalize_text(mailbox_row.get("mailbox_password_enc"))
                if not password_enc:
                    raise MailServiceError(
                        "Mailbox password is not configured",
                        code="MAIL_PASSWORD_REQUIRED",
                        status_code=409,
                    )
                try:
                    password = decrypt_secret(password_enc)
                except SecretCryptoError as exc:
                    raise MailServiceError(str(exc)) from exc
                if not password:
                    raise MailServiceError(
                        "Mailbox password is empty",
                        code="MAIL_PASSWORD_REQUIRED",
                        status_code=409,
                    )
        else:
            if auth_mode == "primary_session":
                session_id = get_request_session_id()
                session_context = session_auth_context_service.get_session_context(
                    session_id,
                    user_id=int(user.get("id") or 0),
                )
                session_login = _normalize_text((session_context or {}).get("exchange_login")).lower()
                if session_login:
                    login = session_login
                mail_requires_relogin = not bool(
                    session_context and session_auth_context_service.resolve_session_password(session_id, user_id=int(user.get("id") or 0))
                )
            else:
                mail_requires_password = not bool(_normalize_text(mailbox_row.get("mailbox_password_enc")))

        mail_auth_mode = "ad_auto" if auth_mode == "primary_session" else "manual"
        return {
            "user": user,
            "mailbox_id": _normalize_text(mailbox_row.get("id")),
            "label": _normalize_text(mailbox_row.get("label")) or email,
            "email": email,
            "login": login,
            "password": password,
            "signature": signature,
            "mail_auth_mode": mail_auth_mode,
            "mail_requires_password": mail_requires_password,
            "mail_requires_relogin": mail_requires_relogin,
            "is_primary": _to_bool(mailbox_row.get("is_primary"), default=False),
            "is_active": _to_bool(mailbox_row.get("is_active"), default=True),
            "mail_is_configured": bool(email and login and not mail_requires_password and not mail_requires_relogin),
        }

    def _get_mailbox_unread_count(self, *, user_id: int, mailbox_id: str) -> int:
        cached = self._cached_unread_count(user_id=int(user_id), mailbox_scope=_normalize_text(mailbox_id))
        if cached is not None:
            return int(cached)
        mail_context = self._resolve_account_context(
            user_id=int(user_id),
            mailbox_id=_normalize_text(mailbox_id),
            require_password=True,
        )
        count = self._get_unread_count_from_account(account=mail_context["account"])
        self._cache_set(
            user_id=int(user_id),
            bucket="unread_count",
            mailbox_scope=_normalize_text(mailbox_id),
            value=int(count),
        )
        return int(count)

    def _serialize_mailbox_entry(
        self,
        *,
        user: dict[str, Any],
        mailbox_row: dict[str, Any],
        unread_count: int = 0,
        unread_count_state: str = "deferred",
        selected: bool = False,
    ) -> dict[str, Any]:
        profile = self._build_mailbox_profile(
            user=user,
            mailbox_row=mailbox_row,
            require_password=False,
        )
        return {
            "id": profile["mailbox_id"],
            "label": profile["label"],
            "mailbox_email": profile["email"],
            "mailbox_login": _normalize_text(mailbox_row.get("mailbox_login")) or None,
            "effective_mailbox_login": profile["login"] or None,
            "auth_mode": _normalize_text(mailbox_row.get("auth_mode"), "stored_credentials"),
            "mail_auth_mode": profile["mail_auth_mode"],
            "is_primary": bool(profile["is_primary"]),
            "is_active": bool(profile["is_active"]),
            "is_selected": bool(selected),
            "mail_requires_password": bool(profile["mail_requires_password"]),
            "mail_requires_relogin": bool(profile["mail_requires_relogin"]),
            "mail_is_configured": bool(profile["mail_is_configured"]),
            "mail_signature_html": _normalize_signature_html(user.get("mail_signature_html")) or None,
            "unread_count": max(0, int(unread_count or 0)),
            "unread_count_state": _normalize_text(unread_count_state, "deferred"),
            "last_selected_at": _normalize_text(mailbox_row.get("last_selected_at")) or None,
            "sort_order": int(mailbox_row.get("sort_order") or 0),
            "mail_updated_at": _normalize_text(user.get("mail_updated_at")) or None,
        }

    def list_user_mailboxes(
        self,
        *,
        user_id: int,
        include_inactive: bool = False,
        include_unread: bool = False,
        active_mailbox_id: str | None = None,
    ) -> list[dict[str, Any]]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")
        rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=include_inactive)
        selected_row = None
        try:
            selected_row = self._resolve_mailbox_row(user_id=int(user_id), allow_inactive=include_inactive)
        except MailServiceError:
            selected_row = None
        selected_id = _normalize_text((selected_row or {}).get("id"))
        preferred_fresh_mailbox_id = _normalize_text(active_mailbox_id) or selected_id
        items: list[dict[str, Any]] = []
        deferred_count = 0
        for row in rows:
            row_id = _normalize_text(row.get("id"))
            unread_count = 0
            unread_count_state = "deferred"
            row_active = _to_bool(row.get("is_active"), default=True)
            if row_active and row_id:
                should_fetch_fresh = bool(include_unread) or row_id == preferred_fresh_mailbox_id
                if should_fetch_fresh:
                    try:
                        unread_count = self._get_mailbox_unread_count(user_id=int(user_id), mailbox_id=row_id)
                        unread_count_state = "fresh"
                    except Exception:
                        cached_unread = self._cached_unread_count(user_id=int(user_id), mailbox_scope=row_id)
                        if cached_unread is not None:
                            unread_count = int(cached_unread)
                            unread_count_state = "stale"
                        else:
                            unread_count_state = "deferred"
                else:
                    cached_unread = self._cached_unread_count(user_id=int(user_id), mailbox_scope=row_id)
                    if cached_unread is not None:
                        unread_count = int(cached_unread)
                        unread_count_state = "stale"
                    else:
                        deferred_count += 1
            items.append(
                self._serialize_mailbox_entry(
                    user=user,
                    mailbox_row=row,
                    unread_count=unread_count,
                    unread_count_state=unread_count_state,
                    selected=row_id == selected_id,
                )
            )
        self._set_request_metric("mailbox_unread_deferred", deferred_count)
        return items

    def verify_mailbox_credentials(
        self,
        *,
        mailbox_email: str,
        mailbox_login: str,
        mailbox_password: str,
    ) -> dict[str, Any]:
        email = _normalize_text(mailbox_email).lower()
        login = _normalize_text(mailbox_login).lower()
        password = _normalize_text(mailbox_password)
        if not email:
            raise MailServiceError("Mailbox email is required")
        if not login:
            raise MailServiceError("Mailbox login is required")
        if not password:
            raise MailServiceError("Mailbox password is required", code="MAIL_PASSWORD_REQUIRED", status_code=409)
        try:
            account = self._create_account(email=email, login=login, password=password)
            list(account.inbox.all().order_by("-datetime_received")[:1])
        except MailServiceError:
            raise
        except Exception as exc:
            raise MailServiceError(f"Failed to verify mailbox credentials: {exc}") from exc
        return {"mailbox_email": email, "effective_mailbox_login": login}

    def create_user_mailbox(
        self,
        *,
        user_id: int,
        label: str,
        mailbox_email: str,
        mailbox_login: str,
        mailbox_password: str,
        is_primary: bool = False,
        is_active: bool = True,
    ) -> dict[str, Any]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")
        verified = self.verify_mailbox_credentials(
            mailbox_email=mailbox_email,
            mailbox_login=mailbox_login,
            mailbox_password=mailbox_password,
        )
        existing_rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
        normalized_email = _normalize_text(verified["mailbox_email"]).lower()
        if any(_normalize_text(item.get("mailbox_email")).lower() == normalized_email for item in existing_rows):
            raise MailServiceError("Mailbox is already connected", status_code=409)
        row_id = self._generate_mailbox_id()
        now_iso = _utc_now_iso()
        next_is_primary = bool(is_primary) or len(existing_rows) == 0
        next_sort_order = max([int(item.get("sort_order") or 0) for item in existing_rows] or [0]) + 1
        encrypted_password = encrypt_secret(_normalize_text(mailbox_password))
        with self._lock, self._connect() as conn:
            if next_is_primary:
                conn.execute(
                    f"UPDATE {self._USER_MAILBOXES_TABLE} SET is_primary = ?, updated_at = ? WHERE user_id = ?",
                    (False, now_iso, int(user_id)),
                )
            conn.execute(
                f"""
                INSERT INTO {self._USER_MAILBOXES_TABLE}
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
                    row_id,
                    int(user_id),
                    _normalize_text(label) or normalized_email,
                    normalized_email,
                    _normalize_text(mailbox_login).lower(),
                    encrypted_password,
                    "stored_credentials",
                    bool(next_is_primary),
                    bool(is_active),
                    next_sort_order,
                    now_iso if next_is_primary else None,
                    now_iso,
                    now_iso,
                ),
            )
            conn.commit()
        if next_is_primary:
            self._sync_primary_mailbox_to_legacy_user(user_id=int(user_id))
        self.invalidate_user_cache(user_id=int(user_id))
        row = self._resolve_mailbox_row(user_id=int(user_id), mailbox_id=row_id, allow_inactive=True)
        return self._serialize_mailbox_entry(user=user, mailbox_row=row, unread_count=0, selected=next_is_primary)

    def update_user_mailbox(
        self,
        *,
        user_id: int,
        mailbox_id: str,
        label: str | object = _UNSET,
        mailbox_email: str | object = _UNSET,
        mailbox_login: str | object = _UNSET,
        mailbox_password: str | object = _UNSET,
        auth_mode: str | object = _UNSET,
        is_primary: bool | object = _UNSET,
        is_active: bool | object = _UNSET,
        selected: bool | object = _UNSET,
    ) -> dict[str, Any]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")
        current = self._resolve_mailbox_row(user_id=int(user_id), mailbox_id=mailbox_id, allow_inactive=True)
        next_auth_mode = _normalize_text(current.get("auth_mode"), "stored_credentials").lower()
        if auth_mode is not _UNSET:
            candidate_auth_mode = _normalize_text(auth_mode, next_auth_mode).lower()
            if candidate_auth_mode in {"stored_credentials", "primary_session"}:
                next_auth_mode = candidate_auth_mode
        next_email = _normalize_text(current.get("mailbox_email")).lower()
        next_login = _normalize_text(current.get("mailbox_login")).lower()
        next_password_enc = _normalize_text(current.get("mailbox_password_enc"))
        next_label = _normalize_text(current.get("label")) or next_email
        next_is_active = _to_bool(current.get("is_active"), default=True)
        if label is not _UNSET:
            next_label = _normalize_text(label) or next_label
        if mailbox_email is not _UNSET:
            next_email = _normalize_text(mailbox_email).lower()
        if mailbox_login is not _UNSET and next_auth_mode != "primary_session":
            next_login = _normalize_text(mailbox_login).lower()
        next_password_raw = None
        if mailbox_password is not _UNSET and next_auth_mode != "primary_session":
            candidate = _normalize_text(mailbox_password)
            if candidate:
                next_password_raw = candidate
        if is_active is not _UNSET:
            next_is_active = bool(is_active)
        if next_auth_mode != "primary_session":
            verify_password = next_password_raw
            if verify_password is None and (mailbox_email is not _UNSET or mailbox_login is not _UNSET):
                try:
                    verify_password = decrypt_secret(next_password_enc)
                except Exception:
                    verify_password = ""
            if mailbox_email is not _UNSET or mailbox_login is not _UNSET or next_password_raw is not None:
                self.verify_mailbox_credentials(
                    mailbox_email=next_email,
                    mailbox_login=next_login or next_email,
                    mailbox_password=verify_password or "",
                )
            if next_password_raw is not None:
                next_password_enc = encrypt_secret(next_password_raw)

        existing_rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
        if any(
            _normalize_text(item.get("id")) != _normalize_text(mailbox_id)
            and _normalize_text(item.get("mailbox_email")).lower() == next_email
            for item in existing_rows
        ):
            raise MailServiceError("Mailbox is already connected", status_code=409)

        next_is_primary = _to_bool(current.get("is_primary"), default=False)
        if is_primary is not _UNSET and bool(is_primary):
            next_is_primary = True
        if not next_is_active and next_is_primary:
            raise MailServiceError("Primary mailbox cannot be inactive", status_code=409)

        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            if next_is_primary:
                conn.execute(
                    f"UPDATE {self._USER_MAILBOXES_TABLE} SET is_primary = ?, updated_at = ? WHERE user_id = ? AND id <> ?",
                    (False, now_iso, int(user_id), _normalize_text(mailbox_id)),
                )
            conn.execute(
                f"""
                UPDATE {self._USER_MAILBOXES_TABLE}
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
                    next_label or next_email,
                    next_email,
                    next_login or None,
                    next_password_enc,
                    next_auth_mode,
                    bool(next_is_primary),
                    bool(next_is_active),
                    bool(selected is not _UNSET and bool(selected)),
                    now_iso,
                    now_iso,
                    int(user_id),
                    _normalize_text(mailbox_id),
                ),
            )
            conn.commit()
        if next_is_primary:
            self._sync_primary_mailbox_to_legacy_user(user_id=int(user_id))
        self.invalidate_user_cache(user_id=int(user_id))
        row = self._resolve_mailbox_row(user_id=int(user_id), mailbox_id=mailbox_id, allow_inactive=True)
        if selected is not _UNSET and bool(selected):
            self._touch_mailbox_selected(user_id=int(user_id), mailbox_id=_normalize_text(mailbox_id))
        unread_count = self._get_mailbox_unread_count(user_id=int(user_id), mailbox_id=_normalize_text(mailbox_id)) if next_is_active else 0
        return self._serialize_mailbox_entry(
            user=user,
            mailbox_row=row,
            unread_count=unread_count,
            selected=bool(selected) if selected is not _UNSET else False,
        )

    def delete_user_mailbox(self, *, user_id: int, mailbox_id: str) -> dict[str, Any]:
        row = self._resolve_mailbox_row(user_id=int(user_id), mailbox_id=mailbox_id, allow_inactive=True)
        if _to_bool(row.get("is_primary"), default=False):
            raise MailServiceError("Primary mailbox cannot be deleted until another mailbox is primary", status_code=409)
        with self._lock, self._connect() as conn:
            conn.execute(
                f"DELETE FROM {self._USER_MAILBOXES_TABLE} WHERE user_id = ? AND id = ?",
                (int(user_id), _normalize_text(mailbox_id)),
            )
            conn.commit()
        self.invalidate_user_cache(user_id=int(user_id))
        return {"ok": True, "mailbox_id": _normalize_text(mailbox_id)}

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
    def _encode_message_id(folder: str, exchange_id: str, mailbox_id: str | None = None) -> str:
        normalized_mailbox_id = _normalize_text(mailbox_id)
        if normalized_mailbox_id:
            raw = f"v2::{normalized_mailbox_id}::{_normalize_text(folder, 'inbox')}::{_normalize_text(exchange_id)}"
        else:
            raw = f"{_normalize_text(folder, 'inbox')}::{_normalize_text(exchange_id)}"
        return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8").rstrip("=")

    @staticmethod
    def _decode_message_ref(token: str) -> tuple[str, str, str]:
        value = _normalize_text(token)
        if not value:
            raise MailServiceError("Message id is required")
        padded = value + "=" * ((4 - len(value) % 4) % 4)
        try:
            raw = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        except Exception as exc:
            raise MailServiceError("Invalid message id") from exc
        mailbox_id = ""
        if raw.startswith("v2::"):
            parts = raw.split("::", 3)
            if len(parts) != 4:
                raise MailServiceError("Invalid message id payload")
            _, mailbox_id, folder, exchange_id = parts
        else:
            if "::" not in raw:
                raise MailServiceError("Invalid message id payload")
            folder, exchange_id = raw.split("::", 1)
        if not exchange_id:
            raise MailServiceError("Invalid message id payload")
        return _normalize_text(folder, "inbox").lower(), exchange_id, _normalize_text(mailbox_id)

    @staticmethod
    def _decode_message_id(token: str) -> tuple[str, str]:
        folder, exchange_id, _mailbox_id = MailService._decode_message_ref(token)
        return folder, exchange_id

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
    def _encode_attachment_token(attachment_id: str, mailbox_id: str | None = None) -> str:
        value = _normalize_text(attachment_id)
        if not value:
            return ""
        # Exchange attachment ids are already compact base64-like strings. Re-encoding
        # them into another base64 wrapper creates very long path segments that
        # HTTP.sys rejects before the request reaches FastAPI. Keep only a minimal
        # URL-safe transform and rely on message_id/mailbox_id for mailbox scope.
        escaped = (
            value
            .replace("~", "~~")
            .replace("-", "~d")
            .replace("_", "~u")
            .replace("+", "-")
            .replace("/", "_")
            .rstrip("=")
        )
        return f"{MailService._ATTACHMENT_TOKEN_PREFIX}{escaped}"

    @staticmethod
    def _decode_attachment_ref(token: str) -> tuple[str, str]:
        value = _normalize_text(token)
        if not value:
            raise MailServiceError("Attachment token is required")
        if value.startswith(MailService._ATTACHMENT_TOKEN_PREFIX):
            encoded_part = value[len(MailService._ATTACHMENT_TOKEN_PREFIX):]
            if not encoded_part:
                raise MailServiceError("Attachment token payload is empty")
            decoded_chars: list[str] = []
            index = 0
            while index < len(encoded_part):
                current = encoded_part[index]
                if current == "~":
                    if index + 1 >= len(encoded_part):
                        raise MailServiceError("Attachment token payload is invalid")
                    marker = encoded_part[index + 1]
                    if marker == "~":
                        decoded_chars.append("~")
                    elif marker == "d":
                        decoded_chars.append("-")
                    elif marker == "u":
                        decoded_chars.append("_")
                    else:
                        raise MailServiceError("Attachment token payload is invalid")
                    index += 2
                    continue
                if current == "-":
                    decoded_chars.append("+")
                elif current == "_":
                    decoded_chars.append("/")
                else:
                    decoded_chars.append(current)
                index += 1
            normalized_attachment_id = _normalize_text("".join(decoded_chars))
            if not normalized_attachment_id:
                raise MailServiceError("Attachment token payload is invalid")
            if re.fullmatch(r"[A-Za-z0-9+/]+", normalized_attachment_id or "") and (len(normalized_attachment_id) % 4):
                normalized_attachment_id = normalized_attachment_id + "=" * ((4 - len(normalized_attachment_id) % 4) % 4)
            return "", normalized_attachment_id
        if not value.startswith(MailService._ATTACHMENT_TOKEN_PREFIX_LEGACY):
            raise MailServiceError("Attachment token format is invalid")
        encoded_part = value[len(MailService._ATTACHMENT_TOKEN_PREFIX_LEGACY):]
        if not encoded_part:
            raise MailServiceError("Attachment token payload is empty")
        padded = encoded_part + "=" * ((4 - len(encoded_part) % 4) % 4)
        try:
            raw = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        except Exception as exc:
            raise MailServiceError("Attachment token payload is invalid") from exc
        normalized_raw = _normalize_text(raw)
        if not normalized_raw:
            raise MailServiceError("Attachment token payload is invalid")
        if normalized_raw.startswith("v2::"):
            parts = normalized_raw.split("::", 2)
            if len(parts) != 3:
                raise MailServiceError("Attachment token payload is invalid")
            _, mailbox_id, attachment_id = parts
            resolved_attachment_id = _normalize_text(attachment_id)
            if not resolved_attachment_id:
                raise MailServiceError("Attachment token payload is invalid")
            return _normalize_text(mailbox_id), resolved_attachment_id
        return "", normalized_raw

    @staticmethod
    def _decode_attachment_token(token: str) -> str:
        _mailbox_id, attachment_id = MailService._decode_attachment_ref(token)
        return attachment_id

    @staticmethod
    def _resolve_mailbox_scope(*scopes: str | None) -> str:
        for value in scopes:
            normalized = _normalize_text(value)
            if normalized:
                return normalized
        return ""

    @staticmethod
    def _make_scoped_storage_key(*, mailbox_id: str | None = None, value: str) -> str:
        normalized_value = _normalize_text(value)
        normalized_mailbox_id = _normalize_text(mailbox_id)
        if not normalized_value:
            return ""
        if not normalized_mailbox_id:
            return normalized_value
        return f"{normalized_mailbox_id}::{normalized_value}"

    @staticmethod
    def _split_scoped_storage_key(value: str) -> tuple[str, str]:
        normalized = _normalize_text(value)
        if "::" not in normalized:
            return "", normalized
        mailbox_id, payload = normalized.split("::", 1)
        return _normalize_text(mailbox_id), _normalize_text(payload)

    def _resolve_mailbox_id_from_message(self, *, mailbox_id: str | None = None, message_id: str | None = None) -> str:
        normalized_mailbox_id = _normalize_text(mailbox_id)
        if normalized_mailbox_id:
            return normalized_mailbox_id
        token = _normalize_text(message_id)
        if not token:
            return ""
        try:
            _folder, _exchange_id, encoded_mailbox_id = self._decode_message_ref(token)
        except Exception:
            return ""
        return _normalize_text(encoded_mailbox_id)

    def _resolve_mailbox_id_from_attachment(self, *, mailbox_id: str | None = None, attachment_ref: str | None = None) -> str:
        normalized_mailbox_id = _normalize_text(mailbox_id)
        if normalized_mailbox_id:
            return normalized_mailbox_id
        token = _normalize_text(attachment_ref)
        if not (
            token.startswith(self._ATTACHMENT_TOKEN_PREFIX)
            or token.startswith(self._ATTACHMENT_TOKEN_PREFIX_LEGACY)
        ):
            return ""
        try:
            encoded_mailbox_id, _attachment_id = self._decode_attachment_ref(token)
        except Exception:
            return ""
        return _normalize_text(encoded_mailbox_id)

    def _resolve_outbound_mailbox_id(
        self,
        *,
        mailbox_id: str | None = None,
        draft_id: str | None = None,
        reply_to_message_id: str | None = None,
        forward_message_id: str | None = None,
    ) -> str:
        return self._resolve_mailbox_scope(
            mailbox_id,
            self._resolve_mailbox_id_from_message(message_id=draft_id),
            self._resolve_mailbox_id_from_message(message_id=reply_to_message_id),
            self._resolve_mailbox_id_from_message(message_id=forward_message_id),
        )

    def resolve_attachment_id(self, token_or_id: str) -> str:
        value = _normalize_text(token_or_id)
        if not value:
            raise MailServiceError("Attachment id is required")
        if value.startswith(self._ATTACHMENT_TOKEN_PREFIX) or value.startswith(self._ATTACHMENT_TOKEN_PREFIX_LEGACY):
            return self._decode_attachment_token(value)
        # Backward-compatible fallback for legacy clients sending raw exchangelib attachment id.
        return value

    @staticmethod
    def _normalize_attachment_id_candidate(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            try:
                value = value.decode("utf-8", errors="ignore")
            except Exception:
                value = str(value)
        if not isinstance(value, (str, int, float)):
            return ""
        normalized = _normalize_text(value)
        if not normalized or normalized.lower() in {"none", "null"}:
            return ""
        if normalized.startswith("<") and normalized.endswith(">"):
            return ""
        return normalized

    @staticmethod
    def _extract_attachment_id_from_repr(value: Any) -> str:
        raw = _normalize_text(value)
        if not raw:
            return ""
        for pattern in (
            r"(?:^|[({,\s])id=['\"]([^'\"]+)['\"]",
            r"(?:^|[({,\s])attachment_id=['\"]([^'\"]+)['\"]",
        ):
            match = re.search(pattern, raw)
            if match and _normalize_text(match.group(1)):
                return _normalize_text(match.group(1))
        if "<" not in raw and ">" not in raw and not any(ch.isspace() for ch in raw):
            return raw
        return ""

    @classmethod
    def _extract_attachment_raw_id(cls, attachment: Any) -> str:
        attachment_id = getattr(attachment, "attachment_id", None)
        item_id = getattr(attachment, "item_id", None)
        for candidate in (
            getattr(attachment_id, "id", None),
            getattr(attachment_id, "attachment_id", None),
            getattr(attachment_id, "value", None),
            getattr(attachment, "id", None),
            getattr(item_id, "id", None),
            getattr(item_id, "item_id", None),
            attachment_id if isinstance(attachment_id, (str, int, float, bytes)) else None,
        ):
            normalized = cls._normalize_attachment_id_candidate(candidate)
            if normalized:
                return normalized
        for candidate in (attachment_id, item_id, attachment):
            normalized = cls._extract_attachment_id_from_repr(candidate)
            if normalized:
                return normalized
        return ""

    @staticmethod
    def _normalize_attachment_content_id(value: Any) -> str:
        normalized = _normalize_text(value)
        if normalized.lower().startswith("cid:"):
            normalized = normalized[4:]
        normalized = normalized.strip().strip("<>").strip()
        return normalized.lower()

    @staticmethod
    def _build_inline_attachment_src(*, message_id: str, attachment_ref: str) -> str | None:
        safe_message_id = _normalize_text(message_id)
        safe_attachment_ref = _normalize_text(attachment_ref)
        if not safe_message_id or not safe_attachment_ref:
            return None
        quoted_message_id = quote(safe_message_id, safe="")
        quoted_attachment_ref = quote(safe_attachment_ref, safe="")
        return f"/api/v1/mail/messages/{quoted_message_id}/attachments/{quoted_attachment_ref}?disposition=inline"

    @staticmethod
    def _mail_auth_mode_for_user(user: dict | None) -> str:
        auth_source = str((user or {}).get("auth_source") or "local").strip().lower()
        return "ad_auto" if auth_source == "ldap" else "manual"

    def _build_effective_mailbox_email(self, user: dict | None) -> str:
        effective = _normalize_text((user or {}).get("mailbox_email") or (user or {}).get("email")).lower()
        if effective:
            return effective
        auth_source = str((user or {}).get("auth_source") or "local").strip().lower()
        if auth_source == "ldap":
            return build_default_ldap_mailbox_email((user or {}).get("username"))
        return ""

    def _build_effective_mailbox_login(self, user: dict | None) -> str:
        auth_source = str((user or {}).get("auth_source") or "local").strip().lower()
        if auth_source == "ldap":
            session_id = get_request_session_id()
            session_context = session_auth_context_service.get_session_context(
                session_id,
                user_id=int((user or {}).get("id") or 0),
            )
            session_login = _normalize_text((session_context or {}).get("exchange_login")).lower()
            if session_login:
                return session_login
            username = _normalize_text((user or {}).get("username")).lower()
            return normalize_exchange_login(username) if username else ""

        explicit_login = _normalize_text((user or {}).get("mailbox_login")).lower()
        if explicit_login:
            return explicit_login
        return _normalize_text((user or {}).get("mailbox_email") or (user or {}).get("email")).lower()

    @classmethod
    def classify_mail_error_code(cls, value: Any) -> str | None:
        message = _normalize_text(value).strip().lower()
        if not message:
            return None
        if message in cls._PASSWORD_REQUIRED_MESSAGES:
            return "MAIL_PASSWORD_REQUIRED"
        if any(marker in message for marker in cls._AUTH_FAILURE_MARKERS):
            return "MAIL_AUTH_INVALID"
        return None

    def invalidate_saved_password(self, *, user_id: int, mailbox_id: str | None = None) -> None:
        normalized_mailbox_id = _normalize_text(mailbox_id)
        try:
            with self._lock, self._connect() as conn:
                target_mailbox_id = normalized_mailbox_id
                if not target_mailbox_id:
                    row = conn.execute(
                        f"""
                        SELECT id
                        FROM {self._USER_MAILBOXES_TABLE}
                        WHERE user_id = ? AND auth_mode = 'stored_credentials'
                        ORDER BY is_primary DESC, COALESCE(last_selected_at, '') DESC, sort_order ASC
                        LIMIT 1
                        """,
                        (int(user_id),),
                    ).fetchone()
                    target_mailbox_id = _normalize_text((dict(row) if row is not None else {}).get("id"))
                if target_mailbox_id:
                    conn.execute(
                        f"""
                        UPDATE {self._USER_MAILBOXES_TABLE}
                        SET mailbox_password_enc = '', updated_at = ?
                        WHERE user_id = ? AND id = ?
                        """,
                        (_utc_now_iso(), int(user_id), target_mailbox_id),
                    )
                    conn.commit()
        except Exception:
            logger.warning(
                "Failed to clear saved mailbox password for user_id=%s mailbox_id=%s",
                int(user_id),
                normalized_mailbox_id,
                exc_info=True,
            )
        try:
            user_service.update_user(int(user_id), mailbox_password="")
        except Exception:
            logger.warning("Failed to clear saved mail password for user_id=%s", int(user_id), exc_info=True)

    def _resolve_user_mail_profile(
        self,
        user_id: int,
        *,
        mailbox_id: str | None = None,
        require_password: bool,
    ) -> dict[str, Any]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")
        mailbox_row = self._resolve_mailbox_row(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            allow_inactive=False,
        )
        return self._build_mailbox_profile(
            user=user,
            mailbox_row=mailbox_row,
            require_password=bool(require_password),
        )

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

    def _list_favorite_folder_ids(self, *, user_id: int, mailbox_id: str | None = None) -> set[str]:
        normalized_mailbox_id = _normalize_text(mailbox_id)
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT folder_id FROM {self._FOLDER_FAVORITES_TABLE} WHERE user_id = ?",
                (int(user_id),),
            ).fetchall()
        scoped_values: set[str] = set()
        legacy_values: set[str] = set()
        for row in rows:
            stored_value = _normalize_text(row["folder_id"])
            scoped_mailbox_id, payload = self._split_scoped_storage_key(stored_value)
            if not payload:
                continue
            if scoped_mailbox_id:
                if scoped_mailbox_id == normalized_mailbox_id:
                    scoped_values.add(payload)
            else:
                legacy_values.add(payload)
        return scoped_values or legacy_values

    def _list_visible_custom_folder_ids(self, *, user_id: int, mailbox_id: str | None = None) -> set[str]:
        normalized_mailbox_id = _normalize_text(mailbox_id)
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT folder_id FROM {self._VISIBLE_CUSTOM_FOLDERS_TABLE} WHERE user_id = ?",
                (int(user_id),),
            ).fetchall()
        scoped_values: set[str] = set()
        legacy_values: set[str] = set()
        for row in rows:
            stored_value = _normalize_text(row["folder_id"])
            scoped_mailbox_id, payload = self._split_scoped_storage_key(stored_value)
            if not payload or payload in self._STANDARD_FOLDERS:
                continue
            if scoped_mailbox_id:
                if scoped_mailbox_id == normalized_mailbox_id:
                    scoped_values.add(payload)
            else:
                legacy_values.add(payload)
        return scoped_values or legacy_values

    def _set_custom_folder_visible(self, *, user_id: int, mailbox_id: str | None = None, folder_id: str, visible: bool) -> None:
        normalized_folder_id = _normalize_text(folder_id)
        if not normalized_folder_id or normalized_folder_id in self._STANDARD_FOLDERS:
            return
        scoped_folder_id = self._make_scoped_storage_key(mailbox_id=mailbox_id, value=normalized_folder_id)
        with self._lock, self._connect() as conn:
            if visible:
                conn.execute(
                    f"""
                    INSERT INTO {self._VISIBLE_CUSTOM_FOLDERS_TABLE} (user_id, folder_id, created_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, folder_id) DO NOTHING
                    """,
                    (int(user_id), scoped_folder_id, _utc_now_iso()),
                )
            else:
                conn.execute(
                    f"DELETE FROM {self._VISIBLE_CUSTOM_FOLDERS_TABLE} WHERE user_id = ? AND folder_id IN (?, ?)",
                    (int(user_id), scoped_folder_id, normalized_folder_id),
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

    def set_folder_favorite(self, *, user_id: int, mailbox_id: str | None = None, folder_id: str, favorite: bool) -> dict[str, Any]:
        normalized_folder_id = _normalize_text(folder_id)
        if not normalized_folder_id:
            raise MailServiceError("Folder id is required")
        now_iso = _utc_now_iso()
        scoped_folder_id = self._make_scoped_storage_key(mailbox_id=mailbox_id, value=normalized_folder_id)
        with self._lock, self._connect() as conn:
            if favorite:
                conn.execute(
                    f"""
                    INSERT INTO {self._FOLDER_FAVORITES_TABLE} (user_id, folder_id, created_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, folder_id) DO NOTHING
                    """,
                    (int(user_id), scoped_folder_id, now_iso),
                )
            else:
                conn.execute(
                    f"DELETE FROM {self._FOLDER_FAVORITES_TABLE} WHERE user_id = ? AND folder_id IN (?, ?)",
                    (int(user_id), scoped_folder_id, normalized_folder_id),
                )
            conn.commit()
        self.invalidate_user_cache(user_id=int(user_id), prefixes=("folder_tree", "bootstrap"))
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
        self.invalidate_user_cache(user_id=int(user_id), prefixes=("bootstrap",))
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

    @staticmethod
    def _is_mail_folder_visible_in_tree(folder_obj) -> bool:
        folder_class = _normalize_text(getattr(folder_obj, "folder_class", None))
        if not folder_class:
            return True
        non_mail_prefixes = (
            "IPF.Contact",
            "IPF.Appointment",
            "IPF.Journal",
            "IPF.StickyNote",
            "IPF.Task",
            "IPF.Configuration",
            "IPF.Files",
        )
        if folder_class == "IPF":
            return False
        return not any(folder_class.startswith(prefix) for prefix in non_mail_prefixes)

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
    def _serialize_person(value: Any) -> dict[str, str | None]:
        if value is None:
            return {"name": None, "email": None, "display": None}
        if isinstance(value, str):
            email = _normalize_text(value).lower()
            display = email or None
            return {"name": None, "email": email or None, "display": display}
        email = _normalize_text(getattr(value, "email_address", None)).lower()
        name = _normalize_text(
            getattr(value, "name", None)
            or getattr(value, "display_name", None)
            or getattr(value, "mailbox_name", None)
        )
        display = name or email or None
        return {
            "name": name or None,
            "email": email or None,
            "display": display,
        }

    @staticmethod
    def _person_lookup_key(person: dict[str, Any] | None) -> str:
        if not isinstance(person, dict):
            return ""
        return _normalize_text(
            person.get("email")
            or person.get("display")
            or person.get("name")
        ).lower()

    @classmethod
    def _item_sender_person(cls, item) -> dict[str, str | None]:
        sender = getattr(item, "sender", None)
        if sender is not None:
            person = cls._serialize_person(sender)
            if person.get("email") or person.get("display"):
                return person
        author = getattr(item, "author", None)
        if author is not None:
            person = cls._serialize_person(author)
            if person.get("email") or person.get("display"):
                return person
        return {"name": None, "email": None, "display": None}

    @classmethod
    def _item_sender(cls, item) -> str:
        return _normalize_text(cls._item_sender_person(item).get("email")).lower()

    @classmethod
    def _item_recipient_people(cls, item, attrs: tuple[str, ...] = ("to_recipients", "cc_recipients")) -> list[dict[str, str | None]]:
        recipients: list[dict[str, str | None]] = []
        seen: set[str] = set()
        for attr in attrs:
            values = getattr(item, attr, None) or []
            for rec in values:
                person = cls._serialize_person(rec)
                lookup_key = cls._person_lookup_key(person)
                if not lookup_key or lookup_key in seen:
                    continue
                seen.add(lookup_key)
                recipients.append(person)
        return recipients

    @classmethod
    def _item_recipients(cls, item) -> list[str]:
        return [
            _normalize_text(person.get("email")).lower()
            for person in cls._item_recipient_people(item)
            if _normalize_text(person.get("email"))
        ]

    @classmethod
    def _item_bcc_recipient_people(cls, item) -> list[dict[str, str | None]]:
        return cls._item_recipient_people(item, attrs=("bcc_recipients",))

    @classmethod
    def _item_bcc_recipients(cls, item) -> list[str]:
        return [
            _normalize_text(person.get("email")).lower()
            for person in cls._item_bcc_recipient_people(item)
            if _normalize_text(person.get("email"))
        ]

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

    def _folder_queryset(self, folder_obj, folder_key: str, *, preview_only: bool = False):
        queryset = folder_obj.all().order_by(self._message_sort_attr(folder_key))
        if not preview_only:
            return queryset
        try:
            return queryset.only(
                "subject",
                "text_body",
                "datetime_received",
                "datetime_created",
                "is_read",
                "sender",
                "author",
                "to_recipients",
                "cc_recipients",
                "categories",
                "importance",
                "has_attachments",
            )
        except Exception:
            return queryset

    def _build_quote_html(self, item) -> str:
        sender_person = self._item_sender_person(item)
        sender = _normalize_text(sender_person.get("display") or sender_person.get("email")) or "-"
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

    def _should_embed_inline_attachment(self, attachment) -> bool:
        content_id = self._normalize_attachment_content_id(getattr(attachment, "content_id", None))
        if not content_id and not bool(getattr(attachment, "is_inline", False)):
            return False
        content_type = _normalize_text(getattr(attachment, "content_type", "")).lower()
        if not content_type.startswith("image/"):
            return False
        try:
            size = int(getattr(attachment, "size", 0) or 0)
        except Exception:
            size = 0
        return size > 0 and size <= self._INLINE_ATTACHMENT_EMBED_MAX_SIZE

    def _prefetch_inline_attachment_content(self, *, item, account) -> None:
        try:
            from exchangelib.attachments import FileAttachment
        except Exception:
            return
        candidates = []
        for attachment in (getattr(item, "attachments", None) or []):
            if not isinstance(attachment, FileAttachment):
                continue
            if not self._should_embed_inline_attachment(attachment):
                continue
            try:
                content = attachment.content
            except Exception:
                content = b""
            if content:
                continue
            candidates.append(attachment)
        if not candidates:
            return
        try:
            account.protocol.get_attachments(candidates)
        except Exception:
            return

    def _build_inline_attachment_data_url(self, attachment) -> str | None:
        if not self._should_embed_inline_attachment(attachment):
            return None
        try:
            content = attachment.content
        except Exception:
            content = b""
        if not isinstance(content, (bytes, bytearray)) or not content:
            return None
        content_type = _normalize_text(getattr(attachment, "content_type", "application/octet-stream"))
        encoded = base64.b64encode(bytes(content)).decode("ascii")
        return f"data:{content_type};base64,{encoded}"

    def build_compose_context(self, item, mailbox_email: str, mailbox_id: str | None = None) -> dict[str, Any]:
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
            "mailbox_id": _normalize_text(mailbox_id) or None,
            "mailbox_email": mailbox or None,
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
        mailbox_id: str | None = None,
        mailbox_email: str,
        restore_hint_folder: str | None = None,
        draft_context: dict[str, Any] | None = None,
        include_inline_data_urls: bool = False,
    ) -> dict[str, Any]:
        received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
        received_iso = received.isoformat() if received else None
        body_html = _normalize_text(getattr(item, "body", None))
        body_text = _normalize_text(getattr(item, "text_body", None))
        if not body_text and body_html:
            body_text = _normalize_text(re.sub(r"<[^>]+>", " ", body_html))

        resolved_mailbox_id = _normalize_text(mailbox_id)
        encoded_message_id = self._encode_message_id(
            folder_key,
            _normalize_text(getattr(item, "id", "")),
            resolved_mailbox_id,
        )

        attachments = []
        for att in (getattr(item, "attachments", None) or []):
            attachment_raw_id = self._extract_attachment_raw_id(att)
            download_token = self._encode_attachment_token(attachment_raw_id, resolved_mailbox_id)
            content_id = self._normalize_attachment_content_id(getattr(att, "content_id", None))
            is_inline = bool(getattr(att, "is_inline", False) or content_id)
            is_downloadable = bool((download_token or attachment_raw_id) and self._is_downloadable_attachment(att))
            if not is_downloadable:
                logger.warning(
                    "Mail attachment is not downloadable: name=%s mailbox_id=%s message_exchange_id=%s attachment_type=%s stable_id=%s",
                    _normalize_text(getattr(att, "name", "attachment.bin")),
                    resolved_mailbox_id or "",
                    _normalize_text(getattr(item, "id", "")),
                    type(att).__name__,
                    attachment_raw_id or "",
                )
            attachments.append(
                {
                    "id": attachment_raw_id,
                    "download_token": download_token,
                    "downloadable": is_downloadable,
                    "name": _normalize_text(getattr(att, "name", "attachment.bin")),
                    "content_type": _normalize_text(getattr(att, "content_type", "")),
                    "size": int(getattr(att, "size", 0) or 0),
                    "content_id": content_id,
                    "is_inline": is_inline,
                    "inline_src": self._build_inline_attachment_src(
                        message_id=encoded_message_id,
                        attachment_ref=download_token or attachment_raw_id,
                    ) if is_inline and (download_token or attachment_raw_id) else None,
                    "inline_data_url": self._build_inline_attachment_data_url(att)
                    if include_inline_data_urls and is_inline
                    else None,
                }
            )

        sender_person = self._item_sender_person(item)
        to_people = self._item_recipient_people(item, attrs=("to_recipients",))
        cc_people = self._item_recipient_people(item, attrs=("cc_recipients",))
        bcc_people = self._item_bcc_recipient_people(item)

        try:
            compose_context = self.build_compose_context(item, mailbox_email, resolved_mailbox_id)
        except TypeError:
            compose_context = self.build_compose_context(item, mailbox_email)

        return {
            "id": encoded_message_id,
            "mailbox_id": resolved_mailbox_id or None,
            "exchange_id": _normalize_text(getattr(item, "id", "")),
            "folder": folder_key,
            "subject": _normalize_text(getattr(item, "subject", "")),
            "sender": self._item_sender(item),
            "sender_person": sender_person,
            "sender_name": sender_person.get("name"),
            "sender_email": sender_person.get("email"),
            "sender_display": sender_person.get("display") or self._item_sender(item),
            "to": [
                _normalize_text(person.get("email")).lower()
                for person in to_people
                if _normalize_text(person.get("email"))
            ],
            "to_people": to_people,
            "cc": [
                _normalize_text(person.get("email")).lower()
                for person in cc_people
                if _normalize_text(person.get("email"))
            ],
            "cc_people": cc_people,
            "bcc": [
                _normalize_text(person.get("email")).lower()
                for person in bcc_people
                if _normalize_text(person.get("email"))
            ],
            "bcc_people": bcc_people,
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
            "compose_context": compose_context,
            "draft_context": draft_context or None,
            "has_external_images": bool(re.search(r"<img[^>]+src=['\"]https?://", body_html, flags=re.IGNORECASE)),
            "can_archive": not str(folder_key).startswith("archive"),
            "can_move": True,
        }

    def _set_restore_hint(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        trash_exchange_id: str,
        restore_folder: str,
        source_exchange_id: str | None = None,
    ) -> None:
        now_iso = _utc_now_iso()
        scoped_trash_exchange_id = self._make_scoped_storage_key(
            mailbox_id=mailbox_id,
            value=_normalize_text(trash_exchange_id),
        )
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
                    scoped_trash_exchange_id,
                    _normalize_text(restore_folder, "inbox"),
                    _normalize_text(source_exchange_id) or None,
                    now_iso,
                ),
            )
            conn.commit()

    def _get_restore_hint(self, *, user_id: int, mailbox_id: str | None = None, trash_exchange_id: str) -> dict[str, Any] | None:
        scoped_trash_exchange_id = self._make_scoped_storage_key(
            mailbox_id=mailbox_id,
            value=_normalize_text(trash_exchange_id),
        )
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT restore_folder, source_exchange_id, created_at
                FROM {self._RESTORE_HINTS_TABLE}
                WHERE user_id = ? AND trash_exchange_id = ?
                """,
                (int(user_id), scoped_trash_exchange_id),
            ).fetchone()
            if row is None and scoped_trash_exchange_id != _normalize_text(trash_exchange_id):
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

    def _delete_restore_hint(self, *, user_id: int, mailbox_id: str | None = None, trash_exchange_id: str) -> None:
        scoped_trash_exchange_id = self._make_scoped_storage_key(
            mailbox_id=mailbox_id,
            value=_normalize_text(trash_exchange_id),
        )
        with self._lock, self._connect() as conn:
            conn.execute(
                f"DELETE FROM {self._RESTORE_HINTS_TABLE} WHERE user_id = ? AND trash_exchange_id IN (?, ?)",
                (int(user_id), scoped_trash_exchange_id, _normalize_text(trash_exchange_id)),
            )
            conn.commit()

    def _save_draft_context(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        draft_exchange_id: str,
        compose_mode: str,
        reply_to_message_id: str | None = None,
        forward_message_id: str | None = None,
    ) -> None:
        scoped_draft_exchange_id = self._make_scoped_storage_key(
            mailbox_id=mailbox_id,
            value=_normalize_text(draft_exchange_id),
        )
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
                    scoped_draft_exchange_id,
                    int(user_id),
                    _normalize_text(compose_mode, "draft"),
                    _normalize_text(reply_to_message_id) or None,
                    _normalize_text(forward_message_id) or None,
                    _utc_now_iso(),
                ),
            )
            conn.commit()

    def _get_draft_context(self, *, user_id: int, mailbox_id: str | None = None, draft_exchange_id: str) -> dict[str, Any] | None:
        scoped_draft_exchange_id = self._make_scoped_storage_key(
            mailbox_id=mailbox_id,
            value=_normalize_text(draft_exchange_id),
        )
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT compose_mode, reply_to_message_id, forward_message_id, updated_at
                FROM {self._DRAFT_CONTEXT_TABLE}
                WHERE user_id = ? AND draft_exchange_id = ?
                """,
                (int(user_id), scoped_draft_exchange_id),
            ).fetchone()
            if row is None and scoped_draft_exchange_id != _normalize_text(draft_exchange_id):
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

    def _delete_draft_context(self, *, mailbox_id: str | None = None, draft_exchange_id: str) -> None:
        scoped_draft_exchange_id = self._make_scoped_storage_key(
            mailbox_id=mailbox_id,
            value=_normalize_text(draft_exchange_id),
        )
        with self._lock, self._connect() as conn:
            conn.execute(
                f"DELETE FROM {self._DRAFT_CONTEXT_TABLE} WHERE draft_exchange_id IN (?, ?)",
                (scoped_draft_exchange_id, _normalize_text(draft_exchange_id)),
            )
            conn.commit()

    def _serialize_message_preview(self, item, folder_key: str) -> dict[str, Any]:
        return self._serialize_message_preview_for_mailbox(item=item, folder_key=folder_key, mailbox_id="")

    def _serialize_message_preview_for_mailbox(self, *, item, folder_key: str, mailbox_id: str | None = None) -> dict[str, Any]:
        received = getattr(item, "datetime_received", None) or getattr(item, "datetime_created", None)
        received_iso = received.isoformat() if received else None
        body_text = _normalize_text(getattr(item, "text_body", None))
        if not body_text:
            body_text = _normalize_text(getattr(item, "body", None))
        body_preview = body_text[:350]
        has_attachments = bool(getattr(item, "has_attachments", False))
        sender_person = self._item_sender_person(item)
        recipient_people = self._item_recipient_people(item)
        return {
            "id": self._encode_message_id(
                folder_key,
                _normalize_text(getattr(item, "id", "")),
                _normalize_text(mailbox_id),
            ),
            "mailbox_id": _normalize_text(mailbox_id) or None,
            "exchange_id": _normalize_text(getattr(item, "id", "")),
            "folder": folder_key,
            "subject": _normalize_text(getattr(item, "subject", "")),
            "sender": self._item_sender(item),
            "sender_person": sender_person,
            "sender_name": sender_person.get("name"),
            "sender_email": sender_person.get("email"),
            "sender_display": sender_person.get("display") or self._item_sender(item),
            "recipients": self._item_recipients(item),
            "recipient_people": recipient_people,
            "received_at": received_iso,
            "is_read": bool(getattr(item, "is_read", False)),
            "has_attachments": has_attachments,
            "attachments_count": 1 if has_attachments else 0,
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

    def _list_messages_from_account(
        self,
        *,
        account,
        mailbox_id: str | None = None,
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

        targets = self._search_target_folders(
            account,
            folder=_normalize_text(folder, "inbox"),
            folder_scope=_normalize_text(folder_scope, "current"),
        )
        searched_window = 0
        search_limited = False
        if len(targets) == 1 and _normalize_text(folder_scope, "current").lower() != "all" and not filters_active:
            folder_obj, folder_key = targets[0]
            queryset = self._folder_queryset(folder_obj, folder_key, preview_only=True)
            if unread_only:
                queryset = queryset.filter(is_read=False)
            total_hint = self._folder_total_hint(folder_obj, unread_only=bool(unread_only))
            page_items = list(queryset[safe_offset: safe_offset + safe_limit + 1])
            has_more = len(page_items) > safe_limit
            page_items = page_items[:safe_limit]
            items = [
                self._serialize_message_preview_for_mailbox(
                    item=item,
                    folder_key=folder_key,
                    mailbox_id=mailbox_id,
                )
                for item in page_items
            ]
            total = max(
                total_hint if total_hint is not None else 0,
                safe_offset + len(items) + (1 if has_more else 0),
            )
        else:
            serialized_items: list[dict[str, Any]] = []
            search_budget = max(1, int(self.search_window_limit))
            for folder_obj, folder_key in targets:
                queryset = self._folder_queryset(folder_obj, folder_key)
                if unread_only:
                    queryset = queryset.filter(is_read=False)
                scanned = 0
                while True:
                    if searched_window >= search_budget:
                        search_limited = True
                        break
                    batch_limit = min(self._SEARCH_BATCH_SIZE, search_budget - searched_window)
                    batch_items = list(queryset[scanned: scanned + batch_limit])
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
                        serialized_items.append(
                            self._serialize_message_preview_for_mailbox(
                                item=item,
                                folder_key=folder_key,
                                mailbox_id=mailbox_id,
                            )
                        )
                    searched_window += len(batch_items)
                    scanned += len(batch_items)
                    if len(batch_items) < batch_limit:
                        break
                if search_limited:
                    break
            serialized_items.sort(
                key=lambda item: (
                    item.get("received_at") or "",
                    item.get("id") or "",
                ),
                reverse=True,
            )
            total = len(serialized_items)
            items = serialized_items[safe_offset: safe_offset + safe_limit]
            folder_key = _normalize_text(folder, "inbox")

        next_offset = safe_offset + len(items)
        final_total = max(total, safe_offset + len(items))
        self._set_request_metric("searched_window", searched_window)
        self._set_request_metric("search_limited", int(bool(search_limited)))
        return {
            "items": items,
            "folder": folder_key,
            "limit": safe_limit,
            "offset": safe_offset,
            "total": final_total,
            "has_more": next_offset < final_total,
            "next_offset": next_offset if next_offset < final_total else None,
            "search_limited": bool(search_limited),
            "searched_window": searched_window,
        }

    def _list_folder_summary_from_account(self, *, account) -> dict[str, dict[str, int]]:
        result: dict[str, dict[str, int]] = {}
        mapping = self._standard_folders(account)
        for key, folder_obj in mapping.items():
            total, unread = self._folder_counts(folder_obj)
            result[key] = {"total": total, "unread": unread}
        return result

    def _list_folder_tree_from_account(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        account,
        summary: dict[str, dict[str, int]] | None = None,
    ) -> dict[str, Any]:
        favorites = self._list_favorite_folder_ids(user_id=int(user_id), mailbox_id=mailbox_id)
        persisted_custom_folder_ids = self._list_visible_custom_folder_ids(user_id=int(user_id), mailbox_id=mailbox_id)
        standard = self._standard_folders(account)
        walked_folders = self._walk_folder_targets(account)
        folder_lookup = {
            folder_key: (folder_obj, scope_key)
            for folder_obj, folder_key, scope_key in walked_folders
        }
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
            return parent_folder_id if parent_folder_id in folder_lookup else None

        items: list[dict[str, Any]] = []
        for alias, folder_obj in standard.items():
            scope = self._folder_scope_for_alias(alias)
            summary_entry = summary.get(alias) if isinstance(summary, dict) else None
            if isinstance(summary_entry, dict):
                counts = (
                    max(0, int(summary_entry.get("total") or 0)),
                    max(0, int(summary_entry.get("unread") or 0)),
                )
            else:
                counts = self._folder_counts_from_hints(folder_obj, fallback=True)
            items.append(
                self._serialize_folder_node(
                    account,
                    folder_obj,
                    folder_key=alias,
                    scope=scope,
                    parent_id=resolve_parent_id(folder_obj, scope),
                    favorite_ids=favorites,
                    counts=counts,
                )
            )

        stale_folder_ids: set[str] = set()
        present_custom_folder_ids: set[str] = set()
        pending_custom_entries: dict[str, tuple[Any, str, str, str | None]] = {}
        for folder_obj, folder_key, scope_key in walked_folders:
            if folder_key in self._STANDARD_FOLDERS:
                continue
            present_custom_folder_ids.add(folder_key)
            pending_custom_entries[folder_key] = (
                folder_obj,
                folder_key,
                scope_key,
                resolve_parent_id(folder_obj, scope_key),
            )

        included_custom_folder_ids: set[str] = set()
        while pending_custom_entries:
            progressed = False
            for folder_key, entry in list(pending_custom_entries.items()):
                folder_obj, _resolved_folder_key, scope_key, parent_id = entry
                if parent_id and parent_id not in self._STANDARD_FOLDERS and parent_id not in included_custom_folder_ids:
                    if parent_id in pending_custom_entries:
                        continue
                    pending_custom_entries.pop(folder_key, None)
                    progressed = True
                    continue
                if not self._is_mail_folder_visible_in_tree(folder_obj):
                    pending_custom_entries.pop(folder_key, None)
                    progressed = True
                    continue
                items.append(
                    self._serialize_folder_node(
                        account,
                        folder_obj,
                        folder_key=folder_key,
                        scope=scope_key,
                        parent_id=parent_id,
                        favorite_ids=favorites,
                        counts=self._folder_counts_from_hints(folder_obj, fallback=True),
                    )
                )
                included_custom_folder_ids.add(folder_key)
                pending_custom_entries.pop(folder_key, None)
                progressed = True
            if not progressed:
                break

        for folder_id in sorted(persisted_custom_folder_ids):
            if folder_id not in present_custom_folder_ids:
                stale_folder_ids.add(folder_id)

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

    def _get_unread_count_from_account(self, *, account) -> int:
        try:
            return int(account.inbox.filter(is_read=False).count())
        except Exception:
            return 0

    def list_messages(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
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
        self._set_request_metric("singleflight_hit", 0)
        cacheable = not any([
            _normalize_text(q),
            bool(has_attachments),
            _normalize_text(date_from),
            _normalize_text(date_to),
            _normalize_text(from_filter),
            _normalize_text(to_filter),
            _normalize_text(subject_filter),
            _normalize_text(body_filter),
            _normalize_text(importance),
        ])
        safe_limit = max(1, min(200, int(limit or 50)))
        safe_offset = max(0, int(offset or 0))
        normalized_folder = _normalize_text(folder, "inbox")
        normalized_scope = _normalize_text(folder_scope, "current")
        resolved_profile = self._resolve_mail_profile(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            require_password=False,
        )
        resolved_mailbox_id = _normalize_text(resolved_profile.get("mailbox_id"))
        filtered_path = int(
            not (
                cacheable
                and normalized_scope.lower() != "all"
            )
        )
        self._set_request_metric("filtered_path", filtered_path)
        if cacheable:
            cached = self._cached_messages(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                folder=normalized_folder,
                folder_scope=normalized_scope,
                limit=safe_limit,
                offset=safe_offset,
                unread_only=bool(unread_only),
            )
            if cached is not None:
                self._set_request_metric("cache_hit", 1)
                return cached
        self._set_request_metric("cache_hit", 0)
        singleflight_key = self._singleflight_key(
            user_id=int(user_id),
            bucket="messages",
            extra=f"{normalized_folder}|{normalized_scope}|{safe_limit}|{safe_offset}|{int(bool(unread_only))}|{_normalize_text(q)}|{int(bool(has_attachments))}|{_normalize_text(date_from)}|{_normalize_text(date_to)}|{_normalize_text(from_filter)}|{_normalize_text(to_filter)}|{_normalize_text(subject_filter)}|{_normalize_text(body_filter)}|{_normalize_text(importance)}",
            mailbox_scope=resolved_mailbox_id,
        )

        def _produce() -> dict[str, Any]:
            mail_context = self._resolve_account_context(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                require_password=True,
            )
            account = mail_context["account"]
            result = self._list_messages_from_account(
                account=account,
                mailbox_id=resolved_mailbox_id,
                folder=normalized_folder,
                folder_scope=normalized_scope,
                limit=safe_limit,
                offset=safe_offset,
                q=q,
                unread_only=bool(unread_only),
                has_attachments=bool(has_attachments),
                date_from=date_from,
                date_to=date_to,
                from_filter=from_filter,
                to_filter=to_filter,
                subject_filter=subject_filter,
                body_filter=body_filter,
                importance=importance,
            )
            if cacheable:
                return self._cache_set(
                    user_id=int(user_id),
                    bucket="messages",
                    extra=f"{normalized_folder}|{normalized_scope}|{safe_limit}|{safe_offset}|{int(bool(unread_only))}",
                    value=result,
                    mailbox_scope=resolved_mailbox_id,
                )
            return result

        return self._run_singleflight(key=singleflight_key, producer=_produce)

    def list_folder_summary(self, *, user_id: int, mailbox_id: str | None = None) -> dict[str, dict[str, int]]:
        self._set_request_metric("singleflight_hit", 0)
        resolved_profile = self._resolve_mail_profile(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            require_password=False,
        )
        resolved_mailbox_id = _normalize_text(resolved_profile.get("mailbox_id"))
        cached = self._cached_summary(user_id=int(user_id), mailbox_id=resolved_mailbox_id)
        if cached is not None:
            self._set_request_metric("cache_hit", 1)
            return cached
        self._set_request_metric("cache_hit", 0)
        singleflight_key = self._singleflight_key(
            user_id=int(user_id),
            bucket="folder_summary",
            mailbox_scope=resolved_mailbox_id,
        )

        def _produce() -> dict[str, dict[str, int]]:
            mail_context = self._resolve_account_context(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                require_password=True,
            )
            account = mail_context["account"]
            result = self._list_folder_summary_from_account(account=account)
            return self._cache_set(
                user_id=int(user_id),
                bucket="folder_summary",
                value=result,
                mailbox_scope=resolved_mailbox_id,
            )

        return self._run_singleflight(key=singleflight_key, producer=_produce)

    def _folder_counts(self, folder_obj) -> tuple[int, int]:
        total_attr = self._safe_folder_attr(folder_obj, "total_count")
        unread_attr = self._safe_folder_attr(folder_obj, "unread_count")
        try:
            total = int(total_attr)
        except Exception:
            total = None
        try:
            unread = int(unread_attr)
        except Exception:
            unread = None
        if total is not None and unread is not None:
            return max(0, total), max(0, unread)
        try:
            total = int(folder_obj.all().count())
        except Exception:
            total = 0
        try:
            unread = int(folder_obj.filter(is_read=False).count())
        except Exception:
            unread = 0
        return total, unread

    def _folder_counts_from_hints(self, folder_obj, *, fallback: bool = True) -> tuple[int, int]:
        total = self._folder_total_hint(folder_obj, unread_only=False)
        unread = self._folder_total_hint(folder_obj, unread_only=True)
        if total is not None and unread is not None:
            return total, unread
        if not fallback:
            return max(0, int(total or 0)), max(0, int(unread or 0))
        return self._folder_counts(folder_obj)

    def _folder_total_hint(self, folder_obj, *, unread_only: bool = False) -> int | None:
        attr_name = "unread_count" if unread_only else "total_count"
        raw_value = self._safe_folder_attr(folder_obj, attr_name)
        try:
            return max(0, int(raw_value))
        except Exception:
            return None

    def _serialize_folder_node(
        self,
        account,
        folder_obj,
        *,
        folder_key: str,
        scope: str,
        parent_id: str | None,
        favorite_ids: set[str],
        counts: tuple[int, int] | None = None,
    ) -> dict[str, Any]:
        total, unread = counts if counts is not None else self._folder_counts(folder_obj)
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

    def list_folder_tree(self, *, user_id: int, mailbox_id: str | None = None) -> dict[str, Any]:
        self._set_request_metric("singleflight_hit", 0)
        resolved_profile = self._resolve_mail_profile(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            require_password=False,
        )
        resolved_mailbox_id = _normalize_text(resolved_profile.get("mailbox_id"))
        cached = self._cached_tree(user_id=int(user_id), mailbox_id=resolved_mailbox_id)
        if cached is not None:
            self._set_request_metric("cache_hit", 1)
            return cached
        self._set_request_metric("cache_hit", 0)
        singleflight_key = self._singleflight_key(
            user_id=int(user_id),
            bucket="folder_tree",
            mailbox_scope=resolved_mailbox_id,
        )

        def _produce() -> dict[str, Any]:
            mail_context = self._resolve_account_context(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                require_password=True,
            )
            account = mail_context["account"]
            summary = self._cached_summary(user_id=int(user_id), mailbox_id=resolved_mailbox_id)
            if summary is None:
                summary = self._cache_set(
                    user_id=int(user_id),
                    bucket="folder_summary",
                    value=self._list_folder_summary_from_account(account=account),
                    mailbox_scope=resolved_mailbox_id,
                )
            result = self._list_folder_tree_from_account(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                account=account,
                summary=summary,
            )
            return self._cache_set(
                user_id=int(user_id),
                bucket="folder_tree",
                value=result,
                mailbox_scope=resolved_mailbox_id,
            )

        return self._run_singleflight(key=singleflight_key, producer=_produce)

    def create_folder(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        name: str,
        parent_folder_id: str = "",
        scope: str = "mailbox",
    ) -> dict[str, Any]:
        folder_name = _normalize_text(name)
        if not folder_name:
            raise MailServiceError("Folder name is required")
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=mailbox_id, require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        scope_key = _normalize_text(scope, "mailbox").lower()
        parent_folder = None
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
        if _normalize_text(parent_folder_id):
            parent_folder, parent_key = self._resolve_folder(account, parent_folder_id)
            if str(parent_key) in self._STANDARD_FOLDERS:
                scope_key = self._folder_scope_for_alias(str(parent_key))
            else:
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
        self._set_custom_folder_visible(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            folder_id=created_folder_id,
            visible=True,
        )
        self.invalidate_user_cache(
            user_id=int(user_id),
            prefixes=("folder_tree", "folder_summary", "bootstrap", "messages", "message_detail", "conversation_detail"),
        )
        return self._serialize_folder_node(
            account,
            created,
            folder_key=created_folder_id,
            scope=scope_key,
            parent_id=parent_id,
            favorite_ids=self._list_favorite_folder_ids(user_id=int(user_id), mailbox_id=resolved_mailbox_id),
        )

    def rename_folder(self, *, user_id: int, mailbox_id: str | None = None, folder_id: str, name: str) -> dict[str, Any]:
        next_name = _normalize_text(name)
        if not next_name:
            raise MailServiceError("Folder name is required")
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=mailbox_id, require_password=True)
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
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
        self.invalidate_user_cache(
            user_id=int(user_id),
            prefixes=("folder_tree", "bootstrap", "message_detail", "conversation_detail"),
        )
        return self._serialize_folder_node(
            account,
            folder_obj,
            folder_key=folder_key,
            scope=scope_key,
            parent_id=parent_id,
            favorite_ids=self._list_favorite_folder_ids(user_id=int(user_id), mailbox_id=resolved_mailbox_id),
        )

    def delete_folder(self, *, user_id: int, mailbox_id: str | None = None, folder_id: str) -> dict[str, Any]:
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=mailbox_id, require_password=True)
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
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
        self.set_folder_favorite(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            folder_id=folder_key,
            favorite=False,
        )
        self._set_custom_folder_visible(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            folder_id=folder_key,
            visible=False,
        )
        self.invalidate_user_cache(
            user_id=int(user_id),
            prefixes=("folder_tree", "folder_summary", "bootstrap", "messages", "message_detail", "conversation_detail"),
        )
        return {"ok": True, "folder_id": folder_key}

    def _get_message_context(self, *, user_id: int, mailbox_id: str | None = None, message_id: str) -> dict[str, Any]:
        folder_key, exchange_id, encoded_mailbox_id = self._decode_message_ref(message_id)
        resolved_mailbox_id = self._resolve_mailbox_scope(mailbox_id, encoded_mailbox_id)
        mail_context = self._resolve_account_context(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            require_password=True,
        )
        profile = mail_context["profile"]
        account = mail_context["account"]
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

    def get_message(self, *, user_id: int, mailbox_id: str | None = None, message_id: str) -> dict[str, Any]:
        resolved_mailbox_id = self._resolve_mailbox_id_from_message(mailbox_id=mailbox_id, message_id=message_id)
        self._set_request_metric("singleflight_hit", 0)
        cached = self._cached_message_detail(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            message_id=message_id,
        )
        if cached is not None:
            self._set_request_metric("cache_hit", 1)
            return cached
        self._set_request_metric("cache_hit", 0)
        singleflight_key = self._singleflight_key(
            user_id=int(user_id),
            bucket="message_detail",
            extra=_normalize_text(message_id),
            mailbox_scope=resolved_mailbox_id,
        )

        def _produce() -> dict[str, Any]:
            if resolved_mailbox_id:
                context = self._get_message_context(
                    user_id=int(user_id),
                    mailbox_id=resolved_mailbox_id,
                    message_id=message_id,
                )
            else:
                context = self._get_message_context(
                    user_id=int(user_id),
                    message_id=message_id,
                )
            item = context["item"]
            folder_key = context["folder_key"]
            profile = context["profile"]
            account = context.get("account")
            exchange_id = context["exchange_id"]
            detail_mailbox_id = _normalize_text((profile or {}).get("mailbox_id")) or resolved_mailbox_id
            restore_hint = (
                self._get_restore_hint(
                    user_id=int(user_id),
                    mailbox_id=detail_mailbox_id,
                    trash_exchange_id=exchange_id,
                )
                if folder_key == "trash"
                else None
            )
            draft_context = (
                self._get_draft_context(
                    user_id=int(user_id),
                    mailbox_id=detail_mailbox_id,
                    draft_exchange_id=exchange_id,
                )
                if folder_key == "drafts"
                else None
            )
            if account is not None:
                self._prefetch_inline_attachment_content(item=item, account=account)
            detail = self._serialize_message_detail(
                item=item,
                folder_key=folder_key,
                mailbox_id=detail_mailbox_id,
                mailbox_email=profile["email"],
                restore_hint_folder=(restore_hint or {}).get("restore_folder"),
                draft_context=draft_context,
                include_inline_data_urls=True,
            )
            return self._cache_set(
                user_id=int(user_id),
                bucket="message_detail",
                extra=_normalize_text(message_id),
                value=detail,
                ttl_sec=max(60, min(self.mail_cache_ttl_sec * 4, 180)),
                mailbox_scope=detail_mailbox_id,
            )

        return self._run_singleflight(key=singleflight_key, producer=_produce)

    def _find_conversation_items(
        self,
        *,
        account,
        conversation_id: str,
        folder: str = "inbox",
        folder_scope: str = "current",
    ) -> tuple[str, list[tuple[Any, str]], str]:
        conversation_key = _normalize_text(conversation_id)
        if not conversation_key:
            raise MailServiceError("Conversation id is required")

        items_raw: list[tuple[Any, str]] = []
        last_folder_key = _normalize_text(folder, "inbox")
        targets = self._search_target_folders(
            account,
            folder=_normalize_text(folder, "inbox"),
            folder_scope=_normalize_text(folder_scope, "current"),
        )
        search_budget = max(1, int(self.search_window_limit))
        searched_window = 0
        search_limited = False

        for folder_obj, folder_key in targets:
            last_folder_key = folder_key
            queryset = self._folder_queryset(folder_obj, folder_key)
            scanned = 0
            while True:
                if searched_window >= search_budget:
                    search_limited = True
                    break
                batch_limit = min(self._SEARCH_BATCH_SIZE, search_budget - searched_window)
                batch_items = list(queryset[scanned: scanned + batch_limit])
                if not batch_items:
                    break
                for item in batch_items:
                    if self._item_conversation_key(item) == conversation_key:
                        items_raw.append((item, folder_key))
                scanned += len(batch_items)
                searched_window += len(batch_items)
                if len(batch_items) < batch_limit:
                    break
            if search_limited:
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
                        if searched_window >= search_budget:
                            search_limited = True
                            break
                        batch_limit = min(self._SEARCH_BATCH_SIZE, search_budget - searched_window)
                        batch_items = list(queryset[scanned: scanned + batch_limit])
                        if not batch_items:
                            break
                        for item in batch_items:
                            if self._item_conversation_key(item) == conversation_key:
                                items_raw.append((item, folder_key))
                        scanned += len(batch_items)
                        searched_window += len(batch_items)
                        if len(batch_items) < batch_limit:
                            break
                    if search_limited:
                        break
                if not items_raw:
                    items_raw = [(direct_item, last_folder_key)]

        if not items_raw:
            raise MailServiceError("Conversation not found")

        items_raw.sort(
            key=lambda pair: getattr(pair[0], "datetime_received", None)
            or getattr(pair[0], "datetime_created", None)
            or datetime.min.replace(tzinfo=timezone.utc)
        )
        return conversation_key, items_raw, last_folder_key

    def mark_as_read(self, *, user_id: int, mailbox_id: str | None = None, message_id: str) -> bool:
        """Mark a message as read in the Exchange server."""
        folder_key, exchange_id, encoded_mailbox_id = self._decode_message_ref(message_id)
        profile = self._resolve_mail_profile(
            user_id=int(user_id),
            mailbox_id=self._resolve_mailbox_scope(mailbox_id, encoded_mailbox_id),
            require_password=False,
        )
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
        mail_context = self._resolve_account_context(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            require_password=True,
        )
        account = mail_context["account"]
        folder_obj, _ = self._resolve_folder(account, folder_key)
        try:
            item = folder_obj.get(id=exchange_id)
            if getattr(item, "is_read", None) is False:
                item.is_read = True
                item.save(update_fields=["is_read"])
            self._update_cached_message_detail_read_state(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                message_id=message_id,
                is_read=True,
            )
            self.invalidate_user_cache(
                user_id=int(user_id),
                prefixes=("unread_count", "folder_summary", "messages", "notification_feed", "bootstrap", "conversation_detail"),
            )
            return True
        except Exception as exc:
            raise MailServiceError(f"Failed to mark message as read: {exc}") from exc

    def mark_as_unread(self, *, user_id: int, mailbox_id: str | None = None, message_id: str) -> bool:
        folder_key, exchange_id, encoded_mailbox_id = self._decode_message_ref(message_id)
        profile = self._resolve_mail_profile(
            user_id=int(user_id),
            mailbox_id=self._resolve_mailbox_scope(mailbox_id, encoded_mailbox_id),
            require_password=False,
        )
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
        mail_context = self._resolve_account_context(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            require_password=True,
        )
        account = mail_context["account"]
        folder_obj, _ = self._resolve_folder(account, folder_key)
        try:
            item = folder_obj.get(id=exchange_id)
            if getattr(item, "is_read", None) is True:
                item.is_read = False
                item.save(update_fields=["is_read"])
            self._update_cached_message_detail_read_state(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                message_id=message_id,
                is_read=False,
            )
            self.invalidate_user_cache(
                user_id=int(user_id),
                prefixes=("unread_count", "folder_summary", "messages", "notification_feed", "bootstrap", "conversation_detail"),
            )
            return True
        except Exception as exc:
            raise MailServiceError(f"Failed to mark message as unread: {exc}") from exc

    def _set_conversation_read_state(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        conversation_id: str,
        folder: str = "inbox",
        folder_scope: str = "current",
        is_read: bool,
    ) -> dict[str, Any]:
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=mailbox_id, require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        conversation_key, items_raw, _last_folder_key = self._find_conversation_items(
            account=account,
            conversation_id=conversation_id,
            folder=folder,
            folder_scope=folder_scope,
        )
        changed = 0
        failed = 0
        for item, _folder_key in items_raw:
            try:
                current_read = bool(getattr(item, "is_read", False))
                if current_read == bool(is_read):
                    continue
                item.is_read = bool(is_read)
                item.save(update_fields=["is_read"])
                changed += 1
            except Exception:
                failed += 1
        self.invalidate_user_cache(
            user_id=int(user_id),
            prefixes=("unread_count", "folder_summary", "messages", "notification_feed", "bootstrap", "message_detail", "conversation_detail"),
        )
        return {
            "ok": failed == 0,
            "changed": changed,
            "failed": failed,
            "conversation_id": conversation_key,
            "folder": _normalize_text(folder, "inbox"),
            "folder_scope": _normalize_text(folder_scope, "current"),
            "is_read": bool(is_read),
        }

    def mark_conversation_as_read(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        conversation_id: str,
        folder: str = "inbox",
        folder_scope: str = "current",
    ) -> dict[str, Any]:
        return self._set_conversation_read_state(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            conversation_id=conversation_id,
            folder=folder,
            folder_scope=folder_scope,
            is_read=True,
        )

    def mark_conversation_as_unread(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        conversation_id: str,
        folder: str = "inbox",
        folder_scope: str = "current",
    ) -> dict[str, Any]:
        return self._set_conversation_read_state(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            conversation_id=conversation_id,
            folder=folder,
            folder_scope=folder_scope,
            is_read=False,
        )

    def mark_all_as_read(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        folder: str = "inbox",
        folder_scope: str = "current",
    ) -> dict[str, Any]:
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=mailbox_id, require_password=True)
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
        self.invalidate_user_cache(
            user_id=int(user_id),
            prefixes=("unread_count", "folder_summary", "messages", "notification_feed", "bootstrap", "message_detail", "conversation_detail"),
        )
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
        mailbox_id: str | None = None,
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
                    result = {"ok": self.mark_as_read(user_id=int(user_id), mailbox_id=mailbox_id, message_id=message_id)}
                elif normalized_action == "mark_unread":
                    result = {"ok": self.mark_as_unread(user_id=int(user_id), mailbox_id=mailbox_id, message_id=message_id)}
                elif normalized_action == "move":
                    result = self.move_message(
                        user_id=int(user_id),
                        mailbox_id=mailbox_id,
                        message_id=message_id,
                        target_folder=_normalize_text(target_folder, "inbox"),
                    )
                elif normalized_action == "archive":
                    result = self.move_message(user_id=int(user_id), mailbox_id=mailbox_id, message_id=message_id, target_folder="archive")
                else:
                    result = self.delete_message(
                        user_id=int(user_id),
                        mailbox_id=mailbox_id,
                        message_id=message_id,
                        permanent=bool(permanent),
                    )
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
        if isinstance(mime_content, (bytes, bytearray, memoryview)):
            return bytes(mime_content)
        if isinstance(mime_content, str):
            return mime_content.encode("utf-8", errors="ignore")
        return b""

    @staticmethod
    def _is_downloadable_attachment(attachment: Any) -> bool:
        try:
            from exchangelib.attachments import FileAttachment, ItemAttachment
        except Exception:
            return False
        return isinstance(attachment, (FileAttachment, ItemAttachment))

    @staticmethod
    def _attachment_download_filename(name: Any, *, default_name: str, preferred_extension: str = "") -> str:
        filename = _normalize_text(name, default_name)
        trimmed = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        if preferred_extension and "." not in trimmed:
            filename = f"{filename}{preferred_extension}"
        return filename

    def _build_attachment_download_payload(self, *, attachment: Any, account: Any) -> tuple[str, str, bytes] | None:
        from exchangelib.attachments import FileAttachment, ItemAttachment

        if isinstance(attachment, FileAttachment):
            content = attachment.content
            if not content:
                # Sometimes we need to download it explicitly if not pre-fetched.
                account.protocol.get_attachments([attachment])
                content = attachment.content
            return (
                self._attachment_download_filename(
                    getattr(attachment, "name", None),
                    default_name="attachment.bin",
                ),
                _normalize_text(getattr(attachment, "content_type", "application/octet-stream")),
                bytes(content or b""),
            )

        if isinstance(attachment, ItemAttachment):
            attached_item = getattr(attachment, "item", None)
            content = self._message_mime_content(attached_item)
            if not content and getattr(attachment, "attachment_id", None) is not None:
                attached_item = attachment.item
                content = self._message_mime_content(attached_item)
            if not content:
                raise MailServiceError("Attached item source is not available")
            return (
                self._attachment_download_filename(
                    getattr(attachment, "name", None),
                    default_name="attached-message",
                    preferred_extension=".eml",
                ),
                _normalize_text(getattr(attachment, "content_type", None), "message/rfc822") or "message/rfc822",
                content,
            )

        return None

    def get_message_source(self, *, user_id: int, mailbox_id: str | None = None, message_id: str) -> tuple[str, bytes]:
        context = self._get_message_context(user_id=int(user_id), mailbox_id=mailbox_id, message_id=message_id)
        item = context["item"]
        source = self._message_mime_content(item)
        if not source:
            raise MailServiceError("Raw message source is not available")
        subject = _normalize_text(getattr(item, "subject", None), "message")
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", subject).strip("._") or "message"
        return f"{safe_name}.eml", source

    def get_message_headers(self, *, user_id: int, mailbox_id: str | None = None, message_id: str) -> dict[str, Any]:
        filename, source = self.get_message_source(user_id=int(user_id), mailbox_id=mailbox_id, message_id=message_id)
        parsed = BytesParser(policy=email.policy.default).parsebytes(source)
        items = [{"name": str(name), "value": str(value)} for name, value in parsed.raw_items()]
        return {
            "message_id": message_id,
            "source_name": filename,
            "items": items,
        }

    def move_message(self, *, user_id: int, mailbox_id: str | None = None, message_id: str, target_folder: str) -> dict[str, Any]:
        folder_key, exchange_id, encoded_mailbox_id = self._decode_message_ref(message_id)
        normalized_target = _normalize_text(target_folder, "inbox")
        profile = self._resolve_mail_profile(
            user_id=int(user_id),
            mailbox_id=self._resolve_mailbox_scope(mailbox_id, encoded_mailbox_id),
            require_password=True,
        )
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
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
                    mailbox_id=resolved_mailbox_id,
                    trash_exchange_id=new_exchange_id,
                    restore_folder=source_folder_key,
                    source_exchange_id=exchange_id,
                )
            elif source_folder_key == "trash":
                self._delete_restore_hint(
                    user_id=int(user_id),
                    mailbox_id=resolved_mailbox_id,
                    trash_exchange_id=exchange_id,
                )
            self.invalidate_user_cache(
                user_id=int(user_id),
                prefixes=("unread_count", "folder_summary", "folder_tree", "messages", "notification_feed", "bootstrap", "message_detail", "conversation_detail"),
            )
            return {
                "ok": True,
                "message_id": self._encode_message_id(target_folder_key, new_exchange_id, resolved_mailbox_id),
                "folder": target_folder_key,
            }
        except Exception as exc:
            raise MailServiceError(f"Failed to move message: {exc}") from exc

    def delete_message(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        message_id: str,
        permanent: bool = False,
    ) -> dict[str, Any]:
        folder_key, exchange_id, encoded_mailbox_id = self._decode_message_ref(message_id)
        resolved_mailbox_id = self._resolve_mailbox_scope(mailbox_id, encoded_mailbox_id)
        if permanent and folder_key != "trash":
            raise MailServiceError("Permanent delete is allowed only from trash")
        if not permanent and folder_key != "trash":
            return self.move_message(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                message_id=message_id,
                target_folder="trash",
            )

        profile = self._resolve_mail_profile(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            require_password=True,
        )
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        folder_obj, _ = self._resolve_folder(account, folder_key)
        try:
            item = folder_obj.get(id=exchange_id)
            item.delete()
            self._delete_restore_hint(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                trash_exchange_id=exchange_id,
            )
            self._delete_draft_context(
                mailbox_id=resolved_mailbox_id,
                draft_exchange_id=exchange_id,
            )
            self.invalidate_user_cache(
                user_id=int(user_id),
                prefixes=("unread_count", "folder_summary", "folder_tree", "messages", "notification_feed", "bootstrap", "message_detail", "conversation_detail"),
            )
            return {"ok": True, "permanent": True}
        except Exception as exc:
            raise MailServiceError(f"Failed to delete message: {exc}") from exc

    def restore_message(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        message_id: str,
        target_folder: str = "",
    ) -> dict[str, Any]:
        folder_key, exchange_id, encoded_mailbox_id = self._decode_message_ref(message_id)
        if folder_key != "trash":
            raise MailServiceError("Only messages from trash can be restored")
        resolved_mailbox_id = self._resolve_mailbox_scope(mailbox_id, encoded_mailbox_id)
        hint = self._get_restore_hint(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            trash_exchange_id=exchange_id,
        ) or {}
        restore_folder = _normalize_text(target_folder, hint.get("restore_folder") or "inbox")
        return self.move_message(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            message_id=message_id,
            target_folder=restore_folder,
        )

    def get_unread_count(self, *, user_id: int, mailbox_id: str | None = None) -> int:
        """Get unread count for a mailbox or an aggregate across all active mailboxes."""
        normalized_mailbox_id = _normalize_text(mailbox_id)
        if normalized_mailbox_id:
            try:
                self._set_request_metric("cache_hit", 0)
                return self._get_mailbox_unread_count(user_id=int(user_id), mailbox_id=normalized_mailbox_id)
            except Exception:
                return 0
        cached = self._cached_unread_count(user_id=int(user_id), mailbox_scope="aggregate")
        if cached is not None:
            self._set_request_metric("cache_hit", 1)
            return int(cached)
        try:
            self._set_request_metric("cache_hit", 0)
            total = 0
            for row in self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=False):
                row_id = _normalize_text(row.get("id"))
                if not row_id:
                    continue
                total += self._get_mailbox_unread_count(user_id=int(user_id), mailbox_id=row_id)
            self._cache_set(
                user_id=int(user_id),
                bucket="unread_count",
                mailbox_scope="aggregate",
                value=int(total),
            )
            return int(total)
        except Exception:
            return 0

    def list_notification_feed(self, *, user_id: int, limit: int = 20) -> dict[str, Any]:
        safe_limit = max(1, min(50, int(limit or 20)))
        cached = self._cache_get(
            user_id=int(user_id),
            bucket="notification_feed",
            extra=str(safe_limit),
            mailbox_scope="aggregate",
        )
        if cached is not None:
            return cached
        user = user_service.get_by_id(int(user_id))
        items: list[dict[str, Any]] = []
        for row in self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=False):
            row_id = _normalize_text(row.get("id"))
            if not row_id:
                continue
            try:
                listing = self.list_messages(
                    user_id=int(user_id),
                    mailbox_id=row_id,
                    folder="inbox",
                    folder_scope="current",
                    unread_only=True,
                    limit=safe_limit,
                    offset=0,
                )
            except Exception:
                continue
            mailbox_entry = self._serialize_mailbox_entry(
                user=user or {},
                mailbox_row=row,
                unread_count=0,
                selected=False,
            )
            for item in (listing.get("items") or []):
                items.append(
                    {
                        "id": item.get("id"),
                        "subject": item.get("subject"),
                        "sender": item.get("sender"),
                        "received_at": item.get("received_at"),
                        "is_read": bool(item.get("is_read")),
                        "has_attachments": bool(item.get("has_attachments")),
                        "body_preview": item.get("body_preview"),
                        "mailbox_id": row_id,
                        "mailbox_label": mailbox_entry.get("label"),
                        "mailbox_email": mailbox_entry.get("mailbox_email"),
                    }
                )
        items.sort(key=lambda item: str(item.get("received_at") or ""), reverse=True)
        items = items[:safe_limit]
        payload = {
            "items": items,
            "total_unread": self.get_unread_count(user_id=int(user_id)),
            "limit": safe_limit,
        }
        return self._cache_set(
            user_id=int(user_id),
            bucket="notification_feed",
            extra=str(safe_limit),
            value=payload,
            ttl_sec=max(10, min(self.mail_cache_ttl_sec, 30)),
            mailbox_scope="aggregate",
        )

    def get_bootstrap(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        folder: str = "inbox",
        folder_scope: str = "current",
        limit: int | None = None,
    ) -> dict[str, Any]:
        safe_limit = max(10, min(100, int(limit or self.mail_bootstrap_default_limit)))
        normalized_folder = _normalize_text(folder, "inbox")
        normalized_scope = _normalize_text(folder_scope, "current")
        self._set_request_metric("singleflight_hit", 0)
        config_payload = self.get_my_config(user_id=int(user_id), mailbox_id=mailbox_id)
        resolved_mailbox_id = _normalize_text(config_payload.get("id") or config_payload.get("mailbox_id"))
        mailbox_items = self.list_user_mailboxes(
            user_id=int(user_id),
            include_inactive=True,
            include_unread=False,
            active_mailbox_id=resolved_mailbox_id or None,
        )
        preferences_payload = self.get_preferences(user_id=int(user_id))
        mail_requires_password = bool(config_payload.get("mail_requires_password"))
        mail_requires_relogin = bool(config_payload.get("mail_requires_relogin"))
        access_ready = bool(config_payload.get("mail_is_configured")) and not mail_requires_password and not mail_requires_relogin
        if not access_ready:
            return {
                "selected_mailbox": config_payload,
                "mailboxes": mailbox_items,
                "mailboxInfo": config_payload,
                "preferences": preferences_payload,
                "unread_count": 0,
                "folder_summary": {},
                "folder_tree": {"items": [], "favorites": []},
                "messages": {
                    "items": [],
                    "folder": normalized_folder,
                    "limit": safe_limit,
                    "offset": 0,
                    "total": 0,
                    "has_more": False,
                    "next_offset": None,
                    "search_limited": False,
                    "searched_window": 0,
                },
            }

        summary = self._cached_summary(user_id=int(user_id), mailbox_id=resolved_mailbox_id)
        tree = self._cached_tree(user_id=int(user_id), mailbox_id=resolved_mailbox_id)
        unread_count = self._cached_unread_count(user_id=int(user_id), mailbox_scope="aggregate")
        messages = self._cached_messages(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            folder=normalized_folder,
            folder_scope=normalized_scope,
            limit=safe_limit,
            offset=0,
            unread_only=False,
        )
        bootstrap_cache_hit = summary is not None and tree is not None and unread_count is not None and messages is not None
        self._set_request_metric("cache_hit", int(bool(bootstrap_cache_hit)))
        if not bootstrap_cache_hit:
            singleflight_key = self._singleflight_key(
                user_id=int(user_id),
                bucket="bootstrap",
                extra=f"{normalized_folder}|{normalized_scope}|{safe_limit}",
                mailbox_scope=resolved_mailbox_id,
            )

            def _produce() -> tuple[dict[str, dict[str, int]], dict[str, Any], int, dict[str, Any]]:
                next_summary = self._cached_summary(user_id=int(user_id), mailbox_id=resolved_mailbox_id)
                next_tree = self._cached_tree(user_id=int(user_id), mailbox_id=resolved_mailbox_id)
                next_unread_count = self._cached_unread_count(user_id=int(user_id), mailbox_scope="aggregate")
                next_messages = self._cached_messages(
                    user_id=int(user_id),
                    mailbox_id=resolved_mailbox_id,
                    folder=normalized_folder,
                    folder_scope=normalized_scope,
                    limit=safe_limit,
                    offset=0,
                    unread_only=False,
                )
                if next_summary is not None and next_tree is not None and next_unread_count is not None and next_messages is not None:
                    return next_summary, next_tree, int(next_unread_count or 0), next_messages

                mail_context = self._resolve_account_context(
                    user_id=int(user_id),
                    mailbox_id=resolved_mailbox_id,
                    require_password=True,
                )
                account = mail_context["account"]
                if next_summary is None:
                    next_summary = self._cache_set(
                        user_id=int(user_id),
                        bucket="folder_summary",
                        value=self._list_folder_summary_from_account(account=account),
                        mailbox_scope=resolved_mailbox_id,
                    )
                if next_tree is None:
                    next_tree = self._cache_set(
                        user_id=int(user_id),
                        bucket="folder_tree",
                        value=self._list_folder_tree_from_account(
                            user_id=int(user_id),
                            mailbox_id=resolved_mailbox_id or None,
                            account=account,
                            summary=next_summary,
                        ),
                        mailbox_scope=resolved_mailbox_id,
                    )
                if next_unread_count is None:
                    next_unread_count = self._cache_set(
                        user_id=int(user_id),
                        bucket="unread_count",
                        mailbox_scope="aggregate",
                        value=self.get_unread_count(user_id=int(user_id)),
                    )
                if next_messages is None:
                    next_messages = self._cache_set(
                        user_id=int(user_id),
                        bucket="messages",
                        extra=f"{normalized_folder}|{normalized_scope}|{safe_limit}|0|0",
                        value=self._list_messages_from_account(
                            account=account,
                            mailbox_id=resolved_mailbox_id or None,
                            folder=normalized_folder,
                            folder_scope=normalized_scope,
                            limit=safe_limit,
                            offset=0,
                        ),
                        mailbox_scope=resolved_mailbox_id,
                    )
                return next_summary, next_tree, int(next_unread_count or 0), next_messages

            summary, tree, unread_count, messages = self._run_singleflight(
                key=singleflight_key,
                producer=_produce,
            )
        return {
            "selected_mailbox": config_payload,
            "mailboxes": mailbox_items,
            "mailboxInfo": config_payload,
            "preferences": preferences_payload,
            "unread_count": int(unread_count or 0),
            "folder_summary": summary,
            "folder_tree": tree,
            "messages": messages,
        }

    def list_conversations(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
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
        self._set_request_metric("singleflight_hit", 0)
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

        mail_context = self._resolve_account_context(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            require_password=True,
        )
        account = mail_context["account"]
        scanned = 0
        search_limited = False
        search_budget = max(1, int(self.search_window_limit))
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
                if scanned >= search_budget:
                    search_limited = True
                    break
                batch_limit = min(self._SEARCH_BATCH_SIZE, search_budget - scanned)
                batch_items = list(queryset[scan_offset: scan_offset + batch_limit])
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
                    participant_people = [
                        self._item_sender_person(item),
                        *self._item_recipient_people(item),
                    ]
                    if group is None:
                        group = {
                            "conversation_id": key,
                            "subject": _normalize_text(getattr(item, "subject", "")) or "(без темы)",
                            "participants": [],
                            "participant_people": [],
                            "participants_set": set(),
                            "participant_people_set": set(),
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
                    for participant in participant_people:
                        value = self._person_lookup_key(participant)
                        if value and value not in group["participant_people_set"]:
                            group["participant_people_set"].add(value)
                            group["participant_people"].append(participant)
                scanned += len(batch_items)
                scan_offset += len(batch_items)
                if len(batch_items) < batch_limit:
                    break
            if search_limited:
                break

        conversations = [
            {
                "conversation_id": item["conversation_id"],
                "subject": item["subject"],
                "participants": item["participants"],
                "participant_people": item["participant_people"],
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
        self._set_request_metric("searched_window", scanned)
        self._set_request_metric("search_limited", int(bool(search_limited)))
        return {
            "items": page_items,
            "folder": _normalize_text(folder, "inbox"),
            "limit": safe_limit,
            "offset": safe_offset,
            "total": total,
            "has_more": next_offset < total,
            "next_offset": next_offset if next_offset < total else None,
            "search_limited": bool(search_limited),
            "searched_window": scanned,
        }

    def get_conversation(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        conversation_id: str,
        folder: str = "inbox",
        folder_scope: str = "current",
    ) -> dict[str, Any]:
        conversation_key = _normalize_text(conversation_id)
        if not conversation_key:
            raise MailServiceError("Conversation id is required")
        resolved_mailbox_id = _normalize_text(
            self._resolve_mail_profile(
                user_id=int(user_id),
                mailbox_id=mailbox_id,
                require_password=False,
            ).get("mailbox_id")
        )
        self._set_request_metric("singleflight_hit", 0)
        cached = self._cached_conversation_detail(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            conversation_id=conversation_key,
            folder=folder,
            folder_scope=folder_scope,
        )
        if cached is not None:
            self._set_request_metric("cache_hit", 1)
            return cached
        self._set_request_metric("cache_hit", 0)
        normalized_folder = _normalize_text(folder, "inbox")
        normalized_scope = _normalize_text(folder_scope, "current")
        singleflight_key = self._singleflight_key(
            user_id=int(user_id),
            bucket="conversation_detail",
            extra=f"{conversation_key}|{normalized_folder}|{normalized_scope}",
            mailbox_scope=resolved_mailbox_id,
        )

        def _produce() -> dict[str, Any]:
            mail_context = self._resolve_account_context(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                require_password=True,
            )
            profile = mail_context["profile"]
            account = mail_context["account"]
            resolved_conversation_key, items_raw, _last_folder_key = self._find_conversation_items(
                account=account,
                conversation_id=conversation_key,
                folder=normalized_folder,
                folder_scope=normalized_scope,
            )
            items = [
                self._serialize_message_detail(
                    item=item,
                    folder_key=item_folder_key,
                    mailbox_id=resolved_mailbox_id,
                    mailbox_email=profile["email"],
                )
                for item, item_folder_key in items_raw
            ]
            participants: list[str] = []
            participant_people: list[dict[str, str | None]] = []
            participant_email_seen: set[str] = set()
            participant_people_seen: set[str] = set()
            for item in items:
                for value in [item.get("sender"), *(item.get("to") or []), *(item.get("cc") or [])]:
                    email = _normalize_text(value).lower()
                    if not email or email in participant_email_seen:
                        continue
                    participant_email_seen.add(email)
                    participants.append(email)
                for person in [item.get("sender_person"), *(item.get("to_people") or []), *(item.get("cc_people") or [])]:
                    lookup_key = self._person_lookup_key(person)
                    if not lookup_key or lookup_key in participant_people_seen:
                        continue
                    participant_people_seen.add(lookup_key)
                    participant_people.append(person)

            payload = {
                "conversation_id": resolved_conversation_key,
                "subject": items[-1].get("subject") or "(без темы)",
                "participants": participants,
                "participant_people": participant_people,
                "messages_count": len(items),
                "unread_count": sum(1 for item in items if not item.get("is_read")),
                "last_received_at": items[-1].get("received_at"),
                "items": items,
            }
            return self._cache_set(
                user_id=int(user_id),
                bucket="conversation_detail",
                extra=f"{resolved_conversation_key}|{normalized_folder}|{normalized_scope}",
                value=payload,
                mailbox_scope=resolved_mailbox_id,
            )

        return self._run_singleflight(key=singleflight_key, producer=_produce)

    def save_draft(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
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
        effective_mailbox_id = self._resolve_outbound_mailbox_id(
            mailbox_id=mailbox_id,
            draft_id=draft_id,
            reply_to_message_id=reply_to_message_id,
            forward_message_id=forward_message_id,
        )
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=effective_mailbox_id, require_password=True)
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
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
            folder_key, draft_exchange_id, encoded_mailbox_id = self._decode_message_ref(draft_id)
            if folder_key != "drafts":
                raise MailServiceError("Draft id must point to drafts folder")
            resolved_mailbox_id = self._resolve_mailbox_scope(resolved_mailbox_id, encoded_mailbox_id)
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
                mailbox_id=resolved_mailbox_id,
                draft_exchange_id=draft_exchange_id,
                compose_mode=_normalize_text(compose_mode, "draft"),
                reply_to_message_id=_normalize_text(reply_to_message_id) or None,
                forward_message_id=_normalize_text(forward_message_id) or None,
            )
            detail = self._serialize_message_detail(
                item=draft_item,
                folder_key="drafts",
                mailbox_id=resolved_mailbox_id,
                mailbox_email=profile["email"],
                draft_context=self._get_draft_context(
                    user_id=int(user_id),
                    mailbox_id=resolved_mailbox_id,
                    draft_exchange_id=draft_exchange_id,
                ),
            )
            self.invalidate_user_cache(
                user_id=int(user_id),
                prefixes=("folder_summary", "folder_tree", "messages", "bootstrap", "message_detail", "conversation_detail"),
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

    def delete_draft(self, *, user_id: int, mailbox_id: str | None = None, draft_id: str) -> dict[str, Any]:
        folder_key, exchange_id, encoded_mailbox_id = self._decode_message_ref(draft_id)
        if folder_key != "drafts":
            raise MailServiceError("Draft id must point to drafts folder")
        profile = self._resolve_mail_profile(
            user_id=int(user_id),
            mailbox_id=self._resolve_mailbox_scope(mailbox_id, encoded_mailbox_id),
            require_password=True,
        )
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        try:
            item = account.drafts.get(id=exchange_id)
            item.delete()
            self._delete_draft_context(mailbox_id=resolved_mailbox_id, draft_exchange_id=exchange_id)
            self.invalidate_user_cache(
                user_id=int(user_id),
                prefixes=("folder_summary", "folder_tree", "messages", "bootstrap", "message_detail", "conversation_detail"),
            )
            return {"ok": True, "draft_id": draft_id}
        except Exception as exc:
            raise MailServiceError(f"Failed to delete draft: {exc}") from exc

    def download_attachment(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        message_id: str,
        attachment_ref: str,
    ) -> tuple[str, str, bytes]:
        normalized_attachment_ref = _normalize_text(attachment_ref)
        attachment_id = self.resolve_attachment_id(normalized_attachment_ref)
        resolved_profile = self._resolve_mail_profile(
            user_id=int(user_id),
            mailbox_id=self._resolve_mailbox_scope(
                mailbox_id,
                self._resolve_mailbox_id_from_message(message_id=message_id),
                self._resolve_mailbox_id_from_attachment(attachment_ref=normalized_attachment_ref),
            ),
            require_password=False,
        )
        resolved_mailbox_id = _normalize_text(resolved_profile.get("mailbox_id"))
        cached = self._cached_attachment_content(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            message_id=message_id,
            attachment_id=attachment_id,
        )
        if cached is not None:
            self._set_request_metric("cache_hit", 1)
            return cached
        self._set_request_metric("cache_hit", 0)
        folder_key, exchange_id, _encoded_mailbox_id = self._decode_message_ref(message_id)
        mail_context = self._resolve_account_context(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            require_password=True,
        )
        account = mail_context["account"]
        folder_obj, _ = self._resolve_folder(account, folder_key)
        try:
            item = folder_obj.get(id=exchange_id)
        except Exception as exc:
            raise MailServiceError(f"Message not found: {exchange_id}") from exc

        try:
            for att in getattr(item, "attachments", []) or []:
                att_id = self._extract_attachment_raw_id(att)
                if att_id == attachment_id:
                    payload = self._build_attachment_download_payload(attachment=att, account=account)
                    if payload is not None:
                        return self._cache_set(
                            user_id=int(user_id),
                            bucket="attachment_content",
                            extra=f"{_normalize_text(message_id)}|{_normalize_text(attachment_id)}",
                            value=payload,
                            ttl_sec=60,
                            mailbox_scope=resolved_mailbox_id,
                        )
                    raise MailServiceError(f"Attachment type is not supported for download: {type(att).__name__}")
            raise MailServiceError(f"Attachment not found: {attachment_id}")
        except MailServiceError:
            raise
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
        mailbox_id: str | None = None,
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
        effective_mailbox_id = self._resolve_outbound_mailbox_id(
            mailbox_id=mailbox_id,
            draft_id=draft_id,
            reply_to_message_id=reply_to_message_id,
            forward_message_id=forward_message_id,
        )
        profile = self._resolve_mail_profile(
            user_id=int(user_id),
            mailbox_id=effective_mailbox_id,
            require_password=True,
        )
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )

        message_id = _normalize_text(base64.urlsafe_b64encode(os.urandom(12)).decode("utf-8"))
        final_subject = _normalize_text(subject)
        final_body = _normalize_text(body)
        signature = _normalize_text(profile["signature"])
        if is_html:
            final_body = _build_outgoing_html_body(
                final_body,
                signature,
                prefer_signature_before_quote=bool(_normalize_text(reply_to_message_id) or _normalize_text(forward_message_id)),
            )
        elif signature:
            separator = "\n\n"
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
                    self.delete_draft(user_id=int(user_id), mailbox_id=resolved_mailbox_id, draft_id=draft_id)
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
            self.invalidate_user_cache(
                user_id=int(user_id),
                prefixes=("folder_summary", "folder_tree", "messages", "notification_feed", "bootstrap", "message_detail", "conversation_detail"),
            )
            return {
                "ok": True,
                "message_id": message_id,
                "subject": final_subject,
                "recipients": recipients,
                "cc": cc_recipients,
                "bcc": bcc_recipients,
                "mailbox_id": _normalize_text(profile.get("mailbox_id")) or None,
                "mailbox_email": _normalize_text(profile.get("email")) or None,
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

    def search_contacts(self, user_id: int, q: str, mailbox_id: str | None = None) -> list[dict[str, str]]:
        query = _normalize_text(q)
        if len(query) < 2:
            return []
        
        try:
            profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=mailbox_id, require_password=True)
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
                ORDER BY updated_at DESC, LOWER(title) ASC
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

    def _build_legacy_mail_config_payload(self, *, user: dict[str, Any]) -> dict[str, Any]:
        mail_auth_mode = self._mail_auth_mode_for_user(user)
        mailbox_email = self._build_effective_mailbox_email(user) or None
        mailbox_login = _normalize_text(user.get("mailbox_login")) or None
        effective_mailbox_login = self._build_effective_mailbox_login(user) or None
        signature = _normalize_signature_html(user.get("mail_signature_html")) or None
        mail_requires_password = False
        mail_requires_relogin = False
        password_enc = _normalize_text(user.get("mailbox_password_enc"))
        auth_mode = self._legacy_user_mail_auth_mode(user)
        if auth_mode == "primary_session":
            session_id = get_request_session_id()
            session_context = session_auth_context_service.get_session_context(
                session_id,
                user_id=int(user.get("id") or 0),
            )
            if session_context:
                session_login = _normalize_text(session_context.get("exchange_login"))
                if session_login:
                    effective_mailbox_login = session_login
            mail_requires_relogin = not bool(
                session_context and session_auth_context_service.resolve_session_password(session_id, user_id=int(user.get("id") or 0))
            )
            mail_is_configured = bool(mailbox_email and effective_mailbox_login and not mail_requires_relogin)
        else:
            mail_requires_password = not bool(password_enc)
            mail_is_configured = bool(mailbox_email and effective_mailbox_login and password_enc)
            mail_auth_mode = "manual"
        return {
            "id": None,
            "mailbox_id": None,
            "label": mailbox_email or _normalize_text(user.get("email")) or "Основной ящик",
            "user_id": int(user.get("id") or 0),
            "username": _normalize_text(user.get("username")),
            "mailbox_email": mailbox_email,
            "mailbox_login": mailbox_login,
            "effective_mailbox_login": effective_mailbox_login,
            "auth_mode": auth_mode,
            "mail_auth_mode": mail_auth_mode,
            "is_primary": True,
            "is_active": True,
            "is_selected": True,
            "mail_requires_relogin": bool(mail_requires_relogin),
            "mail_requires_password": bool(mail_requires_password),
            "mail_signature_html": signature,
            "mail_is_configured": mail_is_configured,
            "mail_updated_at": _normalize_text(user.get("mail_updated_at")) or None,
            "unread_count": 0,
            "last_selected_at": None,
            "sort_order": 0,
        }

    def get_my_config(self, *, user_id: int, mailbox_id: str | None = None) -> dict[str, Any]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")
        rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
        if not rows:
            return self._build_legacy_mail_config_payload(user=user)
        row = self._resolve_mailbox_row(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            allow_inactive=True,
        )
        resolved_mailbox_id = _normalize_text(row.get("id"))
        if resolved_mailbox_id:
            self._touch_mailbox_selected(user_id=int(user_id), mailbox_id=resolved_mailbox_id)
        payload = self._serialize_mailbox_entry(
            user=user,
            mailbox_row=row,
            unread_count=0,
            selected=True,
        )
        payload["user_id"] = int(user.get("id") or 0)
        payload["username"] = _normalize_text(user.get("username"))
        payload["mailbox_id"] = payload.get("id")
        return payload

    def save_my_credentials(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        mailbox_login: Optional[str] = None,
        mailbox_password: Optional[str] = None,
        mailbox_email: Optional[str] | object = _UNSET,
    ) -> dict[str, Any]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")
        password = _normalize_text(mailbox_password)
        if not password:
            raise MailServiceError(
                "Mailbox password is required",
                code="MAIL_PASSWORD_REQUIRED",
                status_code=409,
            )

        rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
        if not rows:
            login = _normalize_text(mailbox_login or self._build_effective_mailbox_login(user)).lower()
            email_source = dict(user)
            if mailbox_email is not _UNSET:
                email_source["mailbox_email"] = str(mailbox_email or "").strip() or None
            email = self._build_effective_mailbox_email(email_source)
            if not email:
                raise MailServiceError("Mailbox email is not configured")
            if not login:
                raise MailServiceError("Mailbox login is not configured")
            self.verify_mailbox_credentials(
                mailbox_email=email,
                mailbox_login=login,
                mailbox_password=password,
            )
            updated = user_service.update_user(
                int(user_id),
                mailbox_email=email if mailbox_email is not _UNSET else _UNSET,
                mailbox_login=login,
                mailbox_password=password,
            )
            if not updated:
                raise MailServiceError("User not found")
            self._ensure_user_mailboxes_seeded(user_id=int(user_id))
            self.invalidate_user_cache(user_id=int(user_id))
            target_row = self._resolve_primary_mailbox_row(user_id=int(user_id), allow_inactive=True)
            return self.get_my_config(
                user_id=int(user_id),
                mailbox_id=_normalize_text((target_row or {}).get("id")) or None,
            )

        target_row = self._resolve_mailbox_row(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            allow_inactive=True,
        )
        target_mailbox_id = _normalize_text(target_row.get("id"))
        target_auth_mode = _normalize_text(target_row.get("auth_mode"), "stored_credentials").lower()
        next_email = (
            _normalize_text(mailbox_email).lower()
            if mailbox_email is not _UNSET
            else _normalize_text(target_row.get("mailbox_email")).lower()
        )
        derived_login = ""
        if target_auth_mode == "primary_session":
            derived_login = self._build_effective_mailbox_login(user)
        next_login = _normalize_text(
            mailbox_login
            or target_row.get("mailbox_login")
            or derived_login
            or next_email
        ).lower()
        if not next_email:
            raise MailServiceError("Mailbox email is not configured")
        if not next_login:
            raise MailServiceError("Mailbox login is not configured")
        self.verify_mailbox_credentials(
            mailbox_email=next_email,
            mailbox_login=next_login,
            mailbox_password=password,
        )
        self.update_user_mailbox(
            user_id=int(user_id),
            mailbox_id=target_mailbox_id,
            mailbox_email=next_email if mailbox_email is not _UNSET else _UNSET,
            mailbox_login=next_login,
            mailbox_password=password,
            auth_mode="stored_credentials",
        )
        self.invalidate_user_cache(user_id=int(user_id))
        return self.get_my_config(user_id=int(user_id), mailbox_id=target_mailbox_id)

    def update_user_config(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        mailbox_email: Optional[str] | object = _UNSET,
        mailbox_login: Optional[str] | object = _UNSET,
        mailbox_password: Optional[str] | object = _UNSET,
        mail_signature_html: Optional[str] | object = _UNSET,
    ) -> dict[str, Any]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")
        target_mailbox_id = _normalize_text(mailbox_id)
        if mail_signature_html is not _UNSET:
            normalized_signature_html = _normalize_signature_html(mail_signature_html)
            updated = user_service.update_user(
                int(user_id),
                mail_signature_html=normalized_signature_html or None,
            )
            if not updated:
                raise MailServiceError("User not found")

        mailbox_fields_changed = (
            mailbox_email is not _UNSET
            or mailbox_login is not _UNSET
            or mailbox_password is not _UNSET
        )
        if mailbox_fields_changed:
            rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
            if rows:
                target_row = self._resolve_mailbox_row(
                    user_id=int(user_id),
                    mailbox_id=target_mailbox_id or None,
                    allow_inactive=True,
                )
                target_mailbox_id = _normalize_text(target_row.get("id"))
                self.update_user_mailbox(
                    user_id=int(user_id),
                    mailbox_id=target_mailbox_id,
                    mailbox_email=mailbox_email,
                    mailbox_login=mailbox_login,
                    mailbox_password=mailbox_password,
                )
            else:
                mail_auth_mode = self._mail_auth_mode_for_user(user)
                legacy_update_payload: dict[str, Any] = {}
                if mailbox_email is not _UNSET:
                    legacy_update_payload["mailbox_email"] = mailbox_email
                if mailbox_login is not _UNSET and mail_auth_mode != "ad_auto":
                    legacy_update_payload["mailbox_login"] = mailbox_login
                if mailbox_password is not _UNSET and mail_auth_mode != "ad_auto":
                    legacy_update_payload["mailbox_password"] = mailbox_password
                if legacy_update_payload:
                    updated = user_service.update_user(
                        int(user_id),
                        **legacy_update_payload,
                    )
                    if not updated:
                        raise MailServiceError("User not found")
                    self._ensure_user_mailboxes_seeded(user_id=int(user_id))
                    target_row = self._resolve_primary_mailbox_row(user_id=int(user_id), allow_inactive=True)
                    target_mailbox_id = _normalize_text((target_row or {}).get("id"))
        self.invalidate_user_cache(user_id=int(user_id))
        return self.get_my_config(user_id=int(user_id), mailbox_id=target_mailbox_id or None)

    def test_connection(self, *, user_id: int, mailbox_id: str | None = None) -> dict[str, Any]:
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=mailbox_id, require_password=True)
        try:
            account = self._create_account(
                email=profile["email"],
                login=profile["login"],
                password=profile["password"],
            )
            inbox = account.inbox
            sample = list(inbox.all().order_by("-datetime_received")[:1])
        except MailServiceError:
            raise
        except Exception as exc:
            raise MailServiceError(f"Failed to verify mailbox credentials: {exc}") from exc
        return {
            "ok": True,
            "exchange_host": self.exchange_host,
            "ews_url": self.exchange_ews_url,
            "mailbox_email": profile["email"],
            "effective_mailbox_login": profile["login"],
            "mail_auth_mode": profile["mail_auth_mode"],
            "mailbox_id": _normalize_text(profile.get("mailbox_id")) or None,
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
