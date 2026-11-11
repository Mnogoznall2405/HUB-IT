from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_attachment_download import (
    ATTACHMENT_CONTENT_CACHE_MAX_ENTRY_BYTES,
    MailAttachmentDownload,
    MailAttachmentDownloadError,
    attachment_payload_bytes,
    should_cache_attachment_payload,
)
from backend.services.mail_runtime_cache import MailRuntimeCache
from backend.services.mail_service import MailService


def test_should_cache_office_sized_payload_and_skip_large():
    office = ("report.docx", "application/octet-stream", b"x" * (3 * 1024 * 1024))
    large = ("dump.bin", "application/octet-stream", b"y" * (9 * 1024 * 1024))

    assert attachment_payload_bytes(office) == 3 * 1024 * 1024
    assert should_cache_attachment_payload(
        office,
        max_entry_bytes=ATTACHMENT_CONTENT_CACHE_MAX_ENTRY_BYTES,
    )
    assert not should_cache_attachment_payload(
        large,
        max_entry_bytes=ATTACHMENT_CONTENT_CACHE_MAX_ENTRY_BYTES,
    )
    assert ATTACHMENT_CONTENT_CACHE_MAX_ENTRY_BYTES == 8 * 1024 * 1024


def test_attachment_download_returns_matching_payload():
    item = SimpleNamespace(
        attachments=[
            SimpleNamespace(raw_id="other", payload=("a.txt", "text/plain", b"a")),
            SimpleNamespace(raw_id="att-1", payload=("logo.png", "image/png", b"png")),
        ]
    )
    payload = MailAttachmentDownload().payload_from_item(
        item=item,
        attachment_id="att-1",
        account=object(),
        extract_attachment_id=lambda attachment: attachment.raw_id,
        build_payload=lambda **kwargs: kwargs["attachment"].payload,
    )
    assert payload == ("logo.png", "image/png", b"png")


def test_attachment_download_rejects_missing_and_unsupported():
    downloader = MailAttachmentDownload()
    item = SimpleNamespace(attachments=[SimpleNamespace(raw_id="att-1")])

    with pytest.raises(MailAttachmentDownloadError, match="not supported"):
        downloader.payload_from_item(
            item=item,
            attachment_id="att-1",
            account=object(),
            extract_attachment_id=lambda attachment: attachment.raw_id,
            build_payload=lambda **_kwargs: None,
        )
    with pytest.raises(MailAttachmentDownloadError, match="Attachment not found"):
        downloader.payload_from_item(
            item=SimpleNamespace(attachments=[]),
            attachment_id="att-1",
            account=object(),
            extract_attachment_id=lambda _attachment: "att-1",
            build_payload=lambda **_kwargs: ("x.bin", "application/octet-stream", b"x"),
        )


class _StubDownloadService(MailService):
    def __init__(self, payload):
        self._runtime_cache = MailRuntimeCache()
        self._payload = payload

    def resolve_attachment_id(self, attachment_ref):
        return attachment_ref

    def _resolve_mail_profile(self, **_kwargs):
        return {"mailbox_id": "mailbox-1"}

    def _resolve_mailbox_scope(self, *_args):
        return "mailbox-1"

    def _resolve_mailbox_id_from_message(self, **_kwargs):
        return "mailbox-1"

    def _resolve_mailbox_id_from_attachment(self, **_kwargs):
        return "mailbox-1"

    def _decode_message_ref(self, _message_id):
        return "inbox", "exchange-1", None

    def _resolve_account_context(self, **_kwargs):
        return {"account": object()}

    def _locate_message_item(self, _account, **_kwargs):
        attachment = SimpleNamespace(attachment_id=SimpleNamespace(id="att-1"))
        return object(), "inbox", SimpleNamespace(attachments=[attachment])

    def _extract_attachment_raw_id(self, _attachment):
        return "att-1"

    def _build_attachment_download_payload(self, **_kwargs):
        return self._payload


def test_download_attachment_caches_office_payload_and_skips_large():
    office = ("report.docx", "application/octet-stream", b"x" * (3 * 1024 * 1024))
    large = ("dump.bin", "application/octet-stream", b"y" * (9 * 1024 * 1024))

    office_service = _StubDownloadService(office)
    assert office_service.download_attachment(
        user_id=7,
        mailbox_id="mailbox-1",
        message_id="msg-1",
        attachment_ref="att-1",
    ) == office
    assert office_service._cached_attachment_content(
        user_id=7,
        mailbox_id="mailbox-1",
        message_id="msg-1",
        attachment_id="att-1",
    ) == office

    large_service = _StubDownloadService(large)
    assert large_service.download_attachment(
        user_id=7,
        mailbox_id="mailbox-1",
        message_id="msg-1",
        attachment_ref="att-1",
    ) == large
    assert large_service._cached_attachment_content(
        user_id=7,
        mailbox_id="mailbox-1",
        message_id="msg-1",
        attachment_id="att-1",
    ) is None
