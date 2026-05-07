"""
Mail service for Exchange (EWS/NTLM) inbox access, sending and IT request templates.
"""
from __future__ import annotations

import base64
import logging
import os
import re
import sqlite3
import warnings
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Optional

from sqlalchemy import inspect

from backend.appdb.db import get_app_database_url, get_app_engine, initialize_app_schema, is_app_database_configured
from backend.appdb.sql_compat import SqlAlchemyCompatConnection
from backend.config import config
from backend.db_schema import schema_name
from local_store import get_local_store
from backend.services.secret_crypto_service import decrypt_secret, encrypt_secret
from backend.services.request_auth_context_service import get_request_session_id
from backend.services.session_auth_context_service import normalize_exchange_login, session_auth_context_service
from backend.services.mail_outgoing_html import (
    build_outgoing_html_body,
    normalize_outgoing_readable_text_colors,
    normalize_signature_html,
    normalize_signature_line_spacing,
    parse_outgoing_css_color,
    plain_text_to_html,
    split_outgoing_html_for_signature,
    wrap_outgoing_html_fragment,
)
from backend.services.mail_exchange_transport import (
    ExchangeTransportError,
    build_ca_bundle_http_adapter,
    create_exchange_account,
    get_no_verify_http_adapter,
    resolve_exchange_http_adapter,
    resolve_tls_ca_bundle,
    suppress_insecure_request_warning,
)
from backend.services.mail_folder_tree import MailFolderTreeBuilder
from backend.services.mail_folder_mutations import MailFolderMutationError, MailFolderMutations
from backend.services.mail_message_actions import MailMessageActionError, MailMessageActions
from backend.services.mail_message_content import MailMessageContent, MailMessageContentError
from backend.services.mail_draft_lifecycle import MailDraftLifecycle, MailDraftLifecycleError
from backend.services.mail_conversation_finder import MailConversationFinder, MailConversationFinderError
from backend.services.mail_conversation_payloads import MailConversationPayloadBuilder
from backend.services.mail_message_listing import (
    MailMessageListBuilder,
    message_matches_filters,
)
from backend.services.mail_mailbox_model import (
    MailboxSelectionError,
    build_legacy_mailbox_seed,
    has_duplicate_mailbox_email,
    next_mailbox_sort_order,
    primary_mailbox_row,
    select_mailbox_row,
    serialize_mailbox_entry,
)
from backend.services.mail_mailbox_store import MailMailboxStore
from backend.services.mail_account_profile_resolver import (
    MailAccountProfileError,
    MailAccountProfileResolver,
)
from backend.services.mail_compose_orchestration import (
    ComposeValidationError,
    build_draft_upsert_plan,
    build_outbound_send_plan,
    build_recipient_set,
    build_reply_forward_reference_headers,
    parse_recipients,
    resolve_outbound_mailbox_id,
)
from backend.services.mail_metadata_store import MailMetadataStore
from backend.services.mail_message_serializer import (
    MailMessageSerializer,
    item_bcc_recipient_people,
    item_bcc_recipients,
    item_conversation_key,
    item_importance,
    item_message_id,
    item_recipient_people,
    item_recipients,
    item_sender,
    item_sender_person,
    normalize_subject_for_conversation,
    person_lookup_key,
    serialize_person,
)
from backend.services.mail_runtime_cache import (
    MailRuntimeCache,
    RuntimeCachePolicy,
    SingleflightGroup,
    cache_key,
    estimate_cache_value_size,
    singleflight_key,
)
from backend.services.mail_reference_codec import (
    ATTACHMENT_TOKEN_PREFIX,
    ATTACHMENT_TOKEN_PREFIX_LEGACY,
    MailReferenceError,
    build_inline_attachment_src,
    decode_attachment_ref,
    decode_attachment_token,
    decode_folder_id,
    decode_message_id,
    decode_message_ref,
    encode_attachment_token,
    encode_folder_id,
    encode_message_id,
    extract_attachment_id_from_repr,
    extract_attachment_raw_id,
    make_scoped_storage_key,
    normalize_attachment_content_id,
    normalize_attachment_id_candidate,
    resolve_mailbox_scope,
    split_scoped_storage_key,
)
from backend.services.mail_profile_model import (
    build_effective_mailbox_email,
    build_effective_mailbox_login,
    legacy_user_mailbox_auth_mode,
    mail_auth_mode_for_user,
    normalize_mailbox_auth_mode,
)
from backend.services.mail_template_model import (
    AttachmentLimitError,
    AttachmentLimits,
    TEMPLATE_FIELD_TYPES,
    TemplateValidationError,
    coerce_field_value,
    normalize_field_options,
    normalize_template_field,
    normalize_template_fields,
    render_template,
    validate_attachments_limits,
    validate_template_values,
    value_to_template_string,
)
from backend.services.mail_template_store import (
    MailTemplateStore,
    TemplateStoreError,
    parse_template_fields_json,
)
from backend.services.user_service import build_default_ldap_mailbox_email, user_service

logger = logging.getLogger(__name__)
_UNSET = object()
_MAIL_REQUEST_CONTEXT: ContextVar[dict[str, Any] | None] = ContextVar("mail_request_context", default=None)
_MAIL_REQUEST_METRICS: ContextVar[dict[str, Any] | None] = ContextVar("mail_request_metrics", default=None)
_EXCHANGE_HTTP_ADAPTER_LOCK = RLock()
_EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS: Any = None
_EXCHANGE_HTTP_ADAPTER_SIGNATURE: tuple[Any, ...] | None = None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


_plain_text_to_html = plain_text_to_html
_parse_outgoing_css_color = parse_outgoing_css_color
_normalize_outgoing_readable_text_colors = normalize_outgoing_readable_text_colors
_normalize_signature_line_spacing = normalize_signature_line_spacing
_normalize_signature_html = normalize_signature_html
_split_outgoing_html_for_signature = split_outgoing_html_for_signature
_wrap_outgoing_html_fragment = wrap_outgoing_html_fragment
_build_outgoing_html_body = build_outgoing_html_body


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
    return parse_recipients(value)


class MailServiceError(RuntimeError):
    """Domain error for mail service operations."""

    def __init__(self, message: str, *, code: str = "MAIL_ERROR", status_code: int = 400) -> None:
        super().__init__(message)
        self.code = str(code or "MAIL_ERROR")
        self.status_code = int(status_code or 400)


class MailPayloadTooLargeError(MailServiceError):
    """Payload is too large (attachments count/size limits)."""


class MailSchemaConfigurationError(RuntimeError):
    """Raised when production mail schema is not migration-ready."""


_MAIL_REQUIRED_COLUMNS = {
    "mail_it_templates": {
        "id",
        "code",
        "title",
        "category",
        "subject_template",
        "body_template_md",
        "required_fields_json",
        "is_active",
        "created_by_user_id",
        "created_by_username",
        "updated_by_user_id",
        "updated_by_username",
        "created_at",
        "updated_at",
    },
    "mail_messages_log": {
        "id",
        "user_id",
        "username",
        "direction",
        "folder_hint",
        "subject",
        "recipients_json",
        "sent_at",
        "status",
        "exchange_item_id",
        "error_text",
    },
    "mail_restore_hints": {"user_id", "trash_exchange_id", "restore_folder", "source_exchange_id", "created_at"},
    "mail_draft_context": {
        "draft_exchange_id",
        "user_id",
        "compose_mode",
        "reply_to_message_id",
        "forward_message_id",
        "updated_at",
    },
    "mail_folder_favorites": {"user_id", "folder_id", "created_at"},
    "mail_visible_custom_folders": {"user_id", "folder_id", "created_at"},
    "mail_user_preferences": {"user_id", "prefs_json", "updated_at"},
    "user_mailboxes": {
        "id",
        "user_id",
        "label",
        "mailbox_email",
        "mailbox_login",
        "mailbox_password_enc",
        "auth_mode",
        "is_primary",
        "is_active",
        "sort_order",
        "last_selected_at",
        "created_at",
        "updated_at",
    },
}
_MAIL_REQUIRED_INDEXES = {
    "mail_it_templates": {"idx_mail_it_templates_active"},
    "mail_messages_log": {"idx_mail_messages_log_user_time"},
    "mail_restore_hints": {"idx_mail_restore_hints_created"},
    "mail_draft_context": {"idx_mail_draft_context_user_updated"},
    "mail_folder_favorites": {"idx_mail_folder_favorites_user_created"},
    "mail_visible_custom_folders": {"idx_mail_visible_custom_folders_user_created"},
    "user_mailboxes": {
        "ix_app_user_mailboxes_user_id",
        "ix_app_user_mailboxes_user_id_is_active",
        "ix_app_user_mailboxes_user_id_is_primary",
    },
}


class MailService:
    _USER_MAILBOXES_TABLE = "user_mailboxes"
    _TEMPLATES_TABLE = "mail_it_templates"
    _LOG_TABLE = "mail_messages_log"
    _RESTORE_HINTS_TABLE = "mail_restore_hints"
    _DRAFT_CONTEXT_TABLE = "mail_draft_context"
    _FOLDER_FAVORITES_TABLE = "mail_folder_favorites"
    _VISIBLE_CUSTOM_FOLDERS_TABLE = "mail_visible_custom_folders"
    _USER_PREFS_TABLE = "mail_user_preferences"
    _ATTACHMENT_TOKEN_PREFIX = ATTACHMENT_TOKEN_PREFIX
    _ATTACHMENT_TOKEN_PREFIX_LEGACY = ATTACHMENT_TOKEN_PREFIX_LEGACY
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
        "folder_summary": RuntimeCachePolicy(max_entries=200, ttl_sec=90),
        "folder_tree": RuntimeCachePolicy(max_entries=100, ttl_sec=90),
        "unread_count": RuntimeCachePolicy(max_entries=200, ttl_sec=60),
        "messages": RuntimeCachePolicy(max_entries=300, ttl_sec=90),
        "message_detail": RuntimeCachePolicy(max_entries=300, ttl_sec=180),
        "conversation_detail": RuntimeCachePolicy(max_entries=100, ttl_sec=120),
        "attachment_content": RuntimeCachePolicy(
            max_entries=32,
            ttl_sec=60,
            max_total_bytes=64 * 1024 * 1024,
            max_entry_bytes=2 * 1024 * 1024,
        ),
        "notification_feed": RuntimeCachePolicy(max_entries=100, ttl_sec=30),
    }
    _FIELD_TYPES = TEMPLATE_FIELD_TYPES
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
        self._database_url = (
            get_app_database_url(explicit_database_url)
            if (explicit_database_url or is_app_database_configured())
            else None
        )
        if config.app.is_production and not self._database_url:
            raise MailSchemaConfigurationError(
                "Production mail runtime requires PostgreSQL APP_DATABASE_URL; "
                "SQLite mail storage is development/test only."
            )
        if (
            config.app.is_production
            and not explicit_database_url
            and str(self._database_url or "").strip().lower().startswith("sqlite")
        ):
            raise MailSchemaConfigurationError(
                "Production mail runtime does not allow SQLite APP_DATABASE_URL; "
                "configure a PostgreSQL APP_DATABASE_URL and run backend Alembic migrations."
            )
        self._use_app_db = bool(self._database_url)
        self.db_path = None if self._use_app_db else Path(get_local_store().db_path)
        self._app_schema = schema_name("app", self._database_url)
        self._lock = RLock()
        self._runtime_cache = MailRuntimeCache()
        self._singleflight = SingleflightGroup()
        self._metadata_store = MailMetadataStore(
            lock=self._lock,
            connect=self._connect,
            log_table=self._LOG_TABLE,
            log_retention_days_getter=lambda: self.mail_log_retention_days,
            restore_hints_table=self._RESTORE_HINTS_TABLE,
            draft_context_table=self._DRAFT_CONTEXT_TABLE,
            folder_favorites_table=self._FOLDER_FAVORITES_TABLE,
            visible_custom_folders_table=self._VISIBLE_CUSTOM_FOLDERS_TABLE,
            user_preferences_table=self._USER_PREFS_TABLE,
            standard_folders=set(self._STANDARD_FOLDERS.keys()),
            default_preferences=dict(self._DEFAULT_PREFERENCES),
        )
        self._mailbox_store = MailMailboxStore(
            lock=self._lock,
            connect=lambda: self._connect(),
            table=self._USER_MAILBOXES_TABLE,
            now_iso=_utc_now_iso,
        )
        self._account_profile_resolver = MailAccountProfileResolver(
            resolve_primary_mailbox_row=lambda **kwargs: self._resolve_primary_mailbox_row(**kwargs),
            normalize_mailbox_auth_mode=lambda value, default="stored_credentials": self._normalize_mailbox_auth_mode(value, default),
            normalize_exchange_login=normalize_exchange_login,
            decrypt_secret=decrypt_secret,
            get_request_session_id=lambda: get_request_session_id(),
            get_session_context=lambda session_id, user_id: session_auth_context_service.get_session_context(
                session_id,
                user_id=int(user_id),
            ),
            resolve_session_password=lambda session_id, user_id: session_auth_context_service.resolve_session_password(
                session_id,
                user_id=int(user_id),
            ),
            normalize_signature_html=_normalize_signature_html,
        )
        self._message_content = MailMessageContent()
        self._message_serializer = MailMessageSerializer(
            inline_attachment_embed_max_size=self._INLINE_ATTACHMENT_EMBED_MAX_SIZE,
            is_downloadable_attachment=self._message_content.is_downloadable_attachment,
        )
        self._folder_tree_builder = MailFolderTreeBuilder(
            standard_folders_meta=dict(self._STANDARD_FOLDERS),
            safe_folder_attr=self._safe_folder_attr,
            encode_folder_id=self._encode_folder_id,
            folder_scope_for_alias=self._folder_scope_for_alias,
            custom_folder_root=self._custom_folder_root,
            is_mail_folder_visible_in_tree=self._is_mail_folder_visible_in_tree,
        )
        self._folder_mutations = MailFolderMutations(
            standard_folder_keys=set(self._STANDARD_FOLDERS.keys()),
            safe_folder_attr=self._safe_folder_attr,
            standard_folders=self._standard_folders,
            resolve_folder=self._resolve_folder,
            folder_scope_for_alias=self._folder_scope_for_alias,
            decode_folder_id=self._decode_folder_id,
            encode_folder_id=self._encode_folder_id,
            custom_folder_root=self._custom_folder_root,
            find_existing_child_folder=self._find_existing_child_folder,
            serialize_folder_node=self._serialize_folder_node,
        )
        self._message_actions = MailMessageActions(
            resolve_folder=self._resolve_folder,
            encode_message_id=self._encode_message_id,
        )
        self._draft_lifecycle = MailDraftLifecycle()
        self._conversation_finder = MailConversationFinder(
            search_target_folders=lambda account, folder="inbox", folder_scope="current": self._search_target_folders(
                account,
                folder=folder,
                folder_scope=folder_scope,
            ),
            folder_queryset=lambda folder_obj, folder_key: self._folder_queryset(folder_obj, folder_key),
            item_conversation_key=lambda item: self._item_conversation_key(item),
            decode_message_id=lambda message_id: self._decode_message_id(message_id),
            resolve_folder=lambda account, folder_key: self._resolve_folder(account, folder_key),
            search_batch_size=self._SEARCH_BATCH_SIZE,
            search_window_limit=lambda: int(self.search_window_limit),
        )
        self._conversation_payloads = MailConversationPayloadBuilder(
            search_target_folders=lambda account, folder="inbox", folder_scope="current": self._search_target_folders(
                account,
                folder=folder,
                folder_scope=folder_scope,
            ),
            folder_queryset=lambda folder_obj, folder_key: self._folder_queryset(folder_obj, folder_key),
            message_matches_filters=lambda item, **filters: self._message_matches_filters(item, **filters),
            item_conversation_key=lambda item: self._item_conversation_key(item),
            item_sender=lambda item: self._item_sender(item),
            item_recipients=lambda item: self._item_recipients(item),
            item_sender_person=lambda item: self._item_sender_person(item),
            item_recipient_people=lambda item: self._item_recipient_people(item),
            person_lookup_key=lambda person: self._person_lookup_key(person),
            search_batch_size=self._SEARCH_BATCH_SIZE,
            search_window_limit=lambda: int(self.search_window_limit),
        )
        self._message_listing = MailMessageListBuilder(
            search_target_folders=lambda account, folder="inbox", folder_scope="current": self._search_target_folders(
                account,
                folder=folder,
                folder_scope=folder_scope,
            ),
            folder_queryset=lambda folder_obj, folder_key, preview_only=False: self._folder_queryset(
                folder_obj,
                folder_key,
                preview_only=preview_only,
            ),
            folder_total_hint=lambda folder_obj, unread_only=False: self._folder_total_hint(
                folder_obj,
                unread_only=bool(unread_only),
            ),
            serialize_message_preview=lambda *, item, folder_key, mailbox_id=None: self._serialize_message_preview_for_mailbox(
                item=item,
                folder_key=folder_key,
                mailbox_id=mailbox_id,
            ),
            message_matches_filters=lambda item, **filters: self._message_matches_filters(item, **filters),
            parse_date_filter=_parse_date_filter,
            search_batch_size=self._SEARCH_BATCH_SIZE,
            search_window_limit=lambda: int(self.search_window_limit),
        )
        self._template_store = MailTemplateStore(
            lock=self._lock,
            connect=self._connect,
            table=self._TEMPLATES_TABLE,
            id_generator=lambda: base64.urlsafe_b64encode(os.urandom(9)).decode("utf-8"),
            now_iso=_utc_now_iso,
        )
        if self._use_app_db and self._database_url:
            if str(self._database_url).lower().startswith("sqlite"):
                logger.warning(
                    "Mail runtime is using SQLite-backed APP_DATABASE_URL; use a PostgreSQL-compatible app DB for stable multi-user mail load."
                )
            initialize_app_schema(self._database_url)
        self._ensure_schema()
        self._migrate_legacy_template_fields()
        self._cleanup_message_log()

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

    def _cache_policy(self, bucket: str) -> RuntimeCachePolicy:
        normalized_bucket = _normalize_text(bucket)
        return self._CACHE_BUCKET_POLICIES.get(
            normalized_bucket,
            RuntimeCachePolicy(max_entries=100, ttl_sec=self.mail_cache_ttl_sec),
        )

    def _cache_key(self, *, user_id: int, bucket: str, extra: str = "", mailbox_scope: str = "") -> str:
        return cache_key(user_id=int(user_id), bucket=bucket, extra=extra, mailbox_scope=mailbox_scope)

    def _singleflight_key(self, *, user_id: int, bucket: str, extra: str = "", mailbox_scope: str = "") -> str:
        return singleflight_key(user_id=int(user_id), bucket=bucket, extra=extra, mailbox_scope=mailbox_scope)

    @classmethod
    def _estimate_cache_value_size(cls, value: Any) -> int:
        return estimate_cache_value_size(value)

    def _cache_get(self, *, user_id: int, bucket: str, extra: str = "", mailbox_scope: str = "") -> Any:
        key = self._cache_key(user_id=int(user_id), bucket=bucket, extra=extra, mailbox_scope=mailbox_scope)
        normalized_bucket = _normalize_text(bucket)
        self._set_request_metric("cache_bucket", normalized_bucket)
        return self._runtime_cache.get(key)

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
        key = self._cache_key(user_id=int(user_id), bucket=normalized_bucket, extra=extra, mailbox_scope=mailbox_scope)
        value, evicted = self._runtime_cache.set(
            key,
            bucket=normalized_bucket,
            value=value,
            policy=policy,
            ttl_sec=ttl_sec,
        )
        self._set_request_metric("cache_bucket", normalized_bucket)
        if evicted > 0:
            current_evicted = int(self.get_request_metrics().get("cache_evicted") or 0)
            self._set_request_metric("cache_evicted", current_evicted + int(evicted))
        return value

    def invalidate_user_cache(self, *, user_id: int, prefixes: list[str] | tuple[str, ...] | None = None) -> None:
        self._runtime_cache.invalidate_user(user_id=int(user_id), prefixes=prefixes)

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
        self._runtime_cache.update_dict_value(cache_key, {"is_read": bool(is_read)})

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
        return self._singleflight.run(
            key=key,
            producer=producer,
            on_hit=lambda hit: self._set_request_metric("singleflight_hit", hit),
        )

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

    def _resolve_tls_ca_bundle(self) -> str:
        try:
            return resolve_tls_ca_bundle(self.tls_ca_bundle)
        except ExchangeTransportError as exc:
            raise MailServiceError(str(exc)) from exc

    @staticmethod
    def _build_ca_bundle_http_adapter(ca_bundle: str):
        return build_ca_bundle_http_adapter(ca_bundle)

    @staticmethod
    def _get_no_verify_http_adapter():
        return get_no_verify_http_adapter()

    @staticmethod
    def _suppress_insecure_request_warning() -> None:
        suppress_insecure_request_warning(warnings_api=warnings)

    def _resolve_exchange_http_adapter(self) -> tuple[tuple[Any, ...], Any | None]:
        try:
            return resolve_exchange_http_adapter(verify_tls=self.verify_tls, ca_bundle=self.tls_ca_bundle)
        except ExchangeTransportError as exc:
            raise MailServiceError(str(exc)) from exc

    def _configure_exchange_http_adapter_for_runtime(self) -> None:
        """Apply Exchange HTTP adapter globally for lazy exchangelib requests."""
        try:
            from exchangelib.protocol import BaseProtocol
        except Exception:
            return
        signature, adapter_cls = self._resolve_exchange_http_adapter()
        if signature == ("no_verify",):
            self._suppress_insecure_request_warning()
        global _EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS, _EXCHANGE_HTTP_ADAPTER_SIGNATURE
        with _EXCHANGE_HTTP_ADAPTER_LOCK:
            if _EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS is None:
                _EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS = BaseProtocol.HTTP_ADAPTER_CLS
            target_adapter = adapter_cls or _EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS
            if _EXCHANGE_HTTP_ADAPTER_SIGNATURE != signature or BaseProtocol.HTTP_ADAPTER_CLS is not target_adapter:
                BaseProtocol.HTTP_ADAPTER_CLS = target_adapter
                _EXCHANGE_HTTP_ADAPTER_SIGNATURE = signature

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

    def _is_production_postgres_app_db(self, engine=None) -> bool:
        if not (self._use_app_db and self._database_url and config.app.is_production):
            return False
        resolved_engine = engine or get_app_engine(self._database_url)
        return str(resolved_engine.dialect.name).lower() == "postgresql"

    def _verify_production_schema(self, engine) -> None:
        try:
            inspector = inspect(engine)
            schema = self._app_schema
            missing_tables = sorted(
                table_name
                for table_name in self._mail_table_names()
                if not inspector.has_table(table_name, schema=schema)
            )
            missing_columns: list[str] = []
            missing_indexes: list[str] = []
            for table_name, required_columns in _MAIL_REQUIRED_COLUMNS.items():
                if table_name in missing_tables:
                    continue
                existing_columns = {
                    _normalize_text(column.get("name")).lower()
                    for column in inspector.get_columns(table_name, schema=schema)
                }
                for column_name in sorted(required_columns):
                    if column_name.lower() not in existing_columns:
                        missing_columns.append(f"{table_name}.{column_name}")
            for table_name, required_indexes in _MAIL_REQUIRED_INDEXES.items():
                if table_name in missing_tables:
                    continue
                existing_indexes = {
                    _normalize_text(index.get("name")).lower()
                    for index in inspector.get_indexes(table_name, schema=schema)
                }
                for index_name in sorted(required_indexes):
                    if index_name.lower() not in existing_indexes:
                        missing_indexes.append(f"{table_name}.{index_name}")
        except MailSchemaConfigurationError:
            raise
        except Exception as exc:
            raise MailSchemaConfigurationError(
                "Production mail schema could not be inspected; "
                "verify APP_DATABASE_URL and backend Alembic migrations."
            ) from exc

        if missing_tables or missing_columns or missing_indexes:
            details: list[str] = []
            if missing_tables:
                details.append("missing tables: " + ", ".join(missing_tables))
            if missing_columns:
                details.append("missing columns: " + ", ".join(missing_columns))
            if missing_indexes:
                details.append("missing indexes: " + ", ".join(missing_indexes))
            raise MailSchemaConfigurationError(
                "Production mail schema is incomplete; "
                "run backend Alembic migrations before startup. "
                + "; ".join(details)
            )

    def _ensure_schema(self) -> None:
        if self._use_app_db and self._database_url:
            engine = get_app_engine(self._database_url)
            if self._is_production_postgres_app_db(engine):
                self._verify_production_schema(engine)
                return

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
        return _to_bool(os.getenv("MAIL_VERIFY_TLS"), default=True)

    @property
    def tls_ca_bundle(self) -> str:
        return _normalize_text(
            os.getenv("MAIL_TLS_CA_BUNDLE")
            or os.getenv("MAIL_CA_BUNDLE")
            or ""
        )

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
    def _normalize_mailbox_auth_mode(value: Any, default: str = "stored_credentials") -> str:
        return normalize_mailbox_auth_mode(value, default)

    @staticmethod
    def _legacy_user_mail_auth_mode(user: dict[str, Any] | None) -> str:
        return legacy_user_mailbox_auth_mode(user)

    def _build_legacy_mailbox_seed(self, user: dict[str, Any] | None) -> dict[str, Any] | None:
        return build_legacy_mailbox_seed(
            user,
            mailbox_email=self._build_effective_mailbox_email(user),
            auth_mode=self._legacy_user_mail_auth_mode(user),
            now_iso=_utc_now_iso(),
            default_label="Основной ящик",
        )

    def _ensure_user_mailboxes_seeded(self, *, user_id: int) -> None:
        normalized_user_id = int(user_id)
        if self._mailbox_store.has_any(user_id=normalized_user_id):
            return
        user = user_service.get_by_id(normalized_user_id)
        seed = self._build_legacy_mailbox_seed(user)
        if not seed:
            return
        self._mailbox_store.insert_legacy_seed(user_id=normalized_user_id, seed=seed)

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
        return self._mailbox_store.list_rows(user_id=normalized_user_id, include_inactive=include_inactive)

    def _touch_mailbox_selected(self, *, user_id: int, mailbox_id: str) -> None:
        normalized_mailbox_id = _normalize_text(mailbox_id)
        if not normalized_mailbox_id:
            return
        self._mailbox_store.touch_selected(user_id=int(user_id), mailbox_id=normalized_mailbox_id)

    def _resolve_mailbox_row(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        allow_inactive: bool = False,
    ) -> dict[str, Any]:
        rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
        try:
            return select_mailbox_row(
                rows,
                mailbox_id=mailbox_id,
                allow_inactive=allow_inactive,
            )
        except MailboxSelectionError as exc:
            raise MailServiceError(str(exc), status_code=exc.status_code) from exc

    def _resolve_primary_mailbox_row(self, *, user_id: int, allow_inactive: bool = True) -> dict[str, Any] | None:
        rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
        return primary_mailbox_row(rows, allow_inactive=allow_inactive)

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

    def ensure_primary_ad_mailbox_credentials(
        self,
        *,
        user: dict[str, Any] | None = None,
        user_id: int | None = None,
        exchange_login: str = "",
        mailbox_password: str = "",
    ) -> dict[str, Any] | None:
        resolved_user = user or (user_service.get_by_id(int(user_id or 0)) if user_id else None)
        if not resolved_user:
            raise MailServiceError("User not found")
        normalized_user_id = int(resolved_user.get("id") or 0)
        if normalized_user_id <= 0:
            raise MailServiceError("User not found")
        if _normalize_text(resolved_user.get("auth_source")).lower() != "ldap":
            return None
        password = _normalize_text(mailbox_password)
        if not password:
            return None
        login_source = _normalize_text(exchange_login or resolved_user.get("username")).lower()
        normalized_login = normalize_exchange_login(login_source) if login_source else ""
        normalized_email = self._build_effective_mailbox_email(resolved_user)
        if not normalized_email:
            logger.warning("Cannot sync AD primary mailbox without email: user_id=%s", normalized_user_id)
            return None
        if not normalized_login:
            normalized_login = normalized_email

        encrypted_password = encrypt_secret(password)
        self._ensure_user_mailboxes_seeded(user_id=normalized_user_id)
        rows = self._list_user_mailboxes_rows(user_id=normalized_user_id, include_inactive=True)
        primary_row = next((row for row in rows if _to_bool(row.get("is_primary"), default=False)), None)
        email_row = next(
            (
                row
                for row in rows
                if _normalize_text(row.get("mailbox_email")).lower() == _normalize_text(normalized_email).lower()
            ),
            None,
        )
        target_row = primary_row or email_row
        target_id = _normalize_text((target_row or {}).get("id")) or self._generate_mailbox_id()
        next_sort_order = int((target_row or {}).get("sort_order") or 0)
        if target_row is None:
            next_sort_order = next_mailbox_sort_order(rows)
        self._mailbox_store.upsert_primary_stored_credentials(
            user_id=normalized_user_id,
            mailbox_id=target_id,
            label=_normalize_text(resolved_user.get("full_name") or resolved_user.get("email") or normalized_email),
            mailbox_email=normalized_email,
            mailbox_login=normalized_login,
            mailbox_password_enc=encrypted_password,
            sort_order=next_sort_order,
            update_existing=target_row is not None,
        )

        user_service.update_user(
            normalized_user_id,
            mailbox_email=normalized_email,
            mailbox_login=normalized_login,
            mailbox_password=password,
        )
        self.invalidate_user_cache(user_id=normalized_user_id)
        updated_user = user_service.get_by_id(normalized_user_id) or resolved_user
        row = self._resolve_mailbox_row(user_id=normalized_user_id, mailbox_id=target_id, allow_inactive=True)
        return self._serialize_mailbox_entry(user=updated_user, mailbox_row=row, unread_count=0, selected=True)

    def _resolve_primary_mailbox_credentials(
        self,
        *,
        user: dict[str, Any],
        current_mailbox_id: str = "",
        require_password: bool,
    ) -> dict[str, Any]:
        try:
            return self._account_profile_resolver.resolve_primary_credentials(
                user=user,
                current_mailbox_id=current_mailbox_id,
                require_password=bool(require_password),
            )
        except MailAccountProfileError as exc:
            raise MailServiceError(str(exc), code=exc.code, status_code=exc.status_code) from exc

    def _build_mailbox_profile(
        self,
        *,
        user: dict[str, Any],
        mailbox_row: dict[str, Any],
        require_password: bool,
    ) -> dict[str, Any]:
        try:
            return self._account_profile_resolver.build_profile(
                user=user,
                mailbox_row=mailbox_row,
                require_password=require_password,
            )
        except MailAccountProfileError as exc:
            raise MailServiceError(str(exc), code=exc.code, status_code=exc.status_code) from exc

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
        return serialize_mailbox_entry(
            user=user,
            mailbox_row=mailbox_row,
            profile=profile,
            signature_html=_normalize_signature_html(user.get("mail_signature_html")),
            unread_count=unread_count,
            unread_count_state=unread_count_state,
            selected=selected,
        )

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
        mailbox_login: str = "",
        mailbox_password: str = "",
        auth_mode: str = "stored_credentials",
        is_primary: bool = False,
        is_active: bool = True,
    ) -> dict[str, Any]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise MailServiceError("User not found")
        normalized_auth_mode = self._normalize_mailbox_auth_mode(auth_mode)
        if normalized_auth_mode == "primary_credentials" and bool(is_primary):
            raise MailServiceError("Shared mailbox cannot be primary", status_code=409)
        normalized_email = _normalize_text(mailbox_email).lower()
        normalized_login = _normalize_text(mailbox_login).lower()
        password_for_verify = _normalize_text(mailbox_password)
        encrypted_password = ""
        if normalized_auth_mode == "primary_credentials":
            primary_credentials = self._resolve_primary_mailbox_credentials(
                user=user,
                current_mailbox_id="",
                require_password=True,
            )
            normalized_login = _normalize_text(primary_credentials.get("login")).lower()
            password_for_verify = _normalize_text(primary_credentials.get("password"))
        elif normalized_auth_mode == "primary_session":
            session_id = get_request_session_id()
            session_context = session_auth_context_service.get_session_context(
                session_id,
                user_id=int(user_id),
            )
            session_login = _normalize_text((session_context or {}).get("exchange_login")).lower()
            if session_login:
                normalized_login = session_login
            elif not normalized_login:
                username = _normalize_text((user or {}).get("username")).lower()
                normalized_login = normalize_exchange_login(username) if username else ""
            password_for_verify = session_auth_context_service.resolve_session_password(session_id, user_id=int(user_id))
            if not password_for_verify:
                raise MailServiceError(
                    "Mail access requires re-login",
                    code="MAIL_RELOGIN_REQUIRED",
                    status_code=409,
                )
        elif not normalized_login:
            normalized_login = normalized_email
        verified = self.verify_mailbox_credentials(
            mailbox_email=normalized_email,
            mailbox_login=normalized_login,
            mailbox_password=password_for_verify,
        )
        existing_rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
        normalized_email = _normalize_text(verified["mailbox_email"]).lower()
        normalized_login = _normalize_text(verified["effective_mailbox_login"]).lower()
        if has_duplicate_mailbox_email(existing_rows, mailbox_email=normalized_email):
            raise MailServiceError("Mailbox is already connected", status_code=409)
        row_id = self._generate_mailbox_id()
        next_is_primary = bool(is_primary) or len(existing_rows) == 0
        if normalized_auth_mode == "primary_credentials" and next_is_primary:
            raise MailServiceError("Shared mailbox cannot be primary", status_code=409)
        next_sort_order = next_mailbox_sort_order(existing_rows)
        if normalized_auth_mode == "stored_credentials":
            encrypted_password = encrypt_secret(password_for_verify)
        self._mailbox_store.insert_row(
            user_id=int(user_id),
            mailbox_id=row_id,
            label=_normalize_text(label) or normalized_email,
            mailbox_email=normalized_email,
            mailbox_login=normalized_login if normalized_auth_mode == "stored_credentials" else "",
            mailbox_password_enc=encrypted_password,
            auth_mode=normalized_auth_mode,
            is_primary=bool(next_is_primary),
            is_active=bool(is_active),
            sort_order=next_sort_order,
            selected=bool(next_is_primary),
            clear_existing_primary=bool(next_is_primary),
        )
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
        next_auth_mode = self._normalize_mailbox_auth_mode(current.get("auth_mode"))
        if auth_mode is not _UNSET:
            next_auth_mode = self._normalize_mailbox_auth_mode(auth_mode, next_auth_mode)
        next_email = _normalize_text(current.get("mailbox_email")).lower()
        next_login = _normalize_text(current.get("mailbox_login")).lower()
        next_password_enc = _normalize_text(current.get("mailbox_password_enc"))
        next_label = _normalize_text(current.get("label")) or next_email
        next_is_active = _to_bool(current.get("is_active"), default=True)
        if label is not _UNSET:
            next_label = _normalize_text(label) or next_label
        if mailbox_email is not _UNSET:
            next_email = _normalize_text(mailbox_email).lower()
        if mailbox_login is not _UNSET and next_auth_mode == "stored_credentials":
            next_login = _normalize_text(mailbox_login).lower()
        next_password_raw = None
        if mailbox_password is not _UNSET and next_auth_mode == "stored_credentials":
            candidate = _normalize_text(mailbox_password)
            if candidate:
                next_password_raw = candidate
        if is_active is not _UNSET:
            next_is_active = bool(is_active)
        next_is_primary = _to_bool(current.get("is_primary"), default=False)
        if is_primary is not _UNSET and bool(is_primary):
            next_is_primary = True
        if next_auth_mode == "primary_credentials" and next_is_primary:
            raise MailServiceError("Shared mailbox cannot be primary", status_code=409)

        if next_auth_mode == "primary_credentials":
            next_login = ""
            next_password_enc = ""
            if next_is_active and (mailbox_email is not _UNSET or auth_mode is not _UNSET):
                primary_credentials = self._resolve_primary_mailbox_credentials(
                    user=user,
                    current_mailbox_id=_normalize_text(mailbox_id),
                    require_password=True,
                )
                self.verify_mailbox_credentials(
                    mailbox_email=next_email,
                    mailbox_login=_normalize_text(primary_credentials.get("login")).lower(),
                    mailbox_password=_normalize_text(primary_credentials.get("password")),
                )
        elif next_auth_mode == "primary_session":
            next_login = ""
            next_password_enc = ""
        elif next_auth_mode == "stored_credentials":
            verify_password = next_password_raw
            if verify_password is None and (
                mailbox_email is not _UNSET
                or mailbox_login is not _UNSET
                or auth_mode is not _UNSET
            ):
                try:
                    verify_password = decrypt_secret(next_password_enc)
                except Exception:
                    verify_password = ""
            if (
                mailbox_email is not _UNSET
                or mailbox_login is not _UNSET
                or auth_mode is not _UNSET
                or next_password_raw is not None
            ):
                self.verify_mailbox_credentials(
                    mailbox_email=next_email,
                    mailbox_login=next_login or next_email,
                    mailbox_password=verify_password or "",
                )
            if next_password_raw is not None:
                next_password_enc = encrypt_secret(next_password_raw)

        existing_rows = self._list_user_mailboxes_rows(user_id=int(user_id), include_inactive=True)
        if has_duplicate_mailbox_email(
            existing_rows,
            mailbox_email=next_email,
            exclude_mailbox_id=_normalize_text(mailbox_id),
        ):
            raise MailServiceError("Mailbox is already connected", status_code=409)

        if not next_is_active and next_is_primary:
            raise MailServiceError("Primary mailbox cannot be inactive", status_code=409)

        self._mailbox_store.update_row(
            user_id=int(user_id),
            mailbox_id=_normalize_text(mailbox_id),
            label=next_label or next_email,
            mailbox_email=next_email,
            mailbox_login=next_login or "",
            mailbox_password_enc=next_password_enc,
            auth_mode=next_auth_mode,
            is_primary=bool(next_is_primary),
            is_active=bool(next_is_active),
            selected=bool(selected is not _UNSET and bool(selected)),
            clear_existing_primary=bool(next_is_primary),
        )
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
        self._mailbox_store.delete_row(user_id=int(user_id), mailbox_id=_normalize_text(mailbox_id))
        self.invalidate_user_cache(user_id=int(user_id))
        return {"ok": True, "mailbox_id": _normalize_text(mailbox_id)}

    def _maybe_cleanup_message_log(self) -> None:
        self._metadata_store.maybe_cleanup_message_log()

    def _cleanup_message_log(self) -> None:
        self._metadata_store.cleanup_message_log()

    @staticmethod
    def _encode_message_id(folder: str, exchange_id: str, mailbox_id: str | None = None) -> str:
        return encode_message_id(folder, exchange_id, mailbox_id)

    @staticmethod
    def _decode_message_ref(token: str) -> tuple[str, str, str]:
        try:
            return decode_message_ref(token)
        except MailReferenceError as exc:
            raise MailServiceError(str(exc)) from exc

    @staticmethod
    def _decode_message_id(token: str) -> tuple[str, str]:
        try:
            return decode_message_id(token)
        except MailReferenceError as exc:
            raise MailServiceError(str(exc)) from exc

    @staticmethod
    def _encode_folder_id(scope: str, exchange_id: str) -> str:
        return encode_folder_id(scope, exchange_id)

    @staticmethod
    def _decode_folder_id(token: str) -> tuple[str, str]:
        try:
            return decode_folder_id(token)
        except MailReferenceError as exc:
            raise MailServiceError(str(exc)) from exc

    @staticmethod
    def _encode_attachment_token(attachment_id: str, mailbox_id: str | None = None) -> str:
        return encode_attachment_token(attachment_id, mailbox_id)

    @staticmethod
    def _decode_attachment_ref(token: str) -> tuple[str, str]:
        try:
            return decode_attachment_ref(token)
        except MailReferenceError as exc:
            raise MailServiceError(str(exc)) from exc

    @staticmethod
    def _decode_attachment_token(token: str) -> str:
        try:
            return decode_attachment_token(token)
        except MailReferenceError as exc:
            raise MailServiceError(str(exc)) from exc

    @staticmethod
    def _resolve_mailbox_scope(*scopes: str | None) -> str:
        return resolve_mailbox_scope(*scopes)

    @staticmethod
    def _make_scoped_storage_key(*, mailbox_id: str | None = None, value: str) -> str:
        return make_scoped_storage_key(mailbox_id=mailbox_id, value=value)

    @staticmethod
    def _split_scoped_storage_key(value: str) -> tuple[str, str]:
        return split_scoped_storage_key(value)

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
        return resolve_outbound_mailbox_id(
            mailbox_id=mailbox_id,
            draft_id=draft_id,
            reply_to_message_id=reply_to_message_id,
            forward_message_id=forward_message_id,
            mailbox_id_from_message=lambda value: self._resolve_mailbox_id_from_message(message_id=value),
            mailbox_scope_resolver=self._resolve_mailbox_scope,
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
        return normalize_attachment_id_candidate(value)

    @staticmethod
    def _extract_attachment_id_from_repr(value: Any) -> str:
        return extract_attachment_id_from_repr(value)

    @classmethod
    def _extract_attachment_raw_id(cls, attachment: Any) -> str:
        return extract_attachment_raw_id(attachment)

    @staticmethod
    def _normalize_attachment_content_id(value: Any) -> str:
        return normalize_attachment_content_id(value)

    @staticmethod
    def _build_inline_attachment_src(*, message_id: str, attachment_ref: str) -> str | None:
        return build_inline_attachment_src(message_id=message_id, attachment_ref=attachment_ref)

    @staticmethod
    def _mail_auth_mode_for_user(user: dict | None) -> str:
        return mail_auth_mode_for_user(user)

    def _build_effective_mailbox_email(self, user: dict | None) -> str:
        return build_effective_mailbox_email(
            user,
            ldap_email_builder=build_default_ldap_mailbox_email,
        )

    def _build_effective_mailbox_login(self, user: dict | None) -> str:
        session_context = None
        if mail_auth_mode_for_user(user) == "ad_auto":
            session_id = get_request_session_id()
            session_context = session_auth_context_service.get_session_context(
                session_id,
                user_id=int((user or {}).get("id") or 0),
            )
        return build_effective_mailbox_login(
            user,
            session_context=session_context,
            exchange_login_normalizer=normalize_exchange_login,
        )

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
            self._mailbox_store.clear_saved_password(user_id=int(user_id), mailbox_id=normalized_mailbox_id)
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
        signature, adapter_cls = self._resolve_exchange_http_adapter()
        if signature == ("no_verify",):
            self._suppress_insecure_request_warning()
        if adapter_cls is None:
            yield
            return
        try:
            from exchangelib.protocol import BaseProtocol
        except Exception:
            # If exchangelib is unavailable, downstream connection call will fail with explicit error.
            yield
            return
        old_adapter = BaseProtocol.HTTP_ADAPTER_CLS
        BaseProtocol.HTTP_ADAPTER_CLS = adapter_cls
        try:
            yield
        finally:
            BaseProtocol.HTTP_ADAPTER_CLS = old_adapter

    def _create_account(self, *, email: str, login: str, password: str):
        self._configure_exchange_http_adapter_for_runtime()
        try:
            return create_exchange_account(
                email=email,
                login=login,
                password=password,
                ews_url=self.exchange_ews_url,
                exchange_host=self.exchange_host,
                protocol_context=self._exchange_protocol_context(),
            )
        except ExchangeTransportError as exc:
            raise MailServiceError(str(exc)) from exc

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
        return self._metadata_store.list_favorite_folder_ids(user_id=int(user_id), mailbox_id=mailbox_id)

    def _list_visible_custom_folder_ids(self, *, user_id: int, mailbox_id: str | None = None) -> set[str]:
        return self._metadata_store.list_visible_custom_folder_ids(user_id=int(user_id), mailbox_id=mailbox_id)

    def _set_custom_folder_visible(self, *, user_id: int, mailbox_id: str | None = None, folder_id: str, visible: bool) -> None:
        self._metadata_store.set_custom_folder_visible(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            folder_id=folder_id,
            visible=bool(visible),
        )

    def _purge_custom_folder_visibility(self, *, user_id: int, folder_ids: set[str]) -> None:
        self._metadata_store.purge_custom_folder_visibility(user_id=int(user_id), folder_ids=folder_ids)

    def set_folder_favorite(self, *, user_id: int, mailbox_id: str | None = None, folder_id: str, favorite: bool) -> dict[str, Any]:
        try:
            result = self._metadata_store.set_folder_favorite(
                user_id=int(user_id),
                mailbox_id=mailbox_id,
                folder_id=folder_id,
                favorite=bool(favorite),
            )
        except ValueError as exc:
            raise MailServiceError(str(exc)) from exc
        self.invalidate_user_cache(user_id=int(user_id), prefixes=("folder_tree", "bootstrap"))
        return result

    def _get_preferences_row(self, *, user_id: int) -> dict[str, Any]:
        return self._metadata_store.get_preferences_row(user_id=int(user_id))

    def get_preferences(self, *, user_id: int) -> dict[str, Any]:
        row = self._get_preferences_row(user_id=int(user_id))
        return {
            "user_id": int(user_id),
            "preferences": row["prefs"],
            "updated_at": row["updated_at"],
        }

    def update_preferences(self, *, user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        result = self._metadata_store.update_preferences(user_id=int(user_id), payload=payload)
        self.invalidate_user_cache(user_id=int(user_id), prefixes=("bootstrap",))
        return result

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
        return serialize_person(value)

    @staticmethod
    def _person_lookup_key(person: dict[str, Any] | None) -> str:
        return person_lookup_key(person)

    @classmethod
    def _item_sender_person(cls, item) -> dict[str, str | None]:
        return item_sender_person(item)

    @classmethod
    def _item_sender(cls, item) -> str:
        return item_sender(item)

    @classmethod
    def _item_recipient_people(cls, item, attrs: tuple[str, ...] = ("to_recipients", "cc_recipients")) -> list[dict[str, str | None]]:
        return item_recipient_people(item, attrs=attrs)

    @classmethod
    def _item_recipients(cls, item) -> list[str]:
        return item_recipients(item)

    @classmethod
    def _item_bcc_recipient_people(cls, item) -> list[dict[str, str | None]]:
        return item_bcc_recipient_people(item)

    @classmethod
    def _item_bcc_recipients(cls, item) -> list[str]:
        return item_bcc_recipients(item)

    @staticmethod
    def _item_message_id(item) -> str:
        return item_message_id(item)

    @staticmethod
    def _normalize_subject_for_conversation(subject: Any) -> str:
        return normalize_subject_for_conversation(subject)

    def _item_conversation_key(self, item) -> str:
        return item_conversation_key(item)

    @staticmethod
    def _item_importance(item) -> str:
        return item_importance(item)

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
        return self._message_serializer.build_quote_html(item)

    def _should_embed_inline_attachment(self, attachment) -> bool:
        return self._message_serializer.should_embed_inline_attachment(attachment)

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
        return self._message_serializer.build_inline_attachment_data_url(attachment)

    def build_compose_context(self, item, mailbox_email: str, mailbox_id: str | None = None) -> dict[str, Any]:
        return self._message_serializer.build_compose_context(item, mailbox_email, mailbox_id)

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
        return self._message_serializer.serialize_message_detail(
            item=item,
            folder_key=folder_key,
            mailbox_id=mailbox_id,
            mailbox_email=mailbox_email,
            restore_hint_folder=restore_hint_folder,
            draft_context=draft_context,
            include_inline_data_urls=include_inline_data_urls,
        )

    def _set_restore_hint(
        self,
        *,
        user_id: int,
        mailbox_id: str | None = None,
        trash_exchange_id: str,
        restore_folder: str,
        source_exchange_id: str | None = None,
    ) -> None:
        self._metadata_store.set_restore_hint(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            trash_exchange_id=trash_exchange_id,
            restore_folder=restore_folder,
            source_exchange_id=source_exchange_id,
        )

    def _get_restore_hint(self, *, user_id: int, mailbox_id: str | None = None, trash_exchange_id: str) -> dict[str, Any] | None:
        return self._metadata_store.get_restore_hint(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            trash_exchange_id=trash_exchange_id,
        )

    def _delete_restore_hint(self, *, user_id: int, mailbox_id: str | None = None, trash_exchange_id: str) -> None:
        self._metadata_store.delete_restore_hint(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            trash_exchange_id=trash_exchange_id,
        )

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
        self._metadata_store.save_draft_context(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            draft_exchange_id=draft_exchange_id,
            compose_mode=compose_mode,
            reply_to_message_id=reply_to_message_id,
            forward_message_id=forward_message_id,
        )

    def _get_draft_context(self, *, user_id: int, mailbox_id: str | None = None, draft_exchange_id: str) -> dict[str, Any] | None:
        return self._metadata_store.get_draft_context(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            draft_exchange_id=draft_exchange_id,
        )

    def _delete_draft_context(self, *, mailbox_id: str | None = None, draft_exchange_id: str) -> None:
        self._metadata_store.delete_draft_context(
            mailbox_id=mailbox_id,
            draft_exchange_id=draft_exchange_id,
        )

    def _serialize_message_preview(self, item, folder_key: str) -> dict[str, Any]:
        return self._serialize_message_preview_for_mailbox(item=item, folder_key=folder_key, mailbox_id="")

    def _serialize_message_preview_for_mailbox(self, *, item, folder_key: str, mailbox_id: str | None = None) -> dict[str, Any]:
        return self._message_serializer.serialize_message_preview(
            item=item,
            folder_key=folder_key,
            mailbox_id=mailbox_id,
        )

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
        return message_matches_filters(
            item,
            item_sender=self._item_sender,
            item_recipients=self._item_recipients,
            item_importance=self._item_importance,
            query_text=query_text,
            has_attachments=has_attachments,
            date_from=date_from,
            date_to=date_to,
            from_filter=from_filter,
            to_filter=to_filter,
            subject_filter=subject_filter,
            body_filter=body_filter,
            importance_filter=importance_filter,
        )

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
        result = self._message_listing.list_messages(
            account=account,
            mailbox_id=mailbox_id,
            folder=folder,
            folder_scope=folder_scope,
            limit=limit,
            offset=offset,
            q=q,
            unread_only=unread_only,
            has_attachments=has_attachments,
            date_from=date_from,
            date_to=date_to,
            from_filter=from_filter,
            to_filter=to_filter,
            subject_filter=subject_filter,
            body_filter=body_filter,
            importance=importance,
        )
        self._set_request_metric("searched_window", result.searched_window)
        self._set_request_metric("search_limited", int(result.search_limited))
        return result.payload

    def _list_folder_summary_from_account(self, *, account) -> dict[str, dict[str, int]]:
        return self._folder_tree_builder.list_folder_summary(
            standard_folders=self._standard_folders(account),
        )

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
        result = self._folder_tree_builder.build_tree(
            account=account,
            standard_folders=self._standard_folders(account),
            walked_folders=self._walk_folder_targets(account),
            favorite_ids=favorites,
            persisted_custom_folder_ids=persisted_custom_folder_ids,
            summary=summary,
        )
        if result.stale_folder_ids:
            self._purge_custom_folder_visibility(user_id=int(user_id), folder_ids=result.stale_folder_ids)
        return result.payload

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
        return self._folder_tree_builder.folder_counts(folder_obj)

    def _folder_counts_from_hints(self, folder_obj, *, fallback: bool = True) -> tuple[int, int]:
        return self._folder_tree_builder.folder_counts_from_hints(folder_obj, fallback=fallback)

    def _folder_total_hint(self, folder_obj, *, unread_only: bool = False) -> int | None:
        return self._folder_tree_builder.folder_total_hint(folder_obj, unread_only=unread_only)

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
        return self._folder_tree_builder.serialize_folder_node(
            folder_obj,
            folder_key=folder_key,
            scope=scope,
            parent_id=parent_id,
            favorite_ids=favorite_ids,
            counts=counts,
        )

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
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=mailbox_id, require_password=True)
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
        try:
            result = self._folder_mutations.create_folder(
                account=account,
                name=name,
                parent_folder_id=parent_folder_id,
                scope=scope,
                favorite_ids=self._list_favorite_folder_ids(user_id=int(user_id), mailbox_id=resolved_mailbox_id),
            )
        except MailFolderMutationError as exc:
            raise MailServiceError(str(exc)) from exc
        self._set_custom_folder_visible(
            user_id=int(user_id),
            mailbox_id=resolved_mailbox_id,
            folder_id=result.folder_id,
            visible=True,
        )
        self.invalidate_user_cache(
            user_id=int(user_id),
            prefixes=("folder_tree", "folder_summary", "bootstrap", "messages", "message_detail", "conversation_detail"),
        )
        return result.payload

    def rename_folder(self, *, user_id: int, mailbox_id: str | None = None, folder_id: str, name: str) -> dict[str, Any]:
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=mailbox_id, require_password=True)
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        try:
            result = self._folder_mutations.rename_folder(
                account=account,
                folder_id=folder_id,
                name=name,
                favorite_ids=self._list_favorite_folder_ids(user_id=int(user_id), mailbox_id=resolved_mailbox_id),
            )
        except MailFolderMutationError as exc:
            raise MailServiceError(str(exc)) from exc
        self.invalidate_user_cache(
            user_id=int(user_id),
            prefixes=("folder_tree", "bootstrap", "message_detail", "conversation_detail"),
        )
        return result.payload

    def delete_folder(self, *, user_id: int, mailbox_id: str | None = None, folder_id: str) -> dict[str, Any]:
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=mailbox_id, require_password=True)
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )
        try:
            folder_key = self._folder_mutations.delete_folder(account=account, folder_id=folder_id)
        except MailFolderMutationError as exc:
            raise MailServiceError(str(exc)) from exc
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
        try:
            return self._conversation_finder.find(
                account=account,
                conversation_id=conversation_id,
                folder=folder,
                folder_scope=folder_scope,
            )
        except MailConversationFinderError as exc:
            raise MailServiceError(str(exc)) from exc

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
        try:
            self._message_actions.set_read_state(
                account=account,
                folder_key=folder_key,
                exchange_id=exchange_id,
                is_read=True,
            )
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
        except MailMessageActionError as exc:
            raise MailServiceError(str(exc)) from exc

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
        try:
            self._message_actions.set_read_state(
                account=account,
                folder_key=folder_key,
                exchange_id=exchange_id,
                is_read=False,
            )
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
        except MailMessageActionError as exc:
            raise MailServiceError(str(exc)) from exc

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
        read_result = self._message_actions.set_items_read_state(
            items=(item for item, _folder_key in items_raw),
            is_read=bool(is_read),
        )
        self.invalidate_user_cache(
            user_id=int(user_id),
            prefixes=("unread_count", "folder_summary", "messages", "notification_feed", "bootstrap", "message_detail", "conversation_detail"),
        )
        return {
            "ok": read_result.failed == 0,
            "changed": read_result.changed,
            "failed": read_result.failed,
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
        read_result = self._message_actions.mark_all_read(
            folder_targets=self._search_target_folders(
                account,
                folder=_normalize_text(folder, "inbox"),
                folder_scope=_normalize_text(folder_scope, "current"),
            ),
        )
        self.invalidate_user_cache(
            user_id=int(user_id),
            prefixes=("unread_count", "folder_summary", "messages", "notification_feed", "bootstrap", "message_detail", "conversation_detail"),
        )
        return {
            "ok": read_result.failed == 0,
            "changed": read_result.changed,
            "failed": read_result.failed,
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

    def _mail_message_content(self) -> MailMessageContent:
        content = getattr(self, "_message_content", None)
        if isinstance(content, MailMessageContent):
            return content
        return MailMessageContent()

    def _message_mime_content(self, item) -> bytes:
        return self._mail_message_content().message_mime_content(item)

    @staticmethod
    def _is_downloadable_attachment(attachment: Any) -> bool:
        return MailMessageContent.is_downloadable_attachment(attachment)

    @staticmethod
    def _attachment_download_filename(name: Any, *, default_name: str, preferred_extension: str = "") -> str:
        return MailMessageContent.attachment_download_filename(
            name,
            default_name=default_name,
            preferred_extension=preferred_extension,
        )

    def _build_attachment_download_payload(self, *, attachment: Any, account: Any) -> tuple[str, str, bytes] | None:
        try:
            return self._mail_message_content().build_attachment_download_payload(
                attachment=attachment,
                account=account,
            )
        except MailMessageContentError as exc:
            raise MailServiceError(str(exc)) from exc

    def get_message_source(self, *, user_id: int, mailbox_id: str | None = None, message_id: str) -> tuple[str, bytes]:
        context = self._get_message_context(user_id=int(user_id), mailbox_id=mailbox_id, message_id=message_id)
        try:
            return self._mail_message_content().message_source_payload(item=context["item"])
        except MailMessageContentError as exc:
            raise MailServiceError(str(exc)) from exc

    def get_message_headers(self, *, user_id: int, mailbox_id: str | None = None, message_id: str) -> dict[str, Any]:
        filename, source = self.get_message_source(user_id=int(user_id), mailbox_id=mailbox_id, message_id=message_id)
        return self._mail_message_content().message_headers_payload(
            message_id=message_id,
            source_name=filename,
            source=source,
        )

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
        try:
            result = self._message_actions.move_message(
                account=account,
                folder_key=folder_key,
                exchange_id=exchange_id,
                target_folder=normalized_target,
                mailbox_id=resolved_mailbox_id,
            )
            if result.folder == "trash":
                self._set_restore_hint(
                    user_id=int(user_id),
                    mailbox_id=resolved_mailbox_id,
                    trash_exchange_id=result.target_exchange_id,
                    restore_folder=result.source_folder,
                    source_exchange_id=exchange_id,
                )
            elif result.source_folder == "trash":
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
                "message_id": result.message_id,
                "folder": result.folder,
            }
        except MailMessageActionError as exc:
            raise MailServiceError(str(exc)) from exc

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
        try:
            self._message_actions.delete_message(
                account=account,
                folder_key=folder_key,
                exchange_id=exchange_id,
            )
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
        except MailMessageActionError as exc:
            raise MailServiceError(str(exc)) from exc

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
                        "internet_message_id": item.get("internet_message_id"),
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
        mail_context = self._resolve_account_context(
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            require_password=True,
        )
        result = self._conversation_payloads.list_conversations(
            account=mail_context["account"],
            folder=folder,
            folder_scope=folder_scope,
            limit=limit,
            offset=offset,
            unread_only=bool(unread_only),
            filters={
                "query_text": _normalize_text(q).lower(),
                "has_attachments": bool(has_attachments),
                "date_from": _parse_date_filter(date_from),
                "date_to": _parse_date_filter(date_to),
                "from_filter": _normalize_text(from_filter).lower(),
                "to_filter": _normalize_text(to_filter).lower(),
                "subject_filter": _normalize_text(subject_filter).lower(),
                "body_filter": _normalize_text(body_filter).lower(),
                "importance_filter": _normalize_text(importance).lower(),
            },
        )
        self._set_request_metric("searched_window", result.searched_window)
        self._set_request_metric("search_limited", int(result.search_limited))
        return result.payload

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
            payload = self._conversation_payloads.conversation_detail_payload(
                conversation_id=resolved_conversation_key,
                items=items,
            )
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
        try:
            draft_plan = build_draft_upsert_plan(
                mailbox_id=mailbox_id,
                draft_id=draft_id,
                compose_mode=compose_mode,
                to=to,
                cc=cc,
                bcc=bcc,
                subject=subject,
                body=body,
                is_html=is_html,
                reply_to_message_id=reply_to_message_id,
                forward_message_id=forward_message_id,
                retain_existing_attachments=retain_existing_attachments,
                attachment_id_resolver=self.resolve_attachment_id,
                mailbox_id_from_message=lambda value: self._resolve_mailbox_id_from_message(message_id=value),
                mailbox_scope_resolver=self._resolve_mailbox_scope,
            )
        except ComposeValidationError as exc:
            raise MailServiceError(str(exc)) from exc
        profile = self._resolve_mail_profile(user_id=int(user_id), mailbox_id=draft_plan.effective_mailbox_id, require_password=True)
        resolved_mailbox_id = _normalize_text(profile.get("mailbox_id"))
        account = self._create_account(
            email=profile["email"],
            login=profile["login"],
            password=profile["password"],
        )

        draft_exchange_id = ""
        if draft_id:
            folder_key, draft_exchange_id, encoded_mailbox_id = self._decode_message_ref(draft_id)
            if folder_key != "drafts":
                raise MailServiceError("Draft id must point to drafts folder")
            resolved_mailbox_id = self._resolve_mailbox_scope(resolved_mailbox_id, encoded_mailbox_id)

        try:
            draft_item = self._draft_lifecycle.upsert_draft(
                account=account,
                draft_plan=draft_plan,
                attachments=safe_attachments,
                draft_exchange_id=draft_exchange_id,
            )
            draft_exchange_id = _normalize_text(getattr(draft_item, "id", ""))
            self._save_draft_context(
                user_id=int(user_id),
                mailbox_id=resolved_mailbox_id,
                draft_exchange_id=draft_exchange_id,
                compose_mode=draft_plan.compose_mode,
                reply_to_message_id=draft_plan.reply_to_message_id or None,
                forward_message_id=draft_plan.forward_message_id or None,
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
        except MailDraftLifecycleError as exc:
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
            self._draft_lifecycle.delete_draft(account=account, draft_exchange_id=exchange_id)
            self._delete_draft_context(mailbox_id=resolved_mailbox_id, draft_exchange_id=exchange_id)
            self.invalidate_user_cache(
                user_id=int(user_id),
                prefixes=("folder_summary", "folder_tree", "messages", "bootstrap", "message_detail", "conversation_detail"),
            )
            return {"ok": True, "draft_id": draft_id}
        except MailDraftLifecycleError as exc:
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
        self._metadata_store.log_message(
            message_id=message_id,
            user_id=int(user_id),
            username=username,
            direction=direction,
            folder_hint=folder_hint,
            subject=subject,
            recipients=recipients,
            status=status,
            exchange_item_id=exchange_item_id,
            error_text=error_text,
        )

    def _forward_source_attachments(self, *, forward_item: Any, account: Any) -> list[tuple[str, bytes]]:
        attachments: list[tuple[str, bytes]] = []
        for attachment in getattr(forward_item, "attachments", []) or []:
            content_id = self._normalize_attachment_content_id(getattr(attachment, "content_id", None))
            if bool(getattr(attachment, "is_inline", False) or content_id):
                continue
            payload = self._build_attachment_download_payload(attachment=attachment, account=account)
            if payload is None:
                continue
            filename, _content_type, content = payload
            if content:
                attachments.append((filename, content))
        return attachments

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
        try:
            recipient_set = build_recipient_set(to=to, cc=cc, bcc=bcc, require_to=True)
        except ComposeValidationError as exc:
            raise MailServiceError(str(exc)) from exc
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
        try:
            send_plan = build_outbound_send_plan(
                mailbox_id=effective_mailbox_id,
                draft_id=draft_id,
                to=recipient_set.to,
                cc=recipient_set.cc,
                bcc=recipient_set.bcc,
                subject=subject,
                body=body,
                signature=profile["signature"],
                is_html=is_html,
                reply_to_message_id=reply_to_message_id,
                forward_message_id=forward_message_id,
                mailbox_id_from_message=lambda value: self._resolve_mailbox_id_from_message(message_id=value),
                mailbox_scope_resolver=self._resolve_mailbox_scope,
            )
        except ComposeValidationError as exc:
            raise MailServiceError(str(exc)) from exc

        message_id = _normalize_text(base64.urlsafe_b64encode(os.urandom(12)).decode("utf-8"))
        recipients = send_plan.recipients.to
        cc_recipients = send_plan.recipients.cc
        bcc_recipients = send_plan.recipients.bcc
        final_subject = send_plan.subject
        final_body = send_plan.body

        try:
            from exchangelib import HTMLBody, Mailbox, Message
            from exchangelib.attachments import FileAttachment
        except Exception as exc:
            raise MailServiceError("exchangelib package is not installed") from exc

        try:
            to_recipients = [Mailbox(email_address=email) for email in recipients]
            cc_mailboxes = [Mailbox(email_address=email) for email in cc_recipients]
            bcc_mailboxes = [Mailbox(email_address=email) for email in bcc_recipients]
            body_payload = HTMLBody(final_body) if send_plan.is_html else final_body
            msg_kwargs = dict(
                account=account,
                folder=account.sent,
                subject=final_subject,
                body=body_payload,
                to_recipients=to_recipients,
                cc_recipients=cc_mailboxes,
                bcc_recipients=bcc_mailboxes,
            )
            reply_message_id_value = ""
            reply_references = ""
            forward_message_id_value = ""
            forward_attachments: list[tuple[str, bytes]] = []

            if send_plan.reply_to_message_id:
                reply_folder_key, reply_exchange_id = self._decode_message_id(send_plan.reply_to_message_id)
                reply_folder_obj, _ = self._resolve_folder(account, reply_folder_key)
                try:
                    reply_item = reply_folder_obj.get(id=reply_exchange_id)
                except Exception as exc:
                    raise MailServiceError(f"Reply source message not found: {exc}") from exc
                reply_message_id_value = self._item_message_id(reply_item)
                reply_references = _normalize_text(getattr(reply_item, "references", None))

            if send_plan.forward_message_id:
                forward_folder_key, forward_exchange_id = self._decode_message_id(send_plan.forward_message_id)
                forward_folder_obj, _ = self._resolve_folder(account, forward_folder_key)
                try:
                    forward_item = forward_folder_obj.get(id=forward_exchange_id)
                except Exception as exc:
                    raise MailServiceError(f"Forward source message not found: {exc}") from exc
                forward_message_id_value = self._item_message_id(forward_item)
                forward_attachments = self._forward_source_attachments(
                    forward_item=forward_item,
                    account=account,
                )

            msg_kwargs.update(
                build_reply_forward_reference_headers(
                    reply_message_id=reply_message_id_value,
                    reply_references=reply_references,
                    forward_message_id=forward_message_id_value,
                )
            )

            msg = Message(**msg_kwargs)
            outgoing_attachments = [*forward_attachments, *safe_attachments]
            self._validate_outgoing_attachments_dynamic(outgoing_attachments)
            if outgoing_attachments:
                for filename, content in outgoing_attachments:
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
        try:
            return normalize_field_options(value)
        except TemplateValidationError as exc:
            raise MailServiceError(str(exc)) from exc

    @classmethod
    def _normalize_template_field(cls, raw_field: Any, index: int = 0) -> dict[str, Any]:
        try:
            return normalize_template_field(raw_field, index)
        except TemplateValidationError as exc:
            raise MailServiceError(str(exc)) from exc

    @classmethod
    def _normalize_template_fields(cls, raw_fields: Any) -> list[dict[str, Any]]:
        try:
            return normalize_template_fields(raw_fields)
        except TemplateValidationError as exc:
            raise MailServiceError(str(exc)) from exc

    @classmethod
    def _parse_template_fields_json(cls, raw_json: str) -> list[dict[str, Any]]:
        try:
            return parse_template_fields_json(raw_json)
        except (TemplateStoreError, TemplateValidationError) as exc:
            raise MailServiceError(str(exc)) from exc

    def _migrate_legacy_template_fields(self) -> None:
        self._template_store.migrate_legacy_template_fields(logger=logger)

    @staticmethod
    def _value_to_template_string(value: Any) -> str:
        return value_to_template_string(value)

    @classmethod
    def _render_template(cls, text: str, values: dict[str, Any]) -> str:
        return render_template(text, values)

    @classmethod
    def _coerce_field_value(cls, field: dict[str, Any], raw_value: Any) -> Any:
        try:
            return coerce_field_value(field, raw_value)
        except TemplateValidationError as exc:
            raise MailServiceError(str(exc)) from exc

    @classmethod
    def _validate_template_values(cls, template_fields: list[dict[str, Any]], values: dict[str, Any]) -> dict[str, Any]:
        try:
            return validate_template_values(template_fields, values)
        except TemplateValidationError as exc:
            raise MailServiceError(str(exc)) from exc

    @classmethod
    def _validate_attachments_limits(
        cls,
        attachments: list[tuple[str, bytes]],
        *,
        max_files: int,
        max_file_size: int,
        max_total_size: int,
    ) -> None:
        try:
            validate_attachments_limits(
                attachments,
                AttachmentLimits(
                    max_files=int(max_files),
                    max_file_size=int(max_file_size),
                    max_total_size=int(max_total_size),
                ),
            )
        except AttachmentLimitError as exc:
            raise MailPayloadTooLargeError(str(exc)) from exc

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

    def _search_local_user_contacts(self, query: str) -> list[dict[str, str]]:
        normalized_query = _normalize_text(query).lower()
        if len(normalized_query) < 2:
            return []
        terms = [item for item in re.split(r"\s+", normalized_query) if item]
        contacts: list[dict[str, str]] = []
        seen: set[str] = set()
        for user in user_service.list_users():
            email = _normalize_text(user.get("mailbox_email") or user.get("email")).lower()
            if not email:
                continue
            name = _normalize_text(user.get("full_name") or user.get("username") or email)
            haystack = " ".join(
                [
                    name,
                    _normalize_text(user.get("username")),
                    email,
                    _normalize_text(user.get("mailbox_login")),
                ]
            ).lower()
            if terms and not all(term in haystack for term in terms):
                continue
            if email in seen:
                continue
            seen.add(email)
            contacts.append({"name": name, "email": email, "source": "itinvent_users"})
            if len(contacts) >= 25:
                break
        return contacts

    @staticmethod
    def _is_gal_no_results(value: Any) -> bool:
        return value.__class__.__name__ == "ErrorNameResolutionNoResults"

    @staticmethod
    def _serialize_gal_contact(value: Any) -> dict[str, str] | None:
        email = _normalize_text(getattr(value, "email_address", None)).lower()
        if not email:
            return None
        name = _normalize_text(getattr(value, "name", None))
        return {"name": name or email, "email": email, "source": "exchange_gal"}

    def search_contacts(self, user_id: int, q: str, mailbox_id: str | None = None) -> list[dict[str, str]]:
        query = _normalize_text(q)
        if len(query) < 2:
            return []

        contacts: list[dict[str, str]] = []
        seen: set[str] = set()
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
            for item in results:
                if self._is_gal_no_results(item):
                    continue
                contact = self._serialize_gal_contact(item)
                if not contact:
                    continue
                email = _normalize_text(contact.get("email")).lower()
                if email and email not in seen:
                    seen.add(email)
                    contacts.append(contact)
            if contacts:
                return contacts
        except Exception as exc:
            if not self._is_gal_no_results(exc):
                logger.warning("Error searching contacts in GAL (user_id=%s, q=%s): %s", user_id, query, exc)

        for item in self._search_local_user_contacts(query):
            email = _normalize_text(item.get("email")).lower()
            if email and email not in seen:
                seen.add(email)
                contacts.append(item)
        return contacts

    def list_templates(self, *, active_only: bool = True) -> list[dict[str, Any]]:
        return self._template_store.list_templates(active_only=active_only)

    def get_template(self, template_id: str, *, active_only: bool = False) -> Optional[dict[str, Any]]:
        return self._template_store.get_template(template_id, active_only=active_only)

    def create_template(self, *, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._template_store.create_template(payload=payload, actor=actor)
        except (TemplateStoreError, TemplateValidationError) as exc:
            raise MailServiceError(str(exc)) from exc

    def update_template(self, *, template_id: str, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._template_store.update_template(template_id=template_id, payload=payload, actor=actor)
        except (TemplateStoreError, TemplateValidationError) as exc:
            raise MailServiceError(str(exc)) from exc

    def delete_template(self, *, template_id: str, actor: dict[str, Any]) -> bool:
        try:
            return self._template_store.delete_template(template_id=template_id, actor=actor)
        except TemplateStoreError as exc:
            raise MailServiceError(str(exc)) from exc

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
