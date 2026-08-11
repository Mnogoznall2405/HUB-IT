"""Lean ACK payload builders for chat send critical path."""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from backend.chat.lean_ack import (
    apply_sender_summary_to_message,
    build_lean_command_ok_payload,
    build_lean_message_payload,
    build_lean_message_payload_from_orm,
    build_sender_summary,
)


def test_build_lean_message_payload_is_minimal():
    payload = build_lean_message_payload(
        message_id="m1",
        conversation_id="c1",
        sender_user_id=7,
        current_user_id=7,
        body="hello",
        client_message_id="client-1",
        created_at=datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc),
        conversation_seq=42,
    )

    assert payload["id"] == "m1"
    assert payload["conversation_id"] == "c1"
    assert payload["client_message_id"] == "client-1"
    assert payload["conversation_seq"] == 42
    assert payload["is_own"] is True
    assert payload["delivery_status"] == "sent"
    assert payload["payload_mode"] == "lean"
    assert payload["sender"]["id"] == 7
    assert payload["sender"]["full_name"] is None
    assert payload["sender"]["username"] == ""
    assert payload["reply_preview"] is None
    assert payload["attachments"] == []
    assert "member_preview" not in payload


def test_apply_sender_summary_rejects_synthetic_username():
    message = build_lean_message_payload(
        message_id="m1",
        conversation_id="c1",
        sender_user_id=38,
        current_user_id=38,
        body="hi",
    )
    enriched = apply_sender_summary_to_message(
        message,
        user_id=38,
        username="user-38",
        full_name="Иван Иванов",
    )
    assert enriched["sender"]["full_name"] == "Иван Иванов"
    assert enriched["sender"]["username"] == ""
    assert build_sender_summary(user_id=38, username="ivan", full_name=None)["username"] == "ivan"


def test_build_lean_command_ok_payload_shape():
    message = build_lean_message_payload(
        message_id="m2",
        conversation_id="c2",
        sender_user_id=3,
        current_user_id=3,
        body="x",
        client_message_id="cid",
        created_at="2026-08-03T12:00:00+00:00",
        conversation_seq=9,
    )
    ack = build_lean_command_ok_payload(message=message, conversation_id="c2")

    assert ack["command"] == "send_message"
    assert ack["ok"] is True
    assert ack["message_id"] == "m2"
    assert ack["client_message_id"] == "cid"
    assert ack["seq"] == 9
    assert ack["status"] == "sent"
    assert ack["message"]["payload_mode"] == "lean"


def test_build_lean_from_orm_snapshot():
    message = SimpleNamespace(
        id="m3",
        conversation_id="c3",
        sender_user_id=11,
        body="body",
        body_format="plain",
        client_message_id="c-msg",
        created_at=datetime(2026, 8, 3, 13, 0, tzinfo=timezone.utc),
        conversation_seq=5,
        kind="text",
        reply_to_message_id=None,
    )
    payload = build_lean_message_payload_from_orm(message=message, current_user_id=11)
    assert payload["id"] == "m3"
    assert payload["conversation_seq"] == 5
    assert payload["payload_mode"] == "lean"
