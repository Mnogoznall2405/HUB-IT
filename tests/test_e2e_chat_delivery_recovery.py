"""Chat delivery recovery and enqueue commit/wake guarantees."""
from __future__ import annotations

import asyncio
import importlib
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from test_e2e_chat_flow import chat_env  # noqa: F401


chat_api = importlib.import_module("backend.api.v1.chat")
chat_db = importlib.import_module("backend.chat.db")
models = importlib.import_module("backend.chat.models")
outbox = importlib.import_module("backend.chat.event_outbox_service")


@pytest.fixture
def lost_post_send_tasks(chat_env, monkeypatch):
    monkeypatch.setattr(chat_api, "_schedule_chat_message_side_effects", lambda **kwargs: None)
    monkeypatch.setattr(chat_api, "_schedule_ai_run_for_message", lambda **kwargs: None)
    profile = importlib.import_module("backend.chat.latency_profile")
    monkeypatch.setattr(profile, "event_outbox_poll_enabled", lambda: True)
    monkeypatch.setenv("CHAT_EVENT_OUTBOX_ENABLED", "1")
    return chat_env


def _restart_delivery_worker(monkeypatch):
    later = datetime.now(timezone.utc) + timedelta(minutes=10)
    monkeypatch.setattr(outbox, "_utc_now", lambda: later)
    worker = outbox.ChatEventOutboxService()
    result = asyncio.run(worker.poll_once())
    assert result["failed"] == 0
    return worker


@pytest.mark.parametrize(
    "kind,body,mentions",
    [("text", "hello @bob", [2]), ("contact", '{"name":"Offline contact"}', [])],
)
def test_acknowledged_send_recovers_after_worker_outage(lost_post_send_tasks, monkeypatch, kind, body, mentions):
    client, set_user, _drain = lost_post_send_tasks
    created = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"kind": kind, "body": body, "client_message_id": "offline-send"},
    )
    assert sent.status_code == 200, sent.text
    message_id = sent.json()["id"]
    with chat_db.chat_session() as session:
        jobs = list(session.scalars(select(models.ChatEventOutbox).where(
            models.ChatEventOutbox.message_id == message_id,
            models.ChatEventOutbox.event_type == "chat.message.delivery_state",
        )))
    assert len(jobs) == 1, "ACK has no durable delivery-state intent"
    _restart_delivery_worker(monkeypatch)
    with chat_db.chat_session() as session:
        state = session.scalar(select(models.ChatConversationUserState).where(
            models.ChatConversationUserState.conversation_id == conversation_id,
            models.ChatConversationUserState.user_id == 2,
        ))
        mention_ids = list(session.scalars(select(models.ChatMessageMention.user_id).where(
            models.ChatMessageMention.message_id == message_id,
        )))
    assert state.unread_count == 1
    assert state.unread_mention_count == len(mentions)
    assert mention_ids == mentions
    retry = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"kind": kind, "body": body, "client_message_id": "offline-send"},
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["id"] == message_id
    set_user(2)
    history = client.get(f"/chat/conversations/{conversation_id}/messages")
    assert history.status_code == 200, history.text
    assert [item["id"] for item in history.json()["items"]] == [message_id]


def test_delivery_intent_failure_rolls_back_message_and_sequence(lost_post_send_tasks):
    client, _set_user, _drain = lost_post_send_tasks
    created = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]
    engine = chat_db.get_chat_write_engine()

    def fail_outbox_insert(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("INSERT") and "chat_event_outbox" in statement:
            raise RuntimeError("Isolated durable intent insert failure")

    event.listen(engine, "before_cursor_execute", fail_outbox_insert)
    try:
        failed = TestClient(client.app, raise_server_exceptions=False).post(
            f"/chat/conversations/{conversation_id}/messages",
            json={"body": "must roll back", "client_message_id": "retry-intent"},
        )
    finally:
        event.remove(engine, "before_cursor_execute", fail_outbox_insert)
    assert failed.status_code == 500, failed.text
    with chat_db.chat_session() as session:
        assert session.get(models.ChatConversation, conversation_id).last_message_seq == 0
        assert not list(session.scalars(select(models.ChatMessage).where(
            models.ChatMessage.conversation_id == conversation_id,
        )))
        assert not list(session.scalars(select(models.ChatEventOutbox).where(
            models.ChatEventOutbox.conversation_id == conversation_id,
        )))
    retried = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "must roll back", "client_message_id": "retry-intent"},
    )
    assert retried.status_code == 200, retried.text
    with chat_db.chat_session() as session:
        assert session.get(models.ChatMessage, retried.json()["id"]).conversation_seq == 1
        assert len(list(session.scalars(select(models.ChatEventOutbox).where(
            models.ChatEventOutbox.message_id == retried.json()["id"],
        )))) == 1


@pytest.mark.parametrize("sender_role", ["member", "moderator"])
def test_recovered_everyone_mention_uses_send_time_permission(lost_post_send_tasks, monkeypatch, sender_role):
    client, set_user, _drain = lost_post_send_tasks
    created = client.post(
        "/chat/conversations/group", json={"title": "Recovery permission", "member_user_ids": [2, 3]},
    )
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]
    role_url = f"/chat/conversations/{conversation_id}/members/2/role"
    if sender_role == "moderator":
        assert client.patch(role_url, json={"member_role": "moderator"}).status_code == 200
    set_user(2)
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "hello @all", "client_message_id": "everyone-offline"},
    )
    assert sent.status_code == 200, sent.text
    set_user(1)
    changed_role = "moderator" if sender_role == "member" else "member"
    assert client.patch(role_url, json={"member_role": changed_role}).status_code == 200
    _restart_delivery_worker(monkeypatch)
    with chat_db.chat_session() as session:
        mention_ids = list(session.scalars(select(models.ChatMessageMention.user_id).where(
            models.ChatMessageMention.message_id == sent.json()["id"],
        ).order_by(models.ChatMessageMention.user_id)))
    assert mention_ids == ([1, 3] if sender_role == "moderator" else [])


@pytest.mark.parametrize("retry_same_id", [False, True])
def test_parallel_sends_commit_one_intent_per_message(lost_post_send_tasks, retry_same_id):
    client, _set_user, _drain = lost_post_send_tasks
    created = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]

    def send(index):
        return client.post(
            f"/chat/conversations/{conversation_id}/messages",
            json={"body": "parallel send", "client_message_id": "same-id" if retry_same_id else f"send-{index}"},
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(send, range(8)))
    assert all(r.status_code == 200 for r in responses), [r.status_code for r in responses]
    ids = {r.json()["id"] for r in responses}
    assert len(ids) == (1 if retry_same_id else 8)
    with chat_db.chat_session() as session:
        messages = list(session.scalars(select(models.ChatMessage).where(
            models.ChatMessage.conversation_id == conversation_id,
        ).order_by(models.ChatMessage.conversation_seq)))
        jobs = list(session.scalars(select(models.ChatEventOutbox).where(
            models.ChatEventOutbox.conversation_id == conversation_id,
        )))
        conversation = session.get(models.ChatConversation, conversation_id)
    assert {m.id for m in messages} == {j.message_id for j in jobs} == ids
    assert len(jobs) == len(ids)
    assert [m.conversation_seq for m in messages] == list(range(1, len(ids) + 1))
    assert conversation.last_message_seq == len(ids)


@pytest.mark.parametrize("deduplicated", [True, False])
def test_committed_enqueue_wakes_idle_dispatcher_and_reports_actual_inserts(lost_post_send_tasks, deduplicated):
    client, _set_user, _drain = lost_post_send_tasks
    created = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "enqueue wake probe", "client_message_id": "enqueue-wake"},
    )
    assert sent.status_code == 200, sent.text
    message_id = sent.json()["id"]
    job = {
        "event_type": "chat.message.metadata.refresh",
        "target_scope": "system", "target_user_id": 1,
        "conversation_id": conversation_id, "message_id": message_id, "payload": {},
        "dedupe_key": f"metadata-wake:{message_id}" if deduplicated else None,
    }
    worker = outbox.ChatEventOutboxService()

    async def check():
        worker._loop = asyncio.get_running_loop()
        worker._wake = asyncio.Event()
        worker._stop_event = asyncio.Event()
        waiter = asyncio.create_task(worker._wait_for_wake_or_stop(30))
        await asyncio.sleep(0)
        try:
            inserted = await asyncio.to_thread(worker.enqueue_events, [job])
            with chat_db.chat_session() as session:
                rows = list(session.scalars(select(models.ChatEventOutbox).where(
                    models.ChatEventOutbox.message_id == message_id,
                    models.ChatEventOutbox.event_type == job["event_type"],
                )))
            assert len(rows) == 1, "Enqueue did not commit its row"
            try:
                stopped = await asyncio.wait_for(waiter, timeout=2)
                awoken = not stopped
            except TimeoutError:
                awoken = False
            assert inserted == 1 and awoken, f"Committed row: inserted={inserted}, dispatcher_awoken={awoken}"

            worker._wake.clear()
            repeated = await asyncio.to_thread(worker.enqueue_events, [job])
            await asyncio.sleep(0)
            assert repeated == (0 if deduplicated else 1)
            assert worker._wake.is_set() is (not deduplicated)
        finally:
            if not waiter.done():
                waiter.cancel()
                await asyncio.gather(waiter, return_exceptions=True)
            worker._loop = None

    asyncio.run(check())
    with chat_db.chat_session() as session:
        rows = list(session.scalars(select(models.ChatEventOutbox).where(
            models.ChatEventOutbox.message_id == message_id,
            models.ChatEventOutbox.event_type == job["event_type"],
        )))
    assert len(rows) == (1 if deduplicated else 2)


def test_failed_enqueue_batch_neither_commits_nor_wakes_dispatcher(lost_post_send_tasks):
    client, _set_user, _drain = lost_post_send_tasks
    created = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]
    jobs = [{
        "event_type": "chat.message.metadata.refresh", "target_scope": "system",
        "target_user_id": 1, "conversation_id": conversation_id, "payload": {},
        "dedupe_key": f"rollback-wake:{index}",
    } for index in range(2)]
    worker = outbox.ChatEventOutboxService()
    inserts = []

    def fail_second_insert(connection, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("INSERT") and "chat_event_outbox" in statement:
            inserts.append(statement)
            if len(inserts) == 2:
                raise RuntimeError("Isolated second enqueue failure")

    async def check():
        worker._loop = asyncio.get_running_loop()
        worker._wake = asyncio.Event()
        engine = chat_db.get_chat_write_engine()
        event.listen(engine, "before_cursor_execute", fail_second_insert)
        try:
            with pytest.raises(RuntimeError, match="Isolated second enqueue failure"):
                await asyncio.to_thread(worker.enqueue_events, jobs)
            await asyncio.sleep(0)
            assert not worker._wake.is_set()
        finally:
            event.remove(engine, "before_cursor_execute", fail_second_insert)
            worker._loop = None

    asyncio.run(check())
    assert len(inserts) == 2
    with chat_db.chat_session() as session:
        assert not list(session.scalars(select(models.ChatEventOutbox).where(
            models.ChatEventOutbox.conversation_id == conversation_id,
        )))
