from __future__ import annotations

import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_service import MailPayloadTooLargeError, MailService, referenced_inline_content_ids
from backend.services.mail_outgoing_attachment import MailOutgoingAttachment


class ForwardAttachmentService(MailService):
    def __init__(self) -> None:
        pass

    @staticmethod
    def _is_downloadable_attachment(attachment):
        return bool(getattr(attachment, "downloadable", False))

    @staticmethod
    def _build_attachment_download_payload(*, attachment, account):
        return getattr(attachment, "payload", None)


def _summary(attachments):
    return [
        (
            item.filename,
            item.content,
            item.content_type,
            item.content_id,
            item.is_inline,
        )
        for item in attachments
    ]


def _forward_item():
    return SimpleNamespace(
        attachments=[
            SimpleNamespace(
                id="att-report",
                name="report.xlsx",
                downloadable=True,
                payload=("report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b"xlsx"),
            ),
            SimpleNamespace(
                id="att-with-cid-pdf",
                name="with-cid.pdf",
                content_id="<pdf-cid>",
                content_type="application/pdf",
                downloadable=True,
                payload=("with-cid.pdf", "application/pdf", b"pdf-cid"),
            ),
            SimpleNamespace(
                id="att-inline-flagged-pdf",
                name="inline-flagged.pdf",
                content_id="<inline-pdf>",
                content_type="application/pdf",
                is_inline=True,
                downloadable=True,
                payload=("inline-flagged.pdf", "application/pdf", b"pdf-inline"),
            ),
            SimpleNamespace(
                id="att-logo",
                name="logo.png",
                content_id="<logo>",
                content_type="image/png",
                downloadable=True,
                payload=("logo.png", "image/png", b"png"),
            ),
            SimpleNamespace(
                id="att-signature",
                name="embedded-signature.png",
                content_type="image/png",
                is_inline=True,
                downloadable=True,
                payload=("embedded-signature.png", "image/png", b"png"),
            ),
            SimpleNamespace(id="att-unsupported", name="unsupported.bin", downloadable=False),
        ],
    )


def test_referenced_inline_content_ids_handles_cid_variants():
    body = (
        '<p><img src="cid:Logo@Example"></p>'
        '<div style="background:url(cid:<bg-image>)"></div>'
        '<p><img src="cid:plain"></p>'
    )

    assert referenced_inline_content_ids(body) == {
        "logo@example",
        "bg-image",
        "plain",
    }


def test_collect_forwarded_attachments_keeps_regular_files_and_skips_unused_inline_images():
    service = ForwardAttachmentService()
    account = object()

    assert _summary(service._collect_forwarded_attachments(item=_forward_item(), account=account)) == [
        (
            "report.xlsx",
            b"xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "",
            False,
        ),
        ("with-cid.pdf", b"pdf-cid", "application/pdf", "", False),
        ("inline-flagged.pdf", b"pdf-inline", "application/pdf", "", False),
        ("logo.png", b"png", "image/png", "", False),
    ]


def test_collect_forwarded_attachments_embeds_images_referenced_by_content_id():
    service = ForwardAttachmentService()
    account = object()
    body = '<p>See <img src="cid:logo" /> and <img src="cid:inline-pdf" /></p>'

    attachments = service._collect_forwarded_attachments(
        item=_forward_item(),
        account=account,
        body_html=body,
    )

    assert _summary(attachments) == [
        (
            "report.xlsx",
            b"xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "",
            False,
        ),
        ("with-cid.pdf", b"pdf-cid", "application/pdf", "", False),
        ("inline-flagged.pdf", b"pdf-inline", "application/pdf", "inline-pdf", True),
        ("logo.png", b"png", "image/png", "logo", True),
    ]
    assert all(isinstance(item, MailOutgoingAttachment) for item in attachments)


def test_collect_forwarded_attachments_inline_only_keeps_only_referenced_parts():
    service = ForwardAttachmentService()
    account = object()

    attachments = service._collect_forwarded_attachments(
        item=_forward_item(),
        account=account,
        body_html='<p><img src="cid:logo" /></p>',
        inline_only=True,
    )

    assert _summary(attachments) == [
        ("logo.png", b"png", "image/png", "logo", True),
    ]


def test_collect_forwarded_attachments_allowlist_keeps_selected_files_and_referenced_inline():
    service = ForwardAttachmentService()
    account = object()

    attachments = service._collect_forwarded_attachments(
        item=_forward_item(),
        account=account,
        body_html='<p><img src="cid:logo" /></p>',
        retain_attachment_ids={"att-with-cid-pdf"},
    )

    assert _summary(attachments) == [
        ("with-cid.pdf", b"pdf-cid", "application/pdf", "", False),
        ("logo.png", b"png", "image/png", "logo", True),
    ]


def test_collect_forwarded_attachments_empty_allowlist_keeps_only_referenced_inline():
    service = ForwardAttachmentService()
    account = object()

    attachments = service._collect_forwarded_attachments(
        item=_forward_item(),
        account=account,
        body_html='<p><img src="cid:inline-pdf" /></p>',
        retain_attachment_ids=set(),
    )

    assert _summary(attachments) == [
        ("inline-flagged.pdf", b"pdf-inline", "application/pdf", "inline-pdf", True),
    ]


def test_collect_forwarded_attachments_skips_duplicate_reserved_content_ids():
    service = ForwardAttachmentService()
    account = object()

    attachments = service._collect_forwarded_attachments(
        item=_forward_item(),
        account=account,
        body_html='<p><img src="cid:logo" /></p>',
        reserved_content_ids=["logo"],
    )

    assert _summary(attachments) == [
        (
            "report.xlsx",
            b"xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "",
            False,
        ),
        ("with-cid.pdf", b"pdf-cid", "application/pdf", "", False),
        ("inline-flagged.pdf", b"pdf-inline", "application/pdf", "", False),
    ]


def test_send_message_adds_source_message_attachments_when_forwarding(monkeypatch):
    created_messages = []

    class FakeHTMLBody(str):
        pass

    class FakeMailbox:
        def __init__(self, *, email_address):
            self.email_address = email_address

    class FakeFileAttachment:
        def __init__(self, *, name, content, content_type="", content_id="", is_inline=False):
            self.name = name
            self.content = content
            self.content_type = content_type
            self.content_id = content_id
            self.is_inline = is_inline

    class FakeMessage:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.attachments = []
            self.id = "sent-exchange-id"
            created_messages.append(self)

        def attach(self, attachment):
            self.attachments.append(attachment)

        def send_and_save(self):
            self.sent = True

    exchangelib = types.ModuleType("exchangelib")
    exchangelib.HTMLBody = FakeHTMLBody
    exchangelib.Mailbox = FakeMailbox
    exchangelib.Message = FakeMessage
    exchangelib_attachments = types.ModuleType("exchangelib.attachments")
    exchangelib_attachments.FileAttachment = FakeFileAttachment
    monkeypatch.setitem(sys.modules, "exchangelib", exchangelib)
    monkeypatch.setitem(sys.modules, "exchangelib.attachments", exchangelib_attachments)

    forward_item = SimpleNamespace(
        message_id="<forward-source@example.com>",
        attachments=[
            SimpleNamespace(
                name="source.pdf",
                downloadable=True,
                payload=("source.pdf", "application/pdf", b"source-pdf"),
            ),
        ],
    )
    forward_folder = SimpleNamespace(get=lambda *, id: forward_item)
    validation_lengths = []

    class Service(ForwardAttachmentService):
        def _validate_outgoing_attachments_dynamic(self, attachments):
            validation_lengths.append(len(list(attachments or [])))

        def _resolve_outbound_mailbox_id(self, **kwargs):
            return kwargs.get("mailbox_id") or "mb-1"

        def _resolve_mail_profile(self, **kwargs):
            return {
                "mailbox_id": "mb-1",
                "email": "user@example.com",
                "login": "user@example.com",
                "password": "secret",
                "signature": "",
                "user": {"id": 100, "username": "mail-user"},
            }

        def _create_account(self, **kwargs):
            return SimpleNamespace(sent="sent-folder", protocol=object())

        def _decode_message_id(self, message_id):
            assert message_id == "encoded-forward"
            return "inbox", "forward-exchange-id"

        def _resolve_folder(self, account, folder_key):
            assert folder_key == "inbox"
            return forward_folder, folder_key

        @staticmethod
        def _item_message_id(item):
            return item.message_id

        @staticmethod
        def _log_message(**kwargs):
            return None

        @staticmethod
        def invalidate_user_cache(**kwargs):
            return None

    result = Service().send_message(
        user_id=100,
        mailbox_id="mb-1",
        to=["target@example.com"],
        cc=[],
        bcc=[],
        subject="Fwd: Source",
        body="<p>See attached</p>",
        is_html=True,
        attachments=[("manual.txt", b"manual")],
        forward_message_id="encoded-forward",
    )

    assert result["ok"] is True
    assert [attachment.name for attachment in created_messages[0].attachments] == [
        "manual.txt",
        "source.pdf",
    ]
    assert validation_lengths == [1, 2]


def test_send_message_retains_selected_draft_attachments(monkeypatch):
    created_messages = []
    deleted_drafts = []

    class FakeHTMLBody(str):
        pass

    class FakeMailbox:
        def __init__(self, *, email_address):
            self.email_address = email_address

    class FakeFileAttachment:
        def __init__(self, *, name, content, content_type="", content_id="", is_inline=False):
            self.name = name
            self.content = content
            self.content_type = content_type
            self.content_id = content_id
            self.is_inline = is_inline

    class FakeMessage:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.attachments = []
            self.id = "sent-exchange-id"
            created_messages.append(self)

        def attach(self, attachment):
            self.attachments.append(attachment)

        def send_and_save(self):
            self.sent = True

    exchangelib = types.ModuleType("exchangelib")
    exchangelib.HTMLBody = FakeHTMLBody
    exchangelib.Mailbox = FakeMailbox
    exchangelib.Message = FakeMessage
    exchangelib_attachments = types.ModuleType("exchangelib.attachments")
    exchangelib_attachments.FileAttachment = FakeFileAttachment
    monkeypatch.setitem(sys.modules, "exchangelib", exchangelib)
    monkeypatch.setitem(sys.modules, "exchangelib.attachments", exchangelib_attachments)

    draft_item = SimpleNamespace(
        attachments=[
            SimpleNamespace(
                attachment_id=SimpleNamespace(id="keep-id"),
                name="keep.pdf",
                downloadable=True,
                payload=("keep.pdf", "application/pdf", b"keep-pdf"),
            ),
            SimpleNamespace(
                attachment_id=SimpleNamespace(id="drop-id"),
                name="drop.pdf",
                downloadable=True,
                payload=("drop.pdf", "application/pdf", b"drop-pdf"),
            ),
        ],
    )
    draft_folder = SimpleNamespace(get=lambda *, id: draft_item)

    class Service(ForwardAttachmentService):
        def _validate_outgoing_attachments_dynamic(self, attachments):
            return None

        def _resolve_outbound_mailbox_id(self, **kwargs):
            return kwargs.get("mailbox_id") or "mb-1"

        def _resolve_mail_profile(self, **kwargs):
            return {
                "mailbox_id": "mb-1",
                "email": "user@example.com",
                "login": "user@example.com",
                "password": "secret",
                "signature": "",
                "user": {"id": 100, "username": "mail-user"},
            }

        def _create_account(self, **kwargs):
            return SimpleNamespace(sent="sent-folder", protocol=object())

        def _decode_message_id(self, message_id):
            assert message_id == "encoded-draft"
            return "drafts", "draft-exchange-id"

        def _resolve_folder(self, account, folder_key):
            assert folder_key == "drafts"
            return draft_folder, folder_key

        def delete_draft(self, **kwargs):
            deleted_drafts.append(kwargs)
            return {"ok": True}

        @staticmethod
        def _log_message(**kwargs):
            return None

        @staticmethod
        def invalidate_user_cache(**kwargs):
            return None

    result = Service().send_message(
        user_id=100,
        mailbox_id="mb-1",
        to=["target@example.com"],
        cc=[],
        bcc=[],
        subject="Draft with file",
        body="<p>Body</p>",
        is_html=True,
        draft_id="encoded-draft",
        retain_existing_attachments=["keep-id"],
    )

    assert result["ok"] is True
    assert [attachment.name for attachment in created_messages[0].attachments] == ["keep.pdf"]
    assert deleted_drafts[0]["draft_id"] == "encoded-draft"


def test_inline_forwarded_images_do_not_consume_regular_file_slots():
    service = ForwardAttachmentService()
    regular = [
        MailOutgoingAttachment(filename=f"file-{index}.txt", content=b"x", content_type="text/plain")
        for index in range(10)
    ]
    inline = [
        MailOutgoingAttachment(
            filename=f"image-{index}.png",
            content=b"x",
            content_type="image/png",
            content_id=f"image-{index}",
            is_inline=True,
        )
        for index in range(25)
    ]

    service._validate_outgoing_attachments_dynamic([*regular, *inline])


def test_regular_attachment_limit_still_applies_next_to_inline_images():
    service = ForwardAttachmentService()
    regular = [
        MailOutgoingAttachment(filename=f"file-{index}.txt", content=b"x", content_type="text/plain")
        for index in range(11)
    ]
    inline = [
        MailOutgoingAttachment(
            filename="image.png",
            content=b"x",
            content_type="image/png",
            content_id="image-1",
            is_inline=True,
        )
    ]

    with pytest.raises(MailPayloadTooLargeError):
        service._validate_outgoing_attachments_dynamic([*regular, *inline])


def test_forward_allowlist_matches_attachment_id_round_tripped_from_download_token():
    import base64

    from backend.services.mail_reference_codec import decode_attachment_token, encode_attachment_token

    service = ForwardAttachmentService()
    raw_id = base64.b64encode(b"attachment-identifier").decode("ascii")
    item = SimpleNamespace(
        attachments=[
            SimpleNamespace(
                id=raw_id,
                name="kept.pdf",
                content_type="application/pdf",
                downloadable=True,
                payload=("kept.pdf", "application/pdf", b"pdf"),
            )
        ]
    )

    attachments = service._collect_forwarded_attachments(
        item=item,
        account=object(),
        retain_attachment_ids={decode_attachment_token(encode_attachment_token(raw_id))},
    )

    assert [attachment.filename for attachment in attachments] == ["kept.pdf"]


def test_inline_parts_have_a_separate_abuse_limit():
    service = ForwardAttachmentService()
    inline = [
        MailOutgoingAttachment(
            filename=f"image-{index}.png",
            content=b"x",
            content_type="image/png",
            content_id=f"image-{index}",
            is_inline=True,
        )
        for index in range(service._MAX_MAIL_INLINE_PARTS + 1)
    ]

    with pytest.raises(MailPayloadTooLargeError):
        service._validate_outgoing_attachments_dynamic(inline)
