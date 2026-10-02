"""AI7: profile GET /chat/conversations — count statements and measure latency
on a realistic sqlite dataset; regression-guards against per-item N+1 queries."""
from __future__ import annotations

import importlib
import statistics
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_db_module = importlib.import_module("backend.chat.db")
chat_models_module = importlib.import_module("backend.chat.models")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")

CONVERSATIONS_TOTAL = 60  # one full page (limit=50) plus spillover


def _raw_user(user_id: int, username: str, full_name: str) -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "role": "operator",
        "is_active": True,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": [],
    }


def _reset_chat_engines():
    chat_db_module._engine = None
    chat_db_module._session_factory = None
    chat_db_module._read_engine = None
    chat_db_module._read_session_factory = None
    chat_db_module._engines.clear()
    chat_db_module._session_factories.clear()
    chat_db_module._read_engines.clear()
    chat_db_module._read_session_factories.clear()


@pytest.fixture
def chat_env(temp_dir, monkeypatch):
    raw_users = {1: _raw_user(1, "me", "Current User")}
    raw_users.update({
        uid: _raw_user(uid, f"peer{uid}", f"Peer {uid}")
        for uid in range(2, CONVERSATIONS_TOTAL + 10)
    })
    users = list(raw_users.values())
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "hub-data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(hub_service_module.user_service, "get_users_map_by_ids", lambda user_ids: {
        int(user_id): users_by_id[int(user_id)]
        for user_id in set(user_ids or [])
        if int(user_id) in users_by_id
    })
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "get_users_map_by_ids", lambda user_ids: {
        int(user_id): users_by_id[int(user_id)]
        for user_id in set(user_ids or [])
        if int(user_id) in users_by_id
    })
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))

    hub_service = hub_service_module.HubService()
    monkeypatch.setattr(chat_service_module, "hub_service", hub_service)

    _reset_chat_engines()
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(
        chat_db_module.config.chat,
        "database_url",
        f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}",
        raising=False,
    )

    chat_db_module.initialize_chat_schema()
    service = chat_service_module.ChatService()
    yield service
    _reset_chat_engines()


def _seed_conversations(service) -> None:
    models = chat_models_module
    now = datetime.now(timezone.utc)
    with chat_db_module.chat_session() as session:
        objects: list = []
        for idx in range(CONVERSATIONS_TOTAL):
            conv_id = f"conv-{idx:03d}"
            peer = idx + 2
            kind = "direct" if idx % 3 else "group"
            msg_id = f"msg-{idx:03d}"
            objects.append(models.ChatConversation(
                id=conv_id,
                kind=kind,
                title=None if kind == "direct" else f"Группа {idx}",
                created_by_user_id=1,
                last_message_id=msg_id,
                last_message_seq=idx + 1,
                last_message_at=now - timedelta(minutes=idx),
            ))
            objects.append(models.ChatMember(
                conversation_id=conv_id, user_id=1, member_role="owner",
            ))
            objects.append(models.ChatMember(
                conversation_id=conv_id, user_id=peer, member_role="member",
            ))
            if kind == "group":
                objects.append(models.ChatMember(
                    conversation_id=conv_id, user_id=peer + 1, member_role="member",
                ))
            objects.append(models.ChatConversationUserState(
                conversation_id=conv_id,
                user_id=1,
                unread_count=idx % 4,
                last_read_seq=max(0, idx - (idx % 4)),
            ))
            objects.append(models.ChatConversationUserState(
                conversation_id=conv_id,
                user_id=peer,
                unread_count=0,
                last_read_seq=idx + 1,
            ))
            objects.append(models.ChatMessage(
                id=msg_id,
                conversation_id=conv_id,
                sender_user_id=peer,
                kind="text",
                body_format="plain",
                body=f"Сообщение {idx} с достаточно длинным текстом для превью",
                conversation_seq=idx + 1,
                created_at=now - timedelta(minutes=idx),
            ))
            objects.append(models.ChatMessageRead(
                conversation_id=conv_id,
                message_id=msg_id,
                user_id=1,
            ))
            if idx % 5 == 0:
                objects.append(models.ChatMessageAttachment(
                    id=f"att-{idx:03d}",
                    message_id=msg_id,
                    conversation_id=conv_id,
                    storage_name=f"storage-{idx}.jpg",
                    file_name=f"photo-{idx}.jpg",
                    file_size=12345,
                    mime_type="image/jpeg",
                    media_kind="image",
                    uploaded_by_user_id=peer,
                ))
        session.add_all(objects)


def test_list_conversations_query_count_and_latency(chat_env, capsys):
    service = chat_env
    _seed_conversations(service)

    engine = chat_db_module.get_chat_read_engine()
    statements: list[tuple[str, float, object]] = []
    started: dict[int, float] = {}

    @event.listens_for(engine, "before_cursor_execute")
    def _before(conn, cursor, statement, parameters, context, executemany):
        started[id(context)] = time.perf_counter()

    @event.listens_for(engine, "after_cursor_execute")
    def _after(conn, cursor, statement, parameters, context, executemany):
        statements.append((
            statement,
            (time.perf_counter() - started.pop(id(context), time.perf_counter())) * 1000,
            parameters,
        ))

    # Warm the code paths first, then drop the response cache — the profiled
    # call must run the real query path. "conversations" is a soft bucket:
    # _invalidate_user_cache only shortens its TTL, so drop the key directly.
    service.list_conversations(current_user_id=1, limit=50)

    service._runtime_cache.clear()
    statements.clear()
    t0 = time.perf_counter()
    search_payload = service.list_conversations(current_user_id=1, limit=50, q="x")
    cold_ms = (time.perf_counter() - t0) * 1000

    service._runtime_cache.clear()
    statements.clear()
    t0 = time.perf_counter()
    payload = service.list_conversations(current_user_id=1, limit=50)
    total_ms = (time.perf_counter() - t0) * 1000

    items = payload["items"]
    assert len(items) == 50
    assert payload["has_more"] is True

    slowest = sorted(statements, key=lambda item: item[1], reverse=True)[:5]
    report = [
        "",
        f"AI7 list_conversations profile (sqlite, {CONVERSATIONS_TOTAL} conversations, page=50):",
        f"  statements on chat read engine: {len(statements)}",
        f"  wall time: {total_ms:.1f} ms (search call: {cold_ms:.1f} ms)",
        "  slowest statements:",
    ]
    report += [f"    {ms:7.2f} ms  {stmt.splitlines()[0][:110]}" for stmt, ms, _params in slowest]

    # Query plan: EXPLAIN QUERY PLAN for each captured statement. sqlite output
    # is indicative only — the authoritative plan must be re-run on PostgreSQL.
    with engine.connect() as conn:
        for stmt, _ms, params in statements:
            if not stmt.lstrip().upper().startswith("SELECT"):
                continue
            try:
                plan_rows = conn.exec_driver_sql(f"EXPLAIN QUERY PLAN {stmt}", params).all()
            except Exception as exc:  # e.g. bound params shape — report, don't fail
                report.append(f"  plan unavailable: {exc.__class__.__name__} for {stmt.splitlines()[0][:80]}")
                continue
            report.append(f"  plan: {stmt.splitlines()[0][:90]}")
            report += [f"      {row}" for row in plan_rows]
    print("\n".join(report))

    # Bounded batch read: page list + members + last messages + attachments +
    # reads + states + (per-statement extra such as PRAGMA) — never per-item N+1.
    assert len(statements) <= 15, (
        f"list_conversations issued {len(statements)} statements for a 50-item page "
        f"(N+1 regression?):\n" + "\n".join(stmt[:120] for stmt, _ms, _p in statements)
    )
    # sqlite is not PostgreSQL, but an in-process page build this large must not
    # take seconds; production p95 target (300 ms) is validated on the stand.
    assert total_ms < 1000, f"list_conversations took {total_ms:.0f} ms for 50 items"
