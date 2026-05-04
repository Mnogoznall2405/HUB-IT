from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_conversation_payloads import MailConversationPayloadBuilder


def _person(email: str, name: str = ""):
    return {"email": email, "name": name or email}


def _item(
    item_id: str,
    conversation_key: str,
    *,
    subject: str,
    sender: str,
    recipients: list[str],
    minute: int,
    is_read: bool,
    text_body: str = "",
    attachments: list[object] | None = None,
):
    return SimpleNamespace(
        id=item_id,
        conversation_key=conversation_key,
        subject=subject,
        sender=sender,
        recipients=recipients,
        sender_person=_person(sender),
        recipient_people=[_person(email) for email in recipients],
        datetime_received=datetime(2026, 5, 4, 12, minute, tzinfo=timezone.utc),
        is_read=is_read,
        text_body=text_body or subject,
        attachments=list(attachments or []),
    )


def _build_payloads(*, folders: dict[str, list[object]], search_window_limit=50):
    def _search_target_folders(_account, folder="inbox", folder_scope="current"):
        if folder_scope == "all":
            return [(items, folder_key) for folder_key, items in folders.items()]
        return [(folders[folder], folder)]

    def _matches(item, **filters):
        query_text = filters.get("query_text") or ""
        if query_text and query_text not in item.subject.lower() and query_text not in item.text_body.lower():
            return False
        if filters.get("has_attachments") and not item.attachments:
            return False
        date_from = filters.get("date_from")
        if date_from and item.datetime_received.date() < date_from:
            return False
        return True

    return MailConversationPayloadBuilder(
        search_target_folders=_search_target_folders,
        folder_queryset=lambda folder_obj, _folder_key: folder_obj,
        message_matches_filters=_matches,
        item_conversation_key=lambda item: item.conversation_key,
        item_sender=lambda item: item.sender,
        item_recipients=lambda item: item.recipients,
        item_sender_person=lambda item: item.sender_person,
        item_recipient_people=lambda item: item.recipient_people,
        person_lookup_key=lambda person: str((person or {}).get("email") or "").lower(),
        search_batch_size=2,
        search_window_limit=lambda: search_window_limit,
    )


def test_conversation_payloads_group_sort_page_and_dedupe_participants():
    items = [
        _item("old", "conv-1", subject="Old", sender="a@example.com", recipients=["b@example.com"], minute=1, is_read=True),
        _item("new", "conv-1", subject="New", sender="a@example.com", recipients=["c@example.com"], minute=3, is_read=False, attachments=[object()]),
        _item("other", "conv-2", subject="Other", sender="d@example.com", recipients=["a@example.com"], minute=2, is_read=True),
    ]
    payloads = _build_payloads(folders={"inbox": items})

    result = payloads.list_conversations(account=object(), folder="inbox", limit=1, offset=0)

    assert result.payload["total"] == 2
    assert result.payload["has_more"] is True
    assert result.payload["items"][0]["conversation_id"] == "conv-1"
    assert result.payload["items"][0]["subject"] == "New"
    assert result.payload["items"][0]["unread_count"] == 1
    assert result.payload["items"][0]["has_attachments"] is True
    assert result.payload["items"][0]["participants"] == ["a@example.com", "b@example.com", "c@example.com"]


def test_conversation_payloads_filters_unread_query_attachments_and_search_limit():
    items = [
        _item("skip-read", "conv-read", subject="Needle", sender="a@example.com", recipients=[], minute=1, is_read=True, attachments=[object()]),
        _item("keep", "conv-keep", subject="Needle", sender="b@example.com", recipients=[], minute=2, is_read=False, attachments=[object()]),
        _item("not-scanned", "conv-late", subject="Needle", sender="c@example.com", recipients=[], minute=3, is_read=False, attachments=[object()]),
    ]
    payloads = _build_payloads(folders={"inbox": items}, search_window_limit=2)

    result = payloads.list_conversations(
        account=object(),
        folder="inbox",
        unread_only=True,
        filters={"query_text": "needle", "has_attachments": True, "date_from": date(2026, 5, 4)},
    )

    assert result.searched_window == 2
    assert result.search_limited is True
    assert [item["conversation_id"] for item in result.payload["items"]] == ["conv-keep"]


def test_conversation_payloads_builds_detail_payload_with_deduped_people():
    payloads = _build_payloads(folders={"inbox": []})
    items = [
        {
            "sender": "a@example.com",
            "to": ["b@example.com"],
            "cc": [],
            "sender_person": _person("a@example.com", "A"),
            "to_people": [_person("b@example.com", "B")],
            "cc_people": [],
            "subject": "First",
            "is_read": False,
            "received_at": "2026-05-04T12:00:00+00:00",
        },
        {
            "sender": "b@example.com",
            "to": ["a@example.com"],
            "cc": ["c@example.com"],
            "sender_person": _person("b@example.com", "B"),
            "to_people": [_person("a@example.com", "A")],
            "cc_people": [_person("c@example.com", "C")],
            "subject": "Latest",
            "is_read": True,
            "received_at": "2026-05-04T12:01:00+00:00",
        },
    ]

    detail = payloads.conversation_detail_payload(conversation_id="conv-1", items=items)

    assert detail["subject"] == "Latest"
    assert detail["messages_count"] == 2
    assert detail["unread_count"] == 1
    assert detail["participants"] == ["a@example.com", "b@example.com", "c@example.com"]
    assert [person["email"] for person in detail["participant_people"]] == [
        "a@example.com",
        "b@example.com",
        "c@example.com",
    ]
