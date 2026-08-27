from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.attachment_media import ChatAttachmentMedia  # noqa: E402


def test_sticker_attachment_payload_exposes_shared_static_preview():
    attachment = SimpleNamespace(
        id="attachment-1",
        message_id="message-1",
        media_kind="sticker",
        file_name="sticker-12345678-1234-1234-1234-123456789abc--Office_Pack.tgs",
    )

    assert ChatAttachmentMedia.build_sticker_preview_url(attachment) == (
        "/api/v1/chat/sticker-packs/preview/Office_Pack/"
        "stickers/12345678-1234-1234-1234-123456789abc/preview"
    )


def test_legacy_sticker_uses_its_authenticated_attachment_preview_route():
    regular = SimpleNamespace(media_kind="file", file_name="report.pdf")
    legacy = SimpleNamespace(
        id="attachment-old",
        message_id="message-old",
        media_kind="sticker",
        file_name="sticker-office.tgs",
    )

    assert ChatAttachmentMedia.build_sticker_preview_url(regular) is None
    assert ChatAttachmentMedia.build_sticker_preview_url(legacy) == (
        "/api/v1/chat/messages/message-old/attachments/attachment-old/file"
        "?inline=1&variant=preview"
    )
