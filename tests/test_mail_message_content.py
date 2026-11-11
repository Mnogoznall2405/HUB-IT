from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_message_content import MailMessageContent, MailMessageContentError


def test_message_content_builds_safe_eml_source_name_and_bytes():
    content = MailMessageContent()
    item = SimpleNamespace(subject="Quarter / Report: Q1", mime_content="From: a@example.com\r\nSubject: Hi\r\n\r\nBody")

    filename, source = content.message_source_payload(item=item)

    assert filename == "Quarter_Report_Q1.eml"
    assert source.endswith(b"Body")


def test_message_content_headers_payload_parses_raw_headers():
    payload = MailMessageContent.message_headers_payload(
        message_id="msg-1",
        source_name="message.eml",
        source=b"From: a@example.com\r\nSubject: Test\r\n\r\nBody",
    )

    assert payload["message_id"] == "msg-1"
    assert payload["source_name"] == "message.eml"
    assert {"name": "Subject", "value": "Test"} in payload["items"]


def test_message_content_rejects_empty_source():
    with pytest.raises(MailMessageContentError, match="Raw message source is not available"):
        MailMessageContent().message_source_payload(item=SimpleNamespace(subject="Empty"))


def test_message_content_attachment_filename_appends_missing_extension():
    assert (
        MailMessageContent.attachment_download_filename(
            "forwarded/message",
            default_name="attached-message",
            preferred_extension=".eml",
        )
        == "forwarded/message.eml"
    )
