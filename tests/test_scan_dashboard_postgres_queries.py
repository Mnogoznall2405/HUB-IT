from __future__ import annotations

import sqlite3

from scan_server import database as scan_database


def test_postgres_dashboard_aggregate_sql_preserves_counts():
    with sqlite3.connect(":memory:") as conn:
        conn.row_factory = sqlite3.Row
        conn.execute(
            "CREATE TABLE scan_jobs "
            "(status TEXT, source_kind TEXT, finished_at INTEGER, error_text TEXT)"
        )
        conn.executemany(
            "INSERT INTO scan_jobs VALUES (?, ?, ?, ?)",
            [
                ("done_clean", "text", 11, None),
                ("done_clean", "text", 9, None),
                ("done_with_incident", "pdf", 10, None),
                ("failed", "pdf", 12, "OCR timeout"),
                ("analysis_incomplete", "image", None, None),
                ("queued", "text", None, None),
                ("processing", "pdf", None, None),
            ],
        )
        rows, completed_24h, ocr_timeouts = scan_database._load_dashboard_job_aggregates(
            conn, is_postgres=True, performance_start=10,
        )
    counts = {(row["status"], row["source_kind"]): row["c"] for row in rows}
    assert counts[("done_clean", "text")] == 2
    assert sum(counts.values()) == 7
    assert completed_24h == 3
    assert ocr_timeouts == 1


def test_dashboard_recent_windows_do_not_scan_historical_jobs(tmp_path, monkeypatch):
    # A tiny HTTP fixture would not expose a historical scan. Exercise the real
    # dashboard SQL with enough history for the planner to distinguish indexes.
    now = 1_800_000_000
    monkeypatch.setattr(scan_database, "_now_ts", lambda: now)
    store = scan_database.ScanStore(
        db_path=tmp_path / "scan.db",
        archive_dir=tmp_path / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=300,
    )
    rows = [(f"old-{i}", "done_clean", 1, 1) for i in range(10_000)]
    rows.extend([
        ("recent-finish", "done_clean", now - 172800, now - 1),
        ("null-finish", "done_with_incident", now - 1, None),
        ("stale-finish", "failed", now - 1, now - 7200),
        ("zero-finish", "failed", now - 1, 0),
        ("boundary", "analysis_incomplete", now - 172800, now - 3600),
        ("queued", "queued", now - 1, now - 1),
        ("processing", "processing", now - 1, None),
        ("stale-null", "done_clean", now - 172800, None),
    ])
    with store._connect() as conn:
        conn.executemany(
            "INSERT INTO scan_jobs(id, status, created_at, finished_at) VALUES (?, ?, ?, ?)",
            rows,
        )
        conn.execute("ANALYZE")

    queries = []
    connect = store._connect

    def traced_connect():
        connection = connect()
        connection.set_trace_callback(queries.append)
        return connection

    monkeypatch.setattr(store, "_connect", traced_connect)
    result = store.dashboard()
    assert result["performance"]["completed_last_hour"] == 3

    hourly = next(
        sql for sql in queries
        if "SELECT COUNT(*) AS c" in sql
        and "FROM scan_jobs" in sql
        and str(now - 3600) in sql
    )
    sample = next(
        sql for sql in queries
        if "FROM scan_jobs" in sql and "metrics_json" in sql
    )
    with connect() as conn:
        for query in (hourly, sample):
            plan = [row["detail"] for row in conn.execute("EXPLAIN QUERY PLAN " + query)]
            assert not any(detail.startswith("SCAN scan_jobs") for detail in plan), plan
