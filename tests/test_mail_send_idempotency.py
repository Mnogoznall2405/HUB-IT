from __future__ import annotations

import runpy
import sys
import threading
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, inspect
from alembic.migration import MigrationContext
from alembic.operations import Operations


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.appdb.db import app_session, initialize_app_schema
from backend.appdb.models import AppMailSendIdempotency
from backend.services.mail_send_idempotency import (
    DEFAULT_PROCESSING_LEASE_SEC,
    MAX_BACKEND_SEND_BUDGET_SEC,
    STATUS_RESERVED,
    MailSendIdempotencyStore,
    hash_mail_send_payload,
    mail_send_idempotency_enabled,
    mail_send_idempotency_metrics,
    mail_send_processing_lease_sec,
    reset_mail_send_idempotency_metrics,
)
from backend.services.mail_service import MailService, MailServiceError


REVISION = (
    WEB_ROOT
    / "backend"
    / "alembic"
    / "versions"
    / "20260818_0100_mail_send_idempotency.py"
)


class _Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 8, 18, 12, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def store_env(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'mail-send-idempotency.db').as_posix()}"
    initialize_app_schema(database_url)
    reset_mail_send_idempotency_metrics()
    clock = _Clock()
    store = MailSendIdempotencyStore(database_url, now_fn=clock, lease_sec=150)
    return store, clock, database_url


def _payload_hash(**overrides) -> str:
    values = {
        "mailbox_id": "mb-1",
        "to": ["to@example.com"],
        "cc": [],
        "bcc": [],
        "subject": "Hello",
        "body": "<p>Hi</p>",
        "is_html": True,
        "reply_to_message_id": "",
        "forward_message_id": "",
        "draft_id": "",
        "retain_existing_attachments": None,
        "attachments": None,
    }
    values.update(overrides)
    return hash_mail_send_payload(**values)


def test_flag_defaults_off_and_ignores_garbage(monkeypatch):
    monkeypatch.delenv("MAIL_SEND_IDEMPOTENCY", raising=False)
    assert mail_send_idempotency_enabled(None) is False
    assert mail_send_idempotency_enabled("") is False
    assert mail_send_idempotency_enabled("0") is False
    assert mail_send_idempotency_enabled("false") is False
    assert mail_send_idempotency_enabled("maybe") is False
    assert mail_send_idempotency_enabled("1") is True
    assert mail_send_idempotency_enabled("yes") is True


def test_processing_lease_defaults_to_budget_plus_margin_and_clamps_below_budget():
    assert mail_send_processing_lease_sec("") == DEFAULT_PROCESSING_LEASE_SEC
    assert mail_send_processing_lease_sec("150") == 150
    assert mail_send_processing_lease_sec("30") == MAX_BACKEND_SEND_BUDGET_SEC
    assert mail_send_processing_lease_sec("not-a-number") == DEFAULT_PROCESSING_LEASE_SEC


def test_payload_hash_ignores_recipient_order_and_attachment_bytes_change_hash():
    first = hash_mail_send_payload(
        mailbox_id="mb-1",
        to=["B@example.com", "a@example.com"],
        cc=["cc@example.com"],
        bcc=[],
        subject="Hello",
        body="Body",
        is_html=True,
        attachments=[("a.txt", b"one"), ("b.txt", b"two")],
    )
    second = hash_mail_send_payload(
        mailbox_id="mb-1",
        to=["a@example.com", "b@example.com"],
        cc=["cc@example.com"],
        bcc=[],
        subject="Hello",
        body="Body",
        is_html=True,
        attachments=[("b.txt", b"two"), ("a.txt", b"one")],
    )
    third = hash_mail_send_payload(
        mailbox_id="mb-1",
        to=["a@example.com", "b@example.com"],
        cc=["cc@example.com"],
        bcc=[],
        subject="Hello",
        body="Body",
        is_html=True,
        attachments=[("a.txt", b"other"), ("b.txt", b"two")],
    )
    assert first == second
    assert first != third


def test_unique_key_same_hash_replays_sent_result(store_env):
    store, _clock, _url = store_env
    payload_hash = _payload_hash()
    first = store.claim(user_id=7, mailbox_id="mb-1", idempotency_key="send-key-01", request_payload_hash=payload_hash)
    assert first.action == "proceed"
    assert mail_send_idempotency_metrics()["idempotency_proceed"] == 1
    store.complete_sent(first.row_id, {"ok": True, "message_id": "sent-1"})
    second = store.claim(user_id=7, mailbox_id="mb-1", idempotency_key="send-key-01", request_payload_hash=payload_hash)
    assert second.action == "replay"
    assert second.result == {"ok": True, "message_id": "sent-1"}
    assert mail_send_idempotency_metrics()["idempotency_hit"] == 1
    assert mail_send_idempotency_metrics()["duplicate_send_prevented"] >= 1


def test_payload_hash_conflict(store_env):
    store, _clock, _url = store_env
    first = store.claim(
        user_id=7,
        mailbox_id="mb-1",
        idempotency_key="send-key-02",
        request_payload_hash=_payload_hash(subject="One"),
    )
    assert first.action == "proceed"
    second = store.claim(
        user_id=7,
        mailbox_id="mb-1",
        idempotency_key="send-key-02",
        request_payload_hash=_payload_hash(subject="Two"),
    )
    assert second.action == "conflict"
    assert mail_send_idempotency_metrics()["payload_conflict"] == 1


def test_processing_blocks_second_claim_until_lease_expires(store_env):
    store, clock, _url = store_env
    payload_hash = _payload_hash()
    first = store.claim(user_id=7, mailbox_id="mb-1", idempotency_key="send-key-03", request_payload_hash=payload_hash)
    assert first.action == "proceed"
    second = store.claim(user_id=7, mailbox_id="mb-1", idempotency_key="send-key-03", request_payload_hash=payload_hash)
    assert second.action == "in_flight"
    clock.now = clock.now + timedelta(seconds=119)
    still_inflight = store.claim(
        user_id=7,
        mailbox_id="mb-1",
        idempotency_key="send-key-03",
        request_payload_hash=payload_hash,
    )
    assert still_inflight.action == "in_flight"
    clock.now = clock.now + timedelta(seconds=32)
    unknown = store.claim(
        user_id=7,
        mailbox_id="mb-1",
        idempotency_key="send-key-03",
        request_payload_hash=payload_hash,
    )
    assert unknown.action == "unknown"
    blocked = store.claim(
        user_id=7,
        mailbox_id="mb-1",
        idempotency_key="send-key-03",
        request_payload_hash=payload_hash,
    )
    assert blocked.action == "unknown"
    assert mail_send_idempotency_metrics()["send_unknown"] >= 1
    assert mail_send_idempotency_metrics()["reconciliation_failed"] == 1


def test_failed_same_hash_can_retry(store_env):
    store, _clock, _url = store_env
    payload_hash = _payload_hash()
    first = store.claim(user_id=7, mailbox_id="mb-1", idempotency_key="send-key-04", request_payload_hash=payload_hash)
    store.complete_failed(first.row_id, error_code="MAIL_SEND_FAILED")
    second = store.claim(user_id=7, mailbox_id="mb-1", idempotency_key="send-key-04", request_payload_hash=payload_hash)
    assert second.action == "proceed"
    assert second.row_id == first.row_id


def test_stale_reserved_without_ews_can_retry(store_env):
    store, clock, database_url = store_env
    payload_hash = _payload_hash()
    with app_session(database_url) as session:
        session.add(
            AppMailSendIdempotency(
                id="reserved-row-1",
                user_id=7,
                mailbox_id="mb-1",
                idempotency_key="send-key-05",
                request_payload_hash=payload_hash,
                status=STATUS_RESERVED,
                internet_message_id="<hubit-send-reserved@local>",
                created_at=clock.now,
                updated_at=clock.now,
            )
        )
    clock.now = clock.now + timedelta(seconds=151)
    claim = store.claim(
        user_id=7,
        mailbox_id="mb-1",
        idempotency_key="send-key-05",
        request_payload_hash=payload_hash,
    )
    assert claim.action == "proceed"
    assert claim.row_id == "reserved-row-1"


def test_concurrent_claims_allow_only_one_proceed(store_env):
    store, _clock, _url = store_env
    payload_hash = _payload_hash(subject="Race")
    barrier = threading.Barrier(2)
    actions: list[str] = []
    errors: list[BaseException] = []

    def worker() -> None:
        try:
            barrier.wait(timeout=3)
            claim = store.claim(
                user_id=9,
                mailbox_id="mb-1",
                idempotency_key="send-key-race",
                request_payload_hash=payload_hash,
            )
            actions.append(claim.action)
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)

    assert errors == []
    assert actions.count("proceed") == 1
    assert actions.count("in_flight") == 1


def test_revision_creates_unique_scope_on_sqlite():
    namespace = runpy.run_path(str(REVISION))
    upgrade = namespace["upgrade"]
    downgrade = namespace["downgrade"]
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        upgrade.__globals__["op"] = operations
        upgrade.__globals__["_scope"] = lambda: "app"
        downgrade.__globals__["op"] = operations
        downgrade.__globals__["_scope"] = lambda: "app"
        upgrade()
        inspector = inspect(connection)
        assert inspector.has_table("mail_send_idempotency")
        columns = {column["name"] for column in inspector.get_columns("mail_send_idempotency")}
        assert {
            "user_id",
            "mailbox_id",
            "idempotency_key",
            "request_payload_hash",
            "status",
            "processing_lease_until",
        } <= columns
        unique = {
            tuple(item["column_names"])
            for item in inspector.get_unique_constraints("mail_send_idempotency")
        }
        unique |= {
            tuple(item["column_names"])
            for item in inspector.get_indexes("mail_send_idempotency")
            if item.get("unique")
        }
        assert ("user_id", "mailbox_id", "idempotency_key") in unique
        downgrade()
        inspector = inspect(connection)
        assert not inspector.has_table("mail_send_idempotency")


def _install_fake_exchangelib(monkeypatch, created_messages):
    class FakeHTMLBody(str):
        pass

    class FakeMailbox:
        def __init__(self, *, email_address):
            self.email_address = email_address

    class FakeFileAttachment:
        def __init__(self, *, name, content):
            self.name = name
            self.content = content

    class FakeMessage:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.attachments = []
            self.id = "sent-exchange-id"
            created_messages.append(self)

        def attach(self, attachment):
            self.attachments.append(attachment)

        def send_and_save(self):
            self.sent = True

    exchangelib = types.ModuleType("exchangelib")
    exchangelib.HTMLBody = FakeHTMLBody
    exchangelib.Mailbox = FakeMailbox
    exchangelib.Message = FakeMessage
    exchangelib_attachments = types.ModuleType("exchangelib.attachments")
    exchangelib_attachments.FileAttachment = FakeFileAttachment
    monkeypatch.setitem(sys.modules, "exchangelib", exchangelib)
    monkeypatch.setitem(sys.modules, "exchangelib.attachments", exchangelib_attachments)


def test_send_message_replays_without_second_exchange_send(tmp_path, monkeypatch):
    monkeypatch.setenv("MAIL_SEND_IDEMPOTENCY", "1")
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'mail-send-service.db').as_posix()}"
    initialize_app_schema(database_url)
    created_messages = []
    _install_fake_exchangelib(monkeypatch, created_messages)

    class Service(MailService):
        def __init__(self) -> None:
            self._database_url = database_url

        def _validate_outgoing_attachments_dynamic(self, attachments):
            return None

        def _resolve_outbound_mailbox_id(self, **kwargs):
            return kwargs.get("mailbox_id") or "mb-1"

        def _resolve_mail_profile(self, **kwargs):
            return {
                "mailbox_id": "mb-1",
                "email": "user@example.com",
                "login": "user@example.com",
                "password": "secret",
                "signature": "",
                "user": {"id": 100, "username": "mail-user"},
            }

        def _create_account(self, **kwargs):
            return SimpleNamespace(sent="sent-folder", protocol=object())

        @staticmethod
        def _log_message(**kwargs):
            return None

        @staticmethod
        def invalidate_user_cache(**kwargs):
            return None

    service = Service()
    kwargs = dict(
        user_id=100,
        mailbox_id="mb-1",
        to=["target@example.com"],
        cc=[],
        bcc=[],
        subject="Hello",
        body="<p>Hi</p>",
        is_html=True,
        idempotency_key="compose-key-abc",
    )
    first = service.send_message(**kwargs)
    second = service.send_message(**kwargs)
    assert first["ok"] is True
    assert second["message_id"] == first["message_id"]
    assert len(created_messages) == 1


def test_send_message_ignores_header_when_flag_off(tmp_path, monkeypatch):
    monkeypatch.delenv("MAIL_SEND_IDEMPOTENCY", raising=False)
    created_messages = []
    _install_fake_exchangelib(monkeypatch, created_messages)

    class Service(MailService):
        def __init__(self) -> None:
            self._database_url = None

        def _validate_outgoing_attachments_dynamic(self, attachments):
            return None

        def _resolve_outbound_mailbox_id(self, **kwargs):
            return "mb-1"

        def _resolve_mail_profile(self, **kwargs):
            return {
                "mailbox_id": "mb-1",
                "email": "user@example.com",
                "login": "user@example.com",
                "password": "secret",
                "signature": "",
                "user": {"id": 100, "username": "mail-user"},
            }

        def _create_account(self, **kwargs):
            return SimpleNamespace(sent="sent-folder", protocol=object())

        @staticmethod
        def _log_message(**kwargs):
            return None

        @staticmethod
        def invalidate_user_cache(**kwargs):
            return None

    service = Service()
    first = service.send_message(
        user_id=100,
        mailbox_id="mb-1",
        to=["target@example.com"],
        subject="Hello",
        body="<p>Hi</p>",
        idempotency_key="compose-key-abc",
    )
    second = service.send_message(
        user_id=100,
        mailbox_id="mb-1",
        to=["target@example.com"],
        subject="Hello",
        body="<p>Hi</p>",
        idempotency_key="compose-key-abc",
    )
    assert first["ok"] is True
    assert second["ok"] is True
    assert len(created_messages) == 2


def test_send_message_conflict_does_not_call_exchange(tmp_path, monkeypatch):
    monkeypatch.setenv("MAIL_SEND_IDEMPOTENCY", "1")
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'mail-send-conflict.db').as_posix()}"
    initialize_app_schema(database_url)
    created_messages = []
    _install_fake_exchangelib(monkeypatch, created_messages)

    class Service(MailService):
        def __init__(self) -> None:
            self._database_url = database_url

        def _validate_outgoing_attachments_dynamic(self, attachments):
            return None

        def _resolve_outbound_mailbox_id(self, **kwargs):
            return "mb-1"

        def _resolve_mail_profile(self, **kwargs):
            return {
                "mailbox_id": "mb-1",
                "email": "user@example.com",
                "login": "user@example.com",
                "password": "secret",
                "signature": "",
                "user": {"id": 100, "username": "mail-user"},
            }

        def _create_account(self, **kwargs):
            return SimpleNamespace(sent="sent-folder", protocol=object())

        @staticmethod
        def _log_message(**kwargs):
            return None

        @staticmethod
        def invalidate_user_cache(**kwargs):
            return None

    service = Service()
    service.send_message(
        user_id=100,
        mailbox_id="mb-1",
        to=["target@example.com"],
        subject="One",
        body="<p>Hi</p>",
        idempotency_key="compose-key-xyz",
    )
    with pytest.raises(MailServiceError, match="уже использован"):
        service.send_message(
            user_id=100,
            mailbox_id="mb-1",
            to=["target@example.com"],
            subject="Two",
            body="<p>Hi</p>",
            idempotency_key="compose-key-xyz",
        )
    assert len(created_messages) == 1
