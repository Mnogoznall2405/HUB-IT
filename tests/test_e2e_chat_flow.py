"""End-to-end chat golden path through the real HTTP router.

Covers the user-visible flow instead of isolated units:
create a direct conversation -> send a message -> retry the same send
(idempotency, what the mobile outbox does on reconnect) -> the peer sees
the unread counter -> marks it read -> counters clear -> a third user is
denied access to the conversation. Only the deepest boundaries (user
directory, chat DB) are stubbed or moved to a temp SQLite file.
"""
from __future__ import annotations

import asyncio
import importlib
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, select, text
from sqlalchemy.orm import Session

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import chat  # noqa: E402
from backend.models.auth import User  # noqa: E402

chat_db_module = importlib.import_module("backend.chat.db")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")


def _raw_user(user_id: int, username: str, full_name: str, role: str) -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "role": role,
        "is_active": True,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": ["chat.read", "chat.write"],
    }


def _public_user(raw: dict) -> User:
    permissions = list(raw.get("custom_permissions") or raw.get("permissions") or [])
    return User(
        id=int(raw["id"]),
        username=str(raw["username"]),
        email=None,
        full_name=str(raw["full_name"]),
        role=str(raw["role"]),
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_profile_mode="manual",
        mail_signature_html=None,
        mail_is_configured=False,
        created_at=None,
        updated_at=None,
        mail_updated_at=None,
    )


@pytest.fixture
def chat_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "alice", "Alice Sender", "operator"),
        2: _raw_user(2, "bob", "Bob Peer", "operator"),
        3: _raw_user(3, "mallory", "Mallory Outsider", "viewer"),
    }
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "hub-data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "get_users_map_by_ids", lambda user_ids: {
        int(user_id): users_by_id[int(user_id)]
        for user_id in set(user_ids or [])
        if int(user_id) in users_by_id
    })
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "database_url", f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}", raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    monkeypatch.setattr(chat_db_module.config.redis, 'url', None)
    redis_read_cache = importlib.import_module('backend.chat.chat_read_cache_redis').chat_read_cache_redis
    monkeypatch.setattr(redis_read_cache, '_client', None)

    service = chat_service_module.ChatService()
    monkeypatch.setattr(chat, "chat_service", service)

    # Post-ACK side effects (outbox enqueue, delivery-state apply, realtime
    # publish) run as fire-and-forget asyncio tasks in prod. TestClient's
    # portal loop does not reliably pump them between requests, so schedule
    # them on a dedicated event-loop thread — same code, real task objects
    # (callers use done()/cancel()/add_done_callback).
    bg_loop = asyncio.new_event_loop()
    bg_thread = threading.Thread(target=bg_loop.run_forever, daemon=True)
    bg_thread.start()
    scheduled: list = []

    def _schedule(coro, *, label):
        future = asyncio.run_coroutine_threadsafe(coro, bg_loop)
        scheduled.append(future)
        return future

    monkeypatch.setattr(chat, "_schedule_chat_background_task", _schedule)

    def drain_background() -> None:
        # Side-effect tasks schedule nested tasks (e.g. delivery-state apply);
        # keep draining until the queue is empty and everything settles.
        for _ in range(10):
            pending = list(scheduled)
            scheduled.clear()
            if not pending:
                break
            for future in pending:
                try:
                    future.result(timeout=15)
                except Exception:
                    # Coalesced meta tasks are cancelled by design (latest wins);
                    # other failures are logged by the task failure hook.
                    pass

    app = FastAPI()
    app.include_router(chat.router, prefix="/chat")
    current = {"user": _public_user(raw_users[1])}
    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    client = TestClient(app)

    yield (
        client,
        lambda user_id: current.update({"user": _public_user(raw_users[user_id])}),
        drain_background,
    )

    bg_loop.call_soon_threadsafe(bg_loop.stop)
    bg_thread.join(timeout=5)
    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_employee_link_resolves_exact_unique_email_and_reuses_dialog(chat_env, monkeypatch):
    client, _, drain_background = chat_env
    directory = chat_service_module.user_service.list_users()
    directory[0]['email'] = 'alice@example.com'
    directory[1]['email'] = 'bob@example.com'
    monkeypatch.setattr(chat_service_module.user_service, 'list_users', lambda: directory)

    found = client.get('/chat/users/resolve', params={'email': ' BOB@EXAMPLE.COM ', 'strict_email': True})
    assert found.status_code == 200, found.text
    assert found.json()['id'] == 2
    for email in ['bob@other.example', 'missing@example.com', 'alice@example.com']:
        missing = client.get('/chat/users/resolve', params={
            'email': email, 'full_name': 'Bob Peer', 'strict_email': True,
        })
        assert missing.status_code == 404, missing.text
    legacy = client.get('/chat/users/resolve', params={'email': 'bob@other.example'})
    assert legacy.status_code == 200 and legacy.json()['id'] == 2

    directory.append({**directory[1], 'id': 4, 'username': 'duplicate'})
    ambiguous = client.get('/chat/users/resolve', params={'email': 'bob@example.com', 'strict_email': True})
    assert ambiguous.status_code == 404 and 'несколько' in ambiguous.json()['detail']
    directory.pop()
    directory[1]['is_active'] = False
    assert client.get('/chat/users/resolve', params={'email': 'bob@example.com', 'strict_email': True}).status_code == 404
    directory[1]['is_active'] = True
    assert client.get('/chat/users/resolve', params={'email': 'not-an-email', 'strict_email': True}).status_code == 400

    opened = client.post('/chat/conversations/direct', json={'peer_user_id': found.json()['id']})
    repeated = client.post('/chat/conversations/direct', json={'peer_user_id': found.json()['id']})
    assert opened.status_code == repeated.status_code == 200
    assert opened.json()['id'] == repeated.json()['id']
    messages = client.get(f"/chat/conversations/{opened.json()['id']}/messages")
    assert messages.status_code == 200 and messages.json()['items'] == []
    drain_background()


def test_chat_send_read_and_access_denial_flow(chat_env):
    client, set_user, drain_background = chat_env

    created = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]

    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "e2e: hello", "client_message_id": "cli-1"},
    )
    assert sent.status_code == 200, sent.text
    message_id = sent.json()["id"]

    # The mobile outbox retries a send with the same client_message_id after
    # reconnects — the backend must not store a duplicate.
    retried = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "e2e: hello", "client_message_id": "cli-1"},
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["id"] == message_id

    listed = client.get(f"/chat/conversations/{conversation_id}/messages")
    assert listed.status_code == 200, listed.text
    bodies = [m["body"] for m in listed.json()["items"]]
    assert bodies.count("e2e: hello") == 1

    # Unread counters move through the durable delivery-state outbox; the send
    # ACK schedules the enqueue+apply as a post-response background task.
    drain_background()

    set_user(2)
    conversations = client.get("/chat/conversations")
    assert conversations.status_code == 200, conversations.text
    summary = next(
        (c for c in conversations.json()["items"] if c["id"] == conversation_id), None
    )
    assert summary is not None, conversations.json()
    # The per-conversation badge reads the authoritative user-state row.
    assert int(summary.get("unread_count") or 0) >= 1, summary

    read = client.post(
        f"/chat/conversations/{conversation_id}/read",
        json={"message_id": message_id},
    )
    assert read.status_code == 200, read.text

    # Read also defers view invalidation / publish to post-ACK tasks.
    drain_background()

    # unread_summary is hard-dropped by mark_read — it must be fresh already.
    unread_after = client.get("/chat/unread-summary").json()
    assert int(unread_after.get("messages_unread_total") or 0) == 0, unread_after

    # The conversations list is only soft-invalidated after mark_read (≤2.5s
    # by design — WS push carries the instant update). It must converge.
    deadline = time.time() + 4
    summary_after = None
    while time.time() < deadline:
        conversations_after = client.get("/chat/conversations").json()
        summary_after = next(
            (c for c in conversations_after["items"] if c["id"] == conversation_id), None
        )
        if summary_after is None or int(summary_after.get("unread_count") or 0) == 0:
            break
        time.sleep(0.3)
    assert summary_after is None or int(summary_after.get("unread_count") or 0) == 0, summary_after

    # A user who is not a member must not read the conversation.
    set_user(3)
    denied = client.get(f"/chat/conversations/{conversation_id}/messages")
    assert denied.status_code in (403, 404), denied.status_code


@pytest.mark.parametrize('kind, endpoint, payload, members', [
    ('direct', '/chat/conversations/direct', {'peer_user_id': 2}, (1, 2)),
    ('group', '/chat/conversations/group', {'title': 'Fresh group', 'member_user_ids': [2]}, (1, 2)),
    ('notes', '/chat/conversations/notes', None, (1,)),
])
def test_new_conversation_is_immediately_visible_in_warmed_lists(chat_env, kind, endpoint, payload, members):
    client, set_user, _drain_background = chat_env
    for member_id in members:
        set_user(member_id)
        for limit in (10, 50):
            warmed = client.get('/chat/conversations', params={'limit': limit})
            assert warmed.status_code == 200, warmed.text
            assert warmed.json()['items'] == []
    set_user(1)
    created = client.post(endpoint, json=payload) if payload is not None else client.post(endpoint)
    assert created.status_code == 200, created.text
    conversation_id = created.json()['id']
    assert created.json()['kind'] == kind
    for member_id in members:
        set_user(member_id)
        for limit in (10, 50):
            listed = client.get('/chat/conversations', params={'limit': limit})
            assert listed.status_code == 200, listed.text
            assert conversation_id in {row['id'] for row in listed.json()['items']}


def _png_bytes(size=(300, 200), color=(200, 30, 30)) -> bytes:
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def test_group_avatar_owner_upload_member_read_and_remove(chat_env):
    client, set_user, _drain_background = chat_env

    created = client.post("/chat/conversations/group", json={"title": "Avatar group", "member_user_ids": [2]})
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]

    # Owner uploads a non-square picture: server stores a 256x256 JPEG.
    uploaded = client.post(
        f"/chat/conversations/{conversation_id}/avatar",
        files={"file": ("photo.png", _png_bytes(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    avatar_url = uploaded.json()["avatar_url"]
    assert avatar_url and "/group-avatars/" in avatar_url

    # A group member loads the picture the way <img src> does.
    set_user(2)
    served = client.get(avatar_url.replace("/api/v1/chat", "/chat"))
    assert served.status_code == 200, served.text
    assert served.headers["content-type"] == "image/jpeg"

    # A plain member cannot change or remove the owner's picture.
    forbidden = client.post(
        f"/chat/conversations/{conversation_id}/avatar",
        files={"file": ("photo.png", _png_bytes(), "image/png")},
    )
    assert forbidden.status_code == 403, forbidden.text
    forbidden_delete = client.delete(f"/chat/conversations/{conversation_id}/avatar")
    assert forbidden_delete.status_code == 403, forbidden_delete.text

    # An outsider cannot read the picture.
    set_user(3)
    hidden = client.get(avatar_url.replace("/api/v1/chat", "/chat"))
    assert hidden.status_code in (403, 404), hidden.status_code

    # Owner removes it: reference is cleared and the file is gone.
    set_user(1)
    removed = client.delete(f"/chat/conversations/{conversation_id}/avatar")
    assert removed.status_code == 200, removed.text
    assert not removed.json().get("avatar_url")
    gone = client.get(avatar_url.replace("/api/v1/chat", "/chat"))
    assert gone.status_code in (403, 404), gone.status_code


def test_group_avatar_rejects_unreadable_and_oversized_payloads(chat_env):
    client, _set_user, _drain_background = chat_env

    created = client.post("/chat/conversations/group", json={"title": "Bad avatars", "member_user_ids": [2]})
    assert created.status_code == 200, created.text
    url = f"/chat/conversations/{created.json()['id']}/avatar"

    not_an_image = client.post(url, files={"file": ("notes.txt", b"hello", "text/plain")})
    assert not_an_image.status_code == 400, not_an_image.text

    too_large = client.post(url, files={"file": ("big.png", b"\x89PNG" + b"0" * (5 * 1024 * 1024 + 10), "image/png")})
    assert too_large.status_code == 400, too_large.text

    # Browsers send an empty / octet-stream type for formats such as HEIC or
    # files picked on Windows: a readable picture must still be accepted.
    octet_stream = client.post(url, files={"file": ("photo.bin", _png_bytes(), "application/octet-stream")})
    assert octet_stream.status_code == 200, octet_stream.text


@pytest.mark.parametrize("audit_mode", ["disabled", "broken", "enabled"])
def test_conversation_listing_respects_optional_audit_gate(chat_env, monkeypatch, tmp_path, audit_mode):
    client, _set_user, drain_background = chat_env
    audit = importlib.import_module("backend.chat.send_audit")
    profile = importlib.import_module("backend.chat.latency_profile")
    log_path = tmp_path / "chat-audit.jsonl"
    monkeypatch.setattr(audit, "_LOG_PATH", log_path)
    created = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]
    drain_background()

    def audit_enabled():
        if audit_mode == "broken":
            raise RuntimeError("fixture: unavailable opt-in configuration")
        return audit_mode == "enabled"

    monkeypatch.setattr(profile, "audit_enabled", audit_enabled)
    # Real HTTP requests exercise both the uncached and cached readers; the
    # actual background writer must remain inactive without a valid opt-in.
    for params in ({"q": "bob"}, {}, {}):
        listed = client.get("/chat/conversations", params=params)
        assert listed.status_code == 200, listed.text
        assert conversation_id in {item["id"] for item in listed.json()["items"]}
    audit._WRITE_QUEUE.join()

    if audit_mode == "enabled":
        entries = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
        stages = {item["data"]["stage"] for item in entries}
        assert {"conversations_cache_hit", "conversations_cache_miss"} <= stages
    else:
        assert not log_path.exists()


def test_support_chat_is_a_relabelled_direct_dialog_with_the_configured_user(chat_env, monkeypatch):
    client, set_user, _drain = chat_env
    support_chat = importlib.import_module("backend.chat.support_chat")
    # bob (id 2) plays the support user; the lookup goes by the configured username.
    monkeypatch.setattr(
        support_chat.app_settings_service, "get_settings", lambda: {"support_chat_username": "bob"}
    )
    monkeypatch.setattr(
        support_chat.user_service,
        "get_by_username",
        lambda username: chat_service_module.user_service.get_by_id(2) if username == "bob" else None,
    )
    support_chat.reset_support_user_cache()
    try:
        assert client.get("/chat/config").json()["support_user_id"] == 2

        opened = client.post("/chat/conversations/support")
        assert opened.status_code == 200, opened.text
        assert opened.json()["title"] == "Техподдержка HUB"
        assert opened.json()["is_support"] is True
        again = client.post("/chat/conversations/support")
        assert again.json()["id"] == opened.json()["id"]

        set_user(2)
        assert client.get("/chat/config").json()["support_user_id"] is None
        assert client.post("/chat/conversations/support").status_code in (400, 409)
        seen = {
            item["id"]: item for item in client.get("/chat/conversations").json()["items"]
        }[opened.json()["id"]]
        assert seen["title"] == "Alice Sender"
        assert seen["is_support"] is False
    finally:
        support_chat.reset_support_user_cache()


def test_existing_dialog_with_the_support_user_is_relabelled_and_stays_writable(chat_env, monkeypatch):
    client, set_user, drain_background = chat_env
    support_chat = importlib.import_module("backend.chat.support_chat")

    # alice and bob already talk before bob becomes the support user.
    existing = client.post("/chat/conversations/direct", json={"peer_user_id": 2}).json()
    first = client.post(
        f"/chat/conversations/{existing['id']}/messages",
        json={"body": "before support", "client_message_id": "pre-1"},
    )
    assert first.status_code == 200, first.text

    monkeypatch.setattr(
        support_chat.app_settings_service, "get_settings", lambda: {"support_chat_username": "bob"}
    )
    monkeypatch.setattr(
        support_chat.user_service,
        "get_by_username",
        lambda username: chat_service_module.user_service.get_by_id(2) if username == "bob" else None,
    )
    support_chat.reset_support_user_cache()
    try:
        listed = {item["id"]: item for item in client.get("/chat/conversations").json()["items"]}
        assert listed[existing["id"]]["title"] == "Техподдержка HUB"
        assert listed[existing["id"]]["is_support"] is True

        # The support entry opens that very dialog instead of creating a second one.
        assert client.post("/chat/conversations/support").json()["id"] == existing["id"]

        after = client.post(
            f"/chat/conversations/{existing['id']}/messages",
            json={"body": "after support", "client_message_id": "post-1"},
        )
        assert after.status_code == 200, after.text
        drain_background()

        set_user(2)
        reply = client.post(
            f"/chat/conversations/{existing['id']}/messages",
            json={"body": "support reply", "client_message_id": "post-2"},
        )
        assert reply.status_code == 200, reply.text
        bodies = [m["body"] for m in client.get(f"/chat/conversations/{existing['id']}/messages").json()["items"]]
        assert bodies == ["before support", "after support", "support reply"]
    finally:
        support_chat.reset_support_user_cache()


@pytest.fixture
def locked_preview_reads(chat_env, monkeypatch):
    service = chat.chat_service
    original = service._lock_conversation_for_write
    current = {}
    reads = []

    def lock(**kwargs):
        conversation = original(**kwargs)
        session = kwargs["session"]
        current.update(session=session, connection=session.connection())
        return conversation

    def capture(connection, cursor, statement, parameters, context, executemany):
        session = current.get("session")
        if (
            session is not None
            and session.in_transaction()
            and connection is current["connection"]
            and statement.lstrip().upper().startswith("SELECT")
            and "chat_attachment_previews" in statement
        ):
            reads.append(statement)

    engine = chat_db_module.get_chat_write_engine()
    monkeypatch.setattr(service, "_lock_conversation_for_write", lock)
    event.listen(engine, "before_cursor_execute", capture)
    try:
        yield reads
    finally:
        event.remove(engine, "before_cursor_execute", capture)


def _file_send_request(client, conversation_id, client_id, source_id=None):
    if source_id:
        return client.post(
            f"/chat/conversations/{conversation_id}/messages/forward",
            json={"source_message_id": source_id, "client_message_id": client_id},
        )
    return client.post(
        f"/chat/conversations/{conversation_id}/messages/files",
        data={"client_message_id": client_id},
        files=[("files", (f"image-{i}.png", _png_bytes(), "image/png")) for i in range(5)],
    )


@pytest.mark.parametrize("kind", ["files", "forward"])
def test_file_preview_queue_is_batched_and_retries_preserve_message_order(chat_env, locked_preview_reads, kind):
    client, set_user, drain = chat_env
    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 2}).json()["id"]
    source_id = None
    if kind == "forward":
        source = _file_send_request(client, conversation, "source")
        assert source.status_code == 200, source.text
        source_id = source.json()["id"]
        drain()
    reads = locked_preview_reads
    reads.clear()
    sent = _file_send_request(client, conversation, "batch-1", source_id)
    assert sent.status_code == 200, sent.text
    message = sent.json()
    assert len(message["attachments"]) == 5
    assert len(reads) == 1

    retried = _file_send_request(client, conversation, "batch-1", source_id)
    assert retried.status_code == 200, retried.text
    assert retried.json()["id"] == message["id"]
    assert {a["id"] for a in retried.json()["attachments"]} == {a["id"] for a in message["attachments"]}
    drain()
    models = importlib.import_module("backend.chat.models")
    with chat_db_module.chat_session() as session:
        previews = list(session.scalars(select(models.ChatAttachmentPreview).where(
            models.ChatAttachmentPreview.attachment_id.in_([a["id"] for a in message["attachments"]]),
        )))
        messages = list(session.scalars(select(models.ChatMessage).where(
            models.ChatMessage.conversation_id == conversation,
        ).order_by(models.ChatMessage.conversation_seq)))
    assert len(previews) == 5
    assert all(p.status == "queued" for p in previews)
    assert [m.conversation_seq for m in messages] == list(range(1, len(messages) + 1))
    assert [m.id for m in messages].count(message["id"]) == 1

    set_user(2)
    listed = client.get(f"/chat/conversations/{conversation}/messages")
    assert listed.status_code == 200, listed.text
    assert {message["id"]} <= {m["id"] for m in listed.json()["items"]}
    set_user(3)
    assert _file_send_request(client, conversation, "outsider", source_id).status_code in {403, 404}


@pytest.mark.parametrize("kind", ["files", "forward"])
def test_preview_queue_failure_rolls_back_message_attachments_and_sequence(chat_env, kind):
    client, _set_user, drain = chat_env
    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 2}).json()["id"]
    source_id = None
    if kind == "forward":
        source = _file_send_request(client, conversation, "source")
        assert source.status_code == 200, source.text
        source_id = source.json()["id"]
        drain()
    models = importlib.import_module("backend.chat.models")
    service = chat.chat_service
    before_files = {p for p in service._attachments_root.rglob("*") if p.is_file()}

    def fail_preview_insert(session, flush_context, instances):
        if any(isinstance(row, models.ChatAttachmentPreview) for row in session.new):
            raise RuntimeError("isolated preview persistence failure")

    event.listen(Session, "before_flush", fail_preview_insert)
    try:
        response = _file_send_request(TestClient(client.app, raise_server_exceptions=False), conversation, "retry-after-failure", source_id)
        assert response.status_code == 500, response.text
    finally:
        event.remove(Session, "before_flush", fail_preview_insert)
    with chat_db_module.chat_session() as session:
        stored = list(session.scalars(select(models.ChatMessage).where(
            models.ChatMessage.conversation_id == conversation,
        )))
        attachments = list(session.scalars(select(models.ChatMessageAttachment)))
        previews = list(session.scalars(select(models.ChatAttachmentPreview)))
    assert {m.id for m in stored} == ({source_id} if source_id else set())
    assert len(attachments) == len(previews) == (5 if source_id else 0)
    assert {p for p in service._attachments_root.rglob("*") if p.is_file()} == before_files

    retried = _file_send_request(client, conversation, "retry-after-failure", source_id)
    assert retried.status_code == 200, retried.text
    with chat_db_module.chat_session() as session:
        seq = session.scalar(select(models.ChatMessage.conversation_seq).where(
            models.ChatMessage.id == retried.json()["id"],
        ))
    assert seq == (2 if source_id else 1)
    drain()


def test_forward_response_failure_keeps_committed_files_and_retry_reuses_them(chat_env, monkeypatch):
    client, set_user, drain = chat_env
    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 2}).json()["id"]
    source = _file_send_request(client, conversation, "source")
    assert source.status_code == 200, source.text
    source_id = source.json()["id"]
    drain()
    service = chat.chat_service
    original = service._build_message_payload_for_members
    fail_once = {"armed": True}

    def fail_response(**kwargs):
        if fail_once["armed"] and kwargs["message"].forward_from_message_id == source_id:
            fail_once["armed"] = False
            raise RuntimeError("isolated response failure after commit")
        return original(**kwargs)

    monkeypatch.setattr(service, "_build_message_payload_for_members", fail_response)
    failed = _file_send_request(
        TestClient(client.app, raise_server_exceptions=False), conversation, "forward-retry", source_id,
    )
    assert failed.status_code == 500, failed.text
    listed = client.get(f"/chat/conversations/{conversation}/messages")
    assert listed.status_code == 200, listed.text
    messages = listed.json()["items"]
    assert len(messages) == 2
    forwarded = next(m for m in messages if m["id"] != source_id)
    assert len(forwarded["attachments"]) == 5

    set_user(2)
    for attachment in forwarded["attachments"]:
        downloaded = client.get(attachment["download_url"].removeprefix("/api/v1"))
        assert downloaded.status_code == 200, downloaded.text
        assert downloaded.content == _png_bytes()
    owned_paths = {p for p in service._attachments_root.rglob("*") if p.is_file()}

    set_user(1)
    retried = _file_send_request(client, conversation, "forward-retry", source_id)
    assert retried.status_code == 200, retried.text
    assert retried.json()["id"] == forwarded["id"]
    assert {a["id"] for a in retried.json()["attachments"]} == {a["id"] for a in forwarded["attachments"]}
    assert {p for p in service._attachments_root.rglob("*") if p.is_file()} == owned_paths
    set_user(3)
    assert client.get(forwarded["attachments"][0]["download_url"].removeprefix("/api/v1")).status_code in {403, 404}
    drain()


@pytest.fixture
def replay_lock_probe(chat_env, monkeypatch):
    service = chat.chat_service
    original = service._lock_conversation_for_write
    probe = {}

    def lock(**kwargs):
        session = kwargs["session"]
        if session.get_bind().dialect.name == "sqlite":
            # SQLite ignores FOR UPDATE; make its lifetime observable in the HTTP race.
            session.execute(text("BEGIN IMMEDIATE"))
        conversation = original(**kwargs)
        probe["transaction"] = session.get_transaction()
        return conversation

    monkeypatch.setattr(service, "_lock_conversation_for_write", lock)
    return probe


@pytest.mark.parametrize("kind", ["files", "forward"])
def test_slow_file_replay_response_does_not_block_another_send(chat_env, replay_lock_probe, monkeypatch, kind):
    client, set_user, drain = chat_env
    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 2}).json()["id"]
    source_id = None
    if kind == "forward":
        source = _file_send_request(client, conversation, "source")
        assert source.status_code == 200, source.text
        source_id = source.json()["id"]
    first = _file_send_request(client, conversation, "replay", source_id)
    assert first.status_code == 200, first.text
    message = first.json()
    drain()
    service = chat.chat_service
    owned_paths = {p for p in service._attachments_root.rglob("*") if p.is_file()}
    original = service._build_message_payload_for_members
    entered = threading.Event()
    release = threading.Event()
    contender_finished = threading.Event()
    lock_active = []

    def slow_response(**kwargs):
        if kwargs["message"].id == message["id"] and not entered.is_set():
            lock_active.append(replay_lock_probe["transaction"].is_active)
            entered.set()
            if not release.wait(10):
                raise RuntimeError("Isolated replay response gate was not released")
        return original(**kwargs)

    def send_contender():
        try:
            return client.post(
                f"/chat/conversations/{conversation}/messages",
                json={"body": "sent while replay response is paused", "client_message_id": "contender"},
            )
        finally:
            contender_finished.set()

    monkeypatch.setattr(service, "_build_message_payload_for_members", slow_response)
    with ThreadPoolExecutor(max_workers=2) as executor:
        replay = executor.submit(_file_send_request, client, conversation, "replay", source_id)
        try:
            assert entered.wait(10), "Replay never reached response serialization"
            contender = executor.submit(send_contender)
            progressed = contender_finished.wait(2)
        finally:
            release.set()
        replay_response = replay.result(timeout=10)
        contender_response = contender.result(timeout=10)
    assert replay_response.status_code == 200, replay_response.text
    assert contender_response.status_code == 200, contender_response.text
    assert progressed, f"Another send waited for replay serialization; original transaction active={lock_active}"
    assert lock_active == [False]
    assert replay_response.json()["id"] == message["id"]
    assert {a["id"] for a in replay_response.json()["attachments"]} == {a["id"] for a in message["attachments"]}
    assert {p for p in service._attachments_root.rglob("*") if p.is_file()} == owned_paths
    drain()
    listed = client.get(f"/chat/conversations/{conversation}/messages")
    assert listed.status_code == 200, listed.text
    expected = ([source_id] if source_id else []) + [message["id"], contender_response.json()["id"]]
    assert [m["id"] for m in listed.json()["items"]] == expected
    set_user(3)
    assert _file_send_request(client, conversation, "replay", source_id).status_code in {403, 404}


@pytest.mark.parametrize("kind", ["files", "forward"])
def test_failed_file_replay_response_discards_only_unused_retry_files(chat_env, replay_lock_probe, monkeypatch, kind):
    client, set_user, drain = chat_env
    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 2}).json()["id"]
    source_id = None
    if kind == "forward":
        source = _file_send_request(client, conversation, "source")
        assert source.status_code == 200, source.text
        source_id = source.json()["id"]
    first = _file_send_request(client, conversation, "replay", source_id)
    assert first.status_code == 200, first.text
    message = first.json()
    drain()
    service = chat.chat_service
    owned_paths = {p for p in service._attachments_root.rglob("*") if p.is_file()}
    original = service._build_message_payload_for_members
    lock_active = []

    def fail_once(**kwargs):
        if kwargs["message"].id == message["id"] and not lock_active:
            lock_active.append(replay_lock_probe["transaction"].is_active)
            raise RuntimeError("Isolated replay response failure")
        return original(**kwargs)

    monkeypatch.setattr(service, "_build_message_payload_for_members", fail_once)
    failed = _file_send_request(
        TestClient(client.app, raise_server_exceptions=False), conversation, "replay", source_id,
    )
    assert failed.status_code == 500, failed.text
    assert {p for p in service._attachments_root.rglob("*") if p.is_file()} == owned_paths
    set_user(2)
    for attachment in message["attachments"]:
        downloaded = client.get(attachment["download_url"].removeprefix("/api/v1"))
        assert downloaded.status_code == 200, downloaded.text
        assert downloaded.content == _png_bytes()
    set_user(1)
    retried = _file_send_request(client, conversation, "replay", source_id)
    assert retried.status_code == 200, retried.text
    assert retried.json()["id"] == message["id"]
    assert {a["id"] for a in retried.json()["attachments"]} == {a["id"] for a in message["attachments"]}
    assert {p for p in service._attachments_root.rglob("*") if p.is_file()} == owned_paths
    drain()
    listed = client.get(f"/chat/conversations/{conversation}/messages")
    assert listed.status_code == 200, listed.text
    assert [m["id"] for m in listed.json()["items"]] == ([source_id] if source_id else []) + [message["id"]]
    assert lock_active == [False]
