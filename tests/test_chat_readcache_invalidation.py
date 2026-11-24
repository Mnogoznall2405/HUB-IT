"""A8c2/P0: cross-node read-cache invalidation via the realtime relay.

Simulates two chat nodes (two ChatService instances + the process-local
singleton as "node B") sharing one sqlite DB. A durable event relayed to a
node must drop its cached thread/conversation pages immediately — the shared
SKIP LOCKED outbox reaches only ONE consumer and cannot do this job.
"""
import asyncio
import importlib
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

NOW = datetime.now(timezone.utc)


def _configure(db_path, monkeypatch):
    url = f"sqlite:///{db_path.as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", url)
    monkeypatch.setenv("CHAT_DATABASE_URL", url)
    monkeypatch.setenv("CHAT_ENABLED", "1")
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


@pytest.fixture(autouse=True)
def _clear_singleton_cache():
    svc_mod = importlib.import_module("backend.chat.service")
    svc_mod.chat_service._runtime_cache.clear()
    svc_mod.chat_service._cache._conv_view_epoch.clear()
    yield
    svc_mod.chat_service._runtime_cache.clear()
    svc_mod.chat_service._cache._conv_view_epoch.clear()


@pytest.fixture
def env(tmp_path, monkeypatch, prebuilt_chat_db):
    url = _configure(prebuilt_chat_db, monkeypatch)
    e = SimpleNamespace()
    e.url = url
    e.chatdb = importlib.import_module("backend.chat.db")
    e.chat_models = importlib.import_module("backend.chat.models")
    e.chat_mod = importlib.import_module("backend.chat.service")
    e.realtime = importlib.import_module("backend.chat.realtime")
    return e


def _seed_conversation(env, *, conversation_id: str, member_ids=(7, 8)):
    with env.chatdb.chat_session(env.url) as db:
        db.add(env.chat_models.ChatConversation(
            id=conversation_id, kind="group", title="Ops",
            created_by_user_id=member_ids[0], last_message_seq=1,
            created_at=NOW, updated_at=NOW,
        ))
        for uid in member_ids:
            db.add(env.chat_models.ChatMember(
                conversation_id=conversation_id, user_id=int(uid),
                member_role="member", joined_at=NOW,
            ))
        db.add(env.chat_models.ChatMessage(
            id=f"m-{conversation_id}-1", conversation_id=conversation_id,
            sender_user_id=member_ids[0], kind="text", body_format="plain",
            body="first", conversation_seq=1, is_deleted=False, created_at=NOW,
        ))


def _worker_write_message(env, *, conversation_id: str, seq: int, body: str) -> str:
    """What the AI worker (separate process) does: commit a message row.
    No local invalidation happens on the reader nodes."""
    message_id = f"m-{conversation_id}-{seq}"
    with env.chatdb.chat_session(env.url) as db:
        db.add(env.chat_models.ChatMessage(
            id=message_id, conversation_id=conversation_id,
            sender_user_id=999, kind="text", body_format="plain",
            body=body, conversation_seq=seq, is_deleted=False, created_at=NOW,
        ))
        conv = db.get(env.chat_models.ChatConversation, conversation_id)
        conv.last_message_seq = seq
    return message_id


def _bodies(payload) -> list[str]:
    return [str(item.get("body") or "") for item in (payload or {}).get("items") or []]


def test_two_nodes_see_fresh_page_after_relayed_event(env, monkeypatch):
    conv = f"conv-{uuid.uuid4().hex[:8]}"
    _seed_conversation(env, conversation_id=conv)
    node_a = env.chat_mod.ChatService()       # "process A" cache
    node_b = env.chat_mod.chat_service        # "process B" = process singleton

    # Both nodes fill their caches with page [first].
    assert _bodies(node_a.get_messages(current_user_id=7, conversation_id=conv)) == ["first"]
    assert _bodies(node_b.get_messages(current_user_id=7, conversation_id=conv)) == ["first"]
    cache_key_a = next(k for k in node_a._runtime_cache if "thread_latest" in k)
    cache_key_b = next(k for k in node_b._runtime_cache if "thread_latest" in k)

    # A worker in a third process commits the reply — outbox goes to ONE
    # consumer; the relay distributes the event to every node.
    _worker_write_message(env, conversation_id=conv, seq=2, body="ai answer")

    # Sanity: without invalidation node A would still serve the cached page.
    assert _bodies(node_a.get_messages(current_user_id=7, conversation_id=conv)) == ["first"]

    # Node B receives the relayed room event and runs its coalesced flush —
    # delivery and debounce wait must share one loop (the flush task dies
    # with a closed loop).
    asyncio.run(_deliver_and_flush(env.realtime.chat_realtime, {
        "distribution": "conversation_room",
        "event_type": "chat.message.created",
        "conversation_id": conv,
        "payload": {"message_id": f"m-{conv}-2"},
        "_realtime_event_id": f"evt-{uuid.uuid4().hex}",
    }))

    # Node B: the cached page was dropped; the next read returns fresh data
    # immediately, no 15s TTL wait.
    assert cache_key_b not in node_b._runtime_cache
    assert _bodies(node_b.get_messages(current_user_id=7, conversation_id=conv)) == [
        "first", "ai answer",
    ]
    # Node A applies the same invalidation its own hub computed.
    env.realtime.ChatRealtimeManager._apply_read_cache_invalidation(
        pending={conv: None}, service=node_a,
    )
    assert cache_key_a not in node_a._runtime_cache
    assert _bodies(node_a.get_messages(current_user_id=7, conversation_id=conv)) == [
        "first", "ai answer",
    ]


async def _deliver_and_flush(hub, event):
    await hub.handle_distributed_event(event)
    await asyncio.sleep(hub._cache_invalidation_debounce_sec + 0.1)


@pytest.mark.parametrize("event_type", [
    "chat.message.edited", "chat.message.deleted", "chat.member.updated",
])
def test_relayed_mutation_events_invalidate(env, event_type):
    conv = f"conv-{uuid.uuid4().hex[:8]}"
    node = env.chat_mod.chat_service
    node._cache._cache_set(user_id=7, bucket="thread_latest", extra=f"{conv}|100", value={"items": []})
    epoch_before = node._cache._conversation_cache_epoch(conv)

    asyncio.run(_deliver_and_flush(env.realtime.chat_realtime, {
        "distribution": "conversation_room",
        "event_type": event_type,
        "conversation_id": conv,
        "payload": {},
        "_realtime_event_id": f"evt-{uuid.uuid4().hex}",
    }))
    assert node._cache._conversation_cache_epoch(conv) > epoch_before
    assert not any("thread_latest" in k for k in node._runtime_cache)


def test_targeted_event_drops_only_listed_users(env):
    conv = f"conv-{uuid.uuid4().hex[:8]}"
    node = env.chat_mod.chat_service
    node._cache._cache_set(user_id=7, bucket="thread_latest", extra=f"{conv}|100", value={"u": 7})
    node._cache._cache_set(user_id=8, bucket="thread_latest", extra=f"{conv}|100", value={"u": 8})

    asyncio.run(_deliver_and_flush(env.realtime.chat_realtime, {
        "distribution": "inbox",
        "event_type": "chat.message.created",
        "conversation_id": conv,
        "target_user_ids": [7],
        "payload": {},
        "_realtime_event_id": f"evt-{uuid.uuid4().hex}",
    }))
    assert not any(k.startswith("7::thread_latest") for k in node._runtime_cache)
    assert any(k.startswith("8::thread_latest") for k in node._runtime_cache)


def test_volatile_event_does_not_invalidate(env):
    conv = f"conv-{uuid.uuid4().hex[:8]}"
    node = env.chat_mod.chat_service
    node._cache._cache_set(user_id=7, bucket="thread_latest", extra=f"{conv}|100", value={"u": 7})
    asyncio.run(_deliver_and_flush(env.realtime.chat_realtime, {
        "distribution": "conversation_room",
        "event_type": "chat.typing.started",
        "conversation_id": conv,
        "payload": {},
        "_realtime_event_id": f"evt-{uuid.uuid4().hex}",
    }))
    assert any(k.startswith("7::thread_latest") for k in node._runtime_cache)


def test_epoch_guard_drops_stale_fill(env):
    """A read that began before an invalidation must not re-seed the cache."""
    conv = f"conv-{uuid.uuid4().hex[:8]}"
    node = env.chat_mod.ChatService()
    epoch_before = node._cache._conversation_cache_epoch(conv)
    node._cache._bump_conversation_cache_epoch(conv)  # invalidation mid-read
    node._cache._cache_set(
        user_id=7, bucket="thread_latest", extra=f"{conv}|100",
        value={"stale": True}, epoch_check=(conv, epoch_before),
    )
    assert not any("thread_latest" in k for k in node._runtime_cache)


def test_pending_map_coalesces_whole_conversation():
    realtime = importlib.import_module("backend.chat.realtime")
    mgr = realtime.ChatRealtimeManager.__new__(realtime.ChatRealtimeManager)
    mgr._lock = threading.Lock()
    mgr._cache_invalidation_pending = {}
    mgr._cache_invalidation_task = None
    mgr._cache_invalidation_debounce_sec = 0.02

    async def _run():
        # user-targeted then room event -> whole conversation wins, one entry.
        mgr._schedule_read_cache_invalidation(conversation_id="c1", user_ids={7})
        mgr._schedule_read_cache_invalidation(conversation_id="c1", whole_conversation=True)
        mgr._schedule_read_cache_invalidation(conversation_id="c2", user_ids={8, 9})
        assert mgr._cache_invalidation_pending["c1"] is None
        assert mgr._cache_invalidation_pending["c2"] == {8, 9}
        # Debounce flush drains the map once for both conversations.
        await asyncio.sleep(0.1)
        assert mgr._cache_invalidation_pending == {}

    asyncio.run(_run())
