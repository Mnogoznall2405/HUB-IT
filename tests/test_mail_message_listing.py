from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_message_listing import (
    MailMessageListBuilder,
    build_server_side_restriction,
    message_matches_filters,
)


def _q_field_paths(q):
    paths = set()
    stack = [q]
    while stack:
        node = stack.pop()
        stack.extend(getattr(node, "children", None) or [])
        field_path = getattr(node, "field_path", None)
        if field_path:
            paths.add(str(field_path))
    return paths


class _Query:
    def __init__(self, items):
        self._items = list(items)
        self.filtered = False

    def filter(self, **_kwargs):
        self.filtered = True
        return _Query([item for item in self._items if not getattr(item, "is_read", False)])

    def __getitem__(self, key):
        return self._items[key]


class _RejectedFilteredSlice:
    def __getitem__(self, key):
        raise RuntimeError("server rejected the restriction")


class _RejectedFilterQuery(_Query):
    def filter(self, *args, **kwargs):
        if args:
            return _RejectedFilteredSlice()
        return super().filter(**kwargs)


class _ServerFilteringQuery(_Query):
    def __init__(self, items, calls):
        super().__init__(items)
        self._calls = calls

    def filter(self, *args, **kwargs):
        if args:
            self._calls["server_filter_used"] = self._calls.get("server_filter_used", 0) + 1
            return _ServerFilteringQuery(
                [item for item in self._items if "needle" in item.subject.lower()],
                self._calls,
            )
        return super().filter(**kwargs)


class _TrustingFilterQuery(_Query):
    """Yields every item once a restriction is applied and counts filtered vs
    unfiltered page reads — used to observe whether the unfiltered supplement
    sweep ran at all."""

    def __init__(self, items, calls, filtered=False):
        super().__init__(items)
        self._calls = calls
        self._filtered = filtered

    def filter(self, *args, **kwargs):
        if args:
            return _TrustingFilterQuery(list(self._items), self._calls, filtered=True)
        return super().filter(**kwargs)

    def __getitem__(self, key):
        counter = "filtered_reads" if self._filtered else "unfiltered_reads"
        self._calls[counter] = self._calls.get(counter, 0) + 1
        return super().__getitem__(key)


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


def test_search_pagination_does_not_skip_messages_with_the_same_timestamp():
    listing = _build_listing(
        folders={"inbox": [_item(key, subject="needle") for key in ("a", "b", "c")]},
        queryset=lambda items: _ServerFilteringQuery(items, {}),
    )
    pages = [
        listing.list_messages(account=object(), subject_filter="needle", limit=1, offset=offset).payload
        for offset in range(3)
    ]

    assert [page["items"][0]["id"] for page in pages] == ["c", "b", "a"]
    assert not pages[-1]["has_more"]


def _build_listing(*, folders: dict[str, list[object]], search_window_limit=50, calls=None, queryset=_Query):
    calls = calls if calls is not None else {}

    def _search_target_folders(_account, folder="inbox", folder_scope="current"):
        if folder_scope == "all":
            return [(items, folder_key) for folder_key, items in folders.items()]
        return [(folders[folder], folder)]

    def _folder_queryset(folder_obj, folder_key, preview_only=False):
        calls.setdefault("querysets", []).append((folder_key, bool(preview_only)))
        return queryset(folder_obj)

    return MailMessageListBuilder(
        search_target_folders=_search_target_folders,
        folder_queryset=_folder_queryset,
        folder_total_hint=lambda folder_obj, unread_only=False: len(folder_obj),
        serialize_message_preview=lambda *, item, folder_key, mailbox_id=None, mailbox_email="": {
            "id": item.id,
            "received_at": (item.datetime_received or item.datetime_created).isoformat(),
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


def test_quick_search_keeps_recipient_matches_alongside_archive_matches():
    calls = {}
    listing = _build_listing(
        folders={
            "inbox": [_item(f"recent-{i}", subject="Needle", minute=20 - i) for i in range(8)],
            "sent": [_item("recipient-only", recipients=["needle@example.test"], minute=4)],
            "archive": [_item("older-subject", subject="Needle", minute=1)],
        },
        search_window_limit=4,
        queryset=lambda items: _ServerFilteringQuery(items, calls),
    )

    result = listing.list_messages(account=object(), q="needle", folder_scope="all")

    ids = [item["id"] for item in result.payload["items"]]
    assert {"recipient-only", "older-subject"} <= set(ids)
    assert len(ids) == len(set(ids))
    assert result.search_limited


def test_search_keeps_discovered_archive_folders_and_reports_hierarchy_failure():
    from backend.services.mail_service import MailService

    archive_folder = SimpleNamespace(id="archive-child", items=[_item("archived", subject="Needle")])

    def walk_archive():
        yield archive_folder
        raise TimeoutError("next page of the hierarchy failed")

    account = SimpleNamespace(
        inbox=SimpleNamespace(id="inbox-id", items=[]),
        archive_msg_folder_root=SimpleNamespace(id="archive-root", walk=walk_archive),
    )
    service = object.__new__(MailService)
    listing = _build_listing(folders={})
    listing.search_target_folders = service._listing_search_target_folders
    listing.folder_queryset = lambda folder, _key, preview_only=False: _Query(folder.items)

    result = listing.list_messages(account=account, folder_scope="all", subject_filter="needle")

    assert [item["id"] for item in result.payload["items"]] == ["archived"]
    assert result.payload["skipped_folders"] == 1


def test_quick_search_reaches_subject_beyond_compatibility_window():
    calls = {}
    listing = _build_listing(
        folders={"inbox": [_item(f"other-{i}") for i in range(6)] + [_item("old", subject="Needle")]},
        search_window_limit=3,
        queryset=lambda items: _ServerFilteringQuery(items, calls),
    )

    result = listing.list_messages(account=object(), q="needle")

    assert [item["id"] for item in result.payload["items"]] == ["old"]
    assert result.search_limited


def test_message_listing_late_ews_failure_does_not_repeat_matches():
    class LateFailure(_Query):
        def __getitem__(self, page):
            if page.start:
                raise RuntimeError("second page failed")
            return super().__getitem__(page)

    class RestrictedQuery(_Query):
        def filter(self, restriction):
            return LateFailure(self._items)

    listing = _build_listing(
        folders={"inbox": [_item(f"hit-{i}", subject="Needle", minute=i) for i in range(3)]},
        queryset=RestrictedQuery,
    )

    result = listing.list_messages(account=object(), subject_filter="needle")

    assert [item["id"] for item in result.payload["items"]] == ["hit-2", "hit-1", "hit-0"]


def test_date_filter_keeps_drafts_with_creation_date():
    created_only = _item("draft")
    created_only.datetime_created = created_only.datetime_received
    created_only.datetime_received = None

    class DateQuery(_Query):
        def filter(self, restriction):
            if "datetime_created" in _q_field_paths(restriction):
                return self
            return _Query([item for item in self._items if item.datetime_received])

    listing = _build_listing(folders={"drafts": [created_only]}, queryset=DateQuery)
    result = listing.list_messages(account=object(), folder="drafts", date_from="2026-05-04")

    assert [item["id"] for item in result.payload["items"]] == ["draft"]


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


def test_message_listing_pushes_supported_search_to_server_side_filter():
    calls = {}
    items = [
        _item("skip", subject="Other", minute=1),
        _item("keep", subject="Needle", minute=2),
    ]

    listing = MailMessageListBuilder(
        search_target_folders=lambda _account, folder="inbox", folder_scope="current": [(items, "inbox")],
        folder_queryset=lambda folder_obj, folder_key, preview_only=False: _ServerFilteringQuery(folder_obj, calls),
        folder_total_hint=lambda folder_obj, unread_only=False: len(folder_obj),
        serialize_message_preview=lambda *, item, folder_key, mailbox_id=None, mailbox_email="": {
            "id": item.id,
            "received_at": item.datetime_received.isoformat(),
            "folder": folder_key,
        },
        message_matches_filters=lambda item, **filters: message_matches_filters(
            item,
            item_sender=lambda value: value.sender,
            item_recipients=lambda value: value.recipients,
            item_importance=lambda value: value.importance,
            **filters,
        ),
        parse_date_filter=lambda value: None,
        search_batch_size=10,
        search_window_limit=lambda: 50,
    )

    result = listing.list_messages(account=object(), folder="inbox", q="needle")

    assert calls["server_filter_used"] == 1
    assert [item["id"] for item in result.payload["items"]] == ["keep"]


def test_server_side_restriction_uses_only_exchange_supported_fields():
    restriction = build_server_side_restriction(
        query_text="needle",
        has_attachments=True,
        date_from=date(2026, 5, 1),
        date_to=date(2026, 5, 5),
        subject_filter="subject",
        importance_filter="high",
    )

    assert restriction is not None
    field_paths = _q_field_paths(restriction)
    assert field_paths == {
        "subject",
        "body",
        "sender",
        "author",
        "display_to",
        "display_cc",
        "has_attachments",
        "importance",
        "datetime_received",
        "datetime_created",
    }


def test_server_side_restriction_includes_explicit_body_filter():
    """The dedicated "Текст письма" field must hit the Exchange body index the
    same way the free-text query does (MAIL-08)."""
    restriction = build_server_side_restriction(body_filter="needle")
    assert restriction is not None
    assert _q_field_paths(restriction) == {"body"}


def test_cyrillic_query_skips_unfiltered_supplement_scan():
    """Recipient *names* are indexed server-side (display_to/display_cc); a
    non-ASCII query cannot match a bare SMTP address, so the unfiltered
    sweep must not run at all."""
    calls = {}
    listing = _build_listing(
        folders={"inbox": [_item("a", subject="Иголка"), _item("b", subject="Другое"), _item("c", subject="Ещё")]},
        calls=calls,
        queryset=lambda items: _TrustingFilterQuery(items, calls),
    )

    result = listing.list_messages(account=object(), q="иголка")

    assert [item["id"] for item in result.payload["items"]] == ["a"]
    assert calls.get("unfiltered_reads", 0) == 0


def test_ascii_query_runs_unfiltered_supplement_for_recipient_addresses():
    """An ASCII query can live only in a To/Cc SMTP address — the server
    restriction cannot see those, so the supplement sweep must still run."""
    calls = {}
    listing = _build_listing(
        folders={"inbox": [_item("a", subject="needle"), _item("b", recipients=["needle@example.test"])]},
        calls=calls,
        queryset=lambda items: _TrustingFilterQuery(items, calls),
    )

    result = listing.list_messages(account=object(), q="needle")

    assert {item["id"] for item in result.payload["items"]} == {"a", "b"}
    assert calls.get("unfiltered_reads", 0) > 0


def test_page_window_cap_stops_paging_once_boundary_is_strictly_older():
    """With enough accepted matches and a strictly-older fetched tail the
    folder must stop paging; the merged page stays exact."""
    calls = {}
    items = [_item(f"i{i}", subject="needle", minute=10 - i) for i in range(6)]
    listing = _build_listing(
        folders={"inbox": items},
        calls=calls,
        queryset=lambda folder_items: _TrustingFilterQuery(folder_items, calls),
    )

    result = listing.list_messages(account=object(), q="needle", limit=1)

    assert [entry["id"] for entry in result.payload["items"]] == ["i0"]
    # batch_size=2: the filtered pass must stop after 2+2 items — the cap
    # stops it once the fetched tail is strictly older than the boundary.
    assert calls.get("filtered_reads", 0) == 4
    assert result.payload["has_more"]


def test_query_and_recipient_filters_match_display_names():
    item = _item("x", subject="Report")

    def _match(**filters):
        return message_matches_filters(
            item,
            item_sender=lambda _value: "murtaev@example.test",
            item_recipients=lambda _value: ["kalinichenko@example.test"],
            item_importance=lambda _value: "normal",
            item_sender_display=lambda _value: "Муртаев Шамиль",
            item_recipient_displays=lambda _value: ["Калиниченко Валентина"],
            **filters,
        )

    assert _match(query_text="муртаев")
    assert _match(query_text="калиниченко")
    assert _match(from_filter="шамиль")
    assert _match(to_filter="валентина")
    assert not _match(query_text="петров")


def test_message_listing_falls_back_to_unfiltered_scan_when_server_filter_fails(caplog):
    items = [
        _item("keep", subject="Needle", minute=1),
        _item("skip", subject="Other", minute=2),
    ]
    listing = MailMessageListBuilder(
        search_target_folders=lambda _account, folder="inbox", folder_scope="current": [(items, "inbox")],
        folder_queryset=lambda folder_obj, folder_key, preview_only=False: _RejectedFilterQuery(folder_obj),
        folder_total_hint=lambda folder_obj, unread_only=False: len(folder_obj),
        serialize_message_preview=lambda *, item, folder_key, mailbox_id=None, mailbox_email="": {
            "id": item.id,
            "received_at": item.datetime_received.isoformat(),
            "folder": folder_key,
        },
        message_matches_filters=lambda item, **filters: message_matches_filters(
            item,
            item_sender=lambda value: value.sender,
            item_recipients=lambda value: value.recipients,
            item_importance=lambda value: value.importance,
            **filters,
        ),
        parse_date_filter=lambda value: None,
        search_batch_size=10,
        search_window_limit=lambda: 50,
    )

    with caplog.at_level("WARNING"):
        result = listing.list_messages(account=object(), folder="inbox", q="needle")

    assert [item["id"] for item in result.payload["items"]] == ["keep"]
    assert result.searched_window == 2
    assert result.payload["skipped_folders"] == 0
    assert any("server-side filter failed" in record.getMessage() for record in caplog.records)


def test_message_listing_skips_failed_folder_in_all_scope():
    good_items = [_item("keep", subject="Needle", minute=1)]

    def _targets(_account, folder="inbox", folder_scope="current"):
        if folder_scope == "all":
            return [(["broken"], "broken"), (good_items, "inbox")]
        return [(good_items, folder)]

    def _queryset(folder_obj, folder_key, preview_only=False):
        if folder_key == "broken":
            raise RuntimeError("folder unreadable")
        return _Query(folder_obj)

    listing = MailMessageListBuilder(
        search_target_folders=_targets,
        folder_queryset=_queryset,
        folder_total_hint=lambda folder_obj, unread_only=False: len(folder_obj),
        serialize_message_preview=lambda *, item, folder_key, mailbox_id=None, mailbox_email="": {
            "id": item.id,
            "received_at": item.datetime_received.isoformat(),
            "folder": folder_key,
        },
        message_matches_filters=lambda item, **filters: message_matches_filters(
            item,
            item_sender=lambda value: value.sender,
            item_recipients=lambda value: value.recipients,
            item_importance=lambda value: value.importance,
            **filters,
        ),
        parse_date_filter=lambda value: None,
        search_batch_size=10,
        search_window_limit=lambda: 50,
    )

    result = listing.list_messages(account=object(), folder="inbox", folder_scope="all", q="needle")

    assert [item["id"] for item in result.payload["items"]] == ["keep"]
    assert result.payload["skipped_folders"] == 1
    assert result.skipped_folders == 1


def test_message_listing_raises_failed_folder_in_current_scope():
    listing = MailMessageListBuilder(
        search_target_folders=lambda _account, folder="inbox", folder_scope="current": [(["x"], folder)],
        folder_queryset=lambda folder_obj, folder_key, preview_only=False: (_ for _ in ()).throw(
            RuntimeError("folder unreadable")
        ),
        folder_total_hint=lambda folder_obj, unread_only=False: len(folder_obj),
        serialize_message_preview=lambda *, item, folder_key, mailbox_id=None, mailbox_email="": {},
        message_matches_filters=lambda item, **filters: True,
        parse_date_filter=lambda value: None,
        search_batch_size=10,
        search_window_limit=lambda: 50,
    )

    with pytest.raises(RuntimeError):
        listing.list_messages(account=object(), folder="inbox", q="needle")


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

def _build_multi_listing(*, targets, multi, calls):
    """Listing with a multi_folder_queryset fake; targets carry .id/.items."""

    def _search_target_folders(_account, folder="inbox", folder_scope="current"):
        if folder_scope == "all":
            return list(targets)
        return [targets[0]]

    return MailMessageListBuilder(
        search_target_folders=_search_target_folders,
        folder_queryset=lambda folder_obj, folder_key, preview_only=False: (
            calls.setdefault("per_folder", []).append(folder_key)
            or _ServerFilteringQuery(folder_obj.items, {})
        ),
        folder_total_hint=lambda folder_obj, unread_only=False: len(folder_obj.items),
        serialize_message_preview=lambda *, item, folder_key, mailbox_id=None, mailbox_email="": {
            "id": item.id,
            "received_at": (item.datetime_received or item.datetime_created).isoformat(),
            "folder": folder_key,
        },
        message_matches_filters=lambda item, **filters: message_matches_filters(
            item,
            item_sender=lambda value: value.sender,
            item_recipients=lambda value: value.recipients,
            item_importance=lambda value: value.importance,
            **filters,
        ),
        parse_date_filter=lambda value: None,
        search_batch_size=10,
        search_window_limit=lambda: 50,
        multi_folder_queryset=multi,
        multi_folder_batch=2,
    )


def _folder_items(folder_id, items):
    folder = SimpleNamespace(id=folder_id, items=items)
    for item in items:
        item.parent_folder_id = SimpleNamespace(id=folder_id)
    return folder


def test_multi_folder_search_batches_one_query_and_keeps_folder_keys():
    calls = {}
    f1 = _folder_items("f1", [_item("in-1", subject="Needle", minute=5)])
    f2 = _folder_items("f2", [_item("sn-1", subject="Needle", minute=4)])
    f3 = _folder_items("f3", [_item("ot-1", subject="Other", minute=3)])

    listing = _build_multi_listing(
        targets=[(f1, "inbox"), (f2, "sent"), (f3, "other")],
        multi=lambda account, folders, restriction, preview_only=True, unread_only=False: (
            calls.setdefault("multi", []).append(len(folders))
            or _Query([item for f in folders for item in f.items])
        ),
        calls=calls,
    )

    result = listing.list_messages(account=object(), q="needle", folder_scope="all")

    assert calls["multi"], "multi-folder path was not used"
    assert "per_folder" not in calls
    by_folder = {item["id"]: item["folder"] for item in result.payload["items"]}
    assert by_folder == {"in-1": "inbox", "sn-1": "sent"}


def test_multi_folder_search_falls_back_per_folder_when_batch_fails():
    calls = {}
    f1 = _folder_items("f1", [_item("in-1", subject="Needle", minute=5)])
    f2 = _folder_items("f2", [_item("sn-1", subject="Needle", minute=4)])
    f3 = _folder_items("f3", [_item("ot-1", subject="Needle", minute=3)])

    def _failing_multi(account, folders, restriction, preview_only=True, unread_only=False):
        raise RuntimeError("batch FindItem failed")

    listing = _build_multi_listing(
        targets=[(f1, "inbox"), (f2, "sent"), (f3, "other")],
        multi=_failing_multi,
        calls=calls,
    )

    result = listing.list_messages(account=object(), q="needle", folder_scope="all")

    assert set(calls.get("per_folder", [])) == {"inbox", "sent", "other"}
    assert {item["id"] for item in result.payload["items"]} == {"in-1", "sn-1", "ot-1"}


def test_multi_folder_search_falls_back_when_parent_ids_do_not_resolve():
    calls = {}
    item = _item("in-1", subject="Needle", minute=5)
    folder_a = SimpleNamespace(id="f1", items=[item])
    folder_b = SimpleNamespace(id="f2", items=[])
    folder_c = SimpleNamespace(id="f3", items=[])
    # EWS returned an id format the target map cannot resolve.
    item.parent_folder_id = SimpleNamespace(id="UNMAPPED")

    listing = _build_multi_listing(
        targets=[(folder_a, "inbox"), (folder_b, "sent"), (folder_c, "other")],
        multi=lambda account, folders, restriction, preview_only=True, unread_only=False: (
            calls.setdefault("multi", []).append(len(folders))
            or _Query([i for f in folders for i in f.items])
        ),
        calls=calls,
    )

    result = listing.list_messages(account=object(), q="needle", folder_scope="all")

    assert "per_folder" in calls, "unresolvable parent ids must re-scan per folder"
    assert [item["id"] for item in result.payload["items"]] == ["in-1"]
