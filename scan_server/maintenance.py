from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict


def scrub_scan_job_pdf_payloads(*, db_path: Path, batch_size: int = 200, vacuum: bool = False) -> Dict[str, int]:
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
                payload = {}
                try:
                    payload = json.loads(str(row["payload_json"] or "{}"))
                except Exception:
                    payload = {}
                if not isinstance(payload, dict) or "pdf_slice_b64" not in payload:
                    continue
                payload.pop("pdf_slice_b64", None)
                conn.execute(
                    "UPDATE scan_jobs SET payload_json=? WHERE id=?",
                    (json.dumps(payload, ensure_ascii=False), str(row["id"] or "")),
                )
                updated_rows += 1
            conn.commit()

        if vacuum:
            conn.execute("VACUUM")

    return {
        "updated_rows": int(updated_rows),
        "scanned_rows": int(scanned_rows),
        "vacuum_ran": 1 if vacuum else 0,
    }
