"""
Mail API for Exchange inbox/sending and IT request templates.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import atexit
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Form, File, UploadFile, Response, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from backend.api.deps import ensure_user_permission, get_current_active_user, get_current_admin_user, get_current_session_id
from backend.models.auth import User
from backend.realtime.hub import (
    HUB_MAIL_MESSAGE_STATE_CHANGED_EVENT,
    HUB_MAIL_UNREAD_CHANGED_EVENT,
    hub_realtime_publisher,
)
from backend.services.authorization_service import PERM_MAIL_ACCESS
from backend.services.request_auth_context_service import (
    get_request_session_id,
    pop_request_session_id,
    push_request_session_id,
)
from backend.services.mail_notification_service import mail_notification_service
from backend.services.mail_runtime_snapshot_service import mail_runtime_snapshot_service
from backend.services.mail_service import MailPayloadTooLargeError, MailServiceError, mail_service
from backend.services.mail_outgoing_attachment import MailOutgoingAttachment
from backend.services.mail_send_timeouts import (
    increment_ambiguous_send,
    mail_send_wait_for_sec,
    record_mail_send_timing,
)
from backend.services.mail_observability import (
    mail_op_name,
    record_mail_attachment_bytes,
    record_mail_call,
    record_mail_cancelled_wait,
    record_mail_send_state,
    record_mail_source,
    send_state_from_error_code,
)
from backend.services.session_auth_context_service import session_auth_context_service
from backend.services.user_service import user_service


router = APIRouter()
logger = logging.getLogger(__name__)

_MAIL_CALL_LIMITER: asyncio.Semaphore | None = None
_MAIL_CALL_LIMITER_LIMIT = 0
_MAIL_CALL_LIMITER_LOOP = None
_BOOTSTRAP_REFRESH_INFLIGHT: set[tuple[int, str, int]] = set()
_PREVIEW_PDF_MEDIA_TYPE = "application/pdf"
_FORBIDDEN_INLINE_MEDIA_TYPES = frozenset({
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/xml",
    "application/xml",
    "application/javascript",
    "text/javascript",
    "application/x-javascript",
})
_FORBIDDEN_INLINE_EXTENSIONS = frozenset({
    ".html",
    ".htm",
    ".xhtml",
    ".svg",
    ".xml",
    ".js",
})
_SAFE_INLINE_CONTENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@+-]{0,190}$")


def _parse_inline_content_ids(raw_value: str, *, expected_count: int) -> list[str]:
    try:
        parsed = json.loads(_normalize_text(raw_value, "[]"))
    except Exception as exc:
        raise MailServiceError("inline_content_ids_json must contain a valid JSON array") from exc
    if not isinstance(parsed, list):
        raise MailServiceError("inline_content_ids_json must be a JSON array")
    content_ids = [_normalize_text(item) for item in parsed]
    if len(content_ids) != int(expected_count):
        raise MailServiceError("inline_files and inline_content_ids_json must have the same length")
    if any(not content_id or not _SAFE_INLINE_CONTENT_ID_RE.fullmatch(content_id) for content_id in content_ids):
        raise MailServiceError("Inline image Content-ID is invalid")
    if len(set(content_ids)) != len(content_ids):
        raise MailServiceError("Inline image Content-ID values must be unique")
    return content_ids


async def _read_compose_attachments(
    *,
    files: list[UploadFile],
    inline_files: list[UploadFile],
    inline_content_ids_json: str,
) -> list[MailOutgoingAttachment]:
    attachments: list[MailOutgoingAttachment] = []
    for file in files or []:
        content = await file.read()
        if not content:
            continue
        attachments.append(
            MailOutgoingAttachment(
                filename=file.filename or "attachment.bin",
                content=content,
                content_type=_normalize_text(file.content_type),
            )
        )

    inline_ids = _parse_inline_content_ids(
        inline_content_ids_json,
        expected_count=len(inline_files or []),
    )
    for file, content_id in zip(inline_files or [], inline_ids):
        content_type = _normalize_text(file.content_type).lower()
        filename = file.filename or "inline-image"
        if (
            not _attachment_media_type(content_type).startswith("image/")
            or not _is_inline_safe_attachment(content_type=content_type, filename=filename)
        ):
            raise MailServiceError("Inline attachments must use a safe image/* MIME type")
        content = await file.read()
        if not content:
            raise MailServiceError("Inline image must not be empty")
        attachments.append(
            MailOutgoingAttachment(
                filename=filename,
                content=content,
                content_type=content_type,
                content_id=content_id,
                is_inline=True,
            )
        )
    return attachments


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        value = int(raw)
    except Exception:
        value = int(default)
    return max(minimum, min(maximum, value))


# Keep mail open/bootstrap off the shared default to_thread pool used by hub/chat polls.
_MAIL_EXECUTOR = ThreadPoolExecutor(
    max_workers=_env_int("MAIL_WORKER_THREADS", 16, 4, 64),
    thread_name_prefix="mail-io",
)


def _shutdown_mail_executor() -> None:
    _MAIL_EXECUTOR.shutdown(wait=True, cancel_futures=False)


atexit.register(_shutdown_mail_executor)


async def _run_in_mail_executor(func, /, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_MAIL_EXECUTOR, lambda: func(*args, **kwargs))


async def get_current_mail_user(
    current_user: User = Depends(get_current_active_user),
    session_id: Optional[str] = Depends(get_current_session_id),
):
    ensure_user_permission(current_user, PERM_MAIL_ACCESS)
    token = push_request_session_id(session_id)
    try:
        yield current_user
    finally:
        pop_request_session_id(token)


async def get_current_mail_admin_user(
    current_user: User = Depends(get_current_admin_user),
    session_id: Optional[str] = Depends(get_current_session_id),
):
    token = push_request_session_id(session_id)
    try:
        yield current_user
    finally:
        pop_request_session_id(token)


async def get_current_mail_test_user(
    current_user: User = Depends(get_current_active_user),
    session_id: Optional[str] = Depends(get_current_session_id),
):
    if current_user.role != "admin":
        ensure_user_permission(current_user, PERM_MAIL_ACCESS)
    token = push_request_session_id(session_id)
    try:
        yield current_user
    finally:
        pop_request_session_id(token)


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _build_content_disposition(filename: str, disposition: str = "attachment") -> str:
    source = _normalize_text(filename, "attachment.bin").replace("\r", " ").replace("\n", " ")
    source = source.strip() or "attachment.bin"
    normalized_disposition = "inline" if _normalize_text(disposition).lower() == "inline" else "attachment"

    ascii_fallback = source.encode("ascii", "ignore").decode("ascii")
    ascii_fallback = re.sub(r'[";\\]+', "_", ascii_fallback).strip(" .")
    if not ascii_fallback:
        ascii_fallback = "attachment.bin"

    encoded = quote(source, safe="")
    return f"{normalized_disposition}; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded}"


def _mail_inline_allowlist_enabled() -> bool:
    raw = os.getenv("MAIL_INLINE_ALLOWLIST")
    if raw is None or not str(raw).strip():
        return True
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _attachment_media_type(content_type: str) -> str:
    return _normalize_text(content_type).split(";", 1)[0].strip().lower()


def _attachment_filename_extension(filename: str) -> str:
    name = _normalize_text(filename).replace("\\", "/").rsplit("/", 1)[-1]
    if "." not in name:
        return ""
    return "." + name.rsplit(".", 1)[-1].strip().lower()


def _is_inline_safe_attachment(*, content_type: str, filename: str) -> bool:
    media_type = _attachment_media_type(content_type)
    extension = _attachment_filename_extension(filename)
    if media_type in _FORBIDDEN_INLINE_MEDIA_TYPES or extension in _FORBIDDEN_INLINE_EXTENSIONS:
        return False
    if media_type.startswith("image/"):
        return True
    return media_type == "application/pdf"


def _resolve_attachment_disposition(
    *,
    requested_disposition: str,
    content_type: str,
    filename: str,
) -> str:
    wanted = "inline" if _normalize_text(requested_disposition).lower() == "inline" else "attachment"
    if wanted != "inline":
        return "attachment"
    if not _mail_inline_allowlist_enabled():
        return "inline"
    return "inline" if _is_inline_safe_attachment(content_type=content_type, filename=filename) else "attachment"


def _nosniff_headers() -> dict[str, str]:
    return {"X-Content-Type-Options": "nosniff"}


def _build_attachment_download_headers(
    *,
    filename: str,
    content_type: str,
    requested_disposition: str,
) -> dict[str, str]:
    disposition = _resolve_attachment_disposition(
        requested_disposition=requested_disposition,
        content_type=content_type,
        filename=filename,
    )
    return {
        "Content-Disposition": _build_content_disposition(filename, disposition=disposition),
        "Cache-Control": "private, max-age=300",
        **_nosniff_headers(),
    }


def _build_preview_pdf_headers(filename: str) -> dict[str, str]:
    return {
        "Content-Disposition": _build_content_disposition(filename, disposition="inline"),
        "Cache-Control": "private, max-age=300",
        **_nosniff_headers(),
    }


def _request_id_from_headers(request: Request) -> str:
    return _normalize_text(request.headers.get("X-Client-Request-ID"), "-")


def _mail_exchange_max_concurrency() -> int:
    raw = _normalize_text(os.getenv("MAIL_EXCHANGE_MAX_CONCURRENCY"), "16")
    try:
        return max(1, min(64, int(raw)))
    except (TypeError, ValueError):
        return 16


def _shared_mail_snapshot_reads_enabled() -> bool:
    return str(os.getenv("MAIL_SHARED_SNAPSHOT_READ_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"}


def _get_mail_call_limiter() -> asyncio.Semaphore:
    global _MAIL_CALL_LIMITER, _MAIL_CALL_LIMITER_LIMIT, _MAIL_CALL_LIMITER_LOOP

    loop = asyncio.get_running_loop()
    limit = _mail_exchange_max_concurrency()
    if _MAIL_CALL_LIMITER is None or _MAIL_CALL_LIMITER_LIMIT != limit or _MAIL_CALL_LIMITER_LOOP is not loop:
        _MAIL_CALL_LIMITER = asyncio.Semaphore(limit)
        _MAIL_CALL_LIMITER_LIMIT = limit
        _MAIL_CALL_LIMITER_LOOP = loop
    return _MAIL_CALL_LIMITER


async def _run_mail_call(func, /, *args, **kwargs):
    result, _metrics = await _run_mail_instrumented(func, *args, **kwargs)
    return result


async def _run_mail_send_call(func, /, *args, **kwargs):
    timeout_sec = mail_send_wait_for_sec()
    started_at = time.perf_counter()
    send_state = ""
    try:
        result = await asyncio.wait_for(_run_mail_call(func, *args, **kwargs), timeout=timeout_sec)
        send_state = "sent"
        return result
    except asyncio.TimeoutError as exc:
        increment_ambiguous_send()
        send_state = "timeout"
        logger.warning("mail.send wait_for timeout_sec=%.1f", timeout_sec)
        raise MailServiceError(
            "Отправка заняла слишком много времени. Письмо могло быть отправлено. "
            "Проверьте папку «Отправленные» и не отправляйте его повторно сразу.",
            code="MAIL_SEND_TIMEOUT",
            status_code=504,
        ) from exc
    except MailServiceError as exc:
        send_state = send_state_from_error_code(getattr(exc, "code", ""))
        raise
    finally:
        if send_state:
            record_mail_send_state(send_state)
        record_mail_send_timing((time.perf_counter() - started_at) * 1000.0)


async def _write_through_mail_read_state(**kwargs: Any) -> None:
    """Keep shared counters coherent without making Exchange mutations depend on app storage."""
    try:
        await _run_in_mail_executor(mail_runtime_snapshot_service.apply_read_state, **kwargs)
    except Exception:
        logger.warning("Mail read-state snapshot write-through failed", exc_info=True)


def _publish_mail_realtime(
    *,
    user_id: int,
    event_type: str,
    message_id: str = "",
    conversation_id: str = "",
    mailbox_id: str = "",
    operation: str = "",
    unread_delta: int | None = None,
) -> bool:
    payload: dict[str, Any] = {
        "message_id": _normalize_text(message_id),
        "conversation_id": _normalize_text(conversation_id),
        "mailbox_id": _normalize_text(mailbox_id),
        "operation": _normalize_text(operation),
    }
    if unread_delta is not None:
        payload["unread_delta"] = int(unread_delta)
    return hub_realtime_publisher.publish_user_event(
        recipient_user_id=int(user_id),
        event_type=event_type,
        payload=payload,
    )


async def _write_through_mail_preferences(*, user_id: int, preferences: dict[str, Any]) -> None:
    try:
        await _run_in_mail_executor(
            mail_runtime_snapshot_service.apply_preferences,
            user_id=int(user_id),
            preferences=preferences,
        )
    except Exception:
        logger.warning("Mail preferences snapshot write-through failed", exc_info=True)


def _run_mail_call_timed_sync(func, args, kwargs, submitted_at: float):
    executor_wait_ms = (time.perf_counter() - submitted_at) * 1000.0
    request_tokens = mail_service.push_request_context()
    metrics: dict[str, Any] = {}
    call_started = time.perf_counter()
    try:
        result = func(*args, **kwargs)
        metrics = dict(mail_service.get_request_metrics() or {})
        return result, metrics, None, executor_wait_ms, (time.perf_counter() - call_started) * 1000.0
    except Exception as exc:
        metrics = dict(mail_service.get_request_metrics() or {})
        return None, metrics, exc, executor_wait_ms, (time.perf_counter() - call_started) * 1000.0
    finally:
        mail_service.pop_request_context(request_tokens)


async def _run_mail_instrumented(func, /, *args, **kwargs):
    wait_started = time.perf_counter()
    try:
        async with _get_mail_call_limiter():
            semaphore_wait_ms = (time.perf_counter() - wait_started) * 1000.0
            submitted_at = time.perf_counter()
            result, metrics, error, executor_wait_ms, call_ms = await _run_in_mail_executor(
                _run_mail_call_timed_sync,
                func,
                args,
                kwargs,
                submitted_at,
            )
        record_mail_call(
            op=mail_op_name(func),
            semaphore_wait_ms=semaphore_wait_ms,
            executor_wait_ms=executor_wait_ms,
            call_ms=call_ms,
            metrics=metrics,
            error=error is not None,
        )
        if error is not None:
            raise error
        return result, metrics
    except asyncio.CancelledError:
        # Client abort cancels the await, not the EWS SOAP thread (MAIL-AUDIT-025).
        record_mail_cancelled_wait()
        raise


async def _run_mail_call_with_metrics(func, /, *args, **kwargs):
    return await _run_mail_instrumented(func, *args, **kwargs)


def _mail_metrics_log_context(metrics: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = metrics or {}
    return {
        "cache_hit": payload.get("cache_hit"),
        "cache_bucket": payload.get("cache_bucket"),
        "cache_evicted": payload.get("cache_evicted"),
        "singleflight_hit": payload.get("singleflight_hit"),
        "search_limited": payload.get("search_limited"),
        "searched_window": payload.get("searched_window"),
        "mailbox_unread_deferred": payload.get("mailbox_unread_deferred"),
        "filtered_path": payload.get("filtered_path"),
        "account_reused": payload.get("account_reused"),
    }


def _log_request_timing(route_name: str, request_id: str, started_at: float, **context: Any) -> None:
    took_ms = (time.perf_counter() - started_at) * 1000.0
    payload = " ".join([f"{key}={value}" for key, value in context.items() if value is not None])
    logger.info("mail.%s request_id=%s took_ms=%.1f %s", route_name, request_id, took_ms, payload)


def _mail_http_exception(
    exc: MailServiceError,
    *,
    current_user: User | None = None,
    user_id: int | None = None,
) -> HTTPException:
    resolved_user_id = int(user_id or getattr(current_user, "id", 0) or 0)
    resolved_message = str(exc)
    # Prefer message markers, then the original Exchange cause (wrappers may rewrite text),
    # then the explicit MailServiceError.code.
    resolved_code = (
        mail_service.classify_mail_error_code(resolved_message)
        or mail_service.classify_mail_error_code(getattr(exc, "__cause__", None))
        or str(getattr(exc, "code", "") or "").strip()
    )
    headers: dict[str, str] = {}
    if resolved_code == "MAIL_AUTH_INVALID":
        if resolved_user_id > 0:
            mail_service.invalidate_saved_password(user_id=resolved_user_id)
        # Stale AD password may still live in the web session context from an earlier
        # password login. Clear it so /mail can prompt for an update without full re-login
        # (trusted-device / passkey sessions never had a password here at all).
        session_id = get_request_session_id()
        if session_id:
            try:
                session_auth_context_service.delete_session_context(session_id)
            except Exception:
                logger.warning(
                    "Failed to clear mail session auth context after AUTH_INVALID: user_id=%s",
                    resolved_user_id,
                    exc_info=True,
                )
        headers["X-Mail-Error-Code"] = "MAIL_AUTH_INVALID"
        return HTTPException(
            status_code=409,
            detail="Пароль корпоративной почты устарел или неверен. Введите новый пароль на странице Почта.",
            headers=headers,
        )
    if resolved_code == "MAIL_PASSWORD_REQUIRED":
        headers["X-Mail-Error-Code"] = "MAIL_PASSWORD_REQUIRED"
        return HTTPException(
            status_code=409,
            detail="Введите корпоративный пароль для почты.",
            headers=headers,
        )
    if resolved_code == "MAIL_RELOGIN_REQUIRED":
        headers["X-Mail-Error-Code"] = "MAIL_RELOGIN_REQUIRED"
        return HTTPException(
            status_code=409,
            detail="Для доступа к почте войдите в систему заново.",
            headers=headers,
        )
    if resolved_code:
        headers["X-Mail-Error-Code"] = resolved_code
    return HTTPException(
        status_code=int(getattr(exc, "status_code", 400) or 400),
        detail=resolved_message,
        headers=headers or None,
    )


class SendMessageRequest(BaseModel):
    from_mailbox_id: str = Field(default="")
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    bcc: list[str] = Field(default_factory=list)
    subject: str = Field(default="")
    body: str = Field(default="")
    is_html: bool = True
    reply_to_message_id: str = Field(default="")
    forward_message_id: str = Field(default="")
    draft_id: str = Field(default="")
    retain_existing_attachments: Optional[list[str]] = None


class MoveMessagePayload(BaseModel):
    mailbox_id: str = Field(default="")
    target_folder: str = Field(default="inbox")


class DeleteMessagePayload(BaseModel):
    mailbox_id: str = Field(default="")
    permanent: bool = Field(default=False)


class RestoreMessagePayload(BaseModel):
    mailbox_id: str = Field(default="")
    target_folder: str = Field(default="")


class SendItRequestPayload(BaseModel):
    template_id: str = Field(..., min_length=1)
    fields: dict[str, Any] = Field(default_factory=dict)


class UpdateMailConfigPayload(BaseModel):
    mailbox_id: Optional[str] = None
    mailbox_email: Optional[str] = None
    mailbox_login: Optional[str] = None
    mailbox_password: Optional[str] = None
    mail_signature_html: Optional[str] = None


class UpdateMyMailConfigPayload(BaseModel):
    mailbox_id: Optional[str] = None
    mail_signature_html: Optional[str] = None


class SaveMyMailCredentialsPayload(BaseModel):
    mailbox_id: Optional[str] = None
    mailbox_login: Optional[str] = None
    mailbox_password: str = Field(..., min_length=1, max_length=256)
    mailbox_email: Optional[str] = None


class TestConnectionPayload(BaseModel):
    user_id: Optional[int] = None
    mailbox_id: Optional[str] = None


class BulkMessageActionPayload(BaseModel):
    mailbox_id: str = Field(default="")
    action: str = Field(..., min_length=1)
    message_ids: list[str] = Field(default_factory=list)
    target_folder: str = Field(default="")
    permanent: bool = Field(default=False)


class MarkAllReadPayload(BaseModel):
    mailbox_id: str = Field(default="")
    folder: str = Field(default="inbox")
    folder_scope: str = Field(default="current")


class MessageImportancePayload(BaseModel):
    importance: str = Field(..., min_length=3, max_length=10)
    mailbox_id: Optional[str] = None


class ConversationReadStatePayload(BaseModel):
    mailbox_id: str = Field(default="")
    folder: str = Field(default="inbox")
    folder_scope: str = Field(default="current")


class FolderCreatePayload(BaseModel):
    mailbox_id: str = Field(default="")
    name: str = Field(..., min_length=1)
    parent_folder_id: str = Field(default="")
    scope: str = Field(default="mailbox")


class FolderRenamePayload(BaseModel):
    name: str = Field(..., min_length=1)


class FolderFavoritePayload(BaseModel):
    mailbox_id: str = Field(default="")
    favorite: bool = Field(default=True)


class MailboxCreatePayload(BaseModel):
    label: str = Field(default="")
    mailbox_email: str = Field(..., min_length=1)
    mailbox_login: str = Field(default="")
    mailbox_password: str = Field(default="", max_length=256)
    auth_mode: str = Field(default="stored_credentials")
    is_primary: bool = Field(default=False)
    is_active: bool = Field(default=True)


class MailboxUpdatePayload(BaseModel):
    label: Optional[str] = None
    mailbox_email: Optional[str] = None
    mailbox_login: Optional[str] = None
    mailbox_password: Optional[str] = None
    auth_mode: Optional[str] = None
    is_primary: Optional[bool] = None
    is_active: Optional[bool] = None
    selected: Optional[bool] = None


class UpdateMailPreferencesPayload(BaseModel):
    reading_pane: Optional[str] = None
    density: Optional[str] = None
    mark_read_on_select: Optional[bool] = None
    show_preview_snippets: Optional[bool] = None
    show_favorites_first: Optional[bool] = None
    folder_pane_width: Optional[int] = Field(default=None, ge=180, le=360)
    message_list_width: Optional[int] = Field(default=None, ge=280, le=720)
    bottom_list_percent: Optional[int] = Field(default=None, ge=25, le=75)


@router.get("/contacts")
async def get_mail_contacts(
    request: Request,
    q: str = Query("", min_length=0),
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        items = await _run_mail_call(
            mail_service.search_contacts,
            user_id=int(current_user.id),
            q=q,
            mailbox_id=_normalize_text(mailbox_id) or None,
        )
        return {"items": items}
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "contacts",
            request_id,
            started_at,
            user_id=int(current_user.id),
            q_len=len(str(q or "")),
        )


def _list_messages_payload(
    *,
    user_id: int,
    mailbox_id: str | None = None,
    folder: str,
    folder_scope: str,
    limit: int,
    offset: int,
    q: str,
    unread_only: bool,
    has_attachments: bool,
    date_from: str,
    date_to: str,
    from_filter: str,
    to_filter: str,
    subject_filter: str,
    body_filter: str,
    importance: str,
):
    return mail_service.list_messages(
        user_id=int(user_id),
        mailbox_id=_normalize_text(mailbox_id) or None,
        folder=_normalize_text(folder, "inbox"),
        folder_scope=_normalize_text(folder_scope, "current"),
        limit=int(limit),
        offset=int(offset),
        q=_normalize_text(q),
        unread_only=bool(unread_only),
        has_attachments=bool(has_attachments),
        date_from=_normalize_text(date_from),
        date_to=_normalize_text(date_to),
        from_filter=_normalize_text(from_filter),
        to_filter=_normalize_text(to_filter),
        subject_filter=_normalize_text(subject_filter),
        body_filter=_normalize_text(body_filter),
        importance=_normalize_text(importance),
    )


@router.get("/messages")
async def get_mail_messages(
    request: Request,
    mailbox_id: str = Query("", min_length=0),
    folder: str = Query("inbox", min_length=1),
    folder_scope: str = Query("current", min_length=1),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: str = Query("", min_length=0),
    unread_only: bool = Query(False),
    has_attachments: bool = Query(False),
    date_from: str = Query("", min_length=0),
    date_to: str = Query("", min_length=0),
    from_filter: str = Query("", min_length=0),
    to_filter: str = Query("", min_length=0),
    subject_filter: str = Query("", min_length=0),
    body_filter: str = Query("", min_length=0),
    importance: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    metrics: dict[str, Any] = {}
    try:
        result, metrics = await _run_mail_call_with_metrics(
            _list_messages_payload,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            folder=folder,
            folder_scope=folder_scope,
            limit=int(limit),
            offset=int(offset),
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
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "list_messages",
            request_id,
            started_at,
            user_id=int(current_user.id),
            folder=_normalize_text(folder, "inbox"),
            folder_scope=_normalize_text(folder_scope, "current"),
            q_len=len(str(q or "")),
            unread_only=int(bool(unread_only)),
            has_attachments=int(bool(has_attachments)),
            date_from=_normalize_text(date_from) or None,
            date_to=_normalize_text(date_to) or None,
            from_filter=_normalize_text(from_filter) or None,
            to_filter=_normalize_text(to_filter) or None,
            subject_filter=_normalize_text(subject_filter) or None,
            body_filter=_normalize_text(body_filter) or None,
            importance=_normalize_text(importance) or None,
            limit=int(limit),
            offset=int(offset),
            **_mail_metrics_log_context(metrics),
        )


@router.get("/inbox")
async def get_inbox_messages(
    request: Request,
    mailbox_id: str = Query("", min_length=0),
    folder: str = Query("inbox", min_length=1),
    folder_scope: str = Query("current", min_length=1),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: str = Query("", min_length=0),
    unread_only: bool = Query(False),
    has_attachments: bool = Query(False),
    date_from: str = Query("", min_length=0),
    date_to: str = Query("", min_length=0),
    from_filter: str = Query("", min_length=0),
    to_filter: str = Query("", min_length=0),
    subject_filter: str = Query("", min_length=0),
    body_filter: str = Query("", min_length=0),
    importance: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    return await get_mail_messages(
        request=request,
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
        current_user=current_user,
    )


@router.get("/folders/summary")
async def get_mail_folders_summary(
    request: Request,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    metrics: dict[str, Any] = {}
    try:
        items, metrics = await _run_mail_call_with_metrics(
            mail_service.list_folder_summary,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
        )
        return {
            "items": items
        }
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "folder_summary",
            request_id,
            started_at,
            user_id=int(current_user.id),
            **_mail_metrics_log_context(metrics),
        )


@router.get("/folders/tree")
async def get_mail_folders_tree(
    request: Request,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    metrics: dict[str, Any] = {}
    try:
        result, metrics = await _run_mail_call_with_metrics(
            mail_service.list_folder_tree,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "folder_tree",
            request_id,
            started_at,
            user_id=int(current_user.id),
            **_mail_metrics_log_context(metrics),
        )


def _schedule_mail_bootstrap_refresh(
    *,
    user_id: int,
    mailbox_id: str | None,
    limit: int,
    snapshot_context: str,
) -> None:
    """Refresh expired bootstrap snapshot in background; do not block open path."""
    key = (int(user_id), str(mailbox_id or ""), int(limit))
    if key in _BOOTSTRAP_REFRESH_INFLIGHT:
        return
    _BOOTSTRAP_REFRESH_INFLIGHT.add(key)

    async def _refresh() -> None:
        try:
            result, _metrics = await _run_mail_call_with_metrics(
                mail_service.get_bootstrap,
                user_id=int(user_id),
                mailbox_id=mailbox_id,
                folder="inbox",
                folder_scope="current",
                limit=int(limit),
            )
            await _run_in_mail_executor(
                mail_runtime_snapshot_service.write_success,
                user_id=int(user_id),
                mailbox_id=mailbox_id,
                snapshot_type="bootstrap",
                context_key=snapshot_context,
                payload=result,
                ttl_seconds=300,
            )
        except Exception:
            logger.warning("Background mail bootstrap refresh failed user_id=%s", user_id, exc_info=True)
        finally:
            _BOOTSTRAP_REFRESH_INFLIGHT.discard(key)

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_refresh(), name=f"mail-bootstrap-refresh:{key[0]}")
    except RuntimeError:
        _BOOTSTRAP_REFRESH_INFLIGHT.discard(key)


@router.get("/bootstrap")
async def get_mail_bootstrap(
    request: Request,
    limit: int = Query(20, ge=10, le=100),
    mailbox_id: str = Query("", min_length=0),
    refresh: str = Query("auto", pattern="^(auto|live)$"),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    metrics: dict[str, Any] = {}
    normalized_mailbox_id = _normalize_text(mailbox_id) or None
    snapshot_context = f"inbox|current|{int(limit)}"
    bootstrap_source = "unknown"
    try:
        if refresh == "auto" and _shared_mail_snapshot_reads_enabled():
            snapshot = await _run_in_mail_executor(
                mail_runtime_snapshot_service.read,
                user_id=int(current_user.id),
                mailbox_id=normalized_mailbox_id,
                snapshot_type="bootstrap",
                context_key=snapshot_context,
            )
            snapshot_state = str(snapshot.get("state") or "")
            # Serve fresh OR stale snapshot immediately; Exchange under chat load is 10s+.
            if snapshot_state in {"ok", "stale"} and isinstance(snapshot.get("payload"), dict):
                bootstrap_source = "snapshot"
                record_mail_source("snapshot")
                if snapshot_state == "stale":
                    _schedule_mail_bootstrap_refresh(
                        user_id=int(current_user.id),
                        mailbox_id=normalized_mailbox_id,
                        limit=int(limit),
                        snapshot_context=snapshot_context,
                    )
                # Always expose state=ok to UI so client SWR does not force a live Exchange roundtrip.
                return {
                    **snapshot["payload"],
                    "state": "ok",
                    "source": snapshot["source"],
                    "as_of": snapshot.get("as_of"),
                    "last_error": snapshot.get("last_error") or "",
                }
        result, metrics = await _run_mail_call_with_metrics(
            mail_service.get_bootstrap,
            user_id=int(current_user.id),
            mailbox_id=normalized_mailbox_id,
            folder="inbox",
            folder_scope="current",
            limit=int(limit),
        )
        bootstrap_source = "exchange"
        record_mail_source("exchange")
        await _run_in_mail_executor(
            mail_runtime_snapshot_service.write_success,
            user_id=int(current_user.id),
            mailbox_id=normalized_mailbox_id,
            snapshot_type="bootstrap",
            context_key=snapshot_context,
            payload=result,
            ttl_seconds=300,
        )
        return {**result, "state": "ok", "source": "exchange", "as_of": None, "last_error": ""}
    except MailServiceError as exc:
        await _run_in_mail_executor(
            mail_runtime_snapshot_service.record_error,
            user_id=int(current_user.id),
            mailbox_id=normalized_mailbox_id,
            snapshot_type="bootstrap",
            context_key=snapshot_context,
            error=exc,
        )
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "bootstrap",
            request_id,
            started_at,
            user_id=int(current_user.id),
            limit=int(limit),
            source=bootstrap_source,
            **_mail_metrics_log_context(metrics),
        )


@router.get("/mailboxes")
async def get_user_mailboxes(
    request: Request,
    include_unread: bool = Query(False),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    metrics: dict[str, Any] = {}
    try:
        items, metrics = await _run_mail_call_with_metrics(
            mail_service.list_user_mailboxes,
            user_id=int(current_user.id),
            include_inactive=True,
            include_unread=bool(include_unread),
        )
        return {
            "items": items
        }
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "mailboxes",
            request_id,
            started_at,
            user_id=int(current_user.id),
            include_unread=int(bool(include_unread)),
            **_mail_metrics_log_context(metrics),
        )


@router.post("/mailboxes")
async def connect_user_mailbox(
    payload: MailboxCreatePayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.create_user_mailbox,
            user_id=int(current_user.id),
            label=_normalize_text(payload.label),
            mailbox_email=_normalize_text(payload.mailbox_email),
            mailbox_login=_normalize_text(payload.mailbox_login),
            mailbox_password=_normalize_text(payload.mailbox_password),
            auth_mode=_normalize_text(payload.auth_mode, "stored_credentials"),
            is_primary=bool(payload.is_primary),
            is_active=bool(payload.is_active),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.patch("/mailboxes/{mailbox_id}")
async def patch_user_mailbox(
    mailbox_id: str,
    payload: MailboxUpdatePayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        payload_data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        return await _run_mail_call(
            mail_service.update_user_mailbox,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id),
            **payload_data,
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.delete("/mailboxes/{mailbox_id}")
async def delete_connected_mailbox(
    mailbox_id: str,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.delete_user_mailbox,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/folders")
async def create_mail_folder(
    payload: FolderCreatePayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.create_folder,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            name=_normalize_text(payload.name),
            parent_folder_id=_normalize_text(payload.parent_folder_id),
            scope=_normalize_text(payload.scope, "mailbox"),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.patch("/folders/{folder_id}")
async def rename_mail_folder(
    folder_id: str,
    payload: FolderRenamePayload,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.rename_folder,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            folder_id=_normalize_text(folder_id),
            name=_normalize_text(payload.name),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.delete("/folders/{folder_id}")
async def delete_mail_folder(
    folder_id: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.delete_folder,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            folder_id=_normalize_text(folder_id),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/folders/{folder_id}/favorite")
async def toggle_mail_folder_favorite(
    folder_id: str,
    payload: FolderFavoritePayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.set_folder_favorite,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            folder_id=_normalize_text(folder_id),
            favorite=bool(payload.favorite),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.get("/messages/{message_id}")
async def get_mail_message(
    request: Request,
    message_id: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    metrics: dict[str, Any] = {}
    try:
        result, metrics = await _run_mail_call_with_metrics(
            mail_service.get_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            message_id=message_id,
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "get_message",
            request_id,
            started_at,
            user_id=int(current_user.id),
            message_id_len=len(str(message_id or "")),
            **_mail_metrics_log_context(metrics),
        )


@router.post("/messages/{message_id}/read")
async def mark_message_read(
    message_id: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        ok = await _run_mail_call(
            mail_service.mark_as_read,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            message_id=message_id,
        )
        if ok:
            await _write_through_mail_read_state(
                user_id=int(current_user.id),
                mailbox_id=_normalize_text(mailbox_id) or None,
                unread_delta=-1,
                is_read=True,
                message_id=message_id,
                folder="inbox",
            )
            _publish_mail_realtime(
                user_id=int(current_user.id),
                event_type=HUB_MAIL_UNREAD_CHANGED_EVENT,
                message_id=message_id,
                mailbox_id=mailbox_id,
                operation="read",
                unread_delta=-1,
            )
        return {"ok": ok}
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/{message_id}/unread")
async def mark_message_unread(
    message_id: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        ok = await _run_mail_call(
            mail_service.mark_as_unread,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            message_id=message_id,
        )
        if ok:
            await _write_through_mail_read_state(
                user_id=int(current_user.id),
                mailbox_id=_normalize_text(mailbox_id) or None,
                unread_delta=1,
                is_read=False,
                message_id=message_id,
                folder="inbox",
            )
            _publish_mail_realtime(
                user_id=int(current_user.id),
                event_type=HUB_MAIL_UNREAD_CHANGED_EVENT,
                message_id=message_id,
                mailbox_id=mailbox_id,
                operation="unread",
                unread_delta=1,
            )
        return {"ok": ok}
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/{message_id}/importance")
async def set_mail_message_importance(
    message_id: str,
    payload: MessageImportancePayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        result = await _run_mail_call(
            mail_service.set_message_importance,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            message_id=message_id,
            importance=payload.importance,
        )
        _publish_mail_realtime(
            user_id=int(current_user.id),
            event_type=HUB_MAIL_MESSAGE_STATE_CHANGED_EVENT,
            message_id=message_id,
            mailbox_id=payload.mailbox_id,
            operation="importance",
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/{message_id}/summarize")
async def summarize_mail_message(
    message_id: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.summarize_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            message_id=message_id,
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/{message_id}/smart-replies")
async def smart_replies_for_mail_message(
    message_id: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.smart_replies_for_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            message_id=message_id,
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/{message_id}/move")
async def move_mail_message(
    message_id: str,
    payload: MoveMessagePayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        result = await _run_mail_call(
            mail_service.move_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            message_id=message_id,
            target_folder=_normalize_text(payload.target_folder, "inbox"),
        )
        _publish_mail_realtime(
            user_id=int(current_user.id),
            event_type=HUB_MAIL_MESSAGE_STATE_CHANGED_EVENT,
            message_id=message_id,
            mailbox_id=payload.mailbox_id,
            operation="move",
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/{message_id}/delete")
async def delete_mail_message(
    message_id: str,
    payload: DeleteMessagePayload = Body(default=DeleteMessagePayload()),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        result = await _run_mail_call(
            mail_service.delete_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            message_id=message_id,
            permanent=bool(payload.permanent),
        )
        _publish_mail_realtime(
            user_id=int(current_user.id),
            event_type=HUB_MAIL_MESSAGE_STATE_CHANGED_EVENT,
            message_id=message_id,
            mailbox_id=payload.mailbox_id,
            operation="delete_permanent" if payload.permanent else "delete",
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/{message_id}/restore")
async def restore_mail_message(
    message_id: str,
    payload: RestoreMessagePayload = Body(default=RestoreMessagePayload()),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        result = await _run_mail_call(
            mail_service.restore_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            message_id=message_id,
            target_folder=_normalize_text(payload.target_folder),
        )
        _publish_mail_realtime(
            user_id=int(current_user.id),
            event_type=HUB_MAIL_MESSAGE_STATE_CHANGED_EVENT,
            message_id=message_id,
            mailbox_id=payload.mailbox_id,
            operation="restore",
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/bulk")
async def bulk_mail_message_action(
    payload: BulkMessageActionPayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        result = await _run_mail_call(
            mail_service.bulk_message_action,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            message_ids=payload.message_ids or [],
            action=_normalize_text(payload.action),
            target_folder=_normalize_text(payload.target_folder),
            permanent=bool(payload.permanent),
        )
        _publish_mail_realtime(
            user_id=int(current_user.id),
            event_type=HUB_MAIL_MESSAGE_STATE_CHANGED_EVENT,
            mailbox_id=payload.mailbox_id,
            operation=f"bulk:{_normalize_text(payload.action)}",
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/mark-all-read")
async def mark_all_mail_read(
    payload: MarkAllReadPayload = Body(default=MarkAllReadPayload()),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        result = await _run_mail_call(
            mail_service.mark_all_as_read,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            folder=_normalize_text(payload.folder, "inbox"),
            folder_scope=_normalize_text(payload.folder_scope, "current"),
        )
        _publish_mail_realtime(
            user_id=int(current_user.id),
            event_type=HUB_MAIL_UNREAD_CHANGED_EVENT,
            mailbox_id=payload.mailbox_id,
            operation="mark_all_read",
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.get("/conversations")
async def get_mail_conversations(
    request: Request,
    mailbox_id: str = Query("", min_length=0),
    folder: str = Query("inbox", min_length=1),
    folder_scope: str = Query("current", min_length=1),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: str = Query("", min_length=0),
    unread_only: bool = Query(False),
    has_attachments: bool = Query(False),
    date_from: str = Query("", min_length=0),
    date_to: str = Query("", min_length=0),
    from_filter: str = Query("", min_length=0),
    to_filter: str = Query("", min_length=0),
    subject_filter: str = Query("", min_length=0),
    body_filter: str = Query("", min_length=0),
    importance: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    metrics: dict[str, Any] = {}
    try:
        result, metrics = await _run_mail_call_with_metrics(
            mail_service.list_conversations,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            folder=_normalize_text(folder, "inbox"),
            folder_scope=_normalize_text(folder_scope, "current"),
            limit=int(limit),
            offset=int(offset),
            q=_normalize_text(q),
            unread_only=bool(unread_only),
            has_attachments=bool(has_attachments),
            date_from=_normalize_text(date_from),
            date_to=_normalize_text(date_to),
            from_filter=_normalize_text(from_filter),
            to_filter=_normalize_text(to_filter),
            subject_filter=_normalize_text(subject_filter),
            body_filter=_normalize_text(body_filter),
            importance=_normalize_text(importance),
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "conversations",
            request_id,
            started_at,
            user_id=int(current_user.id),
            folder=_normalize_text(folder, "inbox"),
            q_len=len(str(q or "")),
            unread_only=int(bool(unread_only)),
            has_attachments=int(bool(has_attachments)),
            date_from=_normalize_text(date_from) or None,
            date_to=_normalize_text(date_to) or None,
            from_filter=_normalize_text(from_filter) or None,
            to_filter=_normalize_text(to_filter) or None,
            subject_filter=_normalize_text(subject_filter) or None,
            body_filter=_normalize_text(body_filter) or None,
            importance=_normalize_text(importance) or None,
            limit=int(limit),
            offset=int(offset),
            **_mail_metrics_log_context(metrics),
        )


@router.get("/conversations/{conversation_id}")
async def get_mail_conversation(
    request: Request,
    conversation_id: str,
    mailbox_id: str = Query("", min_length=0),
    folder: str = Query("inbox", min_length=1),
    folder_scope: str = Query("current", min_length=1),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    metrics: dict[str, Any] = {}
    try:
        result, metrics = await _run_mail_call_with_metrics(
            mail_service.get_conversation,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            conversation_id=_normalize_text(conversation_id),
            folder=_normalize_text(folder, "inbox"),
            folder_scope=_normalize_text(folder_scope, "current"),
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "conversation",
            request_id,
            started_at,
            user_id=int(current_user.id),
            folder=_normalize_text(folder, "inbox"),
            conversation_id_len=len(str(conversation_id or "")),
            **_mail_metrics_log_context(metrics),
        )


@router.post("/conversations/{conversation_id}/read")
async def mark_mail_conversation_read(
    conversation_id: str,
    payload: ConversationReadStatePayload = Body(default=ConversationReadStatePayload()),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        kwargs = {
            "user_id": int(current_user.id),
            "conversation_id": _normalize_text(conversation_id),
            "folder": _normalize_text(payload.folder, "inbox"),
            "folder_scope": _normalize_text(payload.folder_scope, "current"),
        }
        normalized_mailbox_id = _normalize_text(payload.mailbox_id)
        if normalized_mailbox_id:
            kwargs["mailbox_id"] = normalized_mailbox_id
        result = await _run_mail_call(mail_service.mark_conversation_as_read, **kwargs)
        changed = max(0, int(result.get("changed", 0) or 0)) if isinstance(result, dict) else 0
        if changed:
            await _write_through_mail_read_state(
                user_id=int(current_user.id),
                mailbox_id=normalized_mailbox_id or None,
                unread_delta=-changed,
                is_read=True,
                conversation_id=_normalize_text(conversation_id),
                folder=kwargs["folder"],
            )
            _publish_mail_realtime(
                user_id=int(current_user.id),
                event_type=HUB_MAIL_UNREAD_CHANGED_EVENT,
                conversation_id=conversation_id,
                mailbox_id=normalized_mailbox_id,
                operation="conversation_read",
                unread_delta=-changed,
            )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/conversations/{conversation_id}/unread")
async def mark_mail_conversation_unread(
    conversation_id: str,
    payload: ConversationReadStatePayload = Body(default=ConversationReadStatePayload()),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        kwargs = {
            "user_id": int(current_user.id),
            "conversation_id": _normalize_text(conversation_id),
            "folder": _normalize_text(payload.folder, "inbox"),
            "folder_scope": _normalize_text(payload.folder_scope, "current"),
        }
        normalized_mailbox_id = _normalize_text(payload.mailbox_id)
        if normalized_mailbox_id:
            kwargs["mailbox_id"] = normalized_mailbox_id
        result = await _run_mail_call(mail_service.mark_conversation_as_unread, **kwargs)
        changed = max(0, int(result.get("changed", 0) or 0)) if isinstance(result, dict) else 0
        if changed:
            await _write_through_mail_read_state(
                user_id=int(current_user.id),
                mailbox_id=normalized_mailbox_id or None,
                unread_delta=changed,
                is_read=False,
                conversation_id=_normalize_text(conversation_id),
                folder=kwargs["folder"],
            )
            _publish_mail_realtime(
                user_id=int(current_user.id),
                event_type=HUB_MAIL_UNREAD_CHANGED_EVENT,
                conversation_id=conversation_id,
                mailbox_id=normalized_mailbox_id,
                operation="conversation_unread",
                unread_delta=changed,
            )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.get("/unread-count")
async def get_mail_unread_count(
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    normalized_mailbox_id = _normalize_text(mailbox_id) or None
    if _shared_mail_snapshot_reads_enabled():
        snapshot = await _run_in_mail_executor(
            mail_runtime_snapshot_service.read,
            user_id=int(current_user.id),
            mailbox_id=normalized_mailbox_id,
            snapshot_type="unread",
        )
        payload = snapshot.get("payload") if isinstance(snapshot.get("payload"), dict) else {}
        record_mail_source("snapshot")
        return {
            "unread_count": int(payload.get("unread_count", 0) or 0),
            "state": snapshot.get("state") or "unknown",
            "source": "app_snapshot",
            "as_of": snapshot.get("as_of"),
            "last_error": snapshot.get("last_error") or "",
        }
    try:
        count = await _run_mail_call(
            mail_service.get_unread_count,
            user_id=int(current_user.id),
            mailbox_id=normalized_mailbox_id,
        )
        record_mail_source("exchange")
        return {"unread_count": count, "state": "ok", "source": "exchange", "as_of": None}
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.get("/notifications/feed")
async def get_mail_notifications_feed(
    limit: int = Query(20, ge=1, le=50),
    current_user: User = Depends(get_current_mail_user),
):
    if _shared_mail_snapshot_reads_enabled():
        snapshot = await asyncio.to_thread(
            mail_runtime_snapshot_service.read,
            user_id=int(current_user.id),
            mailbox_id=None,
            snapshot_type="notification_feed",
        )
        if isinstance(snapshot.get("payload"), dict):
            return {
                **snapshot["payload"],
                "state": snapshot.get("state") or "unknown",
                "source": "app_snapshot",
                "as_of": snapshot.get("as_of"),
            }
        return {"items": [], "total_unread": 0, "limit": int(limit), "state": "unknown", "source": "app_snapshot", "as_of": None}
    try:
        return await _run_mail_call(
            mail_service.list_notification_feed,
            user_id=int(current_user.id),
            limit=int(limit),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.get("/preferences")
async def get_mail_preferences(
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(mail_service.get_preferences, user_id=int(current_user.id))
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.patch("/preferences")
async def patch_mail_preferences(
    payload: UpdateMailPreferencesPayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        payload_data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        result = await _run_mail_call(
            mail_service.update_preferences,
            user_id=int(current_user.id),
            payload=payload_data or {},
        )
        await _write_through_mail_preferences(
            user_id=int(current_user.id),
            preferences=result if isinstance(result, dict) else {"preferences": payload_data or {}},
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/send")
async def send_message(
    request: Request,
    payload: SendMessageRequest,
    current_user: User = Depends(get_current_mail_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        return await _run_mail_send_call(
            mail_service.send_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.from_mailbox_id) or None,
            to=payload.to,
            cc=payload.cc or [],
            bcc=payload.bcc or [],
            subject=_normalize_text(payload.subject),
            body=_normalize_text(payload.body),
            is_html=bool(payload.is_html),
            reply_to_message_id=_normalize_text(payload.reply_to_message_id),
            forward_message_id=_normalize_text(payload.forward_message_id),
            draft_id=_normalize_text(payload.draft_id),
            retain_existing_attachments=payload.retain_existing_attachments,
            idempotency_key=_normalize_text(idempotency_key),
        )
    except MailPayloadTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "send",
            request_id,
            started_at,
            user_id=int(current_user.id),
            recipients=len(payload.to or []),
            subject_len=len(str(payload.subject or "")),
        )


@router.get("/messages/{message_id}/attachments/{attachment_ref}")
async def download_message_attachment(
    request: Request,
    message_id: str,
    attachment_ref: str,
    disposition: str = Query("attachment"),
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        filename, content_type, content = await _run_mail_call(
            mail_service.download_attachment,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            message_id=message_id,
            attachment_ref=attachment_ref,
        )
        headers = _build_attachment_download_headers(
            filename=filename,
            content_type=content_type,
            requested_disposition=disposition,
        )
        record_mail_attachment_bytes(len(content or b""))
        return Response(content=content, media_type=content_type, headers=headers)
    except MailServiceError as exc:
        logger.warning(
            "Mail attachment download failed: request_id=%s user_id=%s message_id=%s ref_len=%s error=%s",
            request_id,
            int(current_user.id),
            message_id,
            len(str(attachment_ref or "")),
            str(exc),
        )
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "download_attachment",
            request_id,
            started_at,
            user_id=int(current_user.id),
            message_id_len=len(str(message_id or "")),
            ref_len=len(str(attachment_ref or "")),
        )


@router.get("/messages/{message_id}/attachments/{attachment_ref}/preview")
async def get_message_attachment_preview(
    request: Request,
    message_id: str,
    attachment_ref: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        preview = await _run_mail_call(
            mail_service.get_attachment_preview,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            message_id=message_id,
            attachment_ref=attachment_ref,
        )
        preview_status = _normalize_text(preview.get("status"), "queued").lower()
        if preview_status == "ready":
            return preview
        if preview_status == "failed":
            return JSONResponse(content=preview, status_code=422)
        retry_after_ms = max(100, int(preview.get("retry_after_ms") or 500))
        return JSONResponse(
            content=preview,
            status_code=202,
            headers={"Retry-After": str(max(1, (retry_after_ms + 999) // 1000))},
        )
    except MailServiceError as exc:
        logger.warning(
            "Mail attachment preview failed: request_id=%s user_id=%s message_id=%s ref_len=%s error=%s",
            request_id,
            int(current_user.id),
            message_id,
            len(str(attachment_ref or "")),
            str(exc),
        )
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "attachment_preview_meta",
            request_id,
            started_at,
            user_id=int(current_user.id),
            message_id_len=len(str(message_id or "")),
            ref_len=len(str(attachment_ref or "")),
        )


@router.get("/messages/{message_id}/attachments/{attachment_ref}/preview/pdf")
async def download_message_attachment_preview_pdf(
    request: Request,
    message_id: str,
    attachment_ref: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        preview = await _run_mail_call(
            mail_service.download_attachment_preview_pdf,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            message_id=message_id,
            attachment_ref=attachment_ref,
        )
        preview_status = _normalize_text(preview.get("status"), "queued").lower()
        if preview_status != "ready":
            status_code = 422 if preview_status == "failed" else 202
            headers = {}
            if status_code == 202:
                retry_after_ms = max(100, int(preview.get("retry_after_ms") or 500))
                headers["Retry-After"] = str(max(1, (retry_after_ms + 999) // 1000))
            return JSONResponse(content=preview, status_code=status_code, headers=headers)
        filename = _normalize_text(preview.get("pdf_filename"), "preview.pdf")
        return FileResponse(
            path=str(preview["path"]),
            filename=filename,
            media_type=_PREVIEW_PDF_MEDIA_TYPE,
            content_disposition_type="inline",
            headers=_build_preview_pdf_headers(filename),
        )
    except MailServiceError as exc:
        logger.warning(
            "Mail attachment preview PDF failed: request_id=%s user_id=%s message_id=%s ref_len=%s error=%s",
            request_id,
            int(current_user.id),
            message_id,
            len(str(attachment_ref or "")),
            str(exc),
        )
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "attachment_preview_pdf",
            request_id,
            started_at,
            user_id=int(current_user.id),
            message_id_len=len(str(message_id or "")),
            ref_len=len(str(attachment_ref or "")),
        )


@router.get("/messages/{message_id}/headers")
async def get_mail_message_headers(
    message_id: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.get_message_headers,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            message_id=_normalize_text(message_id),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.get("/messages/{message_id}/eml")
async def download_mail_message_source(
    message_id: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        filename, content = await _run_mail_call(
            mail_service.get_message_source,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            message_id=_normalize_text(message_id),
        )
        headers = {
            "Content-Disposition": _build_content_disposition(filename),
            **_nosniff_headers(),
        }
        return Response(content=content, media_type="message/rfc822", headers=headers)
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/send-multipart")
async def send_message_multipart(
    request: Request,
    from_mailbox_id: str = Form(""),
    to: str = Form(...),
    cc: str = Form(""),
    bcc: str = Form(""),
    subject: str = Form(""),
    body: str = Form(""),
    is_html: bool = Form(True),
    reply_to_message_id: str = Form(""),
    forward_message_id: str = Form(""),
    draft_id: str = Form(""),
    retain_existing_attachments_json: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    inline_files: list[UploadFile] = File(default=[]),
    inline_content_ids_json: str = Form("[]"),
    current_user: User = Depends(get_current_mail_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        attachments = await _read_compose_attachments(
            files=files,
            inline_files=inline_files,
            inline_content_ids_json=inline_content_ids_json,
        )
        
        to_list = [t.strip() for t in to.split(";") if t.strip()]
        cc_list = [t.strip() for t in cc.split(";") if t.strip()]
        bcc_list = [t.strip() for t in bcc.split(";") if t.strip()]
        retain_existing_attachments = None
        if _normalize_text(retain_existing_attachments_json):
            try:
                retain_raw = json.loads(_normalize_text(retain_existing_attachments_json, "[]"))
            except Exception as exc:
                raise MailServiceError("retain_existing_attachments_json must contain valid JSON array") from exc
            if not isinstance(retain_raw, list):
                raise MailServiceError("retain_existing_attachments_json must be a JSON array")
            retain_existing_attachments = [_normalize_text(item) for item in retain_raw if _normalize_text(item)]

        return await _run_mail_send_call(
            mail_service.send_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(from_mailbox_id) or None,
            to=to_list,
            cc=cc_list,
            bcc=bcc_list,
            subject=_normalize_text(subject),
            body=_normalize_text(body),
            is_html=bool(is_html),
            attachments=attachments,
            reply_to_message_id=_normalize_text(reply_to_message_id),
            forward_message_id=_normalize_text(forward_message_id),
            draft_id=_normalize_text(draft_id),
            retain_existing_attachments=retain_existing_attachments,
            idempotency_key=_normalize_text(idempotency_key),
        )
    except MailPayloadTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "send_multipart",
            request_id,
            started_at,
            user_id=int(current_user.id),
            files=len(files or []) + len(inline_files or []),
            recipients=len([t for t in str(to or "").split(";") if t.strip()]),
            subject_len=len(str(subject or "")),
        )


@router.post("/drafts/upsert-multipart")
async def upsert_mail_draft_multipart(
    request: Request,
    from_mailbox_id: str = Form(""),
    draft_id: str = Form(""),
    compose_mode: str = Form("draft"),
    to: str = Form(""),
    cc: str = Form(""),
    bcc: str = Form(""),
    subject: str = Form(""),
    body: str = Form(""),
    is_html: bool = Form(True),
    reply_to_message_id: str = Form(""),
    forward_message_id: str = Form(""),
    retain_existing_attachments_json: str = Form("[]"),
    files: list[UploadFile] = File(default=[]),
    inline_files: list[UploadFile] = File(default=[]),
    inline_content_ids_json: str = Form("[]"),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        attachments = await _read_compose_attachments(
            files=files,
            inline_files=inline_files,
            inline_content_ids_json=inline_content_ids_json,
        )

        try:
            retain_raw = json.loads(_normalize_text(retain_existing_attachments_json, "[]"))
        except Exception as exc:
            raise MailServiceError("retain_existing_attachments_json must contain valid JSON array") from exc
        if not isinstance(retain_raw, list):
            raise MailServiceError("retain_existing_attachments_json must be a JSON array")

        retain_tokens = [_normalize_text(item) for item in retain_raw if _normalize_text(item)]

        return await _run_mail_call(
            mail_service.save_draft,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(from_mailbox_id) or None,
            draft_id=_normalize_text(draft_id),
            compose_mode=_normalize_text(compose_mode, "draft"),
            to=[item.strip() for item in to.split(";") if item.strip()],
            cc=[item.strip() for item in cc.split(";") if item.strip()],
            bcc=[item.strip() for item in bcc.split(";") if item.strip()],
            subject=_normalize_text(subject),
            body=_normalize_text(body),
            is_html=bool(is_html),
            reply_to_message_id=_normalize_text(reply_to_message_id),
            forward_message_id=_normalize_text(forward_message_id),
            retain_existing_attachments=retain_tokens,
            attachments=attachments,
        )
    except MailPayloadTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "draft_upsert_multipart",
            request_id,
            started_at,
            user_id=int(current_user.id),
            files=len(files or []) + len(inline_files or []),
            recipients=len([t for t in str(to or "").split(";") if t.strip()]),
            subject_len=len(str(subject or "")),
        )


@router.delete("/drafts/{draft_id}")
async def delete_mail_draft(
    draft_id: str,
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.delete_draft,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            draft_id=_normalize_text(draft_id),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/send-it-request")
async def send_it_request_message(
    payload: SendItRequestPayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_send_call(
            mail_service.send_it_request,
            user_id=int(current_user.id),
            template_id=_normalize_text(payload.template_id),
            fields=payload.fields or {},
        )
    except MailPayloadTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/send-it-request-multipart")
async def send_it_request_message_multipart(
    request: Request,
    template_id: str = Form(...),
    fields_json: str = Form("{}"),
    files: list[UploadFile] = File(default=[]),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        try:
            parsed_fields = json.loads(_normalize_text(fields_json, "{}"))
        except Exception as exc:
            raise MailServiceError("fields_json must contain valid JSON object") from exc
        if not isinstance(parsed_fields, dict):
            raise MailServiceError("fields_json must be a JSON object")

        attachments: list[tuple[str, bytes]] = []
        for file in files:
            content = await file.read()
            if not content:
                continue
            attachments.append((file.filename or "attachment.bin", content))

        return await _run_mail_send_call(
            mail_service.send_it_request,
            user_id=int(current_user.id),
            template_id=_normalize_text(template_id),
            fields=parsed_fields,
            attachments=attachments,
        )
    except MailPayloadTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "send_it_multipart",
            request_id,
            started_at,
            user_id=int(current_user.id),
            files=len(files or []),
            template_id_len=len(str(template_id or "")),
        )


@router.get("/templates")
async def list_it_templates(
    include_inactive: bool = Query(False),
    _: User = Depends(get_current_mail_user),
):
    return {
        "items": await _run_mail_call(mail_service.list_templates, active_only=not bool(include_inactive)),
    }


@router.post("/templates")
async def create_it_template(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_mail_admin_user),
):
    try:
        return await _run_mail_call(
            mail_service.create_template,
            payload=payload or {},
            actor={
                "id": int(current_user.id),
                "username": _normalize_text(current_user.username),
            },
        )
    except MailServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/templates/{template_id}")
async def update_it_template(
    template_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_mail_admin_user),
):
    try:
        return await _run_mail_call(
            mail_service.update_template,
            template_id=template_id,
            payload=payload or {},
            actor={
                "id": int(current_user.id),
                "username": _normalize_text(current_user.username),
            },
        )
    except MailServiceError as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/templates/{template_id}")
async def delete_it_template(
    template_id: str,
    current_user: User = Depends(get_current_mail_admin_user),
):
    ok = await _run_mail_call(
        mail_service.delete_template,
        template_id=template_id,
        actor={
            "id": int(current_user.id),
            "username": _normalize_text(current_user.username),
        },
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True, "template_id": template_id}


@router.get("/config/me")
async def get_my_mail_config(
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.get_my_config,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.patch("/config/user/{user_id}")
async def patch_user_mail_config(
    user_id: int,
    payload: UpdateMailConfigPayload,
    _: User = Depends(get_current_mail_admin_user),
):
    try:
        payload_data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        return await _run_mail_call(
            mail_service.update_user_config,
            user_id=int(user_id),
            mailbox_id=_normalize_text(payload_data.pop("mailbox_id", "")) or None,
            **payload_data,
        )
    except MailServiceError as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        raise _mail_http_exception(exc, user_id=int(user_id)) from exc


@router.patch("/config/me")
async def patch_my_mail_config(
    payload: UpdateMyMailConfigPayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        payload_data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        return await _run_mail_call(
            mail_service.update_user_config,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload_data.pop("mailbox_id", "")) or None,
            **payload_data,
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/config/me/credentials")
async def post_my_mail_credentials(
    payload: SaveMyMailCredentialsPayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        payload_data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
        return await _run_mail_call(
            mail_service.save_my_credentials,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload_data.pop("mailbox_id", "")) or None,
            **payload_data,
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/test-connection")
async def post_mail_test_connection(
    payload: TestConnectionPayload,
    current_user: User = Depends(get_current_mail_test_user),
):
    target_user_id = int(payload.user_id or current_user.id)
    if target_user_id != int(current_user.id) and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    target_user = user_service.get_by_id(target_user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    if (
        str(target_user.get("auth_source") or "local").strip().lower() == "ldap"
        and target_user_id != int(current_user.id)
    ):
        raise HTTPException(status_code=403, detail="LDAP mailbox connection can only be tested for the current user session")
    try:
        return await _run_mail_call(
            mail_service.test_connection,
            user_id=target_user_id,
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user, user_id=target_user_id) from exc


@router.get("/health")
async def get_mail_health(
    _: User = Depends(get_current_active_user),
):
    return {
        "ok": True,
        "exchange_host": mail_service.exchange_host,
        "ews_url": mail_service.exchange_ews_url,
        "verify_tls": mail_service.verify_tls,
        "tls_ca_bundle_configured": bool(mail_service.tls_ca_bundle),
        "exchange_max_concurrency": _mail_exchange_max_concurrency(),
        "notifications": mail_notification_service.get_runtime_status(),
    }
