from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

compose = importlib.import_module("backend.services.mail_compose_orchestration")


def test_parse_recipients_splits_normalizes_and_deduplicates():
    assert compose.parse_recipients(["User@Example.COM; second@example.com", "user@example.com, third@example.com"]) == [
        "user@example.com",
        "second@example.com",
        "third@example.com",
    ]


def test_build_recipient_set_requires_primary_recipient_when_sending():
    with pytest.raises(compose.ComposeValidationError, match="At least one recipient"):
        compose.build_recipient_set(to=[], cc=["copy@example.com"], require_to=True)


def test_resolve_outbound_mailbox_id_prefers_explicit_mailbox_without_decoding_messages():
    calls: list[str | None] = []

    def mailbox_from_message(value: str | None) -> str:
        calls.append(value)
        return "decoded"

    assert (
        compose.resolve_outbound_mailbox_id(
            mailbox_id="explicit-mailbox",
            draft_id="draft-id",
            reply_to_message_id="reply-id",
            forward_message_id="forward-id",
            mailbox_id_from_message=mailbox_from_message,
            mailbox_scope_resolver=lambda *values: next((value for value in values if value), ""),
        )
        == "explicit-mailbox"
    )
    assert calls == []


def test_resolve_outbound_mailbox_id_uses_message_scope_fallbacks():
    values = {
        "draft-id": "draft-mailbox",
        "reply-id": "reply-mailbox",
        "forward-id": "forward-mailbox",
    }

    assert (
        compose.resolve_outbound_mailbox_id(
            draft_id="draft-id",
            reply_to_message_id="reply-id",
            forward_message_id="forward-id",
            mailbox_id_from_message=lambda value: values.get(value or "", ""),
            mailbox_scope_resolver=lambda *items: next((item for item in items if item), ""),
        )
        == "draft-mailbox"
    )


def test_prepare_outgoing_body_places_html_signature_before_quote():
    result = compose.prepare_outgoing_body(
        body='<p>Hello</p><div class="quoted-mail"><p>Old</p></div>',
        signature="<p>Signature</p>",
        is_html=True,
        has_reply_or_forward=True,
    )

    assert result.index("Signature") < result.index("Old")
    assert 'data-mail-signature="true"' in result


def test_build_reply_forward_reference_headers_deduplicates_headers():
    assert compose.build_reply_forward_reference_headers(
        reply_message_id="<reply@example>",
        reply_references="<root@example> <reply@example>",
        forward_message_id="<forward@example>",
    ) == {
        "in_reply_to": "<reply@example>",
        "references": "<reply@example> <root@example> <forward@example>",
    }


def test_build_draft_upsert_plan_normalizes_scope_recipients_and_retained_attachments():
    plan = compose.build_draft_upsert_plan(
        draft_id="draft-id",
        compose_mode=" reply ",
        to=["User@Example.COM; second@example.com"],
        cc=["Copy@Example.com"],
        bcc=None,
        subject="  Subject  ",
        body="  Body  ",
        is_html=False,
        reply_to_message_id=" reply-id ",
        retain_existing_attachments=[" token-1 ", "", "token-2"],
        attachment_id_resolver=lambda value: f"resolved:{value.strip()}",
        mailbox_id_from_message=lambda value: "mailbox-from-draft" if value == "draft-id" else "",
        mailbox_scope_resolver=lambda *items: next((item for item in items if item), ""),
    )

    assert plan.effective_mailbox_id == "mailbox-from-draft"
    assert plan.recipients.to == ["user@example.com", "second@example.com"]
    assert plan.recipients.cc == ["copy@example.com"]
    assert plan.retain_attachment_ids == ["resolved:token-1", "resolved:token-2"]
    assert plan.subject == "Subject"
    assert plan.body == "Body"
    assert plan.is_html is False
    assert plan.compose_mode == "reply"
    assert plan.reply_to_message_id == "reply-id"


def test_build_outbound_send_plan_prepares_text_signature_and_requires_to_recipient():
    plan = compose.build_outbound_send_plan(
        mailbox_id="mailbox",
        draft_id="draft-id",
        to=["User@Example.COM"],
        subject=" Subject ",
        body="Body",
        signature="Signature",
        is_html=False,
        mailbox_id_from_message=lambda value: "",
        mailbox_scope_resolver=lambda *items: next((item for item in items if item), ""),
    )

    assert plan.effective_mailbox_id == "mailbox"
    assert plan.recipients.to == ["user@example.com"]
    assert plan.subject == "Subject"
    assert plan.body == "Body\n\nSignature"
    assert plan.draft_id == "draft-id"
