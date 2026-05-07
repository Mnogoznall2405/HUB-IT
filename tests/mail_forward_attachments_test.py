from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_module = importlib.import_module("backend.services.mail_service")
MailService = mail_module.MailService


class FakeFileAttachment:
    def __init__(self, name="attachment.bin", content=b"", content_type="application/octet-stream"):
        self.name = name
        self.content = content
        self.content_type = content_type
        self.size = len(content or b"")
        self.attachment_id = SimpleNamespace(id=f"att-{name}")


class FakeMessage:
    sent_messages = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.attachments = []
        self.id = "sent-exchange-id"

    def attach(self, attachment):
        self.attachments.append(attachment)

    def send_and_save(self):
        self.__class__.sent_messages.append(self)


class FakeFolder:
    def __init__(self, item):
        self.item = item

    def get(self, id=None):
        return self.item


def make_service_with_source_message(source_item):
    service = MailService.__new__(MailService)
    service._validate_outgoing_attachments_dynamic = lambda attachments: None
    service._resolve_outbound_mailbox_id = lambda **kwargs: "legacy-38"
    service._resolve_mail_profile = lambda **kwargs: {
        "mailbox_id": "legacy-38",
        "email": "sender@example.com",
        "login": "sender@example.com",
        "password": "secret",
        "signature": "",
        "user": {"id": 1, "username": "sender"},
    }
    service._create_account = lambda **kwargs: SimpleNamespace(
        sent=SimpleNamespace(),
        protocol=SimpleNamespace(get_attachments=lambda attachments: attachments),
    )
    service._resolve_mailbox_id_from_message = lambda **kwargs: "legacy-38"
    service._resolve_mailbox_scope = lambda *values: next((value for value in values if value), "legacy-38")
    service._decode_message_id = lambda message_id: ("inbox", "source-exchange-id")
    service._resolve_folder = lambda account, folder_key: (FakeFolder(source_item), None)
    service._item_message_id = lambda item: "<source@example.com>"
    service._log_message = lambda **kwargs: None
    service.invalidate_user_cache = lambda **kwargs: None
    return service


def send_message_with_exchange_fakes(service, **overrides):
    payload = {
        "user_id": 1,
        "mailbox_id": "legacy-38",
        "to": ["recipient@example.com"],
        "cc": [],
        "bcc": [],
        "subject": "Subject",
        "body": "<p>Body</p>",
        "is_html": True,
        "attachments": [],
        "reply_to_message_id": "",
        "forward_message_id": "",
        "draft_id": "",
    }
    payload.update(overrides)
    FakeMessage.sent_messages = []
    with patch("exchangelib.HTMLBody", lambda value: value), \
        patch("exchangelib.Mailbox", lambda email_address: SimpleNamespace(email_address=email_address)), \
        patch("exchangelib.Message", FakeMessage), \
        patch("exchangelib.attachments.FileAttachment", FakeFileAttachment):
        return service.send_message(**payload)


def test_forward_send_copies_source_message_attachments():
    source_item = SimpleNamespace(
        attachments=[
            FakeFileAttachment(
                name="report.pdf",
                content=b"pdf-body",
                content_type="application/pdf",
            )
        ],
        references="",
    )
    service = make_service_with_source_message(source_item)

    send_message_with_exchange_fakes(service, forward_message_id="encoded-forward-id")

    sent = FakeMessage.sent_messages[0]
    assert [attachment.name for attachment in sent.attachments] == ["report.pdf"]
    assert sent.attachments[0].content == b"pdf-body"


def test_reply_send_does_not_copy_source_message_attachments():
    source_item = SimpleNamespace(
        attachments=[
            FakeFileAttachment(
                name="source-only.txt",
                content=b"source-body",
                content_type="text/plain",
            )
        ],
        references="",
    )
    service = make_service_with_source_message(source_item)

    send_message_with_exchange_fakes(service, reply_to_message_id="encoded-reply-id")

    sent = FakeMessage.sent_messages[0]
    assert sent.attachments == []
