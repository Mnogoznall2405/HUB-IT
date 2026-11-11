"""Scan agent poll/heartbeat load: empty polls and unchanged heartbeats must not hit the write path.

Why a store-level spy and not only HTTP: a wasteful write returns the same response as a skipped one,
so the HTTP boundary alone cannot show the regression (one write transaction per poll per agent
under a process-wide lock was the cause of Scan request pile-ups on a slow disk).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import scan_server.app as scan_app
from scan_server.database import ScanStore


@pytest.fixture()
def api(tmp_path: Path, monkeypatch):
    store = ScanStore(
        db_path=tmp_path / "scan.db",
        archive_dir=tmp_path / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=1800,
        resolve_agent_sql_context=False,
        job_processing_timeout_sec=1800,
    )
    monkeypatch.setattr(scan_app, "store", store)
    writes: list[str] = []
    original = store._run_write_transaction

    def spy(context, operation):
        writes.append(context)
        return original(context, operation)

    monkeypatch.setattr(store, "_run_write_transaction", spy)
    client = TestClient(scan_app.app)
    headers = {"X-API-Key": scan_app.config.api_keys[0]}
    return store, client, headers, writes


def _poll(client, headers, agent_id="agent-1"):
    response = client.get("/api/v1/scan/tasks/poll", params={"agent_id": agent_id}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["tasks"]


def _heartbeat(client, headers, **overrides):
    payload = {
        "agent_id": "agent-1",
        "hostname": "HOST-01",
        "branch": "Tyumen",
        "version": "1.4.15",
        "status": "online",
        "metadata": {"outbox_depth": 0},
    }
    payload.update(overrides)
    response = client.post("/api/v1/scan/heartbeat", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_empty_poll_skips_write_transaction_but_queued_task_is_still_delivered(api):
    store, client, headers, writes = api

    assert _poll(client, headers) == []  # first call runs the maintenance sweep (write)
    writes.clear()
    assert _poll(client, headers) == []
    assert _poll(client, headers) == []
    assert "poll_tasks" not in writes

    created = store.create_task(agent_id="agent-1", command="ping", payload={}, dedupe_key="ping:agent-1")
    tasks = _poll(client, headers)
    assert [task["task_id"] for task in tasks] == [created["id"]]
    assert _poll(client, headers) == []  # delivered, waits for ack backoff


def test_stale_delivered_task_is_requeued_by_throttled_maintenance(api):
    store, client, headers, _writes = api
    created = store.create_task(agent_id="agent-1", command="ping", payload={}, dedupe_key="ping:agent-1")
    assert [task["task_id"] for task in _poll(client, headers)] == [created["id"]]

    with store._lock, store._connect() as conn:
        conn.execute("UPDATE scan_tasks SET delivered_at=1 WHERE id=?", (created["id"],))
        conn.commit()

    _poll(client, headers)  # inside the maintenance interval: no sweep yet
    with store._lock, store._connect() as conn:
        assert conn.execute("SELECT status FROM scan_tasks WHERE id=?", (created["id"],)).fetchone()["status"] == "delivered"

    store._maintain_last_mono = 0.0  # interval elapsed
    _poll(client, headers)
    with store._lock, store._connect() as conn:
        assert conn.execute("SELECT status FROM scan_tasks WHERE id=?", (created["id"],)).fetchone()["status"] == "queued"


def test_unchanged_heartbeat_is_written_once_per_window_but_changes_are_written_at_once(api):
    store, client, headers, writes = api

    _heartbeat(client, headers)
    _heartbeat(client, headers)
    _heartbeat(client, headers)
    assert writes.count("upsert_agent_heartbeat") == 1

    _heartbeat(client, headers, metadata={"outbox_depth": 7})
    assert writes.count("upsert_agent_heartbeat") == 2
    row = next(item for item in store.list_agents() if item.get("agent_id") == "agent-1")
    assert row["last_seen_at"] > 0

    store._heartbeat_write_min_sec = 0.0  # disabled -> every heartbeat is persisted
    _heartbeat(client, headers, metadata={"outbox_depth": 7})
    assert writes.count("upsert_agent_heartbeat") == 3
