from __future__ import annotations

import importlib
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_module = importlib.import_module("backend.services.mail_service")
mail_api_module = importlib.import_module("backend.api.v1.mail")


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'mail_app.db').as_posix()}"


def test_mail_service_supports_app_db_backend(temp_dir, monkeypatch):
    store = SimpleNamespace(db_path=str(Path(temp_dir) / "legacy_mail.sqlite3"))
    monkeypatch.setattr(mail_module, "get_local_store", lambda: store)

    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))

    created = service.create_template(
        payload={
            "code": "it-onboarding",
            "title": "IT Onboarding",
            "category": "requests",
            "subject_template": "Welcome {{full_name}}",
            "body_template_md": "Hello {{full_name}}",
            "fields": [
                {
                    "key": "department",
                    "label": "Department",
                    "type": "text",
                    "required": True,
                    "placeholder": "",
                    "help_text": "",
                    "default_value": "",
                    "options": [],
                    "order": 0,
                },
            ],
        },
        actor={"id": 1, "username": "admin"},
    )

    templates = service.list_templates(active_only=False)
    assert len(templates) == 1
    assert templates[0]["id"] == created["id"]
    assert templates[0]["code"] == "it-onboarding"

    custom_folder_id = service._encode_folder_id("mailbox", "custom-folder-1")
    service._set_custom_folder_visible(user_id=7, folder_id=custom_folder_id, visible=True)
    assert custom_folder_id in service._list_visible_custom_folder_ids(user_id=7)
    service._purge_custom_folder_visibility(user_id=7, folder_ids={custom_folder_id})
    assert custom_folder_id not in service._list_visible_custom_folder_ids(user_id=7)

    service.set_folder_favorite(user_id=7, folder_id="inbox", favorite=True)
    favorites = service._list_favorite_folder_ids(user_id=7)
    assert "inbox" in favorites

    updated_prefs = service.update_preferences(
        user_id=7,
        payload={
            "reading_pane": "bottom",
            "density": "compact",
            "mark_read_on_select": True,
        },
    )
    assert updated_prefs["preferences"]["reading_pane"] == "bottom"
    assert updated_prefs["preferences"]["density"] == "compact"
    assert updated_prefs["preferences"]["mark_read_on_select"] is True

    service._set_restore_hint(
        user_id=7,
        trash_exchange_id="trash-1",
        restore_folder="inbox",
        source_exchange_id="source-1",
    )
    restore_hint = service._get_restore_hint(user_id=7, trash_exchange_id="trash-1")
    assert restore_hint is not None
    assert restore_hint["source_exchange_id"] == "source-1"

    service._save_draft_context(
        user_id=7,
        draft_exchange_id="draft-1",
        compose_mode="reply",
        reply_to_message_id="msg-1",
    )
    draft_context = service._get_draft_context(user_id=7, draft_exchange_id="draft-1")
    assert draft_context is not None
    assert draft_context["compose_mode"] == "reply"
    assert draft_context["reply_to_message_id"] == "msg-1"


def test_mail_service_caches_message_detail_payload(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))
    item = SimpleNamespace(id="exchange-1")
    calls = {"context": 0, "serialize": 0}

    def _get_message_context(*, user_id, message_id):
        calls["context"] += 1
        return {
            "item": item,
            "folder_key": "inbox",
            "profile": {"email": "user@example.com"},
            "exchange_id": "exchange-1",
        }

    def _serialize_message_detail(**kwargs):
        calls["serialize"] += 1
        return {
            "id": "msg-1",
            "folder": kwargs["folder_key"],
            "subject": "Cached subject",
        }

    monkeypatch.setattr(service, "_get_message_context", _get_message_context)
    monkeypatch.setattr(service, "_serialize_message_detail", _serialize_message_detail)
    monkeypatch.setattr(service, "_get_restore_hint", lambda **kwargs: None)
    monkeypatch.setattr(service, "_get_draft_context", lambda **kwargs: None)

    first = service.get_message(user_id=7, message_id="msg-1")
    second = service.get_message(user_id=7, message_id="msg-1")

    assert first == second
    assert calls["context"] == 1
    assert calls["serialize"] == 1

    service.invalidate_user_cache(user_id=7, prefixes=("message_detail",))
    service.get_message(user_id=7, message_id="msg-1")
    assert calls["context"] == 2


def test_mail_service_caches_conversation_detail_payload(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))
    item = SimpleNamespace(id="exchange-1")
    calls = {"find": 0, "serialize": 0}

    monkeypatch.setattr(service, "_resolve_user_mail_profile", lambda user_id, require_password=True: {
        "email": "user@example.com",
        "login": "user@example.com",
        "password": "secret",
    })
    monkeypatch.setattr(service, "_create_account", lambda **kwargs: object())

    def _find_conversation_items(**kwargs):
        calls["find"] += 1
        return "conv-1", [(item, "inbox")], "inbox"

    def _serialize_message_detail(**kwargs):
        calls["serialize"] += 1
        return {
            "id": "msg-1",
            "subject": "Conversation item",
            "sender": "boss@example.com",
            "to": ["user@example.com"],
            "cc": [],
            "received_at": "2026-04-03T09:00:00Z",
            "is_read": True,
        }

    monkeypatch.setattr(service, "_find_conversation_items", _find_conversation_items)
    monkeypatch.setattr(service, "_serialize_message_detail", _serialize_message_detail)

    first = service.get_conversation(user_id=7, conversation_id="conv-1", folder="inbox", folder_scope="current")
    second = service.get_conversation(user_id=7, conversation_id="conv-1", folder="inbox", folder_scope="current")

    assert first == second
    assert calls["find"] == 1
    assert calls["serialize"] == 1

    service.invalidate_user_cache(user_id=7, prefixes=("conversation_detail",))
    service.get_conversation(user_id=7, conversation_id="conv-1", folder="inbox", folder_scope="current")
    assert calls["find"] == 2


def test_mail_service_updates_cached_message_detail_read_state(temp_dir):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))
    service._cache_set(
        user_id=7,
        bucket="message_detail",
        extra="msg-1",
        value={
            "id": "msg-1",
            "subject": "Cached subject",
            "is_read": False,
        },
    )

    service._update_cached_message_detail_read_state(
        user_id=7,
        message_id="msg-1",
        is_read=True,
    )

    cached = service._cached_message_detail(user_id=7, message_id="msg-1")
    assert cached is not None
    assert cached["is_read"] is True


def test_mail_service_expires_runtime_cache_entries_by_ttl(temp_dir):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))
    service._cache_set(
        user_id=7,
        bucket="message_detail",
        extra="ttl-msg",
        value={"id": "ttl-msg"},
        ttl_sec=1,
    )

    assert service._cached_message_detail(user_id=7, message_id="ttl-msg") is not None

    time.sleep(1.1)

    assert service._cached_message_detail(user_id=7, message_id="ttl-msg") is None


def test_mail_service_enforces_runtime_cache_lru_limit(temp_dir):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))

    for index in range(301):
        service._cache_set(
            user_id=7,
            bucket="message_detail",
            extra=f"msg-{index}",
            value={"id": f"msg-{index}"},
        )

    assert service._cached_message_detail(user_id=7, message_id="msg-0") is None
    assert service._cached_message_detail(user_id=7, message_id="msg-300") == {"id": "msg-300"}


def test_mail_service_skips_attachment_cache_for_large_payloads(temp_dir):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))
    large_payload = ("large.bin", "application/octet-stream", b"x" * (2 * 1024 * 1024 + 1))

    service._cache_set(
        user_id=7,
        bucket="attachment_content",
        extra="msg-1|att-1",
        value=large_payload,
    )

    assert service._cached_attachment_content(
        user_id=7,
        message_id="msg-1",
        attachment_id="att-1",
    ) is None


def test_mail_service_limits_filtered_message_scan_window(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))
    monkeypatch.setattr(mail_module.MailService, "search_window_limit", property(lambda self: 3))

    class _Query:
        def __init__(self, items):
            self._items = list(items)

        def filter(self, **kwargs):
            return self

        def __getitem__(self, key):
            if isinstance(key, slice):
                return self._items[key]
            return self._items[key]

    items = [SimpleNamespace(id=f"exchange-{index}") for index in range(5)]

    monkeypatch.setattr(service, "_search_target_folders", lambda *args, **kwargs: [(object(), "inbox")])
    monkeypatch.setattr(service, "_folder_queryset", lambda *args, **kwargs: _Query(items))
    monkeypatch.setattr(service, "_message_matches_filters", lambda *args, **kwargs: True)
    monkeypatch.setattr(
        service,
        "_serialize_message_preview_for_mailbox",
        lambda *, item, folder_key, mailbox_id=None: {
            "id": item.id,
            "received_at": item.id,
            "folder": folder_key,
        },
    )

    result = service._list_messages_from_account(
        account=object(),
        mailbox_id="mbox-1",
        folder="inbox",
        folder_scope="all",
        limit=10,
        offset=0,
        q="boss",
    )

    assert result["search_limited"] is True
    assert result["searched_window"] == 3
    assert [item["id"] for item in result["items"]] == ["exchange-2", "exchange-1", "exchange-0"]


def test_mail_service_singleflight_collapses_concurrent_get_message(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))
    item = SimpleNamespace(id="exchange-1")
    calls = {"context": 0, "serialize": 0}

    def _get_message_context(*, user_id, message_id):
        calls["context"] += 1
        time.sleep(0.05)
        return {
            "item": item,
            "folder_key": "inbox",
            "profile": {"email": "user@example.com"},
            "exchange_id": "exchange-1",
        }

    def _serialize_message_detail(**kwargs):
        calls["serialize"] += 1
        return {
            "id": "msg-1",
            "folder": kwargs["folder_key"],
            "subject": "Singleflight subject",
        }

    monkeypatch.setattr(service, "_get_message_context", _get_message_context)
    monkeypatch.setattr(service, "_serialize_message_detail", _serialize_message_detail)
    monkeypatch.setattr(service, "_get_restore_hint", lambda **kwargs: None)
    monkeypatch.setattr(service, "_get_draft_context", lambda **kwargs: None)

    with ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(lambda _: service.get_message(user_id=7, message_id="msg-1"), range(6)))

    assert all(result == results[0] for result in results)
    assert calls["context"] == 1
    assert calls["serialize"] == 1


def test_mail_service_defers_unread_for_non_active_mailboxes(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))
    rows = [
        {"id": "mbox-1", "label": "Primary", "mailbox_email": "user@example.com", "is_active": True},
        {"id": "mbox-2", "label": "Ops", "mailbox_email": "ops@example.com", "is_active": True},
        {"id": "mbox-3", "label": "Archive", "mailbox_email": "archive@example.com", "is_active": False},
    ]
    unread_calls = []

    monkeypatch.setattr(mail_module.user_service, "get_by_id", lambda user_id: {"id": user_id, "mail_signature_html": ""})
    monkeypatch.setattr(service, "_list_user_mailboxes_rows", lambda **kwargs: rows)
    monkeypatch.setattr(service, "_resolve_mailbox_row", lambda **kwargs: rows[0])
    monkeypatch.setattr(
        service,
        "_serialize_mailbox_entry",
        lambda *, user, mailbox_row, unread_count=0, unread_count_state="deferred", selected=False: {
            "id": mailbox_row["id"],
            "unread_count": unread_count,
            "unread_count_state": unread_count_state,
            "is_selected": selected,
        },
    )
    monkeypatch.setattr(
        service,
        "_get_mailbox_unread_count",
        lambda *, user_id, mailbox_id: unread_calls.append(mailbox_id) or 4,
    )
    service._cache_set(
        user_id=7,
        bucket="unread_count",
        mailbox_scope="mbox-1",
        value=9,
    )

    items = service.list_user_mailboxes(
        user_id=7,
        include_inactive=True,
        include_unread=False,
        active_mailbox_id="mbox-2",
    )

    assert unread_calls == ["mbox-2"]
    assert items == [
        {"id": "mbox-1", "unread_count": 9, "unread_count_state": "stale", "is_selected": True},
        {"id": "mbox-2", "unread_count": 4, "unread_count_state": "fresh", "is_selected": False},
        {"id": "mbox-3", "unread_count": 0, "unread_count_state": "deferred", "is_selected": False},
    ]


def test_mail_service_serializes_inline_attachment_metadata(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))

    monkeypatch.setattr(service, "_item_sender", lambda item: "boss@example.com")
    monkeypatch.setattr(service, "_item_bcc_recipients", lambda item: [])
    monkeypatch.setattr(service, "_item_importance", lambda item: "normal")
    monkeypatch.setattr(service, "_item_message_id", lambda item: "<message-id@example.com>")
    monkeypatch.setattr(service, "_item_conversation_key", lambda item: "conv-1")
    monkeypatch.setattr(service, "build_compose_context", lambda item, mailbox_email: {})

    inline_attachment = SimpleNamespace(
        attachment_id=SimpleNamespace(id="att-inline"),
        name="logo.png",
        content_type="image/png",
        size=128,
        content_id="<logo123>",
        is_inline=True,
        content=b"png-bytes",
    )
    file_attachment = SimpleNamespace(
        attachment_id=SimpleNamespace(id="att-file"),
        name="report.pdf",
        content_type="application/pdf",
        size=512,
        content_id="",
        is_inline=False,
    )
    item = SimpleNamespace(
        id="exchange-1",
        subject="Inline preview",
        body='<p><img src="cid:logo123" /></p>',
        text_body="Inline preview",
        to_recipients=[],
        cc_recipients=[],
        categories=[],
        reminder_is_set=False,
        reminder_due_by=None,
        is_read=True,
        attachments=[inline_attachment, file_attachment],
    )

    detail = service._serialize_message_detail(
        item=item,
        folder_key="inbox",
        mailbox_email="user@example.com",
        include_inline_data_urls=True,
    )

    assert detail["attachments"][0]["content_id"] == "logo123"
    assert detail["attachments"][0]["is_inline"] is True
    assert detail["attachments"][0]["inline_src"]
    assert detail["attachments"][0]["inline_src"].endswith("?disposition=inline")
    assert detail["attachments"][0]["inline_data_url"].startswith("data:image/png;base64,")
    assert detail["attachments"][1]["content_id"] == ""
    assert detail["attachments"][1]["is_inline"] is False
    assert detail["attachments"][1]["inline_src"] is None
    assert detail["attachments"][1]["inline_data_url"] is None


def test_build_outgoing_html_body_uses_no_forced_background_and_standard_font():
    result = mail_module._build_outgoing_html_body("<p>Hello</p>", "")

    assert 'data-mail-outgoing="true"' in result
    assert "background:#ffffff;" not in result
    assert "color:#000000;" not in result
    assert "font-family:Aptos, Calibri, Arial, Helvetica, sans-serif;" in result
    assert "font-size:11pt;" in result
    assert "<p>Hello</p>" in result


def test_build_outgoing_html_body_places_signature_before_quoted_history():
    result = mail_module._build_outgoing_html_body(
        '<p>New message</p><div class="quoted-mail"><blockquote><p>Old message</p></blockquote></div>',
        '<p>--<br>Signature</p>',
        prefer_signature_before_quote=True,
    )

    signature_index = result.index('data-mail-signature="true"')
    quoted_index = result.index('data-mail-quoted-block="true"')

    assert signature_index < quoted_index
    assert result.index("Signature") < result.index("Old message")
    assert result.index("New message") < signature_index


def test_normalize_signature_html_strips_outgoing_preview_wrappers():
    result = mail_module._normalize_signature_html(
        '<div data-mail-outgoing="true" style="background:#ffffff;">'
        '<div data-mail-signature="true" style="margin:0 0 0 0;"><p>--<br>Signature</p></div>'
        '</div>'
    )

    assert '<p style="margin:0 0 4px 0;line-height:1.35;">--<br>Signature</p>' in result


def test_build_outgoing_html_body_compacts_signature_paragraph_spacing():
    result = mail_module._build_outgoing_html_body(
        "<p>Hello</p>",
        '<p>С уважением,</p><p style="color:#003b71">Максим Козловский</p><p>Тел.: +7</p>',
    )

    assert 'data-mail-signature="true"' in result
    assert '<p style="margin:0 0 4px 0;line-height:1.35;">С уважением,</p>' in result
    assert '<p style="color:#003b71;margin:0 0 4px 0;line-height:1.35;">Максим Козловский</p>' in result
    assert "<p>С уважением," not in result


def test_build_outgoing_html_body_normalizes_dark_theme_white_text():
    result = mail_module._build_outgoing_html_body(
        '<p style="color:#ffffff !important">Typed text</p>',
        '<p style="color:rgb(255,255,255)">Signature</p>',
    )

    assert "Typed text" in result
    assert "Signature" in result
    assert "color:#000000;" in result
    assert "color:#ffffff" not in result.lower()
    assert "rgb(255,255,255)" not in result.lower()


def test_mail_folder_tree_uses_summary_snapshot_for_standard_counts(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))

    inbox = SimpleNamespace(id="folder-inbox", name="Inbox", child_folder_count=0, total_count=999, unread_count=999, parent=None)
    sent = SimpleNamespace(id="folder-sent", name="Sent", child_folder_count=0, total_count=999, unread_count=999, parent=None)
    drafts = SimpleNamespace(id="folder-drafts", name="Drafts", child_folder_count=0, total_count=999, unread_count=999, parent=None)
    trash = SimpleNamespace(id="folder-trash", name="Trash", child_folder_count=0, total_count=999, unread_count=999, parent=None)
    junk = SimpleNamespace(id="folder-junk", name="Junk", child_folder_count=0, total_count=999, unread_count=999, parent=None)
    account = SimpleNamespace(
        inbox=inbox,
        sent=sent,
        drafts=drafts,
        trash=trash,
        junk=junk,
        msg_folder_root=SimpleNamespace(id="mail-root"),
        archive_msg_folder_root=None,
        archive_inbox=None,
    )

    monkeypatch.setattr(service, "_list_favorite_folder_ids", lambda **kwargs: set())
    monkeypatch.setattr(service, "_list_visible_custom_folder_ids", lambda **kwargs: set())
    monkeypatch.setattr(
        service,
        "_walk_folder_targets",
        lambda _account: [
            (inbox, "inbox", "mailbox"),
            (sent, "sent", "mailbox"),
            (drafts, "drafts", "mailbox"),
            (trash, "trash", "mailbox"),
            (junk, "junk", "mailbox"),
        ],
    )

    def _folder_counts(_folder):
        raise AssertionError("standard folder counts should come from summary snapshot")

    monkeypatch.setattr(service, "_folder_counts", _folder_counts)

    tree = service._list_folder_tree_from_account(
        user_id=7,
        account=account,
        summary={
            "inbox": {"total": 5, "unread": 2},
            "sent": {"total": 3, "unread": 0},
            "drafts": {"total": 1, "unread": 0},
            "trash": {"total": 4, "unread": 0},
            "junk": {"total": 2, "unread": 1},
        },
    )

    inbox_node = next(item for item in tree["items"] if item["id"] == "inbox")
    sent_node = next(item for item in tree["items"] if item["id"] == "sent")

    assert inbox_node["total"] == 5
    assert inbox_node["unread"] == 2
    assert sent_node["total"] == 3
    assert sent_node["unread"] == 0


def test_mail_folder_tree_includes_exchange_custom_children_without_visibility_snapshot(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))

    inbox = SimpleNamespace(id="folder-inbox", name="Inbox", child_folder_count=1, total_count=5, unread_count=2, parent=None)
    sent = SimpleNamespace(id="folder-sent", name="Sent", child_folder_count=0, total_count=0, unread_count=0, parent=None)
    drafts = SimpleNamespace(id="folder-drafts", name="Drafts", child_folder_count=0, total_count=0, unread_count=0, parent=None)
    trash = SimpleNamespace(id="folder-trash", name="Trash", child_folder_count=0, total_count=0, unread_count=0, parent=None)
    junk = SimpleNamespace(id="folder-junk", name="Junk", child_folder_count=0, total_count=0, unread_count=0, parent=None)
    child = SimpleNamespace(
        id="custom-child-1",
        name="Projects",
        child_folder_count=0,
        total_count=3,
        unread_count=1,
        parent=SimpleNamespace(id="folder-inbox"),
    )
    account = SimpleNamespace(
        inbox=inbox,
        sent=sent,
        drafts=drafts,
        trash=trash,
        junk=junk,
        msg_folder_root=SimpleNamespace(id="mail-root"),
        archive_msg_folder_root=None,
        archive_inbox=None,
    )
    child_folder_id = service._encode_folder_id("mailbox", "custom-child-1")

    monkeypatch.setattr(service, "_list_favorite_folder_ids", lambda **kwargs: set())
    monkeypatch.setattr(service, "_list_visible_custom_folder_ids", lambda **kwargs: set())
    monkeypatch.setattr(
        service,
        "_walk_folder_targets",
        lambda _account: [
            (inbox, "inbox", "mailbox"),
            (sent, "sent", "mailbox"),
            (drafts, "drafts", "mailbox"),
            (trash, "trash", "mailbox"),
            (junk, "junk", "mailbox"),
            (child, child_folder_id, "mailbox"),
        ],
    )

    tree = service._list_folder_tree_from_account(
        user_id=7,
        account=account,
        summary={
            "inbox": {"total": 5, "unread": 2},
            "sent": {"total": 0, "unread": 0},
            "drafts": {"total": 0, "unread": 0},
            "trash": {"total": 0, "unread": 0},
            "junk": {"total": 0, "unread": 0},
        },
    )

    child_node = next(item for item in tree["items"] if item["id"] == child_folder_id)

    assert child_node["label"] == "Projects"
    assert child_node["parent_id"] == "inbox"
    assert child_node["scope"] == "mailbox"


def test_mail_folder_tree_filters_non_mail_exchange_system_folders(temp_dir, monkeypatch):
    service = mail_module.MailService(database_url=_sqlite_url(temp_dir))

    inbox = SimpleNamespace(id="folder-inbox", name="Inbox", child_folder_count=1, total_count=5, unread_count=2, parent=None, folder_class="IPF.Note")
    sent = SimpleNamespace(id="folder-sent", name="Sent", child_folder_count=0, total_count=0, unread_count=0, parent=None, folder_class="IPF.Note")
    drafts = SimpleNamespace(id="folder-drafts", name="Drafts", child_folder_count=0, total_count=0, unread_count=0, parent=None, folder_class="IPF.Note")
    trash = SimpleNamespace(id="folder-trash", name="Trash", child_folder_count=0, total_count=0, unread_count=0, parent=None, folder_class="IPF.Note")
    junk = SimpleNamespace(id="folder-junk", name="Junk", child_folder_count=0, total_count=0, unread_count=0, parent=None, folder_class="IPF.Note")
    contact_root = SimpleNamespace(
        id="contacts-root",
        name="Contacts",
        child_folder_count=1,
        total_count=0,
        unread_count=0,
        parent=SimpleNamespace(id="mail-root"),
        folder_class="IPF.Contact",
    )
    hidden_child = SimpleNamespace(
        id="contact-child",
        name="Recipient Cache",
        child_folder_count=0,
        total_count=0,
        unread_count=0,
        parent=SimpleNamespace(id="contacts-root"),
        folder_class="",
    )
    conversation_settings = SimpleNamespace(
        id="conv-settings",
        name="Conversation Action Settings",
        child_folder_count=0,
        total_count=0,
        unread_count=0,
        parent=SimpleNamespace(id="mail-root"),
        folder_class="IPF.Configuration",
    )
    rss = SimpleNamespace(
        id="rss-root",
        name="RSS-каналы",
        child_folder_count=0,
        total_count=0,
        unread_count=0,
        parent=SimpleNamespace(id="mail-root"),
        folder_class="IPF.Note.OutlookHomepage",
    )
    inbox_child = SimpleNamespace(
        id="custom-inbox-child",
        name="Projects",
        child_folder_count=0,
        total_count=3,
        unread_count=1,
        parent=SimpleNamespace(id="folder-inbox"),
        folder_class="IPF.Note",
    )
    account = SimpleNamespace(
        inbox=inbox,
        sent=sent,
        drafts=drafts,
        trash=trash,
        junk=junk,
        msg_folder_root=SimpleNamespace(id="mail-root"),
        archive_msg_folder_root=None,
        archive_inbox=None,
    )
    rss_folder_id = service._encode_folder_id("mailbox", "rss-root")
    inbox_child_folder_id = service._encode_folder_id("mailbox", "custom-inbox-child")
    contact_root_folder_id = service._encode_folder_id("mailbox", "contacts-root")
    hidden_child_folder_id = service._encode_folder_id("mailbox", "contact-child")
    conversation_settings_folder_id = service._encode_folder_id("mailbox", "conv-settings")

    monkeypatch.setattr(service, "_list_favorite_folder_ids", lambda **kwargs: set())
    monkeypatch.setattr(service, "_list_visible_custom_folder_ids", lambda **kwargs: set())
    monkeypatch.setattr(
        service,
        "_walk_folder_targets",
        lambda _account: [
            (inbox, "inbox", "mailbox"),
            (sent, "sent", "mailbox"),
            (drafts, "drafts", "mailbox"),
            (trash, "trash", "mailbox"),
            (junk, "junk", "mailbox"),
            (contact_root, contact_root_folder_id, "mailbox"),
            (hidden_child, hidden_child_folder_id, "mailbox"),
            (conversation_settings, conversation_settings_folder_id, "mailbox"),
            (rss, rss_folder_id, "mailbox"),
            (inbox_child, inbox_child_folder_id, "mailbox"),
        ],
    )

    tree = service._list_folder_tree_from_account(
        user_id=7,
        account=account,
        summary={
            "inbox": {"total": 5, "unread": 2},
            "sent": {"total": 0, "unread": 0},
            "drafts": {"total": 0, "unread": 0},
            "trash": {"total": 0, "unread": 0},
            "junk": {"total": 0, "unread": 0},
        },
    )

    item_ids = {item["id"] for item in tree["items"]}

    assert rss_folder_id in item_ids
    assert inbox_child_folder_id in item_ids
    assert contact_root_folder_id not in item_ids
    assert hidden_child_folder_id not in item_ids
    assert conversation_settings_folder_id not in item_ids


def test_mail_api_builds_inline_content_disposition():
    inline_disposition = mail_api_module._build_content_disposition("logo.png", disposition="inline")
    attachment_disposition = mail_api_module._build_content_disposition("logo.png", disposition="attachment")

    assert inline_disposition.startswith("inline;")
    assert attachment_disposition.startswith("attachment;")
