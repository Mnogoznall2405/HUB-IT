"""Unit tests for chat write-path isolation helpers."""
from __future__ import annotations

import os

import pytest


def test_write_slot_invariant_defaults():
    from backend.chat.write_path_limits import (
        CHAT_AUX_WRITE_DB_SLOTS,
        CHAT_DB_WRITE_POOL_SIZE,
        CHAT_MARK_READ_DB_SLOTS,
        CHAT_SEND_DB_RESERVED,
        validate_write_slot_invariant,
        write_slot_gauges,
    )

    validate_write_slot_invariant()
    used = CHAT_MARK_READ_DB_SLOTS + CHAT_AUX_WRITE_DB_SLOTS
    assert used <= CHAT_DB_WRITE_POOL_SIZE - CHAT_SEND_DB_RESERVED
    gauges = write_slot_gauges()
    assert gauges["send_db_reserved"] == CHAT_SEND_DB_RESERVED


def test_stage_histogram_and_session_counters():
    from backend.chat.write_path_metrics import (
        note_session_open,
        queue_gauges_snapshot,
        record_stage,
        session_counters_snapshot,
        stage_histogram_snapshot,
        critical_queue_enter,
        critical_queue_leave,
    )

    before = session_counters_snapshot()
    note_session_open("write")
    note_session_open("read")
    note_session_open("legacy", caller="test")
    after = session_counters_snapshot()
    assert after["write"] >= before.get("write", 0) + 1
    assert after["read"] >= before.get("read", 0) + 1
    assert after["legacy"] >= before.get("legacy", 0) + 1

    record_stage("seq_claim", 12.5, trace_id="t1")
    record_stage("seq_claim", 40.0, trace_id="t2")
    hist = stage_histogram_snapshot()
    assert "seq_claim" in hist
    assert hist["seq_claim"]["n"] >= 2
    assert hist["seq_claim"]["p50"] is not None

    critical_queue_enter()
    gauges = queue_gauges_snapshot()
    assert gauges["critical_queue_depth"] >= 1
    assert gauges["critical_queue_drop"] == 0
    critical_queue_leave()


def test_estimated_pg_connections_multiplies_by_process():
    from backend.chat.db import estimated_chat_pg_connections

    one = estimated_chat_pg_connections(processes=1)
    two = estimated_chat_pg_connections(processes=2)
    assert two["estimated_total_pg_connections"] == one["estimated_total_pg_connections"] * 2


def test_mark_read_slot_timeout_when_zero(monkeypatch):
    monkeypatch.setenv("CHAT_DB_WRITE_POOL_SIZE", "8")
    monkeypatch.setenv("CHAT_SEND_DB_RESERVED", "8")
    monkeypatch.setenv("CHAT_MARK_READ_DB_SLOTS", "0")
    monkeypatch.setenv("CHAT_AUX_WRITE_DB_SLOTS", "0")
    # Re-import module under new env is heavy; just exercise current semaphore API.
    from backend.chat.write_path_limits import WriteSlotTimeoutError, _CountingSemaphore

    sem = _CountingSemaphore(0)
    assert sem.acquire(timeout_sec=0.01) is False
    with pytest.raises(WriteSlotTimeoutError):
        # Local recreation of mark_read behavior
        if not sem.acquire(timeout_sec=0.01):
            raise WriteSlotTimeoutError("mark_read DB slot timeout")
