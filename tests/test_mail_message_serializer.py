from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from backend.services.mail_message_serializer import (
    MailMessageSerializer,
    item_recipient_people,
    item_sender,
    normalize_subject_for_conversation,
)


def _person(email: str, name: str = ""):
    return SimpleNamespace(email_address=email, name=name)


def _serializer() -> MailMessageSerializer:
    return MailMessageSerializer(
        inline_attachment_embed_max_size=1024,
        is_downloadable_attachment=lambda attachment: True,
    )


def test_mail_message_serializer_normalizes_sender_recipients_and_subject():
    item = SimpleNamespace(
        sender=_person("Boss@Example.COM", "Boss"),
        to_recipients=[_person("User@Example.COM", "User"), _person("user@example.com", "Duplicate")],
        cc_recipients=[_person("Other@Example.COM", "Other")],
    )

    assert item_sender(item) == "boss@example.com"
    assert item_recipient_people(item) == [
        {"name": "User", "email": "user@example.com", "display": "User"},
        {"name": "Other", "email": "other@example.com", "display": "Other"},
    ]
    assert normalize_subject_for_conversation("Re: FW: Quarterly Report") == "quarterly report"


def test_mail_message_serializer_detail_preserves_inline_attachment_contract():
    item = SimpleNamespace(
        id="exchange-1",
        message_id="<internet-id@example.com>",
        conversation_id=SimpleNamespace(id="conv-1"),
        subject="Inline preview",
        sender=_person("boss@example.com", "Boss"),
        to_recipients=[_person("user@example.com", "User")],
        cc_recipients=[],
        bcc_recipients=[],
        datetime_received=datetime(2026, 5, 3, 12, 30, tzinfo=timezone.utc),
        body='<p><img src="cid:logo123" /></p>',
        text_body="Inline preview",
        importance="high",
        categories=["it"],
        reminder_is_set=False,
        reminder_due_by=None,
        is_read=True,
        attachments=[
            SimpleNamespace(
                attachment_id=SimpleNamespace(id="att-inline"),
                name="logo.png",
                content_type="image/png",
                size=128,
                content_id="<logo123>",
                is_inline=True,
                content=b"png-bytes",
            )
        ],
    )

    detail = _serializer().serialize_message_detail(
        item=item,
        folder_key="inbox",
        mailbox_id="mailbox-1",
        mailbox_email="user@example.com",
        include_inline_data_urls=True,
    )

    assert detail["mailbox_id"] == "mailbox-1"
    assert detail["sender_email"] == "boss@example.com"
    assert detail["to"] == ["user@example.com"]
    assert detail["internet_message_id"] == "<internet-id@example.com>"
    assert detail["conversation_id"] == "conv-1"
    assert detail["attachments"][0]["content_id"] == "logo123"
    assert detail["attachments"][0]["downloadable"] is True
    assert detail["attachments"][0]["inline_src"].endswith("?disposition=inline")
    assert detail["attachments"][0]["inline_data_url"].startswith("data:image/png;base64,")


def test_mail_message_serializer_preview_keeps_list_payload_shape():
    item = SimpleNamespace(
        id="exchange-2",
        subject="Preview",
        sender=_person("boss@example.com", "Boss"),
        to_recipients=[_person("user@example.com", "User")],
        cc_recipients=[],
        datetime_created=datetime(2026, 5, 3, 12, 30, tzinfo=timezone.utc),
        body="<p>Long body</p>",
        text_body="Long body",
        has_attachments=True,
        importance="unknown",
        categories=["news"],
        is_read=False,
    )

    preview = _serializer().serialize_message_preview(
        item=item,
        folder_key="inbox",
        mailbox_id="mailbox-1",
    )

    assert preview["mailbox_id"] == "mailbox-1"
    assert preview["sender_display"] == "Boss"
    assert preview["recipients"] == ["user@example.com"]
    assert preview["has_attachments"] is True
    assert preview["attachments_count"] == 1
    assert preview["importance"] == "normal"
