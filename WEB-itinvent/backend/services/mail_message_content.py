from __future__ import annotations

import email.policy
import re
from email.parser import BytesParser
from typing import Any


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


class MailMessageContentError(Exception):
    pass


class MailMessageContent:
    @staticmethod
    def message_mime_content(item: Any) -> bytes:
        mime_content = getattr(item, "mime_content", None)
        if isinstance(mime_content, (bytes, bytearray, memoryview)):
            return bytes(mime_content)
        if isinstance(mime_content, str):
            return mime_content.encode("utf-8", errors="ignore")
        return b""

    @staticmethod
    def is_downloadable_attachment(attachment: Any) -> bool:
        try:
            from exchangelib.attachments import FileAttachment, ItemAttachment
        except Exception:
            return False
        return isinstance(attachment, (FileAttachment, ItemAttachment))

    @staticmethod
    def attachment_download_filename(name: Any, *, default_name: str, preferred_extension: str = "") -> str:
        filename = _normalize_text(name, default_name)
        trimmed = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        if preferred_extension and "." not in trimmed:
            filename = f"{filename}{preferred_extension}"
        return filename

    def build_attachment_download_payload(self, *, attachment: Any, account: Any) -> tuple[str, str, bytes] | None:
        from exchangelib.attachments import FileAttachment, ItemAttachment

        if isinstance(attachment, FileAttachment):
            content = attachment.content
            if not content:
                account.protocol.get_attachments([attachment])
                content = attachment.content
            return (
                self.attachment_download_filename(
                    getattr(attachment, "name", None),
                    default_name="attachment.bin",
                ),
                _normalize_text(getattr(attachment, "content_type", "application/octet-stream")),
                bytes(content or b""),
            )

        if isinstance(attachment, ItemAttachment):
            attached_item = getattr(attachment, "item", None)
            content = self.message_mime_content(attached_item)
            if not content and getattr(attachment, "attachment_id", None) is not None:
                attached_item = attachment.item
                content = self.message_mime_content(attached_item)
            if not content:
                raise MailMessageContentError("Attached item source is not available")
            return (
                self.attachment_download_filename(
                    getattr(attachment, "name", None),
                    default_name="attached-message",
                    preferred_extension=".eml",
                ),
                _normalize_text(getattr(attachment, "content_type", None), "message/rfc822") or "message/rfc822",
                content,
            )

        return None

    def message_source_payload(self, *, item: Any) -> tuple[str, bytes]:
        source = self.message_mime_content(item)
        if not source:
            raise MailMessageContentError("Raw message source is not available")
        subject = _normalize_text(getattr(item, "subject", None), "message")
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", subject).strip("._") or "message"
        return f"{safe_name}.eml", source

    @staticmethod
    def message_headers_payload(*, message_id: str, source_name: str, source: bytes) -> dict[str, Any]:
        parsed = BytesParser(policy=email.policy.default).parsebytes(source)
        return {
            "message_id": message_id,
            "source_name": source_name,
            "items": [{"name": str(name), "value": str(value)} for name, value in parsed.raw_items()],
        }
