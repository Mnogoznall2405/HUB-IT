from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

from scan_server.database import ScanStore


def _load_benchmark_module():
    path = Path(__file__).parents[1] / "scripts" / "benchmark_scan_storage.py"
    spec = importlib.util.spec_from_file_location("benchmark_scan_storage", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_scan_storage_benchmark_is_read_only_and_reports_core_tables(tmp_path):
    db_path = tmp_path / "scan.db"
    ScanStore(db_path=db_path, archive_dir=tmp_path / "archive", task_ack_timeout_sec=300)
    report = _load_benchmark_module().benchmark_sqlite(db_path, repeats=2)

    with sqlite3.connect(db_path) as conn:
        job_indexes = {row[1] for row in conn.execute("PRAGMA index_list('scan_jobs')").fetchall()}

    assert report["backend"] == "sqlite"
    assert report["table_counts"]["scan_jobs"] == 0
    assert report["read_latency"]["job_status_totals"]["runs"] == 2
    assert report["postgres_readiness"]["priority"] == "low"
    assert {"idx_scan_jobs_created_at", "idx_scan_jobs_finished_at"}.issubset(job_indexes)
