"""Scheduled ("Send later") messages: service, dispatcher, idempotency, routes (sqlite only)."""
from __future__ import annotations

import importlib
import os
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

pytestmark = pytest.mark.integration


def _configure(database_path: Path, monkeypatch) -> str:
    url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", url)
    monkeypatch.setenv("CHAT_DATABASE_URL", url)
    monkeypatch.setenv("CHAT_ENABLED", "1")
    monkeypatch.setenv("CHAT_SCHEDULED_MESSAGES_ENABLED", "1")
    cfg = importlib.import_module("backend.config")
    appdb = importlib.import_module("backend.appdb.db")
    chatdb = importlib.import_module("backend.chat.db")
    for obj, attr, val in [
        (cfg.config.app_db, "database_url", url),
        (cfg.config.chat, "database_url", url),
        (cfg.config.chat, "enabled", True),
        (appdb.config.app_db, "database_url", url),
        (chatdb.config.app_db, "database_url", url),
        (chatdb.config.chat, "database_url", url),
        (chatdb.config.chat, "enabled", True),
    ]:
        monkeypatch.setattr(obj, attr, val, raising=False)
    appdb._engines.clear()
    appdb._session_factories.clear()
    chatdb._engines.clear()
    chatdb._session_factories.clear()
    chatdb._read_engines.clear()
    chatdb._read_session_factories.clear()
    chatdb._engine = None
    chatdb._session_factory = None
    chatdb._read_engine = None
    chatdb._read_session_factory = None
    return url


@pytest.fixture
def env(tmp_path, monkeypatch, prebuilt_chat_db):
    url = _configure(prebuilt_chat_db, monkeypatch)
    e = SimpleNamespace(url=url)
    e.sched = importlib.import_module("backend.chat.scheduled_messages")
    e.chat_mod = importlib.import_module("backend.chat.service")
    e.chat_db = importlib.import_module("backend.chat.db")
    e.models = importlib.import_module("backend.chat.models")
    users_mod = importlib.import_module("backend.services.user_service")
    monkeypatch.setattr(e.chat_mod.hub_service, "data_dir", tmp_path, raising=False)
    e.users = users_mod.UserService(database_url=url)
    e.chat = e.chat_mod.ChatService()
    e.chat._attachments_root = tmp_path / "att"
    e.chat._attachments_root.mkdir()
    e.chat._upload_sessions_root = tmp_path / "up"
    e.chat._upload_sessions_root.mkdir()
    monkeypatch.setattr(e.chat_mod, "user_service", e.users)
    monkeypatch.setattr(e.sched, "chat_session", e.chat_db.chat_session, raising=False)
    # the dispatcher resolves the module-level singleton: point it at this test's ChatService
    monkeypatch.setattr(e.chat_mod, "chat_service", e.chat)
    e.service = e.sched.ChatScheduledMessageService()
    e.outbox_jobs = []
    outbox_mod = importlib.import_module("backend.chat.event_outbox_service")
    monkeypatch.setattr(
        outbox_mod.chat_event_outbox_service, "enqueue_events", lambda jobs: e.outbox_jobs.extend(jobs) or len(jobs)
    )
    perms = ["chat.read", "chat.write"]
    make = lambda name: e.users.create_user(  # noqa: E731
        username=name, password="secret-pass", role="viewer", auth_source="local", full_name=name,
        is_active=True, use_custom_permissions=True, custom_permissions=perms,
    )
    e.alice, e.bob, e.eve = make("alice"), make("bob"), make("eve")
    e.conv = e.chat.create_direct_conversation(
        current_user_id=int(e.alice["id"]), peer_user_id=int(e.bob["id"])
    )
    return e


def _soon(seconds=120):
    return datetime.now(timezone.utc) + timedelta(seconds=seconds)


def _messages(env, conversation_id):
    with env.chat_db.chat_session(env.url) as db:
        rows = list(db.execute(
            select(env.models.ChatMessage).where(env.models.ChatMessage.conversation_id == conversation_id)
        ).scalars())
        return [(row.sender_user_id, row.body, row.client_message_id) for row in rows]


def _make_due(env, scheduled_id):
    with env.chat_db.chat_session(env.url) as db:
        row = db.get(env.models.ChatScheduledMessage, scheduled_id)
        row.scheduled_for = datetime.now(timezone.utc) - timedelta(seconds=1)


def test_disabled_flag_blocks_everything(env, monkeypatch):
    monkeypatch.setenv("CHAT_SCHEDULED_MESSAGES_ENABLED", "0")
    with pytest.raises(env.sched.ScheduledMessageDisabled):
        env.service.create(current_user_id=int(env.alice["id"]), conversation_id=env.conv["id"],
                           body="x", scheduled_for=_soon())


def test_create_validates_time_body_membership_and_kind(env):
    alice = int(env.alice["id"])
    cid = env.conv["id"]
    with pytest.raises(ValueError, match="в будущем"):
        env.service.create(current_user_id=alice, conversation_id=cid, body="x", scheduled_for=_soon(5))
    with pytest.raises(ValueError, match="на год"):
        env.service.create(current_user_id=alice, conversation_id=cid, body="x",
                           scheduled_for=datetime.now(timezone.utc) + timedelta(days=400))
    with pytest.raises(ValueError, match="текст"):
        env.service.create(current_user_id=alice, conversation_id=cid, body="   ", scheduled_for=_soon())
    with pytest.raises(PermissionError):
        env.service.create(current_user_id=int(env.eve["id"]), conversation_id=cid, body="x", scheduled_for=_soon())
    with pytest.raises(LookupError):
        env.service.create(current_user_id=alice, conversation_id="nope", body="x", scheduled_for=_soon())
    # naive datetimes are read as UTC
    naive = (datetime.now(timezone.utc) + timedelta(minutes=5)).replace(tzinfo=None)
    assert env.service.create(current_user_id=alice, conversation_id=cid, body="ok", scheduled_for=naive)["status"] == "scheduled"


def test_limit_of_active_messages_per_user(env, monkeypatch):
    monkeypatch.setattr(env.sched.ChatScheduledMessageService, "MAX_ACTIVE_PER_USER", 2)
    alice, cid = int(env.alice["id"]), env.conv["id"]
    for index in range(2):
        env.service.create(current_user_id=alice, conversation_id=cid, body=f"m{index}", scheduled_for=_soon())
    with pytest.raises(ValueError, match="Не больше 2"):
        env.service.create(current_user_id=alice, conversation_id=cid, body="m3", scheduled_for=_soon())


def test_list_shows_only_own_active_messages_sorted_by_time(env):
    alice, bob, cid = int(env.alice["id"]), int(env.bob["id"]), env.conv["id"]
    late = env.service.create(current_user_id=alice, conversation_id=cid, body="late", scheduled_for=_soon(600))
    early = env.service.create(current_user_id=alice, conversation_id=cid, body="early", scheduled_for=_soon(120))
    env.service.create(current_user_id=bob, conversation_id=cid, body="bob's", scheduled_for=_soon(120))
    cancelled = env.service.create(current_user_id=alice, conversation_id=cid, body="gone", scheduled_for=_soon(300))
    env.service.cancel(current_user_id=alice, scheduled_id=cancelled["id"])

    items = env.service.list_for_conversation(current_user_id=alice, conversation_id=cid)
    assert [item["id"] for item in items] == [early["id"], late["id"]]
    assert [item["body"] for item in env.service.list_for_conversation(current_user_id=bob, conversation_id=cid)] == ["bob's"]


def test_update_and_cancel_are_owner_only_and_only_before_sending(env):
    alice, bob, cid = int(env.alice["id"]), int(env.bob["id"]), env.conv["id"]
    row = env.service.create(current_user_id=alice, conversation_id=cid, body="v1", scheduled_for=_soon())
    with pytest.raises(LookupError):
        env.service.update(current_user_id=bob, scheduled_id=row["id"], body="hack")
    with pytest.raises(LookupError):
        env.service.cancel(current_user_id=bob, scheduled_id=row["id"])
    changed = env.service.update(current_user_id=alice, scheduled_id=row["id"], body="v2", scheduled_for=_soon(900))
    assert changed["body"] == "v2" and changed["scheduled_for"] != row["scheduled_for"]
    with pytest.raises(ValueError, match="в будущем"):
        env.service.update(current_user_id=alice, scheduled_id=row["id"], scheduled_for=_soon(1))

    _make_due(env, row["id"])
    assert env.service.dispatch_due() == 1
    with pytest.raises(ValueError, match="уже отправляется"):
        env.service.update(current_user_id=alice, scheduled_id=row["id"], body="late edit")
    with pytest.raises(ValueError, match="уже отправляется"):
        env.service.cancel(current_user_id=alice, scheduled_id=row["id"])


def test_due_message_is_sent_once_as_an_ordinary_message_of_the_sender(env):
    alice, cid = int(env.alice["id"]), env.conv["id"]
    row = env.service.create(current_user_id=alice, conversation_id=cid, body="Привет из будущего", scheduled_for=_soon())

    assert env.service.dispatch_due() == 0  # not due yet
    assert _messages(env, cid) == []

    _make_due(env, row["id"])
    assert env.service.dispatch_due() == 1
    assert env.service.dispatch_due() == 0  # already sent, nothing to repeat
    messages = _messages(env, cid)
    assert messages == [(alice, "Привет из будущего", f"scheduled:{row['id']}")]
    assert any(job["event_type"] == "chat.message.created" for job in env.outbox_jobs)

    with env.chat_db.chat_session(env.url) as db:
        stored = db.get(env.models.ChatScheduledMessage, row["id"])
        assert stored.status == "sent" and stored.sent_message_id
    assert env.service.list_for_conversation(current_user_id=alice, conversation_id=cid) == []


def test_cancelled_message_is_never_sent(env):
    alice, cid = int(env.alice["id"]), env.conv["id"]
    row = env.service.create(current_user_id=alice, conversation_id=cid, body="x", scheduled_for=_soon())
    env.service.cancel(current_user_id=alice, scheduled_id=row["id"])
    _make_due(env, row["id"])
    assert env.service.dispatch_due() == 0
    assert _messages(env, cid) == []


def test_two_dispatchers_send_a_message_exactly_once(env):
    alice, cid = int(env.alice["id"]), env.conv["id"]
    row = env.service.create(current_user_id=alice, conversation_id=cid, body="once", scheduled_for=_soon())
    _make_due(env, row["id"])
    other = env.sched.ChatScheduledMessageService()
    barrier = threading.Barrier(2)
    results: list[int] = []

    def run(service):
        barrier.wait()
        results.append(service.dispatch_due())

    threads = [threading.Thread(target=run, args=(svc,)) for svc in (env.service, other)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    assert sorted(results) == [0, 1]
    assert len(_messages(env, cid)) == 1


def test_crash_after_send_does_not_duplicate_on_recovery(env):
    """The worker died after the message was saved but before the row was marked sent."""
    alice, cid = int(env.alice["id"]), env.conv["id"]
    row = env.service.create(current_user_id=alice, conversation_id=cid, body="resilient", scheduled_for=_soon())
    _make_due(env, row["id"])
    claimed = env.service._claim(row["id"])
    env.chat.send_message(
        current_user_id=alice, conversation_id=cid, body="resilient",
        client_message_id=f"scheduled:{claimed['id']}", defer_push_notifications=True,
    )
    with env.chat_db.chat_session(env.url) as db:  # the claim is old: the worker is gone
        db.get(env.models.ChatScheduledMessage, row["id"]).updated_at = datetime.now(timezone.utc) - timedelta(hours=1)

    assert env.service.recover_stuck() == 1
    assert env.service.dispatch_due() == 1  # sends again with the same client_message_id -> dedup
    assert len(_messages(env, cid)) == 1


def test_failure_is_retried_then_marked_failed_and_can_be_requeued(env, monkeypatch):
    alice, cid = int(env.alice["id"]), env.conv["id"]
    row = env.service.create(current_user_id=alice, conversation_id=cid, body="flaky", scheduled_for=_soon())

    def boom(**kwargs):
        raise RuntimeError("database is gone")

    original_send = env.chat.send_message
    monkeypatch.setattr(env.chat, "send_message", boom)
    for attempt in range(1, env.sched.ChatScheduledMessageService.MAX_ATTEMPTS + 1):
        _make_due(env, row["id"])
        assert env.service.dispatch_due() == 0
        with env.chat_db.chat_session(env.url) as db:
            stored = db.get(env.models.ChatScheduledMessage, row["id"])
            assert stored.attempt_count == attempt
            assert stored.status == ("failed" if attempt == env.sched.ChatScheduledMessageService.MAX_ATTEMPTS else "scheduled")
    failed = env.service.list_for_conversation(current_user_id=alice, conversation_id=cid)
    assert failed[0]["status"] == "failed" and failed[0]["error_text"]

    monkeypatch.setattr(env.chat, "send_message", original_send)
    requeued = env.service.update(current_user_id=alice, scheduled_id=row["id"], scheduled_for=_soon(60))
    assert requeued["status"] == "scheduled" and requeued["attempt_count"] == 0 and requeued["error_text"] is None


def test_side_effects_failure_after_send_still_marks_the_message_sent(env, monkeypatch):
    """R54: send_message succeeded, notifications/events failed -> status 'sent', no retry, no 'failed'."""
    alice, cid = int(env.alice["id"]), env.conv["id"]
    row = env.service.create(current_user_id=alice, conversation_id=cid, body="delivered", scheduled_for=_soon())

    def boom(**kwargs):
        raise RuntimeError("outbox is down")

    monkeypatch.setattr(env.service, "_enqueue_side_effects", boom)
    _make_due(env, row["id"])
    assert env.service.dispatch_due() == 1
    for _ in range(env.sched.ChatScheduledMessageService.MAX_ATTEMPTS + 1):
        assert env.service.dispatch_due() == 0  # nothing to retry
    assert len(_messages(env, cid)) == 1
    with env.chat_db.chat_session(env.url) as db:
        stored = db.get(env.models.ChatScheduledMessage, row["id"])
        assert stored.status == "sent" and stored.sent_message_id and stored.error_text is None
        assert stored.attempt_count == 1
    assert env.service.list_for_conversation(current_user_id=alice, conversation_id=cid) == []


def test_failed_mark_sent_keeps_the_row_recoverable_without_duplicates(env, monkeypatch):
    alice, cid = int(env.alice["id"]), env.conv["id"]
    row = env.service.create(current_user_id=alice, conversation_id=cid, body="once more", scheduled_for=_soon())
    _make_due(env, row["id"])

    def boom(*args, **kwargs):
        raise RuntimeError("write failed")

    monkeypatch.setattr(env.service, "_mark_sent", boom)
    assert env.service.dispatch_due() == 1  # the message is delivered even though the mark failed
    with env.chat_db.chat_session(env.url) as db:
        db.get(env.models.ChatScheduledMessage, row["id"]).updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    monkeypatch.delattr(env.service, "_mark_sent")  # back to the class method only
    assert env.service.recover_stuck() == 1
    assert env.service.dispatch_due() == 1
    assert len(_messages(env, cid)) == 1  # same client_message_id -> deduplicated
    with env.chat_db.chat_session(env.url) as db:
        assert db.get(env.models.ChatScheduledMessage, row["id"]).status == "sent"


def test_sender_who_left_the_conversation_fails_without_retries(env):
    alice, cid = int(env.alice["id"]), env.conv["id"]
    row = env.service.create(current_user_id=alice, conversation_id=cid, body="too late", scheduled_for=_soon())
    with env.chat_db.chat_session(env.url) as db:
        member = db.execute(select(env.models.ChatMember).where(
            env.models.ChatMember.conversation_id == cid, env.models.ChatMember.user_id == alice)).scalar_one()
        member.left_at = datetime.now(timezone.utc)
    _make_due(env, row["id"])
    assert env.service.dispatch_due() == 0
    with env.chat_db.chat_session(env.url) as db:
        stored = db.get(env.models.ChatScheduledMessage, row["id"])
        assert stored.status == "failed" and stored.attempt_count == 1
    assert _messages(env, cid) == []


def _client(env, user, monkeypatch):
    deps = importlib.import_module("backend.api.deps")
    chat_api = importlib.import_module("backend.api.v1.chat")
    app = FastAPI()
    app.include_router(chat_api.router, prefix="/chat")
    app.dependency_overrides[deps.get_current_active_user] = lambda: user
    return TestClient(app)


def _api_user(env, row, permissions=("chat.read", "chat.write")):  # same dependency as POST /messages
    models = importlib.import_module("backend.models.auth")
    return models.User(
        id=int(row["id"]), username=row["username"], full_name=row["username"], role="viewer",
        use_custom_permissions=True, custom_permissions=list(permissions), permissions=list(permissions),
    )


def test_routes_create_list_update_cancel_and_permissions(env, monkeypatch):
    cid = env.conv["id"]
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    alice = _client(env, _api_user(env, env.alice), monkeypatch)
    created = alice.post(f"/chat/conversations/{cid}/scheduled", json={"body": "через два часа", "scheduled_for": when})
    assert created.status_code == 200, created.text
    scheduled_id = created.json()["id"]
    assert alice.get(f"/chat/conversations/{cid}/scheduled").json()["items"][0]["body"] == "через два часа"
    patched = alice.patch(f"/chat/scheduled/{scheduled_id}", json={"body": "изменено"})
    assert patched.status_code == 200 and patched.json()["body"] == "изменено"

    past = alice.post(f"/chat/conversations/{cid}/scheduled", json={"body": "x", "scheduled_for": datetime.now(timezone.utc).isoformat()})
    assert past.status_code == 422

    eve = _client(env, _api_user(env, env.eve), monkeypatch)
    assert eve.post(f"/chat/conversations/{cid}/scheduled", json={"body": "x", "scheduled_for": when}).status_code == 403
    assert eve.delete(f"/chat/scheduled/{scheduled_id}").status_code == 404


    assert alice.delete(f"/chat/scheduled/{scheduled_id}").json()["status"] == "cancelled"
    assert alice.get(f"/chat/conversations/{cid}/scheduled").json()["items"] == []


def test_routes_report_disabled_feature_and_config_flag(env, monkeypatch):
    cid = env.conv["id"]
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    client = _client(env, _api_user(env, env.alice), monkeypatch)
    assert client.get("/chat/config").json()["scheduled_messages_enabled"] is True
    monkeypatch.setenv("CHAT_SCHEDULED_MESSAGES_ENABLED", "0")
    assert client.get("/chat/config").json()["scheduled_messages_enabled"] is False
    assert client.post(f"/chat/conversations/{cid}/scheduled", json={"body": "x", "scheduled_for": when}).status_code == 503
    assert client.get(f"/chat/conversations/{cid}/scheduled").status_code == 503


def test_alembic_migration_creates_and_drops_the_table(tmp_path):
    from alembic import command
    import sqlalchemy as sa

    build = importlib.import_module("backend.db_migrations").build_alembic_config
    url = f"sqlite:///{(tmp_path / 'mig.db').as_posix()}"
    engine = sa.create_engine(url)
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE chat_conversations (id VARCHAR(36) PRIMARY KEY)"))
    cfg = build(url, scope="chat")
    # run only the new revision: stamp its parent, then upgrade by one step
    command.stamp(cfg, "20260925_0123")
    command.upgrade(cfg, "20261002_0124")
    inspector = sa.inspect(engine)
    assert inspector.has_table("chat_scheduled_messages")
    columns = {col["name"] for col in inspector.get_columns("chat_scheduled_messages")}
    assert {"id", "conversation_id", "sender_user_id", "body", "scheduled_for", "status", "sent_message_id"} <= columns
    command.downgrade(cfg, "20260925_0123")
    assert not sa.inspect(engine).has_table("chat_scheduled_messages")


def _alembic_sqlite(tmp_path, *, with_conversations=True, scope="app"):
    import sqlalchemy as sa

    build = importlib.import_module("backend.db_migrations").build_alembic_config
    url = f"sqlite:///{(tmp_path / 'mig125.db').as_posix()}"
    engine = sa.create_engine(url)
    if with_conversations:
        with engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE chat_conversations (id VARCHAR(36) PRIMARY KEY)"))
    return engine, build(url, scope=scope)


def test_0125_creates_the_table_when_0124_was_recorded_without_it(tmp_path):
    """R53: version says 0124 (recorded by an app-scope start-up upgrade) but the table is missing."""
    from alembic import command
    import sqlalchemy as sa

    engine, cfg = _alembic_sqlite(tmp_path)
    command.stamp(cfg, "20261002_0124")  # version recorded, DDL never ran
    assert not sa.inspect(engine).has_table("chat_scheduled_messages")
    command.upgrade(cfg, "head")  # same app scope that produced the broken state
    inspector = sa.inspect(engine)
    assert inspector.has_table("chat_scheduled_messages")
    assert {index["name"] for index in inspector.get_indexes("chat_scheduled_messages")} == {
        "ix_chat_scheduled_messages_status_scheduled_for",
        "ix_chat_scheduled_messages_conversation_sender_status",
        "ix_chat_scheduled_messages_sender_user_id",
    }
    assert inspector.get_foreign_keys("chat_scheduled_messages")[0]["referred_table"] == "chat_conversations"


def test_0125_is_idempotent_when_0124_created_the_table(tmp_path):
    from alembic import command
    import sqlalchemy as sa

    engine, cfg = _alembic_sqlite(tmp_path, scope="chat")
    command.stamp(cfg, "20260925_0123")
    command.upgrade(cfg, "20261002_0124")
    assert sa.inspect(engine).has_table("chat_scheduled_messages")
    command.upgrade(cfg, "head")  # must not fail on "table already exists"
    assert sa.inspect(engine).has_table("chat_scheduled_messages")
    command.downgrade(cfg, "20261002_0124")  # 0125 downgrade leaves the table of 0124
    assert sa.inspect(engine).has_table("chat_scheduled_messages")


def test_0125_skips_a_database_without_chat_tables(tmp_path):
    from alembic import command
    import sqlalchemy as sa

    engine, cfg = _alembic_sqlite(tmp_path, with_conversations=False)
    command.stamp(cfg, "20261002_0124")
    command.upgrade(cfg, "head")
    assert not sa.inspect(engine).has_table("chat_scheduled_messages")


def test_0125_is_the_only_head():
    from alembic.script import ScriptDirectory

    build = importlib.import_module("backend.db_migrations").build_alembic_config
    script = ScriptDirectory.from_config(build("sqlite:///unused.db"))
    assert script.get_heads() == ["20261002_0125"]
