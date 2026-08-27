from __future__ import annotations

import sys
from pathlib import Path
import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1.mail import _parse_inline_content_ids, _read_compose_attachments
from backend.services.mail_outgoing_attachment import MailOutgoingAttachment
from backend.services.mail_service import MailPayloadTooLargeError, MailServiceError, MailService


class FakeUpload:
    def __init__(self, name: str, content_type: str, content: bytes):
        self.filename = name
        self.content_type = content_type
        self._content = content

    async def read(self):
        return self._content


@pytest.mark.asyncio
async def test_reads_regular_and_inline_multipart_attachments_with_metadata():
    attachments = await _read_compose_attachments(
        files=[FakeUpload("report.pdf", "application/pdf", b"pdf")],
        inline_files=[FakeUpload("paste.png", "image/png", b"png")],
        inline_content_ids_json='["hubit-inline-1@hubit.local"]',
    )

    assert attachments == [
        MailOutgoingAttachment("report.pdf", b"pdf", "application/pdf"),
        MailOutgoingAttachment(
            "paste.png",
            b"png",
            "image/png",
            "hubit-inline-1@hubit.local",
            True,
        ),
    ]


@pytest.mark.asyncio
async def test_rejects_inline_array_mismatch_and_unsafe_mime_or_content_id():
    with pytest.raises(MailServiceError, match="same length"):
        await _read_compose_attachments(
            files=[],
            inline_files=[FakeUpload("paste.png", "image/png", b"png")],
            inline_content_ids_json="[]",
        )
    with pytest.raises(MailServiceError, match="safe image"):
        await _read_compose_attachments(
            files=[],
            inline_files=[FakeUpload("image.svg", "image/svg+xml", b"svg")],
            inline_content_ids_json='["safe-id"]',
        )
    with pytest.raises(MailServiceError, match="safe image"):
        await _read_compose_attachments(
            files=[],
            inline_files=[FakeUpload("image.svg", "image/png", b"not-really-png")],
            inline_content_ids_json='["safe-id"]',
        )
    with pytest.raises(MailServiceError, match="Content-ID"):
        _parse_inline_content_ids('["bad id<script>"]', expected_count=1)


def test_inline_and_regular_files_share_existing_outgoing_limits():
    attachments = [
        MailOutgoingAttachment("regular.txt", b"a"),
        MailOutgoingAttachment("inline.png", b"b", "image/png", "inline-1", True),
    ]

    with pytest.raises(MailPayloadTooLargeError, match="Maximum is 1"):
        MailService._validate_attachments_limits(
            attachments,
            max_files=1,
            max_file_size=10,
            max_total_size=10,
        )
