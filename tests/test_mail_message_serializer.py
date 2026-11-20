from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from backend.services.mail_message_serializer import (
    MailMessageSerializer,
    draft_sender_person_fallback,
    item_recipient_people,
    item_sender,
    mail_use_reply_to_enabled,
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
        {"name": "User", "email": "user@example.com", "display": "User", "avatar_url": None},
        {"name": "Other", "email": "other@example.com", "display": "Other", "avatar_url": None},
    ]
    assert normalize_subject_for_conversation("Re: FW: Quarterly Report") == "quarterly report"
    assert normalize_subject_for_conversation("Отв: Переслано: Отчёт") == "отчёт"


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


def test_mail_message_serializer_marks_only_referenced_content_ids_as_inline():
    def attachment(name, content_type, content_id, is_inline=False):
        return SimpleNamespace(
            attachment_id=SimpleNamespace(id=f"att-{name}"),
            name=name,
            content_type=content_type,
            size=128,
            content_id=content_id,
            is_inline=is_inline,
            content=b"bytes",
        )

    item = SimpleNamespace(
        id="exchange-2",
        subject="Content-ID",
        sender=_person("boss@example.com", "Boss"),
        to_recipients=[_person("user@example.com", "User")],
        cc_recipients=[],
        datetime_received=datetime(2026, 5, 3, 12, 30, tzinfo=timezone.utc),
        body='<p>See <img src="cid:inline-logo" /></p>',
        text_body="Content-ID",
        importance="normal",
        categories=[],
        reminder_is_set=False,
        reminder_due_by=None,
        is_read=True,
        attachments=[
            attachment("regular.pdf", "application/pdf", "<pdf-cid>"),
            attachment("inline-logo.png", "image/png", "<inline-logo>"),
            attachment("unused.png", "image/png", "<unused>", is_inline=True),
        ],
    )

    detail = _serializer().serialize_message_detail(
        item=item,
        folder_key="inbox",
        mailbox_id="mailbox-1",
        mailbox_email="user@example.com",
    )

    assert [item["is_inline"] for item in detail["attachments"]] == [False, True, True]
    assert detail["attachments"][0]["inline_src"] is None
    assert detail["attachments"][1]["inline_src"].endswith("?disposition=inline")
    assert detail["attachments"][2]["inline_src"].endswith("?disposition=inline")


def test_draft_sender_person_fallback_uses_mailbox_email_when_sender_empty():
    base = {"name": None, "email": None, "display": None}
    assert draft_sender_person_fallback("inbox", "owner@SITE.COM", base) is base
    out = draft_sender_person_fallback("drafts", "Owner@SITE.COM", base)
    assert out["email"] == "owner@site.com"
    assert out["display"] == "owner@site.com"


def test_mail_message_serializer_preview_fills_draft_sender_from_mailbox_email():
    item = SimpleNamespace(
        id="exchange-draft",
        subject="Draft only",
        sender=None,
        author=None,
        to_recipients=[],
        cc_recipients=[],
        datetime_created=datetime(2026, 5, 3, 12, 30, tzinfo=timezone.utc),
        body="",
        text_body="",
        has_attachments=False,
        importance="normal",
        categories=[],
        is_read=False,
    )

    preview = _serializer().serialize_message_preview(
        item=item,
        folder_key="drafts",
        mailbox_id="mailbox-1",
        mailbox_email="me@example.com",
    )

    assert preview["sender"] == "me@example.com"
    assert preview["sender_email"] == "me@example.com"
    assert preview["sender_display"] == "me@example.com"


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
        attachments=[SimpleNamespace(), SimpleNamespace(), SimpleNamespace()],
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
    assert preview["attachments_count"] == 3
    assert preview["importance"] == "normal"


def test_mail_message_serializer_preview_falls_back_to_has_attachments_flag():
    item = SimpleNamespace(
        id="exchange-3",
        subject="Preview",
        sender=_person("boss@example.com", "Boss"),
        to_recipients=[],
        cc_recipients=[],
        datetime_created=datetime(2026, 5, 3, 12, 30, tzinfo=timezone.utc),
        body="",
        text_body="",
        has_attachments=True,
        importance="normal",
        categories=[],
        is_read=False,
    )

    preview = _serializer().serialize_message_preview(
        item=item,
        folder_key="inbox",
        mailbox_id="mailbox-1",
    )

    assert preview["attachments_count"] == 1


def _attachment(name: str, content_type: str, *, content_id: str | None = None, is_inline: bool = False):
    return SimpleNamespace(
        name=name,
        content_type=content_type,
        content_id=content_id,
        is_inline=is_inline,
        size=128,
    )


def test_mail_message_serializer_preview_ignores_inline_only_attachments():
    item = SimpleNamespace(
        id="exchange-4",
        subject="Signature logo",
        sender=_person("boss@example.com", "Boss"),
        to_recipients=[],
        cc_recipients=[],
        datetime_created=datetime(2026, 5, 3, 12, 30, tzinfo=timezone.utc),
        body="",
        text_body="",
        has_attachments=True,
        attachments=[
            _attachment("logo.png", "image/png", content_id="<logo>", is_inline=True),
            _attachment("banner.jpg", "image/jpeg", content_id="<banner>"),
        ],
        importance="normal",
        categories=[],
        is_read=False,
    )

    preview = _serializer().serialize_message_preview(
        item=item,
        folder_key="inbox",
        mailbox_id="mailbox-1",
    )

    assert preview["has_attachments"] is False
    assert preview["attachments_count"] == 0


def test_mail_message_serializer_preview_counts_real_attachments_only():
    item = SimpleNamespace(
        id="exchange-5",
        subject="Real file plus signature",
        sender=_person("boss@example.com", "Boss"),
        to_recipients=[],
        cc_recipients=[],
        datetime_created=datetime(2026, 5, 3, 12, 30, tzinfo=timezone.utc),
        body="",
        text_body="",
        has_attachments=True,
        attachments=[
            _attachment("logo.png", "image/png", content_id="<logo>", is_inline=True),
            _attachment("report.pdf", "application/pdf"),
            _attachment("note.eml", "message/rfc822"),
        ],
        importance="normal",
        categories=[],
        is_read=False,
    )

    preview = _serializer().serialize_message_preview(
        item=item,
        folder_key="inbox",
        mailbox_id="mailbox-1",
    )

    assert preview["has_attachments"] is True
    assert preview["attachments_count"] == 2


def test_mail_message_serializer_detail_inline_embed_budget_stops_embedding():
    def inline_image(name: str, content_id: str):
        return SimpleNamespace(
            attachment_id=SimpleNamespace(id=f"att-{name}"),
            name=name,
            content_type="image/png",
            size=9,
            content_id=content_id,
            is_inline=True,
            content=b"png-bytes",
        )

    item = SimpleNamespace(
        id="exchange-6",
        subject="Two inline images",
        sender=_person("boss@example.com", "Boss"),
        to_recipients=[_person("user@example.com", "User")],
        cc_recipients=[],
        bcc_recipients=[],
        datetime_received=datetime(2026, 5, 3, 12, 30, tzinfo=timezone.utc),
        body='<p><img src="cid:first" /><img src="cid:second" /></p>',
        text_body="Two inline images",
        importance="normal",
        categories=[],
        reminder_is_set=False,
        reminder_due_by=None,
        is_read=True,
        attachments=[
            inline_image("first.png", "<first>"),
            inline_image("second.png", "<second>"),
        ],
    )

    first_url = "data:image/png;base64," + "A" * 12
    detail = _serializer().serialize_message_detail(
        item=item,
        folder_key="inbox",
        mailbox_id="mailbox-1",
        mailbox_email="user@example.com",
        include_inline_data_urls=True,
        inline_embed_budget=len(first_url),
    )

    assert detail["attachments"][0]["inline_data_url"] is not None
    assert detail["attachments"][1]["inline_data_url"] is None


def _compose_item(**overrides):
    item = dict(
        sender=_person("Boss@Example.COM", "Boss"),
        to_recipients=[_person("User@Example.COM", "User")],
        cc_recipients=[_person("Other@Example.COM", "Other")],
        subject="Help",
        body="<p>Hi</p>",
        text_body="Hi",
        datetime_received=datetime(2026, 5, 3, 12, 30, tzinfo=timezone.utc),
    )
    item.update(overrides)
    return SimpleNamespace(**item)


def test_mail_use_reply_to_enabled_defaults_and_rollback(monkeypatch):
    monkeypatch.delenv("MAIL_USE_REPLY_TO", raising=False)
    assert mail_use_reply_to_enabled() is True
    assert mail_use_reply_to_enabled("") is True
    assert mail_use_reply_to_enabled("  ") is True
    assert mail_use_reply_to_enabled("0") is False
    assert mail_use_reply_to_enabled("false") is False
    assert mail_use_reply_to_enabled("1") is True
    assert mail_use_reply_to_enabled("nope") is True


def test_build_compose_context_uses_reply_to_for_reply_only(monkeypatch):
    monkeypatch.delenv("MAIL_USE_REPLY_TO", raising=False)
    item = _compose_item(reply_to=[_person("Tickets@Example.COM", "Tickets")])
    ctx = _serializer().build_compose_context(item, "user@example.com", "mailbox-1")

    assert ctx["reply"]["to"] == ["tickets@example.com"]
    assert "tickets@example.com" not in ctx["reply_all"]["to"]
    assert "tickets@example.com" not in ctx["reply_all"]["cc"]
    assert ctx["reply_all"]["to"][0] == "boss@example.com"


def test_build_compose_context_reply_falls_back_when_reply_to_absent(monkeypatch):
    monkeypatch.delenv("MAIL_USE_REPLY_TO", raising=False)
    ctx = _serializer().build_compose_context(_compose_item(), "user@example.com")
    assert ctx["reply"]["to"] == ["boss@example.com"]


def test_build_compose_context_reply_falls_back_when_reply_to_empty(monkeypatch):
    monkeypatch.delenv("MAIL_USE_REPLY_TO", raising=False)
    ctx = _serializer().build_compose_context(_compose_item(reply_to=[]), "user@example.com")
    assert ctx["reply"]["to"] == ["boss@example.com"]


def test_build_compose_context_reply_uses_sender_when_flag_off(monkeypatch):
    monkeypatch.setenv("MAIL_USE_REPLY_TO", "0")
    item = _compose_item(reply_to=[_person("tickets@example.com", "Tickets")])
    ctx = _serializer().build_compose_context(item, "user@example.com")
    assert ctx["reply"]["to"] == ["boss@example.com"]


def test_build_compose_context_reply_to_own_message_targets_original_recipients(monkeypatch):
    monkeypatch.delenv("MAIL_USE_REPLY_TO", raising=False)
    item = _compose_item(
        sender=_person("User@Example.COM", "User"),
        to_recipients=[_person("Client@Example.COM", "Client"), _person("User@Example.COM", "User")],
        cc_recipients=[_person("Copy@Example.COM", "Copy")],
        bcc_recipients=[_person("Hidden@Example.COM", "Hidden")],
    )

    ctx = _serializer().build_compose_context(item, "user@example.com", "mailbox-1")

    assert ctx["reply"]["to"] == ["client@example.com"]
    assert ctx["reply"]["cc"] == []
    assert ctx["reply"]["bcc"] == []
    assert ctx["reply_all"]["to"] == ["client@example.com"]
    assert ctx["reply_all"]["cc"] == ["copy@example.com"]
    assert ctx["reply_all"]["bcc"] == ["hidden@example.com"]


def test_build_compose_context_reply_to_sent_alias_message_uses_original_recipients(monkeypatch):
    monkeypatch.delenv("MAIL_USE_REPLY_TO", raising=False)
    item = _compose_item(
        sender=_person("shared-mailbox@example.com", "Shared"),
        to_recipients=[_person("Client@Example.COM", "Client")],
    )

    ctx = _serializer().build_compose_context(item, "user@example.com", "mailbox-1", "sent")

    assert ctx["reply"]["to"] == ["client@example.com"]
    assert ctx["reply_all"]["to"] == ["client@example.com"]


def test_build_compose_context_reply_to_own_bcc_only_message_uses_bcc_recipients(monkeypatch):
    monkeypatch.delenv("MAIL_USE_REPLY_TO", raising=False)
    item = _compose_item(
        sender=_person("user@example.com", "User"),
        to_recipients=[_person("user@example.com", "User")],
        cc_recipients=[],
        bcc_recipients=[_person("Hidden@Example.COM", "Hidden")],
    )

    ctx = _serializer().build_compose_context(item, "user@example.com")

    assert ctx["reply"]["to"] == []
    assert ctx["reply"]["bcc"] == ["hidden@example.com"]
    assert ctx["reply_all"]["to"] == []
    assert ctx["reply_all"]["bcc"] == ["hidden@example.com"]


def test_build_compose_context_reply_to_sent_cc_only_message_uses_cc_recipients(monkeypatch):
    monkeypatch.delenv("MAIL_USE_REPLY_TO", raising=False)
    item = _compose_item(
        sender=_person("user@example.com", "User"),
        to_recipients=[_person("user@example.com", "User")],
        cc_recipients=[_person("Copy@Example.COM", "Copy")],
        bcc_recipients=[],
    )

    ctx = _serializer().build_compose_context(item, "user@example.com")

    assert ctx["reply"]["to"] == ["copy@example.com"]
    assert ctx["reply_all"]["to"] == []
    assert ctx["reply_all"]["cc"] == ["copy@example.com"]


def test_build_compose_context_reply_without_sender_falls_back_to_recipients(monkeypatch):
    monkeypatch.delenv("MAIL_USE_REPLY_TO", raising=False)
    item = _compose_item(
        sender=None,
        to_recipients=[_person("Client@Example.COM", "Client")],
        cc_recipients=[_person("Copy@Example.COM", "Copy")],
    )

    ctx = _serializer().build_compose_context(item, "user@example.com")

    assert ctx["reply"]["to"] == ["client@example.com"]


def test_build_compose_context_keeps_multiple_reply_to_addresses(monkeypatch):
    monkeypatch.delenv("MAIL_USE_REPLY_TO", raising=False)
    item = _compose_item(reply_to=[
        _person("a@example.com", "A"),
        _person("b@example.com", "B"),
    ])
    ctx = _serializer().build_compose_context(item, "user@example.com")
    assert ctx["reply"]["to"] == ["a@example.com", "b@example.com"]
