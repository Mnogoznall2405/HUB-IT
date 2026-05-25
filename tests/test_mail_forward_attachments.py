from __future__ import annotations

import sys
import types
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_service import MailService


class ForwardAttachmentService(MailService):
    def __init__(self) -> None:
        pass

    @staticmethod
    def _is_downloadable_attachment(attachment):
        return bool(getattr(attachment, "downloadable", False))

    @staticmethod
    def _build_attachment_download_payload(*, attachment, account):
        return getattr(attachment, "payload", None)


def test_collect_forwarded_attachments_skips_inline_and_unsupported_items():
    service = ForwardAttachmentService()
    account = object()
    item = SimpleNamespace(
        attachments=[
            SimpleNamespace(
                name="report.xlsx",
                downloadable=True,
                payload=("report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", b"xlsx"),
            ),
            SimpleNamespace(
                name="logo.png",
                content_id="<logo>",
                downloadable=True,
                payload=("logo.png", "image/png", b"png"),
            ),
            SimpleNamespace(
                name="embedded-signature.png",
                is_inline=True,
                downloadable=True,
                payload=("embedded-signature.png", "image/png", b"png"),
            ),
            SimpleNamespace(name="unsupported.bin", downloadable=False),
        ],
    )

    assert service._collect_forwarded_attachments(item=item, account=account) == [
        ("report.xlsx", b"xlsx"),
    ]


def test_send_message_adds_source_message_attachments_when_forwarding(monkeypatch):
    created_messages = []

    class FakeHTMLBody(str):
        pass

    class FakeMailbox:
        def __init__(self, *, email_address):
            self.email_address = email_address

    class FakeFileAttachment:
        def __init__(self, *, name, content):
            self.name = name
            self.content = content

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
        def __init__(self, *, name, content):
            self.name = name
            self.content = content

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
