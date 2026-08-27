from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator


@dataclass(frozen=True)
class MailOutgoingAttachment:
    filename: str
    content: bytes
    content_type: str = ""
    content_id: str = ""
    is_inline: bool = False

    def __iter__(self) -> Iterator[Any]:
        """Keep legacy tuple-unpacking consumers compatible."""
        yield self.filename
        yield self.content


def coerce_outgoing_attachment(value: Any) -> MailOutgoingAttachment:
    if isinstance(value, MailOutgoingAttachment):
        return value
    filename, content = value
    return MailOutgoingAttachment(
        filename=str(filename or "attachment.bin").strip() or "attachment.bin",
        content=bytes(content or b""),
    )


def exchange_attachment_kwargs(value: Any) -> dict[str, Any]:
    attachment = coerce_outgoing_attachment(value)
    payload: dict[str, Any] = {
        "name": attachment.filename,
        "content": attachment.content,
    }
    if attachment.content_type:
        payload["content_type"] = attachment.content_type
    if attachment.content_id:
        payload["content_id"] = attachment.content_id
    if attachment.is_inline:
        payload["is_inline"] = True
    return payload
