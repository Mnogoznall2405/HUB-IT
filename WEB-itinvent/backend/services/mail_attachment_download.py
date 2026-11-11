from __future__ import annotations

from typing import Any, Callable

# Office-sized payloads (~3MB) stay in process cache. Larger downloads skip a
# second RAM copy. RuntimeCachePolicy.max_entry_bytes is the last-resort cap.
ATTACHMENT_CONTENT_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024


class MailAttachmentDownloadError(Exception):
    pass


def attachment_payload_bytes(payload: tuple[str, str, bytes] | None) -> int:
    if not payload:
        return 0
    content = payload[2] if len(payload) > 2 else b""
    if isinstance(content, (bytes, bytearray, memoryview)):
        return len(content)
    return 0


def should_cache_attachment_payload(
    payload: tuple[str, str, bytes] | None,
    *,
    max_entry_bytes: int | None,
) -> bool:
    if payload is None:
        return False
    if max_entry_bytes is None:
        return True
    return attachment_payload_bytes(payload) <= int(max_entry_bytes)


class MailAttachmentDownload:
    def payload_from_item(
        self,
        *,
        item: Any,
        attachment_id: str,
        account: Any,
        extract_attachment_id: Callable[[Any], str],
        build_payload: Callable[..., tuple[str, str, bytes] | None],
    ) -> tuple[str, str, bytes]:
        for attachment in getattr(item, "attachments", []) or []:
            if extract_attachment_id(attachment) != attachment_id:
                continue
            payload = build_payload(attachment=attachment, account=account)
            if payload is None:
                raise MailAttachmentDownloadError(
                    f"Attachment type is not supported for download: {type(attachment).__name__}"
                )
            return payload
        raise MailAttachmentDownloadError(f"Attachment not found: {attachment_id}")
