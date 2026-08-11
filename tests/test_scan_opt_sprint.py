"""Scan Center optimization sprint gates (S1/S2)."""

from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import scan_server.app as scan_app
from scan_server.database import ScanStore, _read_cache_clear


def _make_store(temp_dir):
    root = Path(temp_dir)
    return ScanStore(
        db_path=root / "scan-server.db",
        archive_dir=root / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=300,
    )


def test_job_status_counts_ttl_cache(temp_dir):
    store = _make_store(temp_dir)
    store._counts_cache_ttl_sec = 5.0
    first = store.job_status_counts()
    assert first["pending"] == 0
    store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "file_path": r"C:\a.txt",
            "file_name": "a.txt",
            "file_hash": "h1",
            "file_size": 1,
            "source_kind": "text",
            "event_id": "evt-cache-1",
        }
    )
    # Within TTL the hot-path counter may lag (intentional backpressure cache).
    cached = store.job_status_counts()
    assert cached["pending"] == first["pending"]
    store._job_status_counts_cache = None
    fresh = store.job_status_counts()
    assert fresh["pending"] == 1


def test_touch_agent_presence_is_light_and_throttled(temp_dir):
    store = _make_store(temp_dir)
    store._touch_throttle_sec = 30.0
    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-light",
            "hostname": "HOST-LIGHT",
            "branch": "Тюмень",
            "ip_address": "10.0.0.1",
            "version": "1.0.0",
            "status": "online",
            "metadata": {"keep": True, "outbox_depth": 3},
        }
    )
    before = store.list_agents()
    hb_before = None
    for item in before:
        if item.get("agent_id") == "agent-light":
            hb_before = item.get("last_heartbeat") or item.get("last_heartbeat_json")
            break

    first = store.touch_agent_presence(
        agent_id="agent-light",
        ip_address="10.0.0.2",
        metadata={"last_source": "ingest"},
    )
    assert first is not None
    assert first["last_seen_at"] > 0

    second = store.touch_agent_presence(
        agent_id="agent-light",
        ip_address="10.0.0.3",
        metadata={"last_source": "poll_tasks"},
    )
    assert second is None  # throttled

    with store._lock, store._connect() as conn:
        row = conn.execute(
            "SELECT ip_address, last_heartbeat_json FROM scan_agents WHERE agent_id=?",
            ("agent-light",),
        ).fetchone()
    assert str(row["ip_address"]) == "10.0.0.2"
    # Heartbeat JSON must not be rewritten by light touch.
    assert "keep" in str(row["last_heartbeat_json"] or "")


def test_reconcile_debounce_skips_hot_path(temp_dir):
    store = _make_store(temp_dir)
    store._reconcile_debounce_sec = 2.0
    store._reconcile_every_n_jobs = 50
    task = store.create_task(agent_id="agent-1", command="scan_now", payload={})
    tid = task["id"]
    store.report_task_result(
        agent_id="agent-1",
        task_id=tid,
        status="acknowledged",
        result={"phase": "local_scan"},
        error_text="",
    )

    with store._lock, store._connect() as conn:
        # First after ack is force=True from report; seed debounce clock.
        store._reconcile_scan_task_progress_locked(conn, tid, force=True)
        skipped = store._reconcile_scan_task_progress_locked(conn, tid, force=False)
        assert skipped is None
        forced = store._reconcile_scan_task_progress_locked(conn, tid, force=True)
        assert isinstance(forced, dict)


def test_list_incidents_summary_view_and_patterns_cap(temp_dir):
    store = _make_store(temp_dir)
    job = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "branch": "Тюмень",
            "file_path": r"C:\Docs\secret.pdf",
            "file_name": "secret.pdf",
            "file_hash": "hash-sum",
            "file_size": 10,
            "source_kind": "pdf",
            "event_id": "evt-sum-1",
        }
    )
    patterns = [
        {"pattern_id": f"p{i}", "pattern_name": f"P{i}", "value": f"v{i}", "snippet": f"s{i}"}
        for i in range(8)
    ]
    claimed = {**job, "id": job["job_id"]}
    with store._lock, store._connect() as conn:
        row = conn.execute("SELECT * FROM scan_jobs WHERE id=?", (job["job_id"],)).fetchone()
        claimed = dict(row)
    store.create_finding_and_incident(
        job=claimed,
        category="test",
        short_reason="reason",
        severity="high",
        matched_patterns=patterns,
        finalize_status="done_with_incident",
    )
    detail = store.list_incidents(hostname="HOST-01", limit=10, view="detail")
    summary = store.list_incidents(hostname="HOST-01", limit=10, view="summary")
    assert detail["view"] == "detail"
    assert summary["view"] == "summary"
    assert len(summary["items"][0]["matched_patterns"]) <= 3
    assert len(detail["items"][0]["matched_patterns"]) <= 8


def test_list_agents_table_sql_path_for_task_status_and_ascii_branch(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-tyum",
            "hostname": "TMN-PC-01",
            "branch": "Tyumen",
            "ip_address": "10.1.1.1",
            "version": "1.0.0",
            "status": "online",
        }
    )
    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-msk",
            "hostname": "MSK-PC-01",
            "branch": "Moscow",
            "ip_address": "10.2.2.2",
            "version": "1.0.0",
            "status": "online",
        }
    )
    store.create_task(agent_id="agent-tyum", command="scan_now", payload={})
    calls = {"python": 0}
    original = store._scan_agent_read_store._list_agents_table_python

    def _wrapped(**kwargs):
        calls["python"] += 1
        return original(**kwargs)

    monkeypatch.setattr(store._scan_agent_read_store, "_list_agents_table_python", _wrapped)
    by_branch = store.list_agents_table(branch="tyum", limit=10, offset=0)
    by_status = store.list_agents_table(task_status="active", limit=10, offset=0)
    assert by_branch["total"] == 1
    assert by_branch["items"][0]["agent_id"] == "agent-tyum"
    assert by_status["total"] >= 1
    assert calls["python"] == 0


def test_list_agents_table_cyrillic_still_matches_on_sqlite(temp_dir):
    store = _make_store(temp_dir)
    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-tyum",
            "hostname": "TMN-PC-01",
            "branch": "Тюмень",
            "status": "online",
        }
    )
    by_branch = store.list_agents_table(branch="тюм", limit=10, offset=0)
    assert by_branch["total"] == 1
    assert by_branch["items"][0]["agent_id"] == "agent-tyum"


def test_list_agents_activity_uses_slim_merge(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    store.upsert_agent_heartbeat(
        {
            "agent_id": "agent-act",
            "hostname": "HOST-ACT",
            "branch": "Тюмень",
            "status": "online",
        }
    )
    seen = {}

    original = store._scan_agent_read_store._merge_agent_runtime_rows

    def _wrapped(rows, *, conn, now_ts, slim=False):
        seen["slim"] = slim
        return original(rows, conn=conn, now_ts=now_ts, slim=slim)

    monkeypatch.setattr(store._scan_agent_read_store, "_merge_agent_runtime_rows", _wrapped)
    out = store.list_agents_activity(agent_ids=["agent-act"])
    assert seen.get("slim") is True
    assert out["items"][0]["agent_id"] == "agent-act"


def test_bulk_ack_by_filters_does_not_materialize_all_ids(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    for idx in range(3):
        job = store.queue_job(
            {
                "agent_id": "agent-1",
                "hostname": "HOST-01",
                "branch": "Тюмень",
                "file_path": rf"C:\Docs\f{idx}.txt",
                "file_name": f"f{idx}.txt",
                "file_hash": f"h{idx}",
                "file_size": 1,
                "source_kind": "text",
                "event_id": f"evt-bulk-{idx}",
            }
        )
        with store._lock, store._connect() as conn:
            row = dict(conn.execute("SELECT * FROM scan_jobs WHERE id=?", (job["job_id"],)).fetchone())
        store.create_finding_and_incident(
            job=row,
            category="test",
            short_reason="r",
            severity="low",
            matched_patterns=[{"pattern_id": "p", "value": "x"}],
            finalize_status="done_with_incident",
        )

    select_id_batches = {"count": 0}
    real_connect = store._connect

    class TrackingConn:
        def __init__(self, inner):
            self._inner = inner

        def __enter__(self):
            self._inner.__enter__()
            return self

        def __exit__(self, *args):
            return self._inner.__exit__(*args)

        def execute(self, sql, params=None):
            text = str(sql or "")
            # Standalone SELECT of ids (old path), not the UPDATE … IN (SELECT …) subquery.
            if text.lstrip().upper().startswith("SELECT") and "SELECT i.id" in text:
                select_id_batches["count"] += 1
            return self._inner.execute(sql, params)

        def commit(self):
            return self._inner.commit()

        def __getattr__(self, name):
            return getattr(self._inner, name)

    monkeypatch.setattr(store, "_connect", lambda: TrackingConn(real_connect()))
    result = store.bulk_ack_incidents(filters={"hostname": "HOST-01"}, ack_by="tester")
    assert result["success"] is True
    assert result["acked_count"] == 3
    assert select_id_batches["count"] == 0


def test_incidents_api_accepts_summary_view(monkeypatch):
    calls = []

    class FakeStore:
        def list_incidents(self, **kwargs):
            calls.append(kwargs)
            return {"total": 0, "items": [], "view": kwargs.get("view")}

    monkeypatch.setattr(scan_app, "store", FakeStore())
    for route in scan_app.app.routes:
        if getattr(route, "path", "") == "/api/v1/scan/incidents":
            for dependency in route.dependant.dependencies:
                scan_app.app.dependency_overrides[dependency.call] = lambda: {
                    "id": 1,
                    "role": "admin",
                    "permissions": ["scan.read"],
                }
            break
    client = TestClient(scan_app.app)
    try:
        resp = client.get("/api/v1/scan/incidents?view=summary&limit=10")
        assert resp.status_code == 200, resp.text
        assert calls[-1]["view"] == "summary"
        bad = client.get("/api/v1/scan/incidents?view=garbage")
        assert bad.status_code == 422
    finally:
        scan_app.app.dependency_overrides.clear()
        _read_cache_clear()


def test_store_lock_mode_fail_closed_default(temp_dir, monkeypatch):
    monkeypatch.setenv("SCAN_STORE_LOCK_MODE", "nonsense")
    store = _make_store(temp_dir)
    assert store._lock_kind == "rlock"
    monkeypatch.setenv("SCAN_STORE_LOCK_MODE", "null")
    store_null = _make_store(temp_dir)
    assert store_null._lock_kind == "null"


def test_is_unique_violation_sqlite_and_pg_shapes():
    from scan_server.database import _is_unique_violation
    import sqlite3

    assert _is_unique_violation(sqlite3.IntegrityError("UNIQUE")) is True

    class FakePgUnique(Exception):
        pgcode = "23505"

    assert _is_unique_violation(FakePgUnique()) is True

    class Wrapped(Exception):
        pass

    wrapped = Wrapped("x")
    wrapped.__cause__ = FakePgUnique()
    assert _is_unique_violation(wrapped) is True
    assert _is_unique_violation(ValueError("nope")) is False


def test_queue_job_dedupes_same_event_id(temp_dir):
    store = _make_store(temp_dir)
    event_id = "evt-s3-dedupe-1"
    first = store.queue_job(
        {
            "agent_id": "a1",
            "hostname": "h1",
            "file_path": "C:\\x\\a.pdf",
            "file_name": "a.pdf",
            "event_id": event_id,
            "source_kind": "document",
        }
    )
    second = store.queue_job(
        {
            "agent_id": "a1",
            "hostname": "h1",
            "file_path": "C:\\x\\a.pdf",
            "file_name": "a.pdf",
            "event_id": event_id,
            "source_kind": "document",
        }
    )
    assert first["deduped"] is False
    assert second["deduped"] is True
    assert second["job_id"] == first["job_id"]


def test_queue_job_concurrent_same_event_id_under_null_lock(temp_dir, monkeypatch):
    """Race path: NullLock + unique event_id → one job via IntegrityError fallback."""
    import threading

    monkeypatch.setenv("SCAN_STORE_LOCK_MODE", "null")
    store = _make_store(temp_dir)
    assert store._lock_kind == "null"
    event_id = "evt-s3-race-null"
    payload = {
        "agent_id": "a-race",
        "hostname": "H-RACE",
        "file_path": "C:\\x\\race.pdf",
        "file_name": "race.pdf",
        "event_id": event_id,
        "source_kind": "document",
    }
    results = []
    errors = []
    barrier = threading.Barrier(8)

    def worker():
        try:
            barrier.wait(timeout=5)
            results.append(store.queue_job(dict(payload)))
        except Exception as exc:  # noqa: BLE001
            errors.append(repr(exc))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert not errors, errors
    assert len(results) == 8
    job_ids = {str(r.get("job_id") or "") for r in results}
    assert len(job_ids) == 1
    with store._lock, store._connect() as conn:
        total = conn.execute(
            "SELECT COUNT(*) AS c FROM scan_jobs WHERE event_id=?",
            (event_id,),
        ).fetchone()["c"]
    assert int(total) == 1
