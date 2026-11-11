from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, Optional


def scrub_scan_job_pdf_payloads(
    *,
    db_path: Path,
    batch_size: int = 200,
    vacuum: bool = False,
    database_url: Optional[str] = None,
) -> Dict[str, int]:
    """Remove embedded pdf_slice_b64 blobs from job payloads (SQLite or PostgreSQL)."""
    # Explicit database_url="" forces SQLite even when SCAN_DATABASE_URL is set.
    if database_url is not None:
        url = str(database_url or "").strip()
    else:
        url = str(os.getenv("SCAN_DATABASE_URL", "") or "").strip()
    if url:
        return _scrub_postgres(database_url=url, batch_size=batch_size)
    return _scrub_sqlite(db_path=Path(db_path), batch_size=batch_size, vacuum=vacuum)


def _scrub_sqlite(*, db_path: Path, batch_size: int, vacuum: bool) -> Dict[str, int]:
    normalized_path = Path(db_path)
    if not normalized_path.exists():
        raise FileNotFoundError(f"Database not found: {normalized_path}")

    updated_rows = 0
    scanned_rows = 0
    with sqlite3.connect(normalized_path, timeout=30) as conn:
        conn.row_factory = sqlite3.Row
        while True:
            rows = conn.execute(
                """
                SELECT id, payload_json
                FROM scan_jobs
                WHERE instr(payload_json, 'pdf_slice_b64') > 0
                ORDER BY created_at ASC, id ASC
                LIMIT ?
                """,
                (max(1, int(batch_size)),),
            ).fetchall()
            if not rows:
                break
            for row in rows:
                scanned_rows += 1
                if _scrub_one(conn, row):
                    updated_rows += 1
            conn.commit()

        if vacuum:
            conn.execute("VACUUM")

    return {
        "updated_rows": int(updated_rows),
        "scanned_rows": int(scanned_rows),
        "vacuum_ran": 1 if vacuum else 0,
    }


def _scrub_postgres(*, database_url: str, batch_size: int) -> Dict[str, int]:
    from scan_server.db import get_scan_engine
    from scan_server.pg_compat import PgConnection

    engine = get_scan_engine(database_url, application_name="itinvent-scan-maintenance")
    updated_rows = 0
    scanned_rows = 0
    with PgConnection(engine) as conn:
        while True:
            rows = conn.execute(
                """
                SELECT id, payload_json
                FROM scan_jobs
                WHERE position('pdf_slice_b64' in payload_json) > 0
                ORDER BY created_at ASC, id ASC
                LIMIT ?
                """,
                (max(1, int(batch_size)),),
            ).fetchall()
            if not rows:
                break
            for row in rows:
                scanned_rows += 1
                if _scrub_one(conn, row):
                    updated_rows += 1
            conn.commit()

    return {
        "updated_rows": int(updated_rows),
        "scanned_rows": int(scanned_rows),
        "vacuum_ran": 0,
    }


def _scrub_one(conn: Any, row: Any) -> bool:
    payload: Any = {}
    try:
        payload = json.loads(str(row["payload_json"] or "{}"))
    except Exception:
        payload = {}
    if not isinstance(payload, dict) or "pdf_slice_b64" not in payload:
        return False
    payload.pop("pdf_slice_b64", None)
    conn.execute(
        "UPDATE scan_jobs SET payload_json=? WHERE id=?",
        (json.dumps(payload, ensure_ascii=False), str(row["id"] or "")),
    )
    return True
