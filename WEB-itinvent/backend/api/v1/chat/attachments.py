"""Chat attachment download and preview endpoints."""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse, JSONResponse

from backend.api.deps import require_permission
from backend.api.v1.chat._shim import chat_api
from backend.chat.schemas import ChatMessageReadsResponse
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ

router = APIRouter()
_IMMUTABLE_STICKER_CACHE_HEADERS = {
    "Cache-Control": "private, max-age=31536000, immutable",
}

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
    headers = (
        _IMMUTABLE_STICKER_CACHE_HEADERS
        if str(attachment.get("media_kind") or "").strip().lower() == "sticker"
        else None
    )
    return FileResponse(
        path=attachment["path"],
        filename=attachment["file_name"],
        media_type=attachment["mime_type"],
        content_disposition_type="inline" if inline else "attachment",
        headers=headers,
    )


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


