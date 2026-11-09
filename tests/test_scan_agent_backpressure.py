from __future__ import annotations

import json
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
    agent._outbox_metadata = {}
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


def test_failed_dead_letter_write_keeps_the_pending_document(monkeypatch, tmp_path):
    """DSCAN-01: a full disk while writing dead-letter must not delete the unsent document."""
    agent = _make_agent(monkeypatch, tmp_path)
    path = agent._outbox_enqueue({"event_id": "event-1", "file_path": "a.pdf"})
    assert path is not None
    original = path.read_bytes()
    item = agent._outbox_read(path)

    def disk_full(target, payload):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(agent, "_outbox_write", disk_full)
    assert agent._outbox_move_to_dead(path, item, "OUTBOX_MAX_AGE") is False
    assert path.read_bytes() == original

    monkeypatch.undo()
    monkeypatch.setattr(scan_agent_module, "OUTBOX_DEAD_PATH", tmp_path / "outbox" / "dead")
    assert agent._outbox_move_to_dead(path, item, "OUTBOX_MAX_AGE") is True
    assert not path.exists()
    assert len(list((tmp_path / "outbox" / "dead").glob("*.json"))) == 1


def test_prune_reuses_metadata_and_expires_by_original_creation_time(monkeypatch, tmp_path):
    agent = _make_agent(monkeypatch, tmp_path)
    now = int(time.time())
    expired = scan_agent_module.OUTBOX_PENDING_PATH / f"{now}_requeued.json"
    expired.write_text(
        json.dumps({"created_at": now - 31 * 86400, "payload": {"event_id": "requeued"}}),
        encoding="utf-8",
    )
    kept = agent._outbox_enqueue({"event_id": "recent", "document_b64": "a" * (1024 * 1024)})
    assert kept is not None
    agent._outbox_prune_limits()
    dead = scan_agent_module.OUTBOX_DEAD_PATH / expired.name
    assert json.loads(dead.read_text(encoding="utf-8"))["dropped_reason"] == "OUTBOX_MAX_AGE"
    assert not expired.exists()

    def unexpected_read(path):
        raise AssertionError(f"Prune reread unchanged attachment: {path.name}")

    monkeypatch.setattr(agent, "_read_outbox_item", unexpected_read)
    agent._outbox_prune_limits()
    assert kept.is_file()


def test_outbox_lookups_share_metadata_and_detect_rewritten_and_deleted_files(monkeypatch, tmp_path):
    agent = _make_agent(monkeypatch, tmp_path)
    path = scan_agent_module.OUTBOX_PENDING_PATH / "legacy.json"
    path.write_text(
        json.dumps({"payload": {"event_id": "legacy", "scan_task_id": "task-1", "document_b64": "a" * 1024}}),
        encoding="utf-8",
    )
    reads = []
    read_item = agent._read_outbox_item

    def count_read(path):
        reads.append(path)
        return read_item(path)

    monkeypatch.setattr(agent, "_read_outbox_item", count_read)
    assert agent._outbox_has_event("legacy")
    assert agent._outbox_paths_for_task("task-1") == [path]
    assert agent._outbox_paths_for_task("task-1", exclude=path) == []
    assert not agent._outbox_has_event("missing")
    agent._outbox_prune_limits()
    assert reads == [path]

    agent._outbox_write(path, {"event_id": "replacement", "payload": {"scan_task_id": "task-2"}})
    assert not agent._outbox_has_event("legacy")
    assert agent._outbox_has_event("replacement")
    assert agent._outbox_paths_for_task("task-2") == [path]
    assert reads == [path, path]

    path.unlink()
    assert not agent._outbox_has_event("replacement")
    assert agent._outbox_paths_for_task("task-2") == []
    assert reads == [path, path]
