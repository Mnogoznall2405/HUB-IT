"""Helpers to load chat attachments and run shared.doc_convert for AI chat."""

from __future__ import annotations

import io
import mimetypes
import re
from pathlib import Path
from typing import Any

from fastapi import UploadFile
from sqlalchemy import select

from backend.chat.models import ChatMessage, ChatMessageAttachment
from backend.chat.db import chat_session
from backend.chat.service import chat_service
from shared.doc_convert import ConvertSource, DocConvertError, convert_sources, export_markdown
from shared.doc_convert.exporters import DOC_CONVERT_FORMATS, normalize_export_format
from shared.doc_convert.structure import signatures_from_payload, signatures_to_payload


_FORMAT_HINTS = (
    (re.compile(r"\b(docx|word|ворд)\b", re.IGNORECASE), "docx"),
    (re.compile(r"\b(xlsx|excel|эксел[ь]?)\b", re.IGNORECASE), "xlsx"),
    (re.compile(r"\b(markdown|md)\b", re.IGNORECASE), "md"),
    (re.compile(r"\b(pdf)\b", re.IGNORECASE), "pdf"),
    (re.compile(r"\b(txt|текст|text)\b", re.IGNORECASE), "txt"),
)


def detect_format_from_text(text: object) -> str | None:
    raw = str(text or "").strip()
    if not raw:
        return None
    for pattern, fmt in _FORMAT_HINTS:
        if pattern.search(raw):
            return fmt
    return None


def load_convert_sources_for_message(
    *,
    conversation_id: str,
    message_id: str,
    include_reply: bool = True,
) -> list[ConvertSource]:
    normalized_conversation_id = str(conversation_id or "").strip()
    normalized_message_id = str(message_id or "").strip()
    if not normalized_conversation_id or not normalized_message_id:
        return []

    message_ids: list[str] = [normalized_message_id]
    with chat_session() as session:
        trigger = session.get(ChatMessage, normalized_message_id)
        if trigger is None:
            return []
        if include_reply:
            reply_id = str(getattr(trigger, "reply_to_message_id", "") or "").strip()
            if reply_id:
                message_ids.append(reply_id)
        rows = list(
            session.execute(
                select(ChatMessageAttachment)
                .where(ChatMessageAttachment.conversation_id == normalized_conversation_id)
                .where(ChatMessageAttachment.message_id.in_(message_ids))
                .order_by(ChatMessageAttachment.created_at.asc())
            ).scalars()
        )

    sources: list[ConvertSource] = []
    for attachment in rows:
        storage_name = str(getattr(attachment, "storage_name", "") or "").strip()
        file_name = str(getattr(attachment, "file_name", "") or storage_name or "document").strip()
        mime_type = str(getattr(attachment, "mime_type", "") or "").strip()
        if not mime_type:
            mime_type = mimetypes.guess_type(file_name)[0] or ""
        try:
            path = chat_service._resolve_attachment_path(
                conversation_id=normalized_conversation_id,
                storage_name=storage_name,
            )
            data = Path(path).read_bytes()
        except Exception:
            continue
        if not data:
            continue
        sources.append(ConvertSource(file_name=file_name, data=data, mime_type=mime_type))
    return sources


def convert_attachments_to_markdown(
    *,
    conversation_id: str,
    message_id: str,
    include_reply: bool = True,
    vision_fn=None,
    vision_json_fn=None,
) -> dict[str, Any]:
    sources = load_convert_sources_for_message(
        conversation_id=conversation_id,
        message_id=message_id,
        include_reply=include_reply,
    )
    if not sources:
        raise DocConvertError("Прикрепите PDF или изображение для конвертации")
    # Chat converter: max fidelity — always vision over page images + structured JSON layout.
    document = convert_sources(
        sources,
        vision_fn=vision_fn,
        vision_json_fn=vision_json_fn,
        force_vision=True,
        high_fidelity=True,
    )
    return {
        "markdown": document.markdown,
        "source_names": list(document.source_names),
        "warnings": list(document.warnings),
        "table_count": int(document.table_count),
        "page_count": int(document.page_count),
        "used_vision": bool(document.used_vision),
        "formats": list(DOC_CONVERT_FORMATS),
        "title": Path(document.source_names[0]).stem if document.source_names else "document",
        "structure_pages": list(document.structure_pages or []),
        "signatures": signatures_to_payload(list(document.signatures or [])),
        "high_fidelity": True,
        "verify_fidelity": float(getattr(document, "verify_fidelity", 0.0) or 0.0),
    }


def export_converted_markdown(
    *,
    markdown: str,
    export_format: object,
    source_name: str = "document",
    title: str = "",
    structure_pages: list[dict[str, Any]] | None = None,
    signatures: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    signature_crops = signatures_from_payload(list(signatures or []))
    return export_markdown(
        markdown,
        export_format=normalize_export_format(export_format),
        source_name=source_name,
        title=title,
        structure_pages=list(structure_pages or []),
        signatures=signature_crops,
    )


def build_upload_from_export(exported: dict[str, Any]) -> UploadFile:
    content = exported.get("content") or b""
    file_name = str(exported.get("file_name") or "document.bin")
    mime_type = str(exported.get("mime_type") or "application/octet-stream")
    buffer = io.BytesIO(bytes(content))
    upload = UploadFile(file=buffer, filename=file_name)
    try:
        upload.headers = {"content-type": mime_type}  # type: ignore[attr-defined]
    except Exception:
        pass
    return upload
