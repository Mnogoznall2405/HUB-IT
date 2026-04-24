"""
Mail API for Exchange inbox/sending and IT request templates.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from urllib.parse import quote
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Form, File, UploadFile, Response, Request
from pydantic import BaseModel, Field

from backend.api.deps import ensure_user_permission, get_current_active_user, get_current_admin_user, get_current_session_id
from backend.models.auth import User
from backend.services.authorization_service import PERM_MAIL_ACCESS
from backend.services.request_auth_context_service import pop_request_session_id, push_request_session_id
from backend.services.mail_service import MailPayloadTooLargeError, MailServiceError, mail_service
from backend.services.user_service import user_service


router = APIRouter()
logger = logging.getLogger(__name__)


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


def _request_id_from_headers(request: Request) -> str:
    return _normalize_text(request.headers.get("X-Client-Request-ID"), "-")


async def _run_mail_call(func, /, *args, **kwargs):
    return await asyncio.to_thread(func, *args, **kwargs)


def _run_mail_call_with_metrics_sync(func, args, kwargs):
    request_tokens = mail_service.push_request_context()
    metrics: dict[str, Any] = {}
    try:
        result = func(*args, **kwargs)
        metrics = dict(mail_service.get_request_metrics() or {})
        return result, metrics, None
    except Exception as exc:
        metrics = dict(mail_service.get_request_metrics() or {})
        return None, metrics, exc
    finally:
        mail_service.pop_request_context(request_tokens)


async def _run_mail_call_with_metrics(func, /, *args, **kwargs):
    result, metrics, error = await asyncio.to_thread(_run_mail_call_with_metrics_sync, func, args, kwargs)
    if error is not None:
        raise error
    return result, metrics


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
    resolved_code = mail_service.classify_mail_error_code(resolved_message) or str(getattr(exc, "code", "") or "").strip()
    headers: dict[str, str] = {}
    if resolved_code == "MAIL_AUTH_INVALID":
        if resolved_user_id > 0:
            mail_service.invalidate_saved_password(user_id=resolved_user_id)
        headers["X-Mail-Error-Code"] = "MAIL_AUTH_INVALID"
        return HTTPException(
            status_code=409,
            detail="Пароль корпоративной почты устарел или неверен. Введите новый пароль.",
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
    mailbox_login: str = Field(..., min_length=1)
    mailbox_password: str = Field(..., min_length=1, max_length=256)
    is_primary: bool = Field(default=False)
    is_active: bool = Field(default=True)


class MailboxUpdatePayload(BaseModel):
    label: Optional[str] = None
    mailbox_email: Optional[str] = None
    mailbox_login: Optional[str] = None
    mailbox_password: Optional[str] = None
    is_primary: Optional[bool] = None
    is_active: Optional[bool] = None
    selected: Optional[bool] = None


class UpdateMailPreferencesPayload(BaseModel):
    reading_pane: Optional[str] = None
    density: Optional[str] = None
    mark_read_on_select: Optional[bool] = None
    show_preview_snippets: Optional[bool] = None
    show_favorites_first: Optional[bool] = None


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


@router.get("/bootstrap")
async def get_mail_bootstrap(
    request: Request,
    limit: int = Query(20, ge=10, le=100),
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    metrics: dict[str, Any] = {}
    try:
        result, metrics = await _run_mail_call_with_metrics(
            mail_service.get_bootstrap,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
            folder="inbox",
            folder_scope="current",
            limit=int(limit),
        )
        return result
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc
    finally:
        _log_request_timing(
            "bootstrap",
            request_id,
            started_at,
            user_id=int(current_user.id),
            limit=int(limit),
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
        return {"ok": ok}
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/{message_id}/move")
async def move_mail_message(
    message_id: str,
    payload: MoveMessagePayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.move_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            message_id=message_id,
            target_folder=_normalize_text(payload.target_folder, "inbox"),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/{message_id}/delete")
async def delete_mail_message(
    message_id: str,
    payload: DeleteMessagePayload = Body(default=DeleteMessagePayload()),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.delete_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            message_id=message_id,
            permanent=bool(payload.permanent),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/{message_id}/restore")
async def restore_mail_message(
    message_id: str,
    payload: RestoreMessagePayload = Body(default=RestoreMessagePayload()),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.restore_message,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            message_id=message_id,
            target_folder=_normalize_text(payload.target_folder),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/bulk")
async def bulk_mail_message_action(
    payload: BulkMessageActionPayload,
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.bulk_message_action,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            message_ids=payload.message_ids or [],
            action=_normalize_text(payload.action),
            target_folder=_normalize_text(payload.target_folder),
            permanent=bool(payload.permanent),
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/mark-all-read")
async def mark_all_mail_read(
    payload: MarkAllReadPayload = Body(default=MarkAllReadPayload()),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        return await _run_mail_call(
            mail_service.mark_all_as_read,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(payload.mailbox_id) or None,
            folder=_normalize_text(payload.folder, "inbox"),
            folder_scope=_normalize_text(payload.folder_scope, "current"),
        )
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
        return await _run_mail_call(mail_service.mark_conversation_as_read, **kwargs)
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
        return await _run_mail_call(mail_service.mark_conversation_as_unread, **kwargs)
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.get("/unread-count")
async def get_mail_unread_count(
    mailbox_id: str = Query("", min_length=0),
    current_user: User = Depends(get_current_mail_user),
):
    try:
        count = await _run_mail_call(
            mail_service.get_unread_count,
            user_id=int(current_user.id),
            mailbox_id=_normalize_text(mailbox_id) or None,
        )
        return {"unread_count": count}
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.get("/notifications/feed")
async def get_mail_notifications_feed(
    limit: int = Query(20, ge=1, le=50),
    current_user: User = Depends(get_current_mail_user),
):
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
        return await _run_mail_call(
            mail_service.update_preferences,
            user_id=int(current_user.id),
            payload=payload_data or {},
        )
    except MailServiceError as exc:
        raise _mail_http_exception(exc, current_user=current_user) from exc


@router.post("/messages/send")
async def send_message(
    request: Request,
    payload: SendMessageRequest,
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        return await _run_mail_call(
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
        headers = {
            "Content-Disposition": _build_content_disposition(filename, disposition=disposition),
            "Cache-Control": "private, max-age=300",
        }
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
        headers = {"Content-Disposition": _build_content_disposition(filename)}
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
    files: list[UploadFile] = File(default=[]),
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        attachments = []
        for file in files:
            content = await file.read()
            if content:
                attachments.append((file.filename or "attachment.bin", content))
        
        to_list = [t.strip() for t in to.split(";") if t.strip()]
        cc_list = [t.strip() for t in cc.split(";") if t.strip()]
        bcc_list = [t.strip() for t in bcc.split(";") if t.strip()]

        return await _run_mail_call(
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
            files=len(files or []),
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
    current_user: User = Depends(get_current_mail_user),
):
    started_at = time.perf_counter()
    request_id = _request_id_from_headers(request)
    try:
        attachments: list[tuple[str, bytes]] = []
        for file in files:
            content = await file.read()
            if not content:
                continue
            attachments.append((file.filename or "attachment.bin", content))

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
            files=len(files or []),
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
        return await _run_mail_call(
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

        return await _run_mail_call(
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
    }
