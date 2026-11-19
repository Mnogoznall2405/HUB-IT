"""Scan agent poll/heartbeat load: empty polls and unchanged heartbeats must not hit the write path.

Why a store-level spy and not only HTTP: a wasteful write returns the same response as a skipped one,
so the HTTP boundary alone cannot show the regression (one write transaction per poll per agent
under a process-wide lock was the cause of Scan request pile-ups on a slow disk).
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

import scan_server.app as scan_app
import scan_server.database as scan_database
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


@pytest.fixture
def agent_write_count(api):
    store, _client, _headers, _writes = api
    with store._connect() as conn:
        conn.executescript(
            """
            CREATE TABLE agent_write_audit (kind TEXT NOT NULL);
            CREATE TRIGGER audit_agent_insert AFTER INSERT ON scan_agents
            BEGIN INSERT INTO agent_write_audit VALUES ('insert'); END;
            CREATE TRIGGER audit_agent_update AFTER UPDATE ON scan_agents
            BEGIN INSERT INTO agent_write_audit VALUES ('update'); END;
            """
        )
        conn.commit()

    def count():
        with store._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM agent_write_audit").fetchone()[0]

    return count


def _other_worker(store, *, online_timeout=1800):
    return ScanStore(
        db_path=store.db_path,
        archive_dir=store.archive_dir,
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=online_timeout,
        resolve_agent_sql_context=False,
        job_processing_timeout_sec=1800,
    )


def test_live_resource_samples_do_not_rewrite_heartbeat_until_due(api, agent_write_count, monkeypatch):
    store, client, headers, _writes = api
    now = [2_000_000_000]
    monkeypatch.setattr(scan_database, "_now_ts", lambda: now[0])
    for i in range(6):
        _heartbeat(
            client,
            headers,
            last_seen_at=now[0],
            ip_address=f"10.0.0.1:{5000 + i}",
            metadata={
                "outbox_depth": 0,
                "agent_cpu_percent": i * 0.5,
                "agent_rss_mb": 100 + i,
                "system_drive_free_gb": 40 - i / 100,
                "outbox_oldest_age_sec": i,
                "server_queue_pending": i,
                "low_disk": False,
            },
        )
    assert agent_write_count() == 1

    now[0] += 121
    store._heartbeat_last_write.clear()  # A restart must not extend the persisted sampling window.
    _heartbeat(
        client,
        headers,
        last_seen_at=now[0],
        ip_address="10.0.0.1:6000",
        metadata={
            "outbox_depth": 0,
            "agent_cpu_percent": 9,
            "agent_rss_mb": 120,
            "system_drive_free_gb": 39,
            "outbox_oldest_age_sec": 121,
            "server_queue_pending": 0,
            "low_disk": False,
        },
    )
    assert agent_write_count() == 2
    with store._connect() as conn:
        row = conn.execute("SELECT last_heartbeat_json FROM scan_agents WHERE agent_id='agent-1'").fetchone()
    assert json.loads(row[0])["metadata"]["agent_cpu_percent"] == 9


@pytest.mark.parametrize(
    "change",
    [
        {"outbox_depth": 7},
        {"dead_letter_depth": 1},
        {"outbox_stale": True},
        {"low_disk": True},
        {"last_error": "upload interrupted"},
        {"pending_update": {"expected_version": "1.4.25", "msi_exit_code": 0}},
        {"mac_address": "02:00:00:00:00:01"},
        {"new_agent_capability": True},
    ],
)
def test_resource_sampling_never_hides_important_agent_changes(api, agent_write_count, change):
    store, client, headers, _writes = api
    _heartbeat(client, headers, metadata={"outbox_depth": 0, "agent_cpu_percent": 1})
    metadata = {"outbox_depth": 0, "agent_cpu_percent": 2, **change}
    _heartbeat(client, headers, metadata=metadata)
    assert agent_write_count() == 2
    with store._connect() as conn:
        row = conn.execute("SELECT last_heartbeat_json FROM scan_agents WHERE agent_id='agent-1'").fetchone()
    persisted = json.loads(row[0])["metadata"]
    assert all(persisted[key] == value for key, value in change.items())


def test_two_workers_share_the_persisted_heartbeat_and_presence_window(api, agent_write_count, monkeypatch):
    store, client, headers, _writes = api
    now = [2_000_000_000]
    monkeypatch.setattr(scan_database, "_now_ts", lambda: now[0])
    _heartbeat(client, headers, last_seen_at=now[0], ip_address="10.0.0.1", metadata={"agent_cpu_percent": 1})

    other = _other_worker(store)
    monkeypatch.setattr(scan_app, "store", other)
    _heartbeat(client, headers, last_seen_at=now[0], ip_address="10.0.0.1", metadata={"agent_cpu_percent": 2})
    assert agent_write_count() == 1
    assert other.touch_agent_presence(agent_id="agent-1", ip_address="10.0.0.1") is None
    assert agent_write_count() == 1

    now[0] += 31
    other._touch_last_mono["agent-1"] -= 31
    assert other.touch_agent_presence(agent_id="agent-1", ip_address="10.0.0.1") is not None
    assert agent_write_count() == 2
    # Light presence must not postpone the full resource sample indefinitely.
    now[0] += 90
    other._heartbeat_last_write.clear()
    _heartbeat(client, headers, last_seen_at=now[0], ip_address="10.0.0.1", metadata={"agent_cpu_percent": 3})
    assert agent_write_count() == 3
    assert store.touch_agent_presence(agent_id="agent-1", ip_address="10.0.0.1") is None
    assert agent_write_count() == 3


def test_concurrent_workers_persist_one_due_resource_sample(api, agent_write_count, monkeypatch):
    store, _client, _headers, _writes = api
    now = [2_000_000_000]
    monkeypatch.setattr(scan_database, "_now_ts", lambda: now[0])
    payload = {"agent_id": "agent-1", "last_seen_at": now[0], "metadata": {"agent_cpu_percent": 0}}
    store.upsert_agent_heartbeat(payload)
    other = _other_worker(store)
    now[0] += 121
    store._heartbeat_last_write.clear()
    barrier = Barrier(2)
    for worker in (store, other):
        original = worker._run_write_transaction
        first = [True]

        def synchronized(context, operation, original=original, first=first):
            if context == "upsert_agent_heartbeat" and first[0]:
                first[0] = False
                barrier.wait(timeout=10)
            return original(context, operation)

        monkeypatch.setattr(worker, "_run_write_transaction", synchronized)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(
                worker.upsert_agent_heartbeat,
                {**payload, "last_seen_at": now[0], "metadata": {"agent_cpu_percent": i + 1}},
            )
            for i, worker in enumerate((store, other))
        ]
        for future in futures:
            assert future.result(timeout=15)["agent_id"] == "agent-1"
    assert agent_write_count() == 2


def test_failed_presence_write_does_not_suppress_the_retry(api, agent_write_count, monkeypatch):
    store, _client, _headers, _writes = api
    original = store._run_write_transaction

    def fail(context, operation):
        raise RuntimeError("isolated write failure")

    monkeypatch.setattr(store, "_run_write_transaction", fail)
    with pytest.raises(RuntimeError, match="isolated write failure"):
        store.touch_agent_presence(agent_id="agent-retry", ip_address="10.0.0.2")
    monkeypatch.setattr(store, "_run_write_transaction", original)
    assert store.touch_agent_presence(agent_id="agent-retry", ip_address="10.0.0.2") is not None
    assert agent_write_count() == 1


def test_resource_sample_cannot_overwrite_a_concurrent_queue_change(api, agent_write_count, monkeypatch):
    store, _client, _headers, _writes = api
    now = [2_000_000_000]
    monkeypatch.setattr(scan_database, "_now_ts", lambda: now[0])
    payload = {"agent_id": "agent-1", "last_seen_at": now[0], "metadata": {"outbox_depth": 0, "agent_cpu_percent": 1}}
    store.upsert_agent_heartbeat(payload)
    other = _other_worker(store)
    now[0] += 121
    store._heartbeat_last_write.clear()
    original = store._run_write_transaction
    competing = [True]

    def update_queue_first(context, operation):
        if context == "upsert_agent_heartbeat" and competing[0]:
            competing[0] = False
            other.upsert_agent_heartbeat(
                {**payload, "last_seen_at": now[0], "metadata": {"outbox_depth": 7, "agent_cpu_percent": 3}}
            )
        return original(context, operation)

    monkeypatch.setattr(store, "_run_write_transaction", update_queue_first)
    store.upsert_agent_heartbeat({**payload, "last_seen_at": now[0], "metadata": {"outbox_depth": 0, "agent_cpu_percent": 2}})
    with store._connect() as conn:
        row = conn.execute("SELECT outbox_depth FROM scan_agents WHERE agent_id='agent-1'").fetchone()
    assert row[0] == 7
    assert agent_write_count() == 2


def test_light_presence_cannot_overwrite_a_concurrent_heartbeat(api, agent_write_count, monkeypatch):
    store, _client, _headers, _writes = api
    now = [2_000_000_000]
    monkeypatch.setattr(scan_database, "_now_ts", lambda: now[0])
    payload = {"agent_id": "agent-1", "hostname": "HOST-OLD", "ip_address": "10.0.0.1", "last_seen_at": now[0]}
    store.upsert_agent_heartbeat(payload)
    other = _other_worker(store)
    now[0] += 31
    original = store._run_write_transaction

    def heartbeat_first(context, operation):
        if context == "touch_agent_presence":
            other.upsert_agent_heartbeat(
                {**payload, "hostname": "HOST-NEW", "ip_address": "10.0.0.2", "last_seen_at": now[0], "version": "1.4.25"}
            )
        return original(context, operation)

    monkeypatch.setattr(store, "_run_write_transaction", heartbeat_first)
    store.touch_agent_presence(agent_id="agent-1", hostname="HOST-OLD", ip_address="10.0.0.1")
    with store._connect() as conn:
        row = conn.execute("SELECT hostname, ip_address, version FROM scan_agents WHERE agent_id='agent-1'").fetchone()
    assert tuple(row) == ("HOST-NEW", "10.0.0.2", "1.4.25")
    assert agent_write_count() == 2


def test_heartbeat_sampling_does_not_mark_a_live_agent_offline(api, agent_write_count, monkeypatch):
    store, client, headers, _writes = api
    worker = _other_worker(store, online_timeout=30)
    monkeypatch.setattr(scan_app, "store", worker)
    now = [2_000_000_000]
    monkeypatch.setattr(scan_database, "_now_ts", lambda: now[0])
    _heartbeat(client, headers, last_seen_at=now[0], metadata={"agent_cpu_percent": 1})
    now[0] += 40
    worker._heartbeat_last_write.clear()
    _heartbeat(client, headers, last_seen_at=now[0], metadata={"agent_cpu_percent": 2})
    assert agent_write_count() == 2
    result = worker.list_agents_table(online="online", limit=10, offset=0)
    assert [item["agent_id"] for item in result["items"]] == ["agent-1"]
