"""Persisted old/new job fixtures exercise readers independently of the writer version."""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json

import pytest
from sqlalchemy import select

from test_e2e_chat_delivery_recovery import chat_api, chat_db, models, outbox, lost_post_send_tasks  # noqa: F401
from test_e2e_chat_flow import chat_env  # noqa: F401
from backend.chat import message_persistence
from backend.chat.chat_delivery_state import build_delivery_state_outbox_job


@pytest.mark.skipif(
    "chat-db-reader-stage1-" not in str(message_persistence.__file__),
    reason="Deferred-writer assertion only applies to the intermediate release artifact",
)
def test_stage1_deferred_writer_retries_enqueue_and_new_reader(chat_env, monkeypatch):
    client, _set_user, _drain = chat_env
    pending = []

    def capture(**kwargs):
        if kwargs.get("deferred_delivery_outbox"):
            pending.append(kwargs["deferred_delivery_outbox"])

    monkeypatch.setattr(chat_api, "_schedule_chat_message_side_effects", capture)
    monkeypatch.setattr(chat_api, "_schedule_ai_run_for_message", lambda **kwargs: None)
    created = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]

    def send(_index):
        return client.post(
            f"/chat/conversations/{conversation_id}/messages",
            json={"body": "phase one retry", "client_message_id": "phase-one-same-id"},
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(send, range(4)))
    assert all(item.status_code == 200 for item in responses)
    assert len({item.json()["id"] for item in responses}) == 1
    message_id = responses[0].json()["id"]
    with chat_db.chat_session() as session:
        assert session.get(models.ChatConversation, conversation_id).last_message_seq == 1
        assert not list(session.scalars(select(models.ChatEventOutbox).where(
            models.ChatEventOutbox.message_id == message_id,
        ))), "Intermediate candidate unexpectedly enabled the atomic writer"
    assert len(pending) == 1
    worker = outbox.ChatEventOutboxService()
    assert worker.enqueue_delivery_state_job_idempotent(pending[0]) is True
    assert worker.enqueue_delivery_state_job_idempotent(pending[0]) is False
    claimed = worker.claim_delivery_state_job_for_message(message_id=message_id)
    assert claimed is not None
    assert asyncio.run(worker.process_job(claimed)) == "delivered"
    with chat_db.chat_session() as session:
        state = session.scalar(select(models.ChatConversationUserState).where(
            models.ChatConversationUserState.conversation_id == conversation_id,
            models.ChatConversationUserState.user_id == 2,
        ))
        assert state.unread_count == 1


@pytest.mark.parametrize("format_name,expected_mentions", [
    ("legacy_ids", [2]),
    ("snapshot_allowed", [2, 3]),
    ("snapshot_denied", []),
])
def test_reader_consumes_persisted_legacy_and_snapshot_jobs(lost_post_send_tasks, format_name, expected_mentions):
    client, set_user, _drain = lost_post_send_tasks
    created = client.post(
        "/chat/conversations/group", json={"title": "Reader compatibility", "member_user_ids": [2, 3]},
    )
    assert created.status_code == 200, created.text
    conversation_id = created.json()["id"]
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "hello @all", "client_message_id": "reader-format"},
    )
    assert sent.status_code == 200, sent.text
    message_id = sent.json()["id"]
    with chat_db.chat_session() as session:
        message = session.get(models.ChatMessage, message_id)
        job = build_delivery_state_outbox_job(
            conversation_id=conversation_id, message_id=message_id, sender_user_id=1,
            member_user_ids=[1, 2, 3], conversation_seq=message.conversation_seq,
            seen_at=datetime.now(timezone.utc), mentioned_user_ids=[2] if format_name == "legacy_ids" else [],
        )
        if format_name != "legacy_ids":
            job["payload"].update(mention_body="hello @all", mention_all_allowed=format_name == "snapshot_allowed")
        row = session.scalar(select(models.ChatEventOutbox).where(
            models.ChatEventOutbox.dedupe_key == job["dedupe_key"],
        ))
        if row is None:
            row = models.ChatEventOutbox(
                event_type=job["event_type"], target_scope=job["target_scope"], target_user_id=1,
                conversation_id=conversation_id, message_id=message_id, dedupe_key=job["dedupe_key"],
                status="queued", attempt_count=0, next_attempt_at=datetime.now(timezone.utc),
                created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
            )
            session.add(row)
        row.payload_json = json.dumps(job["payload"])
    worker = outbox.ChatEventOutboxService()
    claimed = worker.claim_delivery_state_job_for_message(message_id=message_id)
    assert claimed is not None
    assert asyncio.run(worker.process_job(claimed)) == "delivered"
    assert worker.claim_delivery_state_job_for_message(message_id=message_id) is None
    with chat_db.chat_session() as session:
        mention_ids = list(session.scalars(select(models.ChatMessageMention.user_id).where(
            models.ChatMessageMention.message_id == message_id,
        ).order_by(models.ChatMessageMention.user_id)))
        state = session.scalar(select(models.ChatConversationUserState).where(
            models.ChatConversationUserState.conversation_id == conversation_id,
            models.ChatConversationUserState.user_id == 2,
        ))
    assert mention_ids == expected_mentions
    assert state.unread_count == 1
    assert state.unread_mention_count == (1 if 2 in expected_mentions else 0)
    set_user(2)
    history = client.get(f"/chat/conversations/{conversation_id}/messages")
    assert history.status_code == 200, history.text
    assert [item["id"] for item in history.json()["items"]] == [message_id]
