"""Chat attachment download and preview endpoints."""
from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse

from backend.api.deps import ensure_user_permission, require_permission
from backend.api.v1.chat._shim import chat_api
from backend.chat.schemas import ChatMessageReadsResponse
from backend.models.auth import User
from backend.models.my_files import MyFileResponse
from backend.services.authorization_service import PERM_CHAT_READ, PERM_MY_FILES_WRITE
from backend.services.my_files_service import (
    DEFAULT_RETENTION_DAYS,
    MAX_FILE_SIZE_BYTES,
    MyFilesRequestMeta,
    my_files_service,
)
from backend.utils.request_network import build_request_network_context

router = APIRouter()
_IMMUTABLE_STICKER_CACHE_HEADERS = {
    "Cache-Control": "private, max-age=31536000, immutable",
}
_SAFE_INLINE_MIME_TYPES = {
    "application/pdf", "text/plain", "text/csv", "text/tab-separated-values",
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp",
    "video/mp4", "video/webm", "video/quicktime", "video/x-m4v",
    "audio/ogg", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/aac",
    "audio/mp4", "audio/webm", "audio/flac", "audio/x-flac", "audio/opus",
}


def _save_attachment_to_my_files(
    *,
    attachment: dict,
    current_user: User,
    retention_days: int,
    meta: MyFilesRequestMeta,
) -> dict:
    source_path = Path(str(attachment.get("path") or "")).resolve()
    if not source_path.is_file():
        raise LookupError("Attachment file not found")
    file_size = int(source_path.stat().st_size)
    if file_size <= 0:
        raise ValueError("Attachment file is empty")
    if file_size > MAX_FILE_SIZE_BYTES:
        raise ValueError("Attachment exceeds My Files size limit")

    file_name = str(attachment.get("file_name") or source_path.name or "attachment.bin")
    mime_type = str(attachment.get("mime_type") or "application/octet-stream")
    spool_path = my_files_service.new_spool_path(file_name)
    reserved_file_id = ""
    try:
        reserved = my_files_service.reserve_upload(
            actor=current_user,
            original_file_name=file_name,
            mime_type=mime_type,
            spool_path=spool_path,
            expected_size_bytes=file_size,
            retention_days=retention_days,
            meta=meta,
        )
        reserved_file_id = str(reserved["id"])
        spool_path.parent.mkdir(parents=True, exist_ok=True)
        with source_path.open("rb") as source, spool_path.open("xb") as target:
            shutil.copyfileobj(source, target, length=1024 * 1024)
        actual_size = int(spool_path.stat().st_size)
        if actual_size != file_size:
            raise ValueError("Attachment changed while it was being saved")
        return my_files_service.complete_upload(
            file_id=reserved_file_id,
            user_id=int(current_user.id),
            actual_size_bytes=actual_size,
            actor=current_user,
            meta=meta,
        )
    except BaseException:
        spool_path.unlink(missing_ok=True)
        if reserved_file_id:
            try:
                my_files_service.abort_upload(
                    file_id=reserved_file_id,
                    user_id=int(current_user.id),
                    error_text="Saving chat attachment was interrupted",
                    actor=current_user,
                    meta=meta,
                )
            except Exception:
                pass
        raise

@router.get("/messages/{message_id}/attachments/{attachment_id}/file")
async def download_chat_attachment(
    message_id: str,
    attachment_id: str,
    inline: bool = Query(False),
    variant: Optional[str] = Query(None),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        attachment = await chat_api()._run_chat_call(
            chat_api().chat_service.get_attachment_for_download,
            current_user_id=int(current_user.id),
            message_id=message_id,
            attachment_id=attachment_id,
            variant=variant,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    headers = {"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"}
    if str(attachment.get("media_kind") or "").strip().lower() == "sticker":
        headers.update(_IMMUTABLE_STICKER_CACHE_HEADERS)
    mime_type = str(attachment.get("mime_type") or "application/octet-stream").split(";", 1)[0].strip().lower()
    return FileResponse(
        path=attachment["path"],
        filename=attachment["file_name"],
        media_type=mime_type,
        content_disposition_type="inline" if inline and mime_type in _SAFE_INLINE_MIME_TYPES else "attachment",
        headers=headers,
    )


@router.post(
    "/messages/{message_id}/attachments/{attachment_id}/save-to-my-files",
    response_model=MyFileResponse,
    status_code=status.HTTP_201_CREATED,
)
async def save_chat_attachment_to_my_files(
    message_id: str,
    attachment_id: str,
    request: Request,
    retention_days: int = Query(DEFAULT_RETENTION_DAYS),
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
) -> dict:
    """Queue an authorized chat attachment through the regular My Files pipeline."""
    ensure_user_permission(current_user, PERM_MY_FILES_WRITE)
    try:
        attachment = await chat_api()._run_chat_call(
            chat_api().chat_service.get_attachment_for_download,
            current_user_id=int(current_user.id),
            message_id=message_id,
            attachment_id=attachment_id,
        )
        network_context = build_request_network_context(request)
        return await run_in_threadpool(
            _save_attachment_to_my_files,
            attachment=attachment,
            current_user=current_user,
            retention_days=retention_days,
            meta=MyFilesRequestMeta(
                ip_address=network_context.client_ip,
                user_agent=str(request.headers.get("user-agent") or ""),
            ),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


def _build_chat_attachment_content_disposition(filename: str, disposition: str = "attachment") -> str:
    """Build Content-Disposition safe for Starlette (latin-1 headers) + UTF-8 filename*."""
    source = str(filename or "attachment.bin").replace("\r", " ").replace("\n", " ").strip() or "attachment.bin"
    normalized_disposition = "inline" if str(disposition or "").strip().lower() == "inline" else "attachment"
    ascii_fallback = source.encode("ascii", "ignore").decode("ascii")
    ascii_fallback = re.sub(r'[";\\]+', "_", ascii_fallback).strip(" .")
    if not ascii_fallback:
        ascii_fallback = "attachment.bin"
    encoded = quote(source, safe="")
    return f"{normalized_disposition}; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded}"


@router.get("/messages/{message_id}/attachments/{attachment_id}/preview")
async def get_chat_attachment_preview(
    message_id: str,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        preview = await chat_api()._run_chat_call(
            chat_api().chat_service.get_attachment_preview,
            current_user_id=int(current_user.id),
            message_id=message_id,
            attachment_id=attachment_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    status = str(preview.get("status") or "queued").strip().lower()
    if status == "ready":
        return preview
    if status == "failed":
        return JSONResponse(content=preview, status_code=422)
    retry_after_ms = max(100, int(preview.get("retry_after_ms") or 500))
    return JSONResponse(
        content=preview,
        status_code=202,
        headers={"Retry-After": str(max(1, (retry_after_ms + 999) // 1000))},
    )


@router.get("/messages/{message_id}/attachments/{attachment_id}/preview/pdf")
async def download_chat_attachment_preview_pdf(
    message_id: str,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        preview = await chat_api()._run_chat_call(
            chat_api().chat_service.download_attachment_preview_pdf,
            current_user_id=int(current_user.id),
            message_id=message_id,
            attachment_id=attachment_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    status = str(preview.get("status") or "queued").strip().lower()
    if status != "ready":
        status_code = 422 if status == "failed" else 202
        headers = {}
        if status_code == 202:
            retry_after_ms = max(100, int(preview.get("retry_after_ms") or 500))
            headers["Retry-After"] = str(max(1, (retry_after_ms + 999) // 1000))
        return JSONResponse(content=preview, status_code=status_code, headers=headers)
    filename = str(preview.get("pdf_filename") or "attachment.pdf")
    headers = {
        "Content-Disposition": _build_chat_attachment_content_disposition(filename, disposition="inline"),
        "Cache-Control": "private, max-age=300",
    }
    return FileResponse(
        path=str(preview["path"]),
        filename=filename,
        media_type="application/pdf",
        content_disposition_type="inline",
        headers=headers,
    )


@router.get("/messages/{message_id}/reads", response_model=ChatMessageReadsResponse)
async def get_chat_message_reads(
    message_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.get_message_reads,
            current_user_id=int(current_user.id),
            message_id=message_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


