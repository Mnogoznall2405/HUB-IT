"""Chat attachment download and preview endpoints."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response

from backend.api.deps import require_permission
from backend.chat.schemas import ChatMessageReadsResponse
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_READ

router = APIRouter()

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
    return FileResponse(
        path=attachment["path"],
        filename=attachment["file_name"],
        media_type=attachment["mime_type"],
        content_disposition_type="inline" if inline else "attachment",
    )


def _build_chat_attachment_content_disposition(filename: str, disposition: str = "attachment") -> str:
    safe_name = str(filename or "attachment.bin").replace('"', "'")
    return f'{disposition}; filename="{safe_name}"'


@router.get("/messages/{message_id}/attachments/{attachment_id}/preview")
async def get_chat_attachment_preview(
    message_id: str,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        return await chat_api()._run_chat_call(
            chat_api().chat_service.get_attachment_preview,
            current_user_id=int(current_user.id),
            message_id=message_id,
            attachment_id=attachment_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/messages/{message_id}/attachments/{attachment_id}/preview/pdf")
async def download_chat_attachment_preview_pdf(
    message_id: str,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    try:
        filename, content = await chat_api()._run_chat_call(
            chat_api().chat_service.download_attachment_preview_pdf,
            current_user_id=int(current_user.id),
            message_id=message_id,
            attachment_id=attachment_id,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)
    headers = {
        "Content-Disposition": _build_chat_attachment_content_disposition(filename, disposition="inline"),
        "Cache-Control": "private, max-age=300",
    }
    return Response(content=content, media_type="application/pdf", headers=headers)


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


