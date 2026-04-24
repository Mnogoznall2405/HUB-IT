from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional


class InventoryQueueStore:
    def __init__(self, *, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS inventory_ingest_queue (
                    id TEXT PRIMARY KEY,
                    created_at INTEGER NOT NULL,
                    dedupe_key TEXT NOT NULL UNIQUE,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at INTEGER NOT NULL,
                    last_error TEXT NOT NULL DEFAULT '',
                    processed_at INTEGER NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_inventory_ingest_queue_status_next_attempt ON inventory_ingest_queue(status, next_attempt_at, created_at)"
            )
            conn.execute(
                "UPDATE inventory_ingest_queue SET status = 'queued' WHERE status = 'processing'"
            )
            conn.commit()

    def enqueue(self, payload: Dict[str, Any], dedupe_key: str) -> Dict[str, Any]:
        now_ts = int(time.time())
        queue_id = str(uuid.uuid4())
        payload_json = json.dumps(payload, ensure_ascii=False)
        with self._lock, self._connect() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO inventory_ingest_queue (
                        id, created_at, dedupe_key, payload_json, status,
                        attempt_count, next_attempt_at, last_error, processed_at
                    ) VALUES (?, ?, ?, ?, 'queued', 0, ?, '', NULL)
                    """,
                    (queue_id, now_ts, dedupe_key, payload_json, now_ts),
                )
                conn.commit()
                return {
                    "id": queue_id,
                    "created_at": now_ts,
                    "dedupe_key": dedupe_key,
                    "status": "queued",
                    "duplicate": False,
                }
            except sqlite3.IntegrityError:
                row = conn.execute(
                    "SELECT id, created_at, dedupe_key, status FROM inventory_ingest_queue WHERE dedupe_key = ?",
                    (dedupe_key,),
                ).fetchone()
                return {
                    "id": str((row or {})["id"]) if row is not None else "",
                    "created_at": int((row or {})["created_at"]) if row is not None else now_ts,
                    "dedupe_key": dedupe_key,
                    "status": str((row or {})["status"]) if row is not None else "queued",
                    "duplicate": True,
                }

    def claim_next_batch(self, *, limit: int) -> List[Dict[str, Any]]:
        now_ts = int(time.time())
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, created_at, dedupe_key, payload_json, status, attempt_count, next_attempt_at, last_error, processed_at
                FROM inventory_ingest_queue
                WHERE status = 'queued' AND next_attempt_at <= ?
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (now_ts, int(limit)),
            ).fetchall()
            if not rows:
                return []
            ids = [str(row["id"]) for row in rows]
            conn.executemany(
                "UPDATE inventory_ingest_queue SET status = 'processing' WHERE id = ?",
                [(row_id,) for row_id in ids],
            )
            conn.commit()

        claimed: List[Dict[str, Any]] = []
        for row in rows:
            payload = {}
            try:
                decoded = json.loads(str(row["payload_json"] or "{}"))
                if isinstance(decoded, dict):
                    payload = decoded
            except Exception:
                payload = {}
            claimed.append(
                {
                    "id": str(row["id"]),
                    "created_at": int(row["created_at"] or 0),
                    "dedupe_key": str(row["dedupe_key"] or ""),
                    "payload": payload,
                    "status": str(row["status"] or ""),
                    "attempt_count": int(row["attempt_count"] or 0),
                    "next_attempt_at": int(row["next_attempt_at"] or 0),
                    "last_error": str(row["last_error"] or ""),
                    "processed_at": int(row["processed_at"] or 0) if row["processed_at"] is not None else None,
                }
            )
        return claimed

    def mark_done(self, queue_id: str, *, processed_at: Optional[int] = None) -> None:
        processed_ts = int(processed_at or time.time())
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE inventory_ingest_queue SET status = 'done', processed_at = ?, last_error = '' WHERE id = ?",
                (processed_ts, queue_id),
            )
            conn.commit()

    def mark_retry(self, queue_id: str, *, error_text: str, next_attempt_at: int, attempt_count: int) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE inventory_ingest_queue
                SET status = 'queued', attempt_count = ?, next_attempt_at = ?, last_error = ?, processed_at = NULL
                WHERE id = ?
                """,
                (int(attempt_count), int(next_attempt_at), str(error_text or "")[:4000], queue_id),
            )
            conn.commit()

    def mark_dead(self, queue_id: str, *, error_text: str, processed_at: Optional[int], attempt_count: int) -> None:
        processed_ts = int(processed_at or time.time())
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE inventory_ingest_queue
                SET status = 'dead', attempt_count = ?, processed_at = ?, last_error = ?
                WHERE id = ?
                """,
                (int(attempt_count), processed_ts, str(error_text or "")[:4000], queue_id),
            )
            conn.commit()

    def queue_stats(self) -> Dict[str, Any]:
        now_ts = int(time.time())
        with self._lock, self._connect() as conn:
            active_count = int(
                conn.execute(
                    "SELECT COUNT(1) FROM inventory_ingest_queue WHERE status IN ('queued', 'processing')"
                ).fetchone()[0]
            )
            oldest_row = conn.execute(
                """
                SELECT created_at
                FROM inventory_ingest_queue
                WHERE status IN ('queued', 'processing')
                ORDER BY created_at ASC
                LIMIT 1
                """
            ).fetchone()
            dead_count = int(
                conn.execute(
                    "SELECT COUNT(1) FROM inventory_ingest_queue WHERE status = 'dead'"
                ).fetchone()[0]
            )
        oldest_created_at = int(oldest_row["created_at"]) if oldest_row is not None else None
        oldest_age = max(0, now_ts - oldest_created_at) if oldest_created_at is not None else None
        return {
            "queue_depth": active_count,
            "dead_letter_count": dead_count,
            "oldest_queued_age_sec": oldest_age,
        }
