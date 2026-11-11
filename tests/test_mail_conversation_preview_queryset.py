from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from types import SimpleNamespace

from backend.services.mail_service import MailService


class _Query:
    def __init__(self):
        self.fields = None
        self.items = ()

    def order_by(self, _key):
        return self

    def only(self, *fields):
        self.fields = fields
        return self

    def __getitem__(self, key):
        return self.items[key]


class _Folder:
    def __init__(self):
        self.query = _Query()

    def all(self):
        return self.query


class _Service(MailService):
    def __init__(self):
        pass


def test_mail_preview_queryset_includes_conversation_id_without_full_item():
    folder = _Folder()
    result = _Service()._folder_queryset(folder, "inbox", preview_only=True)

    assert result is folder.query
    assert "conversation_id" in folder.query.fields
    assert "has_attachments" in folder.query.fields
    assert "body" not in folder.query.fields
    assert "mime_content" not in folder.query.fields


def test_mail_conversation_scan_queryset_omits_body_and_attachments():
    folder = _Folder()
    result = _Service()._folder_queryset(folder, "inbox", scan_only=True)

    assert result is folder.query
    assert "conversation_id" in folder.query.fields
    assert "is_read" in folder.query.fields
    assert "body" not in folder.query.fields
    assert "text_body" not in folder.query.fields
    assert "attachments" not in folder.query.fields
    assert "mime_content" not in folder.query.fields


def test_mail_conversation_hydrate_fetches_detail_fields_in_scan_order():
    scan_items = [
        (SimpleNamespace(id="early"), "inbox"),
        (SimpleNamespace(id="late"), "sent"),
    ]
    fetched = [
        SimpleNamespace(id="late", body="late-body"),
        SimpleNamespace(id="early", body="early-body"),
    ]
    account = SimpleNamespace(fetch=lambda ids, only_fields=None: fetched)
    service = _Service()

    hydrated = service._hydrate_conversation_items(account=account, items_raw=scan_items)

    assert [item.id for item, _folder in hydrated] == ["early", "late"]
    assert hydrated[0][0].body == "early-body"
    assert hydrated[1][1] == "sent"


def test_mail_conversation_hydrate_keeps_scan_items_when_fetch_fails():
    scan_items = [(SimpleNamespace(id="only"), "inbox")]
    account = SimpleNamespace(
        fetch=lambda ids, only_fields=None: (_ for _ in ()).throw(RuntimeError("ews down"))
    )
    service = _Service()

    hydrated = service._hydrate_conversation_items(account=account, items_raw=scan_items)

    assert hydrated == scan_items


def test_mail_inbox_probe_uses_scan_queryset_without_body():
    folder = _Folder()
    folder.query.items = [SimpleNamespace(id="latest")]
    account = SimpleNamespace(inbox=folder)
    sample = _Service()._probe_inbox_sample(account)

    assert [item.id for item in sample] == ["latest"]
    assert "conversation_id" in folder.query.fields
    assert "body" not in folder.query.fields
    assert "attachments" not in folder.query.fields


def test_complete_conversation_replaces_legacy_cache_and_reuses_verified_cache(monkeypatch):
    service = _Service()
    cache = {"conversation_id": "thread", "items": [{"id": "old"}]}
    calls = []
    monkeypatch.setattr(service, "_resolve_mail_profile", lambda **kwargs: {"mailbox_id": "box"})
    monkeypatch.setattr(service, "_set_request_metric", lambda *args: None)
    monkeypatch.setattr(service, "_cached_conversation_detail", lambda **kwargs: cache)
    monkeypatch.setattr(service, "_singleflight_key", lambda **kwargs: "test")
    monkeypatch.setattr(service, "_run_singleflight", lambda key, producer: producer())
    monkeypatch.setattr(service, "_resolve_account_context", lambda **kwargs: {"profile": {"email": "synthetic@example.test"}, "account": object()})
    def find(**kwargs):
        calls.append(kwargs)
        return "thread", [(SimpleNamespace(id="new"), "inbox")], "inbox"
    monkeypatch.setattr(service, "_find_conversation_items", find)
    monkeypatch.setattr(service, "_hydrate_conversation_items", lambda **kwargs: kwargs["items_raw"])
    monkeypatch.setattr(service, "_serialize_message_detail", lambda **kwargs: {"id": kwargs["item"].id})
    service._conversation_payloads = SimpleNamespace(conversation_detail_payload=lambda **kwargs: kwargs)
    def save(**kwargs):
        cache.clear()
        cache.update(kwargs["value"])
        return cache
    monkeypatch.setattr(service, "_cache_set", save)
    result = service.get_conversation(user_id=7, mailbox_id="box", conversation_id="thread")
    assert result["conversation_complete"] is True
    assert result["items"] == [{"id": "new"}]
    assert calls[0]["require_complete"] is True
    assert calls[0]["folder"] == "inbox"
    assert service.get_conversation(user_id=7, mailbox_id="box", conversation_id="thread") == result
    assert len(calls) == 1
