from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Iterable

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scan_server.config import ScanServerConfig  # noqa: E402


REPRESENTATIVE_QUERIES = {
    "job_status_totals": """
        SELECT status, source_kind, COUNT(*) AS count
        FROM scan_jobs
        GROUP BY status, source_kind
    """,
    "new_incidents": "SELECT COUNT(*) AS count FROM scan_incidents WHERE status='new'",
    "recent_incomplete": """
        SELECT id, hostname, file_path, status, error_text, finished_at
        FROM scan_jobs
        WHERE status IN ('analysis_incomplete', 'failed')
        ORDER BY COALESCE(finished_at, created_at) DESC
        LIMIT 100
    """,
    "online_agents": "SELECT COUNT(*) AS count FROM scan_agents WHERE last_seen_at >= CAST(strftime('%s','now') AS INTEGER) - 1800",
    "performance_24h": """
        SELECT status, source_kind, created_at, started_at, finished_at, metrics_json
        FROM scan_jobs
        WHERE finished_at >= CAST(strftime('%s','now') AS INTEGER) - 86400
           OR created_at >= CAST(strftime('%s','now') AS INTEGER) - 86400
    """,
}


def _percentile(values: Iterable[float], fraction: float) -> float | None:
    rows = sorted(float(value) for value in values)
    if not rows:
        return None
    index = min(len(rows) - 1, max(0, round((len(rows) - 1) * fraction)))
    return round(rows[index], 3)


def _open_read_only(path: Path) -> sqlite3.Connection:
    uri = f"{path.resolve().as_uri()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    return conn


def _measure_query(conn: sqlite3.Connection, sql: str, repeats: int) -> dict[str, Any]:
    durations: list[float] = []
    row_count = 0
    for _ in range(max(1, repeats)):
        started = time.perf_counter()
        rows = conn.execute(sql).fetchall()
        durations.append((time.perf_counter() - started) * 1000.0)
        row_count = len(rows)
    return {
        "rows": row_count,
        "runs": len(durations),
        "min_ms": round(min(durations), 3),
        "median_ms": round(statistics.median(durations), 3),
        "p95_ms": _percentile(durations, 0.95),
        "max_ms": round(max(durations), 3),
    }


def benchmark_sqlite(path: Path, *, repeats: int = 5) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(path)

    wal_path = Path(f"{path}-wal")
    with _open_read_only(path) as conn:
        page_size = int(conn.execute("PRAGMA page_size").fetchone()[0] or 0)
        page_count = int(conn.execute("PRAGMA page_count").fetchone()[0] or 0)
        free_pages = int(conn.execute("PRAGMA freelist_count").fetchone()[0] or 0)
        table_names = [
            str(row[0])
            for row in conn.execute(
                "SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'scan_%' ORDER BY name"
            ).fetchall()
        ]
        counts = {
            name: int(conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] or 0)
            for name in table_names
        }

        # One warm-up removes connection/page-cache setup from the comparable runs.
        for sql in REPRESENTATIVE_QUERIES.values():
            conn.execute(sql).fetchall()
        timings = {
            name: _measure_query(conn, sql, repeats)
            for name, sql in REPRESENTATIVE_QUERIES.items()
        }

    size_bytes = path.stat().st_size
    used_bytes = max(0, (page_count - free_pages) * page_size)
    priority = "high" if size_bytes >= 4 * 1024**3 else "medium" if size_bytes >= 1024**3 else "low"
    return {
        "backend": "sqlite",
        "database_path": str(path.resolve()),
        "captured_at": int(time.time()),
        "database": {
            "size_bytes": size_bytes,
            "size_mb": round(size_bytes / 1024**2, 1),
            "wal_size_mb": round((wal_path.stat().st_size if wal_path.exists() else 0) / 1024**2, 1),
            "page_size": page_size,
            "page_count": page_count,
            "free_pages": free_pages,
            "estimated_used_mb": round(used_bytes / 1024**2, 1),
        },
        "table_counts": counts,
        "read_latency": timings,
        "postgres_readiness": {
            "priority": priority,
            "reason": "PostgreSQL improves concurrent queue/database work; it does not make Tesseract OCR faster or more accurate.",
            "safe_next_step": "Create an isolated scan schema, backfill it, compare this report before/after, then cut over after count and checksum verification.",
        },
    }


def main() -> int:
    config = ScanServerConfig.from_env()
    parser = argparse.ArgumentParser(description="Read-only benchmark for the Scan Center SQLite store.")
    parser.add_argument("--database", type=Path, default=config.db_path)
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--json-output", type=Path)
    args = parser.parse_args()

    report = benchmark_sqlite(args.database, repeats=max(1, min(50, args.repeats)))
    payload = json.dumps(report, ensure_ascii=False, indent=2)
    print(payload)
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(payload, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
