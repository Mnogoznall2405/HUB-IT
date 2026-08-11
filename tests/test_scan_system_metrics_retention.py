"""Unit tests for scan system metrics 24h retention and 30s sampling."""
from __future__ import annotations

import importlib
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

retention = importlib.import_module("scan_server.system_metrics_retention")
metrics_mod = importlib.import_module("scan_server.system_metrics")


@pytest.fixture()
def clean_env(monkeypatch):
    keys = [
        "SCAN_SYSTEM_METRICS_RETENTION_ENABLED",
        "SCAN_SYSTEM_METRICS_RETENTION_DRY_RUN",
        "SCAN_SYSTEM_METRICS_RETENTION_HOURS",
        "SCAN_SYSTEM_METRICS_RETENTION_DAYS",
        "SCAN_SYSTEM_METRICS_RETENTION_BATCH_SIZE",
        "SCAN_SYSTEM_METRICS_RETENTION_PAUSE_MS",
        "SCAN_SYSTEM_METRICS_RETENTION_MAX_BATCHES",
        "SCAN_SYSTEM_METRICS_RETENTION_MAX_RUNTIME_SECONDS",
        "SCAN_SYSTEM_METRICS_RETENTION_INTERVAL_SECONDS",
        "SCAN_SYSTEM_METRICS_RETENTION_LOCK_TIMEOUT_MS",
        "SCAN_SYSTEM_METRICS_RETENTION_STATEMENT_TIMEOUT_MS",
        "SCAN_SYSTEM_METRICS_RETENTION_ERROR_BUDGET",
        "SCAN_SYSTEM_METRICS_RETENTION_STARTUP_DELAY_SECONDS",
        "SCAN_SYSTEM_METRICS_SAMPLE_INTERVAL_SECONDS",
    ]
    for k in keys:
        monkeypatch.delenv(k, raising=False)
    yield


# --- Sampling (items 1-4) ---


def test_sample_interval_default_30(clean_env):
    assert metrics_mod.resolve_system_metrics_sample_interval_sec() == 30.0


def test_sample_interval_bounds(clean_env, monkeypatch):
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_SAMPLE_INTERVAL_SECONDS", "10")
    assert metrics_mod.resolve_system_metrics_sample_interval_sec() == 10.0
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_SAMPLE_INTERVAL_SECONDS", "300")
    assert metrics_mod.resolve_system_metrics_sample_interval_sec() == 300.0
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_SAMPLE_INTERVAL_SECONDS", "9")
    assert metrics_mod.resolve_system_metrics_sample_interval_sec() == 30.0
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_SAMPLE_INTERVAL_SECONDS", "301")
    assert metrics_mod.resolve_system_metrics_sample_interval_sec() == 30.0
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_SAMPLE_INTERVAL_SECONDS", "abc")
    assert metrics_mod.resolve_system_metrics_sample_interval_sec() == 30.0


def test_sampler_heartbeat_independent_and_error_isolation(clean_env):
    """Sampler persist failures must not raise to caller / heartbeat path."""
    calls = {"n": 0, "errors": 0}

    class BoomStore:
        def active_scan_task_ids(self):
            return ["t1"]

        def record_system_metric_samples(self, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                calls["errors"] += 1
                raise RuntimeError("persist_failed")

    stop = threading.Event()
    sampler = metrics_mod.SystemMetricsSampler(
        store=BoomStore(), stop_event=stop, interval_sec=10.0
    )
    # Inject fake collector
    class FakeCollector:
        available = True

        def collect(self, **kwargs):
            return {"captured_at": 1, "cpu_percent": 1.0}

    sampler.collector = FakeCollector()
    sampler.start()
    time.sleep(0.05)
    stop.set()
    sampler.join(timeout=2)
    assert calls["errors"] == 1
    assert not sampler.is_alive()


def test_sampler_no_parallel_writes(clean_env):
    inflight = {"n": 0, "max": 0}
    barrier = threading.Event()

    class SlowStore:
        def active_scan_task_ids(self):
            return ["t1"]

        def record_system_metric_samples(self, **kwargs):
            inflight["n"] += 1
            inflight["max"] = max(inflight["max"], inflight["n"])
            barrier.wait(timeout=0.5)
            inflight["n"] -= 1

    stop = threading.Event()
    sampler = metrics_mod.SystemMetricsSampler(
        store=SlowStore(), stop_event=stop, interval_sec=10.0
    )

    class FakeCollector:
        available = True

        def collect(self, **kwargs):
            return {"captured_at": 1}

    sampler.collector = FakeCollector()
    sampler.start()
    time.sleep(0.05)
    # Try to force a second sample while first is held — lock should skip.
    acquired = sampler._sample_lock.acquire(blocking=False)
    assert acquired is False
    barrier.set()
    stop.set()
    sampler.join(timeout=2)
    assert inflight["max"] <= 1


# --- Retention config / policy (items 5-15) ---


def test_defaults_fail_closed_hours_24(clean_env):
    cfg = retention.SystemMetricsRetentionConfig.from_env()
    assert cfg.enabled is False
    assert cfg.dry_run is True
    assert cfg.retention_hours == 24
    assert cfg.hours_wins_over_days is True
    assert cfg.cutoff_epoch(now_ts=1_700_000_000) == 1_700_000_000 - 24 * 3600


def test_hours_wins_over_days(clean_env, monkeypatch, caplog):
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_HOURS", "24")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_DAYS", "3")
    with caplog.at_level("WARNING"):
        cfg = retention.SystemMetricsRetentionConfig.from_env()
    assert cfg.retention_hours == 24
    assert cfg.hours_wins_over_days is True
    assert cfg.cutoff_epoch(now_ts=1_700_000_000) == 1_700_000_000 - 86400
    assert "HOURS wins" in caplog.text


def test_days_only_when_hours_unset(clean_env, monkeypatch):
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_DAYS", "3")
    cfg = retention.SystemMetricsRetentionConfig.from_env()
    assert cfg.retention_hours is None
    assert cfg.hours_wins_over_days is False
    assert cfg.cutoff_epoch(now_ts=1_700_000_000) == 1_700_000_000 - 3 * 86400


def test_invalid_batch_fail_closed(clean_env, monkeypatch):
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_BATCH_SIZE", "0")
    with pytest.raises(retention.SystemMetricsRetentionConfigError):
        retention.SystemMetricsRetentionConfig.from_env()


def test_eligible_where_no_join_tasks():
    sql = retention.SystemMetricsRetentionService._eligible_where_sql()
    assert "completed_at" not in sql
    assert "scan_tasks" not in sql
    assert "captured_at < %(cutoff)s" in sql
    assert "1000000000" in sql
    assert "4102444800" in sql


def test_disabled_without_force(clean_env, monkeypatch):
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_ENABLED", "false")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_DRY_RUN", "false")
    svc = retention.SystemMetricsRetentionService()
    res = svc.run_once(dry_run=False, acquire_lock=False, force_enabled=False)
    assert res["stop_reason"] == "disabled"
    assert res["rows_deleted"] == 0


def test_advisory_lock_key_stable():
    a = retention.SystemMetricsRetentionService.advisory_lock_key()
    b = retention.SystemMetricsRetentionService.advisory_lock_key()
    assert a == b
    assert a > 0


def test_dry_run_no_mutate(monkeypatch, clean_env):
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_ENABLED", "true")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_DRY_RUN", "true")
    svc = retention.SystemMetricsRetentionService()
    deleted = {"n": 0}

    def fake_report(config=None):
        return {
            "mode": "dry_run",
            "database": "hubit_chat",
            "cutoff_epoch": 1,
            "total_rows": 10,
            "eligible_rows_exact": 4,
            "elapsed_ms": 1.0,
        }

    monkeypatch.setattr(svc, "dry_run_report", fake_report)
    monkeypatch.setattr(
        svc,
        "_delete_one_batch",
        lambda **kwargs: deleted.__setitem__("n", deleted["n"] + 1) or (0, 0.0),
    )
    res = svc.run_once(dry_run=True, acquire_lock=False, force_enabled=True)
    assert res["stop_reason"] == "dry_run_complete"
    assert deleted["n"] == 0
    assert res["rows_deleted"] == 0


def test_batch_limit_and_unlock(monkeypatch, clean_env):
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_ENABLED", "true")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_DRY_RUN", "false")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_PAUSE_MS", "0")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_MAX_BATCHES", "3")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_BATCH_SIZE", "10")
    svc = retention.SystemMetricsRetentionService()
    state = {"n": 0, "unlocked": False, "commits": 0, "sqls": []}

    class FakeCur:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, sql, params=None):
            self.sql = str(sql)
            state["sqls"].append(self.sql)
            if "pg_try_advisory_lock" in self.sql:
                self._mode = "lock"
            elif "pg_advisory_unlock" in self.sql:
                state["unlocked"] = True
                self._mode = "unlock"
            elif "pg_locks" in self.sql:
                self._mode = "locks"
            elif "DELETE FROM scan.scan_task_system_metrics" in self.sql:
                self._mode = "delete"
                assert "scan_tasks" not in self.sql
                assert "completed_at" not in self.sql
            else:
                self._mode = "other"

        def fetchone(self):
            if getattr(self, "_mode", "") == "lock":
                return (True,)
            if getattr(self, "_mode", "") == "locks":
                return (0,)
            return (True,)

        def fetchall(self):
            if getattr(self, "_mode", "") == "delete":
                state["n"] += 1
                if state["n"] <= 2:
                    return [("t1",)] * 10
                return []
            return []

    class FakeConn:
        autocommit = False

        def cursor(self):
            return FakeCur()

        def commit(self):
            state["commits"] += 1

        def close(self):
            return None

        def rollback(self):
            return None

    monkeypatch.setattr(svc, "_connect", lambda: FakeConn())
    monkeypatch.setattr(svc, "_disk_free_gb", lambda: 50.0)
    res = svc.run_once(dry_run=False, acquire_lock=True, force_enabled=True)
    assert res["rows_deleted"] == 20
    assert res["batches"] == 2
    assert state["unlocked"] is True
    assert res["stop_reason"] == "no_rows"


def test_lock_skipped(monkeypatch, clean_env):
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_ENABLED", "true")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_DRY_RUN", "false")
    svc = retention.SystemMetricsRetentionService()

    class FakeCur:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, sql, params=None):
            self.sql = str(sql)

        def fetchone(self):
            return (False,)

        def fetchall(self):
            return []

    class FakeConn:
        autocommit = False

        def cursor(self):
            return FakeCur()

        def commit(self):
            return None

        def close(self):
            return None

    monkeypatch.setattr(svc, "_connect", lambda: FakeConn())
    res = svc.run_once(dry_run=False, acquire_lock=True, force_enabled=True)
    assert res["stop_reason"] == "lock_skipped"


def test_stop_on_waiting_locks(monkeypatch, clean_env):
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_ENABLED", "true")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_DRY_RUN", "false")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_PAUSE_MS", "0")
    svc = retention.SystemMetricsRetentionService()

    class FakeCur:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, sql, params=None):
            self.sql = str(sql)
            if "pg_try_advisory_lock" in self.sql:
                self._mode = "lock"
            elif "pg_locks" in self.sql:
                self._mode = "locks"
            else:
                self._mode = "other"

        def fetchone(self):
            if getattr(self, "_mode", "") == "lock":
                return (True,)
            if getattr(self, "_mode", "") == "locks":
                return (2,)  # waiting locks
            return (True,)

        def fetchall(self):
            return []

    class FakeConn:
        autocommit = False

        def cursor(self):
            return FakeCur()

        def commit(self):
            return None

        def close(self):
            return None

        def rollback(self):
            return None

    monkeypatch.setattr(svc, "_connect", lambda: FakeConn())
    monkeypatch.setattr(svc, "_disk_free_gb", lambda: 50.0)
    res = svc.run_once(dry_run=False, acquire_lock=True, force_enabled=True)
    assert res["stop_reason"] == "waiting_locks"
    assert res["rows_deleted"] == 0


def test_retention_keeps_invalid_and_future_timestamps_in_where():
    """Bounds keep invalid (<1e9) and far-future (>=4102444800) out of DELETE."""
    sql = retention.SystemMetricsRetentionService._eligible_where_sql()
    assert ">= 1000000000" in sql.replace(" ", "") or ">= 1_000_000_000" in sql or "1000000000" in sql
    assert "4102444800" in sql


def test_no_touch_other_tables_in_delete_sql(monkeypatch, clean_env):
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_ENABLED", "true")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_DRY_RUN", "false")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_PAUSE_MS", "0")
    monkeypatch.setenv("SCAN_SYSTEM_METRICS_RETENTION_MAX_BATCHES", "1")
    svc = retention.SystemMetricsRetentionService()
    sqls = []

    class FakeCur:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def execute(self, sql, params=None):
            self.sql = str(sql)
            sqls.append(self.sql)
            if "pg_try_advisory_lock" in self.sql:
                self._mode = "lock"
            elif "pg_locks" in self.sql:
                self._mode = "locks"
            elif "DELETE FROM" in self.sql:
                self._mode = "delete"
            else:
                self._mode = "other"

        def fetchone(self):
            if getattr(self, "_mode", "") == "lock":
                return (True,)
            if getattr(self, "_mode", "") == "locks":
                return (0,)
            return (True,)

        def fetchall(self):
            if getattr(self, "_mode", "") == "delete":
                return []
            return []

    class FakeConn:
        autocommit = False

        def cursor(self):
            return FakeCur()

        def commit(self):
            return None

        def close(self):
            return None

        def rollback(self):
            return None

    monkeypatch.setattr(svc, "_connect", lambda: FakeConn())
    monkeypatch.setattr(svc, "_disk_free_gb", lambda: 50.0)
    svc.run_once(dry_run=False, acquire_lock=True, force_enabled=True)
    blob = "\n".join(sqls).lower()
    for forbidden in (
        "scan_incidents",
        "scan_findings",
        "scan_jobs",
        "scan_tasks",
        "scan_task_file_observations",
        "scan_artifacts",
    ):
        assert forbidden not in blob
