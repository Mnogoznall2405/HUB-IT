from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_message_listing import MailMessageListBuilder, message_matches_filters


class _Query:
    def __init__(self, items):
        self._items = list(items)
        self.filtered = False

    def filter(self, **_kwargs):
        self.filtered = True
        return _Query([item for item in self._items if not getattr(item, "is_read", False)])

    def __getitem__(self, key):
        return self._items[key]


def _item(
    item_id: str,
    *,
    subject: str = "Subject",
    sender: str = "sender@example.com",
    recipients: list[str] | None = None,
    minute: int = 1,
    is_read: bool = False,
    text_body: str = "",
    attachments: list[object] | None = None,
    importance: str = "normal",
):
    return SimpleNamespace(
        id=item_id,
        subject=subject,
        sender=sender,
        recipients=list(recipients or []),
        datetime_received=datetime(2026, 5, 4, 12, minute, tzinfo=timezone.utc),
        is_read=is_read,
        text_body=text_body or subject,
        body=text_body or subject,
        attachments=list(attachments or []),
        importance=importance,
    )


def _build_listing(*, folders: dict[str, list[object]], search_window_limit=50, calls=None):
    calls = calls if calls is not None else {}

    def _search_target_folders(_account, folder="inbox", folder_scope="current"):
        if folder_scope == "all":
            return [(items, folder_key) for folder_key, items in folders.items()]
        return [(folders[folder], folder)]

    def _folder_queryset(folder_obj, folder_key, preview_only=False):
        calls.setdefault("querysets", []).append((folder_key, bool(preview_only)))
        return _Query(folder_obj)

    return MailMessageListBuilder(
        search_target_folders=_search_target_folders,
        folder_queryset=_folder_queryset,
        folder_total_hint=lambda folder_obj, unread_only=False: len(folder_obj),
        serialize_message_preview=lambda *, item, folder_key, mailbox_id=None: {
            "id": item.id,
            "received_at": item.datetime_received.isoformat(),
            "folder": folder_key,
            "mailbox_id": mailbox_id,
        },
        message_matches_filters=lambda item, **filters: message_matches_filters(
            item,
            item_sender=lambda value: value.sender,
            item_recipients=lambda value: value.recipients,
            item_importance=lambda value: value.importance,
            **filters,
        ),
        parse_date_filter=lambda value: datetime.strptime(value, "%Y-%m-%d").date() if value else None,
        search_batch_size=2,
        search_window_limit=lambda: search_window_limit,
    )


def test_message_listing_uses_fast_single_folder_preview_path():
    calls = {}
    items = [
        _item("old", minute=1, is_read=True),
        _item("new", minute=2, is_read=False),
        _item("next", minute=3, is_read=False),
    ]
    listing = _build_listing(folders={"inbox": items}, calls=calls)

    result = listing.list_messages(
        account=object(),
        folder="inbox",
        limit=1,
        offset=1,
        unread_only=False,
        mailbox_id="mbox-1",
    )

    assert calls["querysets"] == [("inbox", True)]
    assert result.searched_window == 0
    assert result.search_limited is False
    assert result.payload["total"] == 3
    assert result.payload["has_more"] is True
    assert result.payload["items"] == [
        {
            "id": "new",
            "received_at": "2026-05-04T12:02:00+00:00",
            "folder": "inbox",
            "mailbox_id": "mbox-1",
        }
    ]


def test_message_listing_filters_and_limits_multi_folder_scan():
    items = [
        _item("skip-read", subject="Needle", minute=1, is_read=True),
        _item("keep", subject="Needle", minute=2, is_read=False, attachments=[object()]),
        _item("not-scanned", subject="Needle", minute=3, is_read=False, attachments=[object()]),
    ]
    listing = _build_listing(folders={"inbox": items}, search_window_limit=2)

    result = listing.list_messages(
        account=object(),
        folder="inbox",
        folder_scope="all",
        unread_only=False,
        q="needle",
        has_attachments=True,
        date_from="2026-05-04",
    )

    assert result.searched_window == 2
    assert result.search_limited is True
    assert [item["id"] for item in result.payload["items"]] == ["keep"]


def test_message_matches_filters_checks_sender_recipients_body_dates_and_importance():
    item = _item(
        "match",
        subject="Budget approval",
        sender="boss@example.com",
        recipients=["user@example.com"],
        text_body="Please approve today",
        attachments=[object()],
        importance="high",
    )

    assert message_matches_filters(
        item,
        item_sender=lambda value: value.sender,
        item_recipients=lambda value: value.recipients,
        item_importance=lambda value: value.importance,
        query_text="budget",
        has_attachments=True,
        date_from=date(2026, 5, 4),
        date_to=date(2026, 5, 4),
        from_filter="boss",
        to_filter="user",
        subject_filter="approval",
        body_filter="approve",
        importance_filter="high",
    )
    assert not message_matches_filters(
        item,
        item_sender=lambda value: value.sender,
        item_recipients=lambda value: value.recipients,
        item_importance=lambda value: value.importance,
        importance_filter="low",
    )
