from __future__ import annotations

import time

import scan_agent.agent as scan_agent_module
from scan_agent.agent import ScanAgent


def _make_agent(monkeypatch, tmp_path):
    pending = tmp_path / "outbox" / "pending"
    dead = tmp_path / "outbox" / "dead"
    pending.mkdir(parents=True)
    dead.mkdir(parents=True)
    monkeypatch.setattr(scan_agent_module, "OUTBOX_PENDING_PATH", pending)
    monkeypatch.setattr(scan_agent_module, "OUTBOX_DEAD_PATH", dead)

    agent = object.__new__(ScanAgent)
    agent.config = {
        "outbox_max_items": 100,
        "outbox_max_age_days": 30,
        "outbox_max_total_mb": 64,
    }
    agent._last_error = ""
    return agent


def test_outbox_enqueue_can_delay_retry_after(monkeypatch, tmp_path):
    agent = _make_agent(monkeypatch, tmp_path)
    now_ts = int(time.time())

    path = agent._outbox_enqueue({"event_id": "event-1", "file_path": "a.pdf"}, retry_after_sec=45)

    assert path is not None
    item = agent._outbox_read(path)
    assert item is not None
    assert int(item["next_attempt_at"]) >= now_ts + 45


def test_outbox_drain_respects_retry_after(monkeypatch, tmp_path):
    agent = _make_agent(monkeypatch, tmp_path)
    path = agent._outbox_enqueue({"event_id": "event-1", "file_path": "a.pdf"})
    assert path is not None
    monkeypatch.setattr(agent, "_send_ingest", lambda payload: {"success": False, "deduped": False, "retry_after": 90})
    monkeypatch.setattr(agent, "_outbox_backoff_seconds", lambda attempts: 5)
    before = int(time.time())

    assert agent._drain_outbox(max_items=1) == 0

    item = agent._outbox_read(path)
    assert item is not None
    assert int(item["attempts"]) == 1
    assert int(item["next_attempt_at"]) >= before + 90
