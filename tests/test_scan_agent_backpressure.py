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
        "outbox_requeue_interval_sec": 1,
        "outbox_drain_batch": 50,
        "outbox_drain_batch_slow": 10,
        "outbox_drain_interval_sec": 10,
        "outbox_drain_interval_slow_sec": 120,
        "poll_interval": 60,
        "poll_interval_slow": 300,
        "server_queue_slow_threshold": 2000,
    }
    agent._last_error = ""
    agent._last_dead_requeue_at = 0
    agent._server_queue_pending = 0
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


def test_requeue_dead_letter_skips_corrupt_and_respects_batch(monkeypatch, tmp_path):
    agent = _make_agent(monkeypatch, tmp_path)
    agent._last_dead_requeue_at = 0
    agent.config["outbox_requeue_interval_sec"] = 1

    dead = scan_agent_module.OUTBOX_DEAD_PATH
    for idx, reason in enumerate(("OUTBOX_FULL_SIZE", "OUTBOX_CORRUPT", "OUTBOX_MAX_AGE")):
        path = dead / f"dead-{idx}.json"
        path.write_text(
            __import__("json").dumps(
                {
                    "id": f"id-{idx}",
                    "event_id": f"event-{idx}",
                    "created_at": int(time.time()),
                    "dropped_reason": reason,
                    "payload": {"event_id": f"event-{idx}", "file_path": f"{idx}.pdf"},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    moved = agent._requeue_dead_letter(max_items=10)
    assert moved == 2
    assert agent._outbox_depth() == 2
    assert agent._dead_letter_depth() == 1
    remaining = list(dead.glob("*.json"))
    assert len(remaining) == 1
    assert "OUTBOX_CORRUPT" in remaining[0].read_text(encoding="utf-8")

    # Interval gate: immediate second call should no-op.
    assert agent._requeue_dead_letter(max_items=10) == 0


def test_outbox_mode_switches_on_server_queue_threshold(tmp_path, monkeypatch):
    agent = _make_agent(monkeypatch, tmp_path)
    assert agent._outbox_mode() == "fast"
    assert agent._effective_drain_batch() == 50
    assert agent._effective_drain_interval() == 10
    assert agent._effective_poll_interval() == 60

    agent._note_server_queue_from_payload({"server_queue_pending": 2000})
    assert agent._server_queue_pending == 2000
    assert agent._outbox_mode() == "slow"
    assert agent._effective_drain_batch() == 10
    assert agent._effective_drain_interval() == 120
    assert agent._effective_poll_interval() == 300


def test_drain_early_stops_when_queue_enters_slow_mode(tmp_path, monkeypatch):
    agent = _make_agent(monkeypatch, tmp_path)
    for idx in range(20):
        assert agent._outbox_enqueue({"event_id": f"event-{idx}", "file_path": f"{idx}.txt"}) is not None

    calls = {"n": 0}

    def _send(_payload):
        calls["n"] += 1
        # After first success, report overloaded server queue so remaining drain shrinks.
        pending = 100 if calls["n"] == 1 else 2500
        agent._note_server_queue_from_payload({"server_queue_pending": pending})
        return {"success": True, "deduped": False}

    monkeypatch.setattr(agent, "_send_ingest", _send)
    sent = agent._drain_outbox()
    assert sent == 10
    assert calls["n"] == 10
    assert agent._outbox_mode() == "slow"


def test_note_server_queue_from_429_detail(tmp_path, monkeypatch):
    agent = _make_agent(monkeypatch, tmp_path)

    class _Resp:
        status_code = 429
        content = b'{"detail":{"total_pending":2105,"server_queue_pending":2105}}'
        text = content.decode("utf-8")
        headers = {"Retry-After": "30"}

        def json(self):
            return {"detail": {"total_pending": 2105, "server_queue_pending": 2105}}

    agent._note_server_queue_from_response(_Resp())
    assert agent._server_queue_pending == 2105
    assert agent._outbox_mode() == "slow"
