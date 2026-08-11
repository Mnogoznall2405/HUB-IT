"""Chat async logging + WS coalesce / sender metrics."""
from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.chat import async_logging
from backend.chat.realtime import ChatRealtimeConnection, ChatRealtimeManager


def test_nonblocking_queue_handler_drops_when_full(monkeypatch):
    async_logging.stop_chat_async_logging()
    monkeypatch.setenv("CHAT_LOG_QUEUE_SIZE", "2")
    # Re-import size is read at module load for CHAT_LOG_QUEUE_SIZE — call install with tiny queue manually.
    import queue as queue_mod

    q: queue_mod.Queue = queue_mod.Queue(maxsize=1)
    handler = async_logging._NonBlockingQueueHandler(q)
    before = async_logging.dropped_logs()
    handler.enqueue(logging.LogRecord("t", logging.INFO, __file__, 1, "a", (), None))
    handler.enqueue(logging.LogRecord("t", logging.INFO, __file__, 1, "b", (), None))
    assert async_logging.dropped_logs() >= before + 1


@pytest.mark.asyncio
async def test_coalesce_keeps_latest_presence_payload():
    manager = ChatRealtimeManager()
    sent: list[str] = []

    async def _send_text(data: str):
        sent.append(data)

    ws = SimpleNamespace(send_text=AsyncMock(side_effect=_send_text), send_json=AsyncMock())
    connection = ChatRealtimeConnection(id="c1", user_id=7, websocket=ws)
    manager._connections = {"c1": connection}

    await manager._broadcast_local(
        target_connections=[connection],
        envelope={"type": "chat.presence.updated", "payload": {"user_id": 7, "v": 1}},
        durable=False,
        volatile_key="presence:7",
    )
    await manager._broadcast_local(
        target_connections=[connection],
        envelope={"type": "chat.presence.updated", "payload": {"user_id": 7, "v": 2}},
        durable=False,
        volatile_key="presence:7",
    )
    assert manager._coalesced_events >= 1
    assert connection.outbound_queue.qsize() == 1

    connection.sender_task = asyncio.create_task(manager._run_connection_sender(connection))
    await asyncio.sleep(0.05)
    assert any('"v": 2' in item or '"v":2' in item for item in sent)
    assert not any('"v": 1' in item or '"v":1' in item for item in sent)

    connection.sender_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await connection.sender_task


@pytest.mark.asyncio
async def test_durable_message_not_coalesced():
    manager = ChatRealtimeManager()
    ws = SimpleNamespace(send_text=AsyncMock(), send_json=AsyncMock())
    connection = ChatRealtimeConnection(id="c2", user_id=1, websocket=ws)
    await manager._broadcast_local(
        target_connections=[connection],
        envelope={"type": "chat.message.created", "payload": {"id": "m1"}},
        durable=True,
        volatile_key=None,
    )
    await manager._broadcast_local(
        target_connections=[connection],
        envelope={"type": "chat.message.created", "payload": {"id": "m2"}},
        durable=True,
        volatile_key=None,
    )
    assert connection.outbound_queue.qsize() == 2
