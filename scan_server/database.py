from __future__ import annotations

import base64
import json
import logging
import re
import sqlite3
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from .pdf_spool import PdfSpoolStore
from .scan_agent_read_store import ScanAgentReadStore
from .scan_host_read_store import ScanHostReadStore
from .scan_task_report_store import ScanTaskIncidentReportStore

logger = logging.getLogger(__name__)

project_root = Path(__file__).resolve().parent.parent
web_root = project_root / "WEB-itinvent"
if web_root.exists() and str(web_root) not in sys.path:
    sys.path.insert(0, str(web_root))

ACTIVE_TASK_STATUSES = ("queued", "delivered", "acknowledged")
FINAL_TASK_STATUSES = ("completed", "failed", "expired")
PENDING_JOB_STATUSES = ("queued", "processing")
FINAL_JOB_STATUSES = ("done_clean", "done_with_incident", "failed")
_SQLITE_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SCAN_RUNTIME_COLUMNS = {
    "scan_jobs": {"event_id", "scan_task_id", "attempt_count"},
    "scan_incidents": {"resolved_at", "resolved_reason", "resolved_by_task_id"},
}


def _quote_sqlite_identifier(identifier: Any) -> str:
    normalized = str(identifier or "").strip()
    if not _SQLITE_IDENTIFIER_RE.fullmatch(normalized):
        raise ValueError(f"Invalid SQLite identifier: {normalized!r}")
    return f'"{normalized}"'


def _require_scan_runtime_column(table_name: Any, column_name: Any) -> tuple[str, str]:
    normalized_table = str(table_name or "").strip()
    normalized_column = str(column_name or "").strip()
    allowed_columns = _SCAN_RUNTIME_COLUMNS.get(normalized_table)
    if not allowed_columns or normalized_column not in allowed_columns:
        raise ValueError(f"Unsupported scan runtime schema patch: {normalized_table}.{normalized_column}")
    return normalized_table, normalized_column


def _now_ts() -> int:
    return int(time.time())


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_loads(value: Any, default: Any) -> Any:
    text = str(value or "").strip()
    if not text:
        return default
    try:
        return json.loads(text)
    except Exception:
        return default


def _safe_b64decode(value: Any) -> bytes:
    try:
        return base64.b64decode(str(value or ""), validate=False)
    except Exception:
        return b""


def _parse_date_or_ts(value: Any, *, end_of_day: bool = False) -> Optional[int]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return int(float(text))
    except Exception:
        pass
    try:
        date_obj = datetime.strptime(text, "%Y-%m-%d")
        base = int(date_obj.timestamp())
        if end_of_day:
            return base + (24 * 60 * 60) - 1
        return base
    except Exception:
        return None


def _file_ext_from_values(file_name: Any, file_path: Any) -> str:
    raw_name = str(file_name or "").strip()
    raw_path = str(file_path or "").strip()
    candidate = raw_name or raw_path
    if not candidate:
        return ""
    name_part = candidate.replace("\\", "/").split("/")[-1]
    if "." not in name_part:
        return ""
    return name_part.rsplit(".", 1)[-1].strip().lower()


def _severity_rank(value: Any) -> int:
    normalized = str(value or "").strip().lower()
    if normalized == "high":
        return 3
    if normalized == "medium":
        return 2
    if normalized == "low":
        return 1
    return 0


def _severity_label_from_rank(rank: Any) -> str:
    rank_value = int(rank or 0)
    if rank_value >= 3:
        return "high"
    if rank_value == 2:
        return "medium"
    if rank_value == 1:
        return "low"
    return "none"


def _incident_file_key(file_path: Any, file_name: Any, incident_id: Any = "") -> str:
    path = str(file_path or "").strip()
    if path:
        return path.lower()
    name = str(file_name or "").strip()
    if name:
        return name.lower()
    return str(incident_id or "").strip()


def _top_fragments_from_patterns(patterns: Any) -> List[Dict[str, Any]]:
    fragments: List[Dict[str, Any]] = []
    for match in _json_loads(patterns, []) if not isinstance(patterns, list) else patterns:
        if not isinstance(match, dict):
            continue
        snippet = str(
            match.get("snippet")
            or match.get("value")
            or match.get("pattern_name")
            or match.get("pattern")
            or ""
        ).strip()
        if snippet:
            fragments.append({**match, "snippet": snippet})
    return fragments[:5]


def _normalize_sort_dir(value: Any) -> str:
    return "asc" if str(value or "").strip().lower() == "asc" else "desc"


def _normalize_task_status_filter(value: Any) -> List[str]:
    raw = str(value or "").strip().lower()
    if not raw or raw == "all":
        return []
    if raw == "active":
        return list(ACTIVE_TASK_STATUSES)
    if raw == "final":
        return list(FINAL_TASK_STATUSES)
    return [item for item in {part.strip().lower() for part in raw.split(",")} if item]


def _normalize_mac_for_lookup(value: Any) -> str:
    return "".join(
        ch for ch in str(value or "").upper()
        if ch.isdigit() or ("A" <= ch <= "F")
    )


def _get_scan_context_db_ids() -> List[str]:
    ids: List[str] = []
    default_db = ""
    try:
        from backend.config import config as web_config

        default_db = str(getattr(getattr(web_config, "database", None), "database", "") or "").strip()
    except Exception:
        default_db = ""

    if default_db:
        ids.append(default_db)

    try:
        from backend.api.v1.database import get_all_db_configs

        for item in get_all_db_configs():
            db_id = str((item or {}).get("id") or "").strip()
            if db_id and db_id not in ids:
                ids.append(db_id)
    except Exception:
        pass

    return ids


def _resolve_agent_sql_context(mac_address: Any, hostname: Any) -> Optional[Dict[str, Any]]:
    normalized_mac = _normalize_mac_for_lookup(mac_address)
    normalized_hostname = str(hostname or "").strip()
    if not normalized_mac and not normalized_hostname:
        return None

    try:
        from backend.database import queries
    except Exception as exc:
        logger.debug("Scan agent SQL context import skipped: %s", exc)
        return None

    for db_id in _get_scan_context_db_ids():
        try:
            row = queries.resolve_pc_context_by_mac_or_hostname(
                mac_address=normalized_mac or mac_address,
                hostname=normalized_hostname,
                db_id=db_id,
            )
        except Exception as exc:
            logger.debug("Scan agent SQL context lookup failed for %s/%s in %s: %s", normalized_hostname, normalized_mac, db_id, exc)
            continue
        if isinstance(row, dict) and any(str(row.get(key) or "").strip() for key in ("branch_name", "location_name", "employee_name", "inv_no")):
            context = dict(row)
            context["database_id"] = db_id
            return context
    return None


def _severity_rank_to_label(rank: Any) -> str:
    rank_value = int(rank or 0)
    if rank_value >= 3:
        return "high"
    if rank_value == 2:
        return "medium"
    if rank_value == 1:
        return "low"
    return "none"


class ScanStore:
    def __init__(
        self,
        *,
        db_path: Path,
        archive_dir: Path,
        task_ack_timeout_sec: int,
        agent_online_timeout_sec: int = 300,
        resolve_agent_sql_context: bool = False,
        job_processing_timeout_sec: int = 1800,
    ) -> None:
        self.db_path = Path(db_path)
        self.archive_dir = Path(archive_dir)
        self.transient_dir = self.db_path.parent / "transient_jobs"
        self._pdf_spool = PdfSpoolStore(self.transient_dir)
        self.task_ack_timeout_sec = int(task_ack_timeout_sec)
        self.agent_online_timeout_sec = max(30, int(agent_online_timeout_sec))
        self.resolve_agent_sql_context = bool(resolve_agent_sql_context)
        self.job_processing_timeout_sec = max(60, int(job_processing_timeout_sec or 1800))
        self._lock = threading.RLock()
        self._scan_agent_read_store = ScanAgentReadStore(
            lock=self._lock,
            connect=self._connect,
            serialize_task_row=self._serialize_task_row,
            now=_now_ts,
            agent_online_timeout_sec=lambda: self.agent_online_timeout_sec,
            resolve_agent_sql_context_enabled=lambda: self.resolve_agent_sql_context,
            resolve_agent_sql_context=lambda mac_address, hostname: _resolve_agent_sql_context(mac_address, hostname),
        )
        self._scan_host_read_store = ScanHostReadStore(
            lock=self._lock,
            connect=self._connect,
            serialize_task_row=self._serialize_task_row,
            now=_now_ts,
        )
        self._scan_task_report_store = ScanTaskIncidentReportStore(
            lock=self._lock,
            connect=self._connect,
            serialize_task_row=self._serialize_task_row,
            now=_now_ts,
        )
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        self.transient_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _ensure_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS scan_agents (
                    agent_id TEXT PRIMARY KEY,
                    hostname TEXT NOT NULL DEFAULT '',
                    branch TEXT NOT NULL DEFAULT '',
                    ip_address TEXT NOT NULL DEFAULT '',
                    version TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'online',
                    last_seen_at INTEGER NOT NULL DEFAULT 0,
                    last_heartbeat_json TEXT NOT NULL DEFAULT '{}',
                    updated_at INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS scan_tasks (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    command TEXT NOT NULL,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    status TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    due_at INTEGER NOT NULL,
                    ttl_at INTEGER NOT NULL,
                    delivered_at INTEGER NULL,
                    acked_at INTEGER NULL,
                    completed_at INTEGER NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at INTEGER NOT NULL,
                    dedupe_key TEXT NULL,
                    error_text TEXT NULL,
                    result_json TEXT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_scan_tasks_agent_status_next
                    ON scan_tasks(agent_id, status, next_attempt_at, due_at);

                CREATE INDEX IF NOT EXISTS idx_scan_tasks_ttl
                    ON scan_tasks(ttl_at);

                CREATE INDEX IF NOT EXISTS idx_scan_tasks_dedupe
                    ON scan_tasks(agent_id, dedupe_key);

                CREATE TABLE IF NOT EXISTS scan_jobs (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL DEFAULT '',
                    hostname TEXT NOT NULL DEFAULT '',
                    branch TEXT NOT NULL DEFAULT '',
                    user_login TEXT NOT NULL DEFAULT '',
                    user_full_name TEXT NOT NULL DEFAULT '',
                    file_path TEXT NOT NULL DEFAULT '',
                    file_name TEXT NOT NULL DEFAULT '',
                    file_hash TEXT NOT NULL DEFAULT '',
                    file_size INTEGER NOT NULL DEFAULT 0,
                    source_kind TEXT NOT NULL DEFAULT 'unknown',
                    event_id TEXT NULL,
                    scan_task_id TEXT NULL,
                    status TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    started_at INTEGER NULL,
                    finished_at INTEGER NULL,
                    error_text TEXT NULL,
                    summary TEXT NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    payload_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE INDEX IF NOT EXISTS idx_scan_jobs_status_created
                    ON scan_jobs(status, created_at);

                CREATE INDEX IF NOT EXISTS idx_scan_jobs_agent_status_created
                    ON scan_jobs(agent_id, status, created_at);

                CREATE INDEX IF NOT EXISTS idx_scan_jobs_agent_created
                    ON scan_jobs(agent_id, created_at);

                CREATE INDEX IF NOT EXISTS idx_scan_tasks_agent_status_ttl_updated
                    ON scan_tasks(agent_id, status, ttl_at, updated_at, created_at);

                CREATE TABLE IF NOT EXISTS scan_findings (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    category TEXT NOT NULL,
                    matched_patterns_json TEXT NOT NULL DEFAULT '[]',
                    short_reason TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_scan_findings_job
                    ON scan_findings(job_id);

                CREATE TABLE IF NOT EXISTS scan_incidents (
                    id TEXT PRIMARY KEY,
                    finding_id TEXT NOT NULL,
                    job_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL DEFAULT '',
                    hostname TEXT NOT NULL DEFAULT '',
                    branch TEXT NOT NULL DEFAULT '',
                    user_login TEXT NOT NULL DEFAULT '',
                    user_full_name TEXT NOT NULL DEFAULT '',
                    file_path TEXT NOT NULL DEFAULT '',
                    severity TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'new',
                    created_at INTEGER NOT NULL,
                    ack_at INTEGER NULL,
                    ack_by TEXT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_scan_incidents_status_created
                    ON scan_incidents(status, created_at);

                CREATE INDEX IF NOT EXISTS idx_scan_incidents_branch
                    ON scan_incidents(branch, created_at);

                CREATE INDEX IF NOT EXISTS idx_scan_incidents_created
                    ON scan_incidents(created_at DESC);

                CREATE INDEX IF NOT EXISTS idx_scan_incidents_hostname_status_created
                    ON scan_incidents(hostname, status, created_at DESC);

                CREATE INDEX IF NOT EXISTS idx_scan_incidents_status_hostname_created
                    ON scan_incidents(status, hostname, created_at DESC);

                CREATE TABLE IF NOT EXISTS scan_task_file_observations (
                    id TEXT PRIMARY KEY,
                    scan_task_id TEXT NOT NULL DEFAULT '',
                    agent_id TEXT NOT NULL DEFAULT '',
                    hostname TEXT NOT NULL DEFAULT '',
                    file_path TEXT NOT NULL DEFAULT '',
                    file_hash TEXT NOT NULL DEFAULT '',
                    event_id TEXT NOT NULL DEFAULT '',
                    observation_type TEXT NOT NULL DEFAULT '',
                    linked_job_id TEXT NOT NULL DEFAULT '',
                    linked_incident_id TEXT NOT NULL DEFAULT '',
                    source_kind TEXT NOT NULL DEFAULT '',
                    severity TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_scan_observations_task_created
                    ON scan_task_file_observations(scan_task_id, created_at DESC);

                CREATE INDEX IF NOT EXISTS idx_scan_observations_hostname_created
                    ON scan_task_file_observations(hostname, created_at DESC);

                CREATE INDEX IF NOT EXISTS idx_scan_observations_task_hash
                    ON scan_task_file_observations(scan_task_id, file_hash);

                CREATE TABLE IF NOT EXISTS scan_artifacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    artifact_type TEXT NOT NULL,
                    storage_path TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_scan_artifacts_job
                    ON scan_artifacts(job_id);

                CREATE INDEX IF NOT EXISTS idx_scan_agents_last_seen
                    ON scan_agents(last_seen_at DESC);
                """
            )

            # Reset stuck scan tasks (commands to agents) that were in transit or active
            cursor_tasks = conn.execute(
                "UPDATE scan_tasks SET status='queued', delivered_at=NULL WHERE status='delivered'"
            )
            if cursor_tasks.rowcount > 0:
                logger.info("Found and reset %d stuck scan tasks from 'delivered' to 'queued'", cursor_tasks.rowcount)

            self._ensure_column(
                conn,
                table_name="scan_jobs",
                column_name="event_id",
                ddl="ALTER TABLE scan_jobs ADD COLUMN event_id TEXT NULL",
            )
            self._ensure_column(
                conn,
                table_name="scan_jobs",
                column_name="scan_task_id",
                ddl="ALTER TABLE scan_jobs ADD COLUMN scan_task_id TEXT NULL",
            )
            self._ensure_column(
                conn,
                table_name="scan_jobs",
                column_name="attempt_count",
                ddl="ALTER TABLE scan_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0",
            )
            self._ensure_column(
                conn,
                table_name="scan_incidents",
                column_name="resolved_at",
                ddl="ALTER TABLE scan_incidents ADD COLUMN resolved_at INTEGER NULL",
            )
            self._ensure_column(
                conn,
                table_name="scan_incidents",
                column_name="resolved_reason",
                ddl="ALTER TABLE scan_incidents ADD COLUMN resolved_reason TEXT NULL",
            )
            self._ensure_column(
                conn,
                table_name="scan_incidents",
                column_name="resolved_by_task_id",
                ddl="ALTER TABLE scan_incidents ADD COLUMN resolved_by_task_id TEXT NULL",
            )
            conn.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_jobs_event_id
                ON scan_jobs(event_id)
                WHERE event_id IS NOT NULL AND event_id <> ''
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_scan_jobs_scan_task_status
                ON scan_jobs(scan_task_id, status, created_at)
                WHERE scan_task_id IS NOT NULL AND scan_task_id <> ''
                """
            )
            self._reconcile_scan_tasks_locked(conn)
            conn.commit()

    def _ensure_column(self, conn: sqlite3.Connection, *, table_name: str, column_name: str, ddl: str) -> None:
        safe_table_name, safe_column_name = _require_scan_runtime_column(table_name, column_name)
        rows = conn.execute(f"PRAGMA table_info({_quote_sqlite_identifier(safe_table_name)})").fetchall()
        existing = {str(row["name"] or "").strip().lower() for row in rows}
        if safe_column_name.lower() in existing:
            return
        conn.execute(ddl)

    def _job_pdf_spool_path(self, job_id: str) -> Path:
        return self._pdf_spool.path_for_job(job_id)

    def write_job_pdf_spool(self, *, job_id: str, pdf_bytes: bytes) -> Path:
        return self._pdf_spool.write(job_id=job_id, pdf_bytes=pdf_bytes)

    def read_job_pdf_spool(self, *, job_id: str) -> bytes:
        return self._pdf_spool.read(job_id=job_id)

    def delete_job_pdf_spool(self, *, job_id: str) -> bool:
        return self._pdf_spool.delete(job_id=job_id)

    def transient_pdf_spool_stats(self, *, cache_ttl_sec: float = 10.0) -> Dict[str, Any]:
        return self._pdf_spool.stats(cache_ttl_sec=cache_ttl_sec)

    def pdf_job_status_counts(self) -> Dict[str, int]:
        counts: Dict[str, int] = {
            "pdf_queued": 0,
            "pdf_processing": 0,
            "pdf_done_clean": 0,
            "pdf_done_with_incident": 0,
            "pdf_failed": 0,
            "pdf_total": 0,
            "pdf_pending": 0,
            "pdf_completed": 0,
        }
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT status, COUNT(*) AS c
                FROM scan_jobs
                WHERE source_kind IN ('pdf', 'pdf_slice')
                GROUP BY status
                """
            ).fetchall()
        for row in rows:
            status = str(row["status"] or "unknown").strip().lower() or "unknown"
            count = int(row["c"] or 0)
            counts[f"pdf_{status}"] = int(counts.get(f"pdf_{status}", 0)) + count
            counts["pdf_total"] += count
        counts["pdf_pending"] = int(counts.get("pdf_queued", 0)) + int(counts.get("pdf_processing", 0))
        counts["pdf_completed"] = int(counts.get("pdf_done_clean", 0)) + int(counts.get("pdf_done_with_incident", 0))
        return counts

    def ingest_backpressure_status(
        self,
        *,
        max_pending_pdf_jobs: int,
        transient_max_gb: float,
    ) -> Dict[str, Any]:
        counts = self.pdf_job_status_counts()
        spool = self.transient_pdf_spool_stats()
        pending_limit = max(1, int(max_pending_pdf_jobs or 1))
        transient_limit_gb = max(0.1, float(transient_max_gb or 0.1))
        reasons: List[str] = []
        if int(counts["pdf_pending"]) >= pending_limit:
            reasons.append("pdf_pending_limit")
        if float(spool["gb"]) >= transient_limit_gb:
            reasons.append("transient_size_limit")
        return {
            "active": bool(reasons),
            "reasons": reasons,
            "pdf_pending": int(counts["pdf_pending"]),
            "pdf_queued": int(counts["pdf_queued"]),
            "pdf_processing": int(counts["pdf_processing"]),
            "max_pending_pdf_jobs": pending_limit,
            "transient": spool,
            "transient_max_gb": transient_limit_gb,
        }

    def reconcile_job_pdf_spool(self) -> Dict[str, int]:
        removed_orphan = 0
        removed_final = 0
        failed_jobs = 0
        now_ts = _now_ts()
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, status, source_kind, scan_task_id, started_at
                FROM scan_jobs
                """
            ).fetchall()
            existing_ids = {str(row["id"] or "").strip() for row in rows if str(row["id"] or "").strip()}
            pending_pdf_rows = [
                row for row in rows
                if str(row["status"] or "").strip().lower() in PENDING_JOB_STATUSES
                and str(row["source_kind"] or "").strip().lower() == "pdf_slice"
            ]
            final_ids = {
                str(row["id"] or "").strip()
                for row in rows
                if str(row["status"] or "").strip().lower() in FINAL_JOB_STATUSES
            }

            spool_paths = self._pdf_spool.list_pdf_paths()
            spool_ids = {path.stem.strip().lower() for path in spool_paths}

            for path in spool_paths:
                job_id = path.stem.strip().lower()
                if job_id not in existing_ids:
                    if self._pdf_spool.delete_path(path, description="orphan"):
                        removed_orphan += 1
                    continue
                if job_id in final_ids:
                    if self._pdf_spool.delete_path(path, description="stale"):
                        removed_final += 1

            missing_rows = []
            waiting_processing_missing = 0
            stale_before = now_ts - self.job_processing_timeout_sec
            for row in pending_pdf_rows:
                if str(row["id"] or "").strip().lower() in spool_ids:
                    continue
                status_value = str(row["status"] or "").strip().lower()
                started_at = int(row["started_at"] or 0)
                if status_value == "processing" and started_at > stale_before:
                    waiting_processing_missing += 1
                    continue
                missing_rows.append(row)
            touched_task_ids = set()
            for row in missing_rows:
                job_id = str(row["id"] or "").strip()
                if not job_id:
                    continue
                conn.execute(
                    """
                    UPDATE scan_jobs
                    SET status='failed', finished_at=?, error_text=?
                    WHERE id=?
                    """,
                    (now_ts, "Missing transient PDF payload", job_id),
                )
                failed_jobs += 1
                task_id = str(row["scan_task_id"] or "").strip()
                if task_id:
                    touched_task_ids.add(task_id)
            for task_id in touched_task_ids:
                self._reconcile_scan_task_progress_locked(conn, task_id, now_ts=now_ts)
            conn.commit()
        return {
            "removed_orphan_files": removed_orphan,
            "removed_final_files": removed_final,
            "failed_jobs": failed_jobs,
            "waiting_processing_missing": waiting_processing_missing,
        }

    def _normalize_linked_scan_task_id_locked(self, conn: sqlite3.Connection, task_id: Any) -> str:
        tid = str(task_id or "").strip()
        if not tid:
            return ""
        row = conn.execute(
            "SELECT command, status FROM scan_tasks WHERE id=? LIMIT 1",
            (tid,),
        ).fetchone()
        if row is None:
            return ""
        if str(row["command"] or "").strip().lower() != "scan_now":
            return ""
        if str(row["status"] or "").strip().lower() in FINAL_TASK_STATUSES:
            return ""
        return tid

    def _scan_task_job_counts(self, conn: sqlite3.Connection, task_id: str) -> Dict[str, int]:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS jobs_total,
                SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS jobs_pending,
                SUM(CASE WHEN status = 'done_clean' THEN 1 ELSE 0 END) AS jobs_done_clean,
                SUM(CASE WHEN status = 'done_with_incident' THEN 1 ELSE 0 END) AS jobs_done_with_incident,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS jobs_failed
            FROM scan_jobs
            WHERE scan_task_id = ?
            """,
            (str(task_id or "").strip(),),
        ).fetchone()
        if row is None:
            return {
                "jobs_total": 0,
                "jobs_pending": 0,
                "jobs_done_clean": 0,
                "jobs_done_with_incident": 0,
                "jobs_failed": 0,
            }
        return {
            "jobs_total": int(row["jobs_total"] or 0),
            "jobs_pending": int(row["jobs_pending"] or 0),
            "jobs_done_clean": int(row["jobs_done_clean"] or 0),
            "jobs_done_with_incident": int(row["jobs_done_with_incident"] or 0),
            "jobs_failed": int(row["jobs_failed"] or 0),
        }

    def _reconcile_scan_task_progress_locked(
        self,
        conn: sqlite3.Connection,
        task_id: str,
        *,
        now_ts: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        tid = str(task_id or "").strip()
        if not tid:
            return None
        row = conn.execute(
            "SELECT * FROM scan_tasks WHERE id=? LIMIT 1",
            (tid,),
        ).fetchone()
        if row is None:
            return None

        command = str(row["command"] or "").strip().lower()
        if command != "scan_now":
            return None

        status_value = str(row["status"] or "").strip().lower()
        current_result = _json_loads(row["result_json"], {})
        if not isinstance(current_result, dict):
            current_result = {}
        counts = self._scan_task_job_counts(conn, tid)
        merged_result = dict(current_result)
        merged_result.update(counts)

        phase = str(merged_result.get("phase") or "").strip().lower()
        if not phase:
            if status_value == "completed":
                phase = "completed"
            elif status_value == "failed":
                phase = "failed"
            elif counts["jobs_total"] > 0:
                phase = "server_processing"
            else:
                phase = "local_scan"
        elif status_value == "acknowledged" and counts["jobs_total"] > 0 and phase == "local_scan":
            phase = "server_processing"

        if status_value in FINAL_TASK_STATUSES:
            if merged_result != current_result:
                merged_result["phase"] = phase
                conn.execute(
                    """
                    UPDATE scan_tasks
                    SET updated_at=?, result_json=?
                    WHERE id=?
                    """,
                    (
                        int(now_ts or _now_ts()),
                        _json_dumps(merged_result),
                        tid,
                    ),
                )
            return {"status": status_value, "phase": phase, **counts}

        next_status = status_value
        next_error = str(row["error_text"] or "").strip() or None
        next_completed_at = None
        stale_before = update_now = int(now_ts or _now_ts())
        local_scan_stale_before = stale_before - self.task_ack_timeout_sec
        if status_value == "acknowledged" and phase == "server_processing":
            if counts["jobs_failed"] > 0:
                next_status = "failed"
                phase = "failed"
                next_error = "Linked OCR jobs failed"
                next_completed_at = int(now_ts or _now_ts())
            elif counts["jobs_total"] > 0 and counts["jobs_pending"] == 0:
                next_status = "completed"
                phase = "completed"
                next_error = None
                next_completed_at = int(now_ts or _now_ts())
        elif status_value == "acknowledged" and phase == "local_scan" and counts["jobs_total"] == 0:
            updated_at = int(row["updated_at"] or row["acked_at"] or row["delivered_at"] or row["created_at"] or 0)
            if updated_at > 0 and updated_at <= local_scan_stale_before:
                next_status = "failed"
                phase = "failed"
                next_error = "Local scan acknowledgement timed out"
                next_completed_at = stale_before

        merged_result["phase"] = phase
        conn.execute(
            """
            UPDATE scan_tasks
            SET status=?,
                updated_at=?,
                result_json=?,
                error_text=?,
                completed_at=?
            WHERE id=?
            """,
            (
                next_status,
                update_now,
                _json_dumps(merged_result),
                next_error,
                next_completed_at,
                tid,
            ),
        )
        return {"status": next_status, "phase": phase, **counts}

    def _reconcile_scan_tasks_locked(self, conn: sqlite3.Connection) -> None:
        rows = conn.execute(
            """
            SELECT id
            FROM scan_tasks
            WHERE command='scan_now' AND status='acknowledged'
            """
        ).fetchall()
        now_ts = _now_ts()
        for row in rows:
            self._reconcile_scan_task_progress_locked(conn, str(row["id"] or ""), now_ts=now_ts)

    def upsert_agent_heartbeat(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        agent_id = str(payload.get("agent_id") or "").strip()
        hostname = str(payload.get("hostname") or "").strip()
        if not agent_id:
            agent_id = hostname or f"agent-{uuid.uuid4().hex[:8]}"
        now_ts = _now_ts()
        row = {
            "agent_id": agent_id,
            "hostname": hostname,
            "branch": str(payload.get("branch") or "").strip(),
            "ip_address": str(payload.get("ip_address") or "").strip(),
            "version": str(payload.get("version") or "").strip(),
            "status": str(payload.get("status") or "online").strip() or "online",
            "last_seen_at": int(payload.get("last_seen_at") or now_ts),
            "last_heartbeat_json": _json_dumps(payload),
            "updated_at": now_ts,
        }
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO scan_agents(
                    agent_id, hostname, branch, ip_address, version, status, last_seen_at, last_heartbeat_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(agent_id) DO UPDATE SET
                    hostname=excluded.hostname,
                    branch=excluded.branch,
                    ip_address=excluded.ip_address,
                    version=excluded.version,
                    status=excluded.status,
                    last_seen_at=excluded.last_seen_at,
                    last_heartbeat_json=excluded.last_heartbeat_json,
                    updated_at=excluded.updated_at
                """,
                (
                    row["agent_id"],
                    row["hostname"],
                    row["branch"],
                    row["ip_address"],
                    row["version"],
                    row["status"],
                    row["last_seen_at"],
                    row["last_heartbeat_json"],
                    row["updated_at"],
                ),
            )
            conn.commit()
        return row

    def touch_agent_presence(
        self,
        *,
        agent_id: str,
        ip_address: str = "",
        hostname: str = "",
        branch: str = "",
        status: str = "online",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        normalized_agent_id = str(agent_id or "").strip()
        if not normalized_agent_id:
            return None
        existing_payload: Dict[str, Any] = {}
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT hostname, branch, ip_address, version, status, last_heartbeat_json
                FROM scan_agents
                WHERE agent_id=?
                LIMIT 1
                """,
                (normalized_agent_id,),
            ).fetchone()
        if row is not None:
            existing_payload = _json_loads(row["last_heartbeat_json"], {})
            if not isinstance(existing_payload, dict):
                existing_payload = {}
            existing_metadata = existing_payload.get("metadata")
            if not isinstance(existing_metadata, dict):
                existing_metadata = {}
            if isinstance(metadata, dict):
                existing_metadata.update(metadata)
            existing_payload.update(
                {
                    "agent_id": normalized_agent_id,
                    "hostname": str(hostname or existing_payload.get("hostname") or row["hostname"] or "").strip(),
                    "branch": str(branch or existing_payload.get("branch") or row["branch"] or "").strip(),
                    "ip_address": str(ip_address or existing_payload.get("ip_address") or row["ip_address"] or "").strip(),
                    "version": str(existing_payload.get("version") or row["version"] or "").strip(),
                    "status": str(status or existing_payload.get("status") or row["status"] or "online").strip() or "online",
                    "last_seen_at": _now_ts(),
                    "metadata": existing_metadata,
                }
            )
        else:
            payload_metadata = metadata if isinstance(metadata, dict) else {}
            existing_payload = {
                "agent_id": normalized_agent_id,
                "hostname": str(hostname or normalized_agent_id).strip(),
                "branch": str(branch or "").strip(),
                "ip_address": str(ip_address or "").strip(),
                "version": "",
                "status": str(status or "online").strip() or "online",
                "last_seen_at": _now_ts(),
                "metadata": payload_metadata,
            }
        return self.upsert_agent_heartbeat(existing_payload)

    def create_task(
        self,
        *,
        agent_id: str,
        command: str,
        payload: Optional[Dict[str, Any]] = None,
        ttl_days: int = 7,
        dedupe_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        agent_id = str(agent_id or "").strip()
        command = str(command or "").strip().lower()
        if not agent_id:
            raise ValueError("agent_id is required")
        if command not in {"ping", "scan_now"}:
            raise ValueError("command must be one of: ping, scan_now")

        now_ts = _now_ts()
        ttl_at = now_ts + max(1, int(ttl_days)) * 24 * 60 * 60
        due_at = now_ts
        key = str(dedupe_key or "").strip() or None
        payload_json = _json_dumps(payload or {})

        with self._lock, self._connect() as conn:
            if key:
                existing = conn.execute(
                    """
                    SELECT id, command, status, created_at, ttl_at
                    FROM scan_tasks
                    WHERE agent_id=? AND dedupe_key=? AND status IN ('queued', 'delivered', 'acknowledged')
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (agent_id, key),
                ).fetchone()
                if existing:
                    return dict(existing)

            if command == "scan_now":
                active_task = conn.execute(
                    """
                    SELECT id, command, status, created_at, ttl_at
                    FROM scan_tasks
                    WHERE agent_id=?
                      AND command='scan_now'
                      AND status IN ('queued', 'delivered', 'acknowledged')
                      AND ttl_at > ?
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (agent_id, now_ts),
                ).fetchone()
                if active_task:
                    return dict(active_task)

                active_job = conn.execute(
                    """
                    SELECT id, status, created_at
                    FROM scan_jobs
                    WHERE agent_id=?
                      AND status IN ('queued', 'processing')
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    (agent_id,),
                ).fetchone()
                if active_job:
                    return {
                        "id": str(active_job["id"] or ""),
                        "agent_id": agent_id,
                        "command": "scan_now",
                        "status": "acknowledged" if str(active_job["status"] or "").lower() == "processing" else "queued",
                        "created_at": int(active_job["created_at"] or now_ts),
                        "ttl_at": ttl_at,
                    }

            task_id = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO scan_tasks(
                    id, agent_id, command, payload_json, status, created_at, updated_at, due_at, ttl_at, next_attempt_at, dedupe_key
                ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    agent_id,
                    command,
                    payload_json,
                    now_ts,
                    now_ts,
                    due_at,
                    ttl_at,
                    now_ts,
                    key,
                ),
            )
            conn.commit()
        return {
            "id": task_id,
            "agent_id": agent_id,
            "command": command,
            "status": "queued",
            "created_at": now_ts,
            "ttl_at": ttl_at,
        }

    def _maintain_tasks(self, conn: sqlite3.Connection, now_ts: int) -> None:
        conn.execute(
            """
            UPDATE scan_tasks
            SET status='expired', updated_at=?, completed_at=COALESCE(completed_at, ?)
            WHERE status IN ('queued', 'delivered', 'acknowledged') AND ttl_at <= ?
            """,
            (now_ts, now_ts, now_ts),
        )
        stale_before = now_ts - self.task_ack_timeout_sec
        conn.execute(
            """
            UPDATE scan_tasks
            SET status='queued', updated_at=?
            WHERE status='delivered'
              AND ttl_at > ?
              AND delivered_at IS NOT NULL
              AND delivered_at <= ?
            """,
            (now_ts, now_ts, stale_before),
        )

    def poll_tasks(self, *, agent_id: str, limit: int) -> List[Dict[str, Any]]:
        aid = str(agent_id or "").strip()
        if not aid:
            return []
        request_limit = max(1, min(50, int(limit)))
        now_ts = _now_ts()
        out: List[Dict[str, Any]] = []
        with self._lock, self._connect() as conn:
            self._maintain_tasks(conn, now_ts)
            rows = conn.execute(
                """
                SELECT id, command, payload_json, attempt_count, created_at, ttl_at
                FROM scan_tasks
                WHERE agent_id=?
                  AND status='queued'
                  AND due_at <= ?
                  AND next_attempt_at <= ?
                  AND ttl_at > ?
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (aid, now_ts, now_ts, now_ts, request_limit),
            ).fetchall()

            for row in rows:
                attempts = int(row["attempt_count"] or 0) + 1
                backoff = min(900, 30 * (2 ** min(attempts - 1, 5)))
                next_attempt = now_ts + backoff
                conn.execute(
                    """
                    UPDATE scan_tasks
                    SET status='delivered',
                        attempt_count=?,
                        delivered_at=?,
                        next_attempt_at=?,
                        updated_at=?
                    WHERE id=?
                    """,
                    (attempts, now_ts, next_attempt, now_ts, row["id"]),
                )
                out.append(
                    {
                        "task_id": row["id"],
                        "command": row["command"],
                        "payload": _json_loads(row["payload_json"], {}),
                        "attempt_count": attempts,
                        "created_at": int(row["created_at"] or now_ts),
                        "ttl_at": int(row["ttl_at"] or now_ts),
                    }
                )
            conn.commit()
        return out

    def report_task_result(
        self,
        *,
        agent_id: str,
        task_id: str,
        status: str,
        result: Optional[Dict[str, Any]],
        error_text: Optional[str],
    ) -> Optional[Dict[str, Any]]:
        aid = str(agent_id or "").strip()
        tid = str(task_id or "").strip()
        normalized = str(status or "").strip().lower()
        if normalized not in {"acknowledged", "completed", "failed"}:
            raise ValueError("status must be acknowledged|completed|failed")
        if not aid or not tid:
            return None

        now_ts = _now_ts()
        result_payload = dict(result or {}) if isinstance(result, dict) else {}
        update_fields = {
            "status": normalized,
            "updated_at": now_ts,
            "result_json": _json_dumps(result_payload),
            "error_text": str(error_text or "").strip() or None,
            "acked_at": now_ts if normalized in {"acknowledged", "completed", "failed"} else None,
            "completed_at": now_ts if normalized in {"completed", "failed"} else None,
        }
        returned_status = normalized
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT id, agent_id, command, status FROM scan_tasks WHERE id=?",
                (tid,),
            ).fetchone()
            if row is None or str(row["agent_id"] or "").strip() != aid:
                return None
            current_status = str(row["status"] or "").strip().lower()
            if current_status in FINAL_TASK_STATUSES:
                return {"task_id": tid, "status": current_status}

            conn.execute(
                """
                UPDATE scan_tasks
                SET status=?,
                    updated_at=?,
                    result_json=?,
                    error_text=?,
                    acked_at=COALESCE(?, acked_at),
                    completed_at=COALESCE(?, completed_at)
                WHERE id=?
                """,
                (
                    update_fields["status"],
                    update_fields["updated_at"],
                    update_fields["result_json"],
                    update_fields["error_text"],
                    update_fields["acked_at"],
                    update_fields["completed_at"],
                    tid,
                ),
            )
            if (
                str(row["command"] or "").strip().lower() == "scan_now"
                and bool(result_payload.get("force_rescan"))
                and normalized in {"acknowledged", "completed", "failed"}
            ):
                resolution_stats = self._apply_scan_resolution_events_locked(
                    conn,
                    task_id=tid,
                    agent_id=aid,
                    result=result_payload,
                    now_ts=now_ts,
                )
                if any(int(value or 0) for value in resolution_stats.values()):
                    result_payload.update(resolution_stats)
                    conn.execute(
                        "UPDATE scan_tasks SET result_json=? WHERE id=?",
                        (_json_dumps(result_payload), tid),
                    )
            if normalized == "acknowledged" and str(row["command"] or "").strip().lower() == "scan_now":
                reconciled = self._reconcile_scan_task_progress_locked(conn, tid, now_ts=now_ts)
                if isinstance(reconciled, dict):
                    returned_status = str(reconciled.get("status") or returned_status).strip().lower() or returned_status
            conn.commit()
        return {"task_id": tid, "status": returned_status}

    def _serialize_task_row(self, row: sqlite3.Row, now_ts: Optional[int] = None) -> Dict[str, Any]:
        current_ts = int(now_ts or _now_ts())
        item = dict(row)
        item["payload"] = _json_loads(item.pop("payload_json", "{}"), {})
        item["result"] = _json_loads(item.pop("result_json", "{}"), {})
        item["status"] = str(item.get("status") or "").strip().lower()
        item["command"] = str(item.get("command") or "").strip().lower()
        item["error_text"] = str(item.get("error_text") or "").strip()
        item["attempt_count"] = int(item.get("attempt_count") or 0)
        item["created_at"] = int(item.get("created_at") or 0)
        item["updated_at"] = int(item.get("updated_at") or item["created_at"] or 0)
        item["delivered_at"] = int(item.get("delivered_at") or 0)
        item["acked_at"] = int(item.get("acked_at") or 0)
        item["completed_at"] = int(item.get("completed_at") or 0)
        item["ttl_at"] = int(item.get("ttl_at") or 0)
        item["is_active"] = item["status"] in ACTIVE_TASK_STATUSES and item["ttl_at"] > current_ts
        elapsed_end = item["completed_at"] or item["updated_at"] or current_ts
        item["elapsed_seconds"] = max(0, elapsed_end - item["created_at"]) if item["created_at"] else 0
        return item

    def list_tasks(
        self,
        *,
        agent_id: Optional[str] = None,
        status: Optional[str] = None,
        command: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        conditions: List[str] = []
        params: List[Any] = []
        normalized_agent_id = str(agent_id or "").strip()
        if normalized_agent_id:
            conditions.append("agent_id = ?")
            params.append(normalized_agent_id)

        status_values = _normalize_task_status_filter(status)
        if status_values:
            placeholders = ", ".join("?" for _ in status_values)
            conditions.append(f"LOWER(status) IN ({placeholders})")
            params.extend(status_values)

        normalized_command = str(command or "").strip().lower()
        if normalized_command:
            conditions.append("LOWER(command) = ?")
            params.append(normalized_command)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        safe_limit = max(1, min(200, int(limit)))
        safe_offset = max(0, int(offset))
        now_ts = _now_ts()

        with self._lock, self._connect() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) as cnt FROM scan_tasks {where_clause}",
                params,
            ).fetchone()["cnt"]
            rows = conn.execute(
                f"""
                SELECT *
                FROM scan_tasks
                {where_clause}
                ORDER BY
                    CASE
                        WHEN status IN ('queued', 'delivered', 'acknowledged') THEN 0
                        ELSE 1
                    END ASC,
                    COALESCE(updated_at, created_at) DESC,
                    created_at DESC
                LIMIT ? OFFSET ?
                """,
                [*params, safe_limit, safe_offset],
            ).fetchall()

        return {
            "total": int(total),
            "items": [self._serialize_task_row(row, now_ts=now_ts) for row in rows],
        }

    def _find_incident_for_job_locked(self, conn: sqlite3.Connection, job_id: str) -> Optional[sqlite3.Row]:
        normalized_job_id = str(job_id or "").strip()
        if not normalized_job_id:
            return None
        return conn.execute(
            """
            SELECT id, severity
            FROM scan_incidents
            WHERE job_id=?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (normalized_job_id,),
        ).fetchone()

    def _record_scan_observation_locked(
        self,
        conn: sqlite3.Connection,
        *,
        scan_task_id: str,
        agent_id: str,
        hostname: str,
        file_path: str,
        file_hash: str,
        event_id: str,
        observation_type: str,
        linked_job_id: str = "",
        linked_incident_id: str = "",
        source_kind: str = "",
        severity: str = "",
        created_at: Optional[int] = None,
    ) -> str:
        task_id = str(scan_task_id or "").strip()
        obs_type = str(observation_type or "").strip().lower()
        if not task_id or not obs_type:
            return ""
        observation_id = uuid.uuid4().hex
        conn.execute(
            """
            INSERT INTO scan_task_file_observations(
                id, scan_task_id, agent_id, hostname, file_path, file_hash, event_id,
                observation_type, linked_job_id, linked_incident_id, source_kind, severity, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                observation_id,
                task_id,
                str(agent_id or "").strip(),
                str(hostname or "").strip(),
                str(file_path or "").strip(),
                str(file_hash or "").strip(),
                str(event_id or "").strip(),
                obs_type,
                str(linked_job_id or "").strip(),
                str(linked_incident_id or "").strip(),
                str(source_kind or "").strip(),
                str(severity or "").strip(),
                int(created_at or _now_ts()),
            ),
        )
        return observation_id

    def _record_existing_job_observation_locked(
        self,
        conn: sqlite3.Connection,
        *,
        scan_task_id: str,
        row: Dict[str, Any],
        existing: sqlite3.Row,
        event_id: str,
        created_at: int,
        observation_type: str = "found_duplicate",
    ) -> None:
        effective_scan_task_id = str(scan_task_id or "").strip()
        if not effective_scan_task_id:
            return
        existing_job_id = str(existing["id"] or "").strip()
        incident = self._find_incident_for_job_locked(conn, existing_job_id)
        self._record_scan_observation_locked(
            conn,
            scan_task_id=effective_scan_task_id,
            agent_id=str(row.get("agent_id") or "").strip(),
            hostname=str(row.get("hostname") or "").strip(),
            file_path=str(row.get("file_path") or "").strip(),
            file_hash=str(row.get("file_hash") or "").strip(),
            event_id=event_id,
            observation_type=observation_type,
            linked_job_id=existing_job_id,
            linked_incident_id=str(incident["id"] or "") if incident is not None else "",
            source_kind=str(row.get("source_kind") or "").strip(),
            severity=str(incident["severity"] or "") if incident is not None else "",
            created_at=created_at,
        )
        existing_task_id = str(existing["scan_task_id"] or "").strip()
        if existing_task_id == effective_scan_task_id:
            self._reconcile_scan_task_progress_locked(conn, effective_scan_task_id, now_ts=created_at)

    def _resolve_incident_from_event_locked(
        self,
        conn: sqlite3.Connection,
        *,
        event_id: str = "",
        agent_id: str = "",
        file_path: str = "",
        file_hash: str = "",
    ) -> Optional[sqlite3.Row]:
        normalized_event_id = str(event_id or "").strip()
        if normalized_event_id:
            row = conn.execute(
                """
                SELECT i.id, i.job_id, i.status, i.severity, i.file_path, j.file_hash, j.event_id
                FROM scan_incidents i
                JOIN scan_jobs j ON j.id = i.job_id
                WHERE j.event_id=?
                ORDER BY i.created_at DESC
                LIMIT 1
                """,
                (normalized_event_id,),
            ).fetchone()
            if row is not None:
                return row
        normalized_agent = str(agent_id or "").strip()
        normalized_path = str(file_path or "").strip()
        normalized_hash = str(file_hash or "").strip()
        if normalized_agent and normalized_path:
            params: List[Any] = [normalized_agent, normalized_path]
            hash_clause = ""
            if normalized_hash:
                hash_clause = "AND j.file_hash=?"
                params.append(normalized_hash)
            return conn.execute(
                f"""
                SELECT i.id, i.job_id, i.status, i.severity, i.file_path, j.file_hash, j.event_id
                FROM scan_incidents i
                JOIN scan_jobs j ON j.id = i.job_id
                WHERE i.agent_id=? AND i.file_path=? {hash_clause}
                ORDER BY i.created_at DESC
                LIMIT 1
                """,
                params,
            ).fetchone()
        return None

    def _apply_scan_resolution_events_locked(
        self,
        conn: sqlite3.Connection,
        *,
        task_id: str,
        agent_id: str,
        result: Dict[str, Any],
        now_ts: int,
    ) -> Dict[str, int]:
        normalized_task_id = str(task_id or "").strip()
        normalized_agent_id = str(agent_id or "").strip()
        if not normalized_task_id:
            return {"resolved_deleted": 0, "resolved_clean": 0, "resolved_moved": 0}

        task_row = conn.execute("SELECT result_json FROM scan_tasks WHERE id=? LIMIT 1", (normalized_task_id,)).fetchone()
        task_result = _json_loads(task_row["result_json"], {}) if task_row is not None else {}
        if not isinstance(task_result, dict):
            task_result = {}
        hostname = str(
            result.get("hostname")
            or task_result.get("hostname")
            or ""
        ).strip()
        if not hostname and normalized_agent_id:
            agent_row = conn.execute(
                "SELECT hostname FROM scan_agents WHERE agent_id=? LIMIT 1",
                (normalized_agent_id,),
            ).fetchone()
            if agent_row is not None:
                hostname = str(agent_row["hostname"] or "").strip()

        stats = {"resolved_deleted": 0, "resolved_clean": 0, "resolved_moved": 0}

        def resolve_event(event: Dict[str, Any], status_value: str, reason: str) -> None:
            incident = self._resolve_incident_from_event_locked(
                conn,
                event_id=str(event.get("event_id") or "").strip(),
                agent_id=normalized_agent_id,
                file_path=str(event.get("file_path") or "").strip(),
                file_hash=str(event.get("file_hash") or "").strip(),
            )
            linked_incident_id = str(incident["id"] or "").strip() if incident is not None else ""
            linked_job_id = str(incident["job_id"] or "").strip() if incident is not None else ""
            severity = str(incident["severity"] or "").strip() if incident is not None else ""
            obs_type = "cleaned" if status_value == "resolved_clean" else ("moved" if status_value == "resolved_moved" else "deleted")
            self._record_scan_observation_locked(
                conn,
                scan_task_id=normalized_task_id,
                agent_id=normalized_agent_id,
                hostname=hostname,
                file_path=str(event.get("file_path") or "").strip(),
                file_hash=str(event.get("file_hash") or "").strip(),
                event_id=str(event.get("event_id") or "").strip(),
                observation_type=obs_type,
                linked_job_id=linked_job_id,
                linked_incident_id=linked_incident_id,
                source_kind=str(event.get("source_kind") or "").strip(),
                severity=severity,
                created_at=now_ts,
            )
            if not linked_incident_id:
                return
            current_status = str(incident["status"] or "").strip().lower()
            if current_status.startswith("resolved_"):
                return
            conn.execute(
                """
                UPDATE scan_incidents
                SET status=?, resolved_at=?, resolved_reason=?, resolved_by_task_id=?
                WHERE id=?
                """,
                (status_value, now_ts, reason, normalized_task_id, linked_incident_id),
            )
            stats[status_value] = stats.get(status_value, 0) + 1

        deleted_events = [item for item in result.get("deleted_file_events", []) if isinstance(item, dict)]
        cleaned_events = [item for item in result.get("cleaned_file_events", []) if isinstance(item, dict)]

        found_hash_rows = conn.execute(
            """
            SELECT file_hash, file_path
            FROM scan_task_file_observations
            WHERE scan_task_id=? AND observation_type IN ('found_new', 'found_duplicate')
              AND file_hash <> ''
            """,
            (normalized_task_id,),
        ).fetchall()
        found_by_hash: Dict[str, set[str]] = {}
        for row in found_hash_rows:
            found_by_hash.setdefault(str(row["file_hash"] or "").strip(), set()).add(str(row["file_path"] or "").strip())

        for event in deleted_events:
            file_hash = str(event.get("file_hash") or "").strip()
            file_path = str(event.get("file_path") or "").strip()
            found_paths = found_by_hash.get(file_hash, set()) if file_hash else set()
            moved = any(path and path != file_path for path in found_paths)
            if moved:
                resolve_event(event, "resolved_moved", "file_found_at_new_path")
            else:
                resolve_event(event, "resolved_deleted", "file_missing_on_force_scan")

        for event in cleaned_events:
            resolve_event(event, "resolved_clean", "file_has_no_matches_on_force_scan")

        return stats

    def queue_job(self, payload: Dict[str, Any], *, pdf_bytes: Optional[bytes] = None) -> Dict[str, Any]:
        now_ts = _now_ts()
        event_id = str(payload.get("event_id") or "").strip()
        payload_pdf_bytes = bytes(pdf_bytes or b"")
        raw_pdf_b64 = str(payload.get("pdf_slice_b64") or "").strip()
        if raw_pdf_b64 and not payload_pdf_bytes:
            payload_pdf_bytes = _safe_b64decode(raw_pdf_b64)
            if not payload_pdf_bytes:
                raise ValueError("Invalid PDF payload")

        sanitized_payload = dict(payload or {})
        sanitized_payload.pop("pdf_slice_b64", None)
        sanitized_payload.pop("_pdf_bytes", None)
        job_id = uuid.uuid4().hex
        row = {
            "id": job_id,
            "agent_id": str(sanitized_payload.get("agent_id") or "").strip(),
            "hostname": str(sanitized_payload.get("hostname") or "").strip(),
            "branch": str(sanitized_payload.get("branch") or "").strip(),
            "user_login": str(sanitized_payload.get("user_login") or "").strip(),
            "user_full_name": str(sanitized_payload.get("user_full_name") or "").strip(),
            "file_path": str(sanitized_payload.get("file_path") or "").strip(),
            "file_name": str(sanitized_payload.get("file_name") or "").strip(),
            "file_hash": str(sanitized_payload.get("file_hash") or "").strip(),
            "file_size": int(sanitized_payload.get("file_size") or 0),
            "source_kind": str(sanitized_payload.get("source_kind") or "unknown").strip() or "unknown",
            "event_id": event_id,
            "scan_task_id": "",
            "status": "queued",
            "created_at": now_ts,
            "payload_json": "{}",
        }

        retry_existing: Optional[sqlite3.Row] = None
        with self._lock, self._connect() as conn:
            effective_scan_task_id = self._normalize_linked_scan_task_id_locked(
                conn,
                sanitized_payload.get("scan_task_id"),
            )
            sanitized_payload["scan_task_id"] = effective_scan_task_id
            row["scan_task_id"] = effective_scan_task_id
            row["payload_json"] = _json_dumps(sanitized_payload)
            if event_id:
                existing = conn.execute(
                    """
                    SELECT id, status, created_at, scan_task_id, error_text
                    FROM scan_jobs
                    WHERE event_id=?
                    LIMIT 1
                    """,
                    (event_id,),
                ).fetchone()
                if existing is not None:
                    is_retryable_missing_payload = (
                        str(existing["status"] or "").strip().lower() == "failed"
                        and str(existing["error_text"] or "").strip() == "Missing transient PDF payload"
                        and bool(payload_pdf_bytes)
                    )
                    if is_retryable_missing_payload:
                        retry_existing = existing
                    else:
                        self._record_existing_job_observation_locked(
                            conn,
                            scan_task_id=effective_scan_task_id,
                            row=row,
                            existing=existing,
                            event_id=event_id,
                            created_at=now_ts,
                        )
                        conn.commit()
                        return {
                            "job_id": str(existing["id"]),
                            "status": str(existing["status"] or "queued"),
                            "deduped": True,
                        }
            conn.commit()

        if retry_existing is not None:
            retry_job_id = str(retry_existing["id"] or "").strip()
            self.write_job_pdf_spool(job_id=retry_job_id, pdf_bytes=payload_pdf_bytes)
            with self._lock, self._connect() as conn:
                effective_scan_task_id = self._normalize_linked_scan_task_id_locked(
                    conn,
                    sanitized_payload.get("scan_task_id"),
                )
                sanitized_payload["scan_task_id"] = effective_scan_task_id
                row["scan_task_id"] = effective_scan_task_id
                row["payload_json"] = _json_dumps(sanitized_payload)
                existing = conn.execute(
                    """
                    SELECT id, status, created_at, scan_task_id, error_text
                    FROM scan_jobs
                    WHERE id=?
                    LIMIT 1
                    """,
                    (retry_job_id,),
                ).fetchone()
                if existing is None:
                    self.delete_job_pdf_spool(job_id=retry_job_id)
                    raise ValueError("Retryable scan job disappeared")
                conn.execute(
                    """
                    UPDATE scan_jobs
                    SET agent_id=?, hostname=?, branch=?, user_login=?, user_full_name=?,
                        file_path=?, file_name=?, file_hash=?, file_size=?, source_kind=?,
                        scan_task_id=?, status='queued', started_at=NULL, finished_at=NULL,
                        error_text=NULL, summary=NULL, payload_json=?
                    WHERE id=?
                    """,
                    (
                        row["agent_id"],
                        row["hostname"],
                        row["branch"],
                        row["user_login"],
                        row["user_full_name"],
                        row["file_path"],
                        row["file_name"],
                        row["file_hash"],
                        row["file_size"],
                        row["source_kind"],
                        row["scan_task_id"],
                        row["payload_json"],
                        retry_job_id,
                    ),
                )
                self._record_existing_job_observation_locked(
                    conn,
                    scan_task_id=effective_scan_task_id,
                    row=row,
                    existing=existing,
                    event_id=event_id,
                    created_at=now_ts,
                    observation_type="found_new",
                )
                if effective_scan_task_id:
                    self._reconcile_scan_task_progress_locked(conn, effective_scan_task_id, now_ts=now_ts)
                conn.commit()
            return {"job_id": retry_job_id, "status": "queued", "deduped": False, "reopened": True}

        spool_written = False
        if payload_pdf_bytes:
            self.write_job_pdf_spool(job_id=job_id, pdf_bytes=payload_pdf_bytes)
            spool_written = True
        try:
            with self._lock, self._connect() as conn:
                effective_scan_task_id = self._normalize_linked_scan_task_id_locked(
                    conn,
                    sanitized_payload.get("scan_task_id"),
                )
                sanitized_payload["scan_task_id"] = effective_scan_task_id
                row["scan_task_id"] = effective_scan_task_id
                row["payload_json"] = _json_dumps(sanitized_payload)
                conn.execute(
                    """
                    INSERT INTO scan_jobs(
                        id, agent_id, hostname, branch, user_login, user_full_name,
                        file_path, file_name, file_hash, file_size, source_kind, event_id, scan_task_id, status,
                        created_at, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row["id"],
                        row["agent_id"],
                        row["hostname"],
                        row["branch"],
                        row["user_login"],
                        row["user_full_name"],
                        row["file_path"],
                        row["file_name"],
                        row["file_hash"],
                        row["file_size"],
                        row["source_kind"],
                        row["event_id"],
                        row["scan_task_id"],
                        row["status"],
                        row["created_at"],
                        row["payload_json"],
                    ),
                )
                if effective_scan_task_id:
                    self._record_scan_observation_locked(
                        conn,
                        scan_task_id=effective_scan_task_id,
                        agent_id=row["agent_id"],
                        hostname=row["hostname"],
                        file_path=row["file_path"],
                        file_hash=row["file_hash"],
                        event_id=event_id,
                        observation_type="found_new",
                        linked_job_id=job_id,
                        source_kind=row["source_kind"],
                        created_at=now_ts,
                    )
                    self._reconcile_scan_task_progress_locked(conn, effective_scan_task_id, now_ts=now_ts)
                conn.commit()
        except sqlite3.IntegrityError:
            if spool_written:
                self.delete_job_pdf_spool(job_id=job_id)
            if event_id:
                with self._lock, self._connect() as conn:
                    existing = conn.execute(
                        "SELECT id, status, scan_task_id, error_text FROM scan_jobs WHERE event_id=? LIMIT 1",
                        (event_id,),
                    ).fetchone()
                    if existing is not None:
                        effective_scan_task_id = self._normalize_linked_scan_task_id_locked(
                            conn,
                            sanitized_payload.get("scan_task_id"),
                        )
                        self._record_existing_job_observation_locked(
                            conn,
                            scan_task_id=effective_scan_task_id,
                            row=row,
                            existing=existing,
                            event_id=event_id,
                            created_at=now_ts,
                        )
                        conn.commit()
                        return {
                            "job_id": str(existing["id"]),
                            "status": str(existing["status"] or "queued"),
                            "deduped": True,
                        }
            raise
        except Exception:
            if spool_written:
                self.delete_job_pdf_spool(job_id=job_id)
            raise
        return {"job_id": job_id, "status": "queued", "deduped": False}

    def requeue_stale_processing_jobs(self, *, timeout_sec: Optional[int] = None) -> int:
        safe_timeout = max(60, int(timeout_sec or self.job_processing_timeout_sec))
        stale_before = _now_ts() - safe_timeout
        with self._lock, self._connect() as conn:
            touched_task_ids = [
                str(row["scan_task_id"] or "").strip()
                for row in conn.execute(
                    """
                    SELECT DISTINCT scan_task_id
                    FROM scan_jobs
                    WHERE status='processing'
                      AND COALESCE(started_at, 0) > 0
                      AND started_at <= ?
                      AND scan_task_id IS NOT NULL
                      AND scan_task_id <> ''
                    """,
                    (stale_before,),
                ).fetchall()
            ]
            cursor = conn.execute(
                """
                UPDATE scan_jobs
                SET status='queued',
                    started_at=NULL,
                    summary='Requeued stale processing job',
                    error_text=NULL
                WHERE status='processing'
                  AND COALESCE(started_at, 0) > 0
                  AND started_at <= ?
                """,
                (stale_before,),
            )
            for task_id in touched_task_ids:
                self._reconcile_scan_task_progress_locked(conn, task_id)
            conn.commit()
            return int(cursor.rowcount or 0)

    def requeue_job_for_retry(self, *, job_id: str, error_text: str, summary: str = "") -> None:
        normalized_job_id = str(job_id or "").strip()
        if not normalized_job_id:
            return
        now_ts = _now_ts()
        with self._lock, self._connect() as conn:
            job_row = conn.execute(
                "SELECT scan_task_id FROM scan_jobs WHERE id=? LIMIT 1",
                (normalized_job_id,),
            ).fetchone()
            conn.execute(
                """
                UPDATE scan_jobs
                SET status='queued',
                    started_at=NULL,
                    finished_at=NULL,
                    error_text=?,
                    summary=?
                WHERE id=?
                """,
                (
                    str(error_text or "").strip() or None,
                    str(summary or "").strip() or None,
                    normalized_job_id,
                ),
            )
            scan_task_id = str(job_row["scan_task_id"] or "").strip() if job_row is not None else ""
            if scan_task_id:
                self._reconcile_scan_task_progress_locked(conn, scan_task_id, now_ts=now_ts)
            conn.commit()

    def claim_next_jobs(self, limit: int) -> List[Dict[str, Any]]:
        batch_limit = max(1, min(100, int(limit or 1)))
        now_ts = _now_ts()
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM scan_jobs
                WHERE status='queued'
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (batch_limit,),
            ).fetchall()
            if not rows:
                return []
            for row in rows:
                conn.execute(
                    """
                    UPDATE scan_jobs
                    SET status='processing',
                        started_at=?,
                        finished_at=NULL,
                        error_text=NULL,
                        attempt_count=COALESCE(attempt_count, 0) + 1
                    WHERE id=?
                    """,
                    (now_ts, row["id"]),
                )
            conn.commit()
        out: List[Dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["status"] = "processing"
            item["started_at"] = now_ts
            item["attempt_count"] = int(item.get("attempt_count") or 0) + 1
            out.append(item)
        return out

    def claim_next_job(self) -> Optional[Dict[str, Any]]:
        jobs = self.claim_next_jobs(1)
        return jobs[0] if jobs else None

    def get_task_payload(self, task_id: str) -> Dict[str, Any]:
        tid = str(task_id or "").strip()
        if not tid:
            return {}
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM scan_tasks WHERE id=? LIMIT 1",
                (tid,),
            ).fetchone()
        if row is None:
            return {}
        payload = _json_loads(row["payload_json"], {})
        return payload if isinstance(payload, dict) else {}

    def finalize_job(
        self,
        *,
        job_id: str,
        status: str,
        summary: Optional[str] = None,
        error_text: Optional[str] = None,
    ) -> None:
        now_ts = _now_ts()
        with self._lock, self._connect() as conn:
            job_row = conn.execute(
                "SELECT scan_task_id FROM scan_jobs WHERE id=? LIMIT 1",
                (str(job_id or "").strip(),),
            ).fetchone()
            conn.execute(
                """
                UPDATE scan_jobs
                SET status=?, finished_at=?, summary=?, error_text=?
                WHERE id=?
                """,
                (
                    str(status or "").strip(),
                    now_ts,
                    str(summary or "").strip() or None,
                    str(error_text or "").strip() or None,
                    str(job_id or "").strip(),
                ),
            )
            scan_task_id = str(job_row["scan_task_id"] or "").strip() if job_row is not None else ""
            if scan_task_id:
                self._reconcile_scan_task_progress_locked(conn, scan_task_id, now_ts=now_ts)
            conn.commit()
        self.delete_job_pdf_spool(job_id=job_id)

    def add_artifact(self, *, job_id: str, artifact_type: str, storage_path: str, size_bytes: int) -> None:
        now_ts = _now_ts()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO scan_artifacts(job_id, artifact_type, storage_path, size_bytes, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (job_id, artifact_type, storage_path, int(size_bytes), now_ts),
            )
            conn.commit()

    def purge_all_artifacts(self) -> Dict[str, int]:
        removed_rows = 0
        removed_files = 0
        removed_dirs = 0
        archive_root = self.archive_dir

        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS cnt FROM scan_artifacts").fetchone()
            removed_rows = int((row or {})["cnt"] if row is not None else 0)
            conn.execute("DELETE FROM scan_artifacts")
            conn.commit()

        if archive_root.exists():
            for path in sorted(archive_root.rglob("*"), key=lambda item: (item.is_file(), len(item.parts)), reverse=True):
                try:
                    if path.is_file():
                        path.unlink()
                        removed_files += 1
                    elif path.is_dir():
                        path.rmdir()
                        removed_dirs += 1
                except Exception as exc:
                    logger.warning("Failed to purge scan archive path %s: %s", path, exc)
            archive_root.mkdir(parents=True, exist_ok=True)

        return {
            "artifact_rows": removed_rows,
            "artifact_files": removed_files,
            "artifact_dirs": removed_dirs,
        }

    def create_finding_and_incident(
        self,
        *,
        job: Dict[str, Any],
        severity: str,
        category: str,
        matched_patterns: List[Dict[str, Any]],
        short_reason: str,
    ) -> Dict[str, str]:
        now_ts = _now_ts()
        finding_id = uuid.uuid4().hex
        incident_id = uuid.uuid4().hex
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO scan_findings(
                    id, job_id, severity, category, matched_patterns_json, short_reason, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    finding_id,
                    str(job.get("id") or ""),
                    severity,
                    category,
                    _json_dumps(matched_patterns),
                    short_reason,
                    now_ts,
                ),
            )
            conn.execute(
                """
                INSERT INTO scan_incidents(
                    id, finding_id, job_id, agent_id, hostname, branch, user_login, user_full_name,
                    file_path, severity, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
                """,
                (
                    incident_id,
                    finding_id,
                    str(job.get("id") or ""),
                    str(job.get("agent_id") or ""),
                    str(job.get("hostname") or ""),
                    str(job.get("branch") or ""),
                    str(job.get("user_login") or ""),
                    str(job.get("user_full_name") or ""),
                    str(job.get("file_path") or ""),
                    severity,
                    now_ts,
                ),
            )
            conn.execute(
                """
                UPDATE scan_task_file_observations
                SET linked_incident_id=?, severity=?
                WHERE linked_job_id=? AND linked_incident_id=''
                """,
                (incident_id, severity, str(job.get("id") or "")),
            )
            conn.commit()
        return {"finding_id": finding_id, "incident_id": incident_id}

    def _build_incident_where_clause(
        self,
        *,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        branch: Optional[str] = None,
        q: Optional[str] = None,
        hostname: Optional[str] = None,
        source_kind: Optional[str] = None,
        file_ext: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        has_fragment: Optional[bool] = None,
        ack_by: Optional[str] = None,
        table_alias: str = "i",
    ) -> tuple[str, List[Any]]:
        i_alias = str(table_alias or "i").strip() or "i"
        conditions: List[str] = []
        params: List[Any] = []
        if status:
            conditions.append(f"{i_alias}.status = ?")
            params.append(str(status).strip())
        if severity:
            conditions.append(f"{i_alias}.severity = ?")
            params.append(str(severity).strip())
        if branch:
            conditions.append(f"LOWER({i_alias}.branch) LIKE ?")
            params.append(f"%{str(branch).strip().lower()}%")
        if hostname:
            conditions.append(f"LOWER({i_alias}.hostname) LIKE ?")
            params.append(f"%{str(hostname).strip().lower()}%")
        if source_kind:
            conditions.append("LOWER(COALESCE(j.source_kind, '')) = ?")
            params.append(str(source_kind).strip().lower())
        if file_ext:
            ext = str(file_ext).strip().lower().lstrip(".")
            if ext:
                conditions.append(
                    f"(LOWER(COALESCE(j.file_name, '')) LIKE ? OR LOWER(COALESCE({i_alias}.file_path, '')) LIKE ?)"
                )
                params.extend([f"%.{ext}", f"%.{ext}"])
        date_from_ts = _parse_date_or_ts(date_from, end_of_day=False)
        if date_from_ts is not None:
            conditions.append(f"{i_alias}.created_at >= ?")
            params.append(int(date_from_ts))
        date_to_ts = _parse_date_or_ts(date_to, end_of_day=True)
        if date_to_ts is not None:
            conditions.append(f"{i_alias}.created_at <= ?")
            params.append(int(date_to_ts))
        if has_fragment is True:
            conditions.append("LENGTH(TRIM(COALESCE(f.matched_patterns_json, ''))) > 2")
        elif has_fragment is False:
            conditions.append("LENGTH(TRIM(COALESCE(f.matched_patterns_json, ''))) <= 2")
        if ack_by:
            conditions.append(f"LOWER(COALESCE({i_alias}.ack_by, '')) LIKE ?")
            params.append(f"%{str(ack_by).strip().lower()}%")
        if q:
            needle = f"%{str(q).strip().lower()}%"
            conditions.append(
                "("
                f"LOWER({i_alias}.hostname) LIKE ? OR LOWER({i_alias}.user_login) LIKE ? "
                f"OR LOWER({i_alias}.user_full_name) LIKE ? OR LOWER({i_alias}.file_path) LIKE ? "
                "OR LOWER(COALESCE(j.file_name, '')) LIKE ? "
                "OR LOWER(COALESCE(j.source_kind, '')) LIKE ? OR LOWER(COALESCE(f.short_reason, '')) LIKE ? "
                "OR LOWER(COALESCE(f.matched_patterns_json, '')) LIKE ?"
                ")"
            )
            params.extend([needle, needle, needle, needle, needle, needle, needle, needle])
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        return where_clause, params

    def list_incidents(
        self,
        *,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        branch: Optional[str] = None,
        q: Optional[str] = None,
        hostname: Optional[str] = None,
        source_kind: Optional[str] = None,
        file_ext: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        has_fragment: Optional[bool] = None,
        ack_by: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Dict[str, Any]:
        where_clause, params = self._build_incident_where_clause(
            status=status,
            severity=severity,
            branch=branch,
            q=q,
            hostname=hostname,
            source_kind=source_kind,
            file_ext=file_ext,
            date_from=date_from,
            date_to=date_to,
            has_fragment=has_fragment,
            ack_by=ack_by,
        )
        safe_limit = max(1, min(5000, int(limit)))
        safe_offset = max(0, int(offset))

        with self._lock, self._connect() as conn:
            total = conn.execute(
                f"""
                SELECT COUNT(*) as cnt
                FROM scan_incidents i
                LEFT JOIN scan_findings f ON f.id = i.finding_id
                LEFT JOIN scan_jobs j ON j.id = i.job_id
                {where_clause}
                """,
                params,
            ).fetchone()["cnt"]
            rows = conn.execute(
                f"""
                SELECT
                    i.*, 
                    f.category,
                    f.short_reason,
                    f.matched_patterns_json,
                    j.source_kind,
                    j.file_name,
                    j.created_at as job_created_at
                FROM scan_incidents i
                LEFT JOIN scan_findings f ON f.id = i.finding_id
                LEFT JOIN scan_jobs j ON j.id = i.job_id
                {where_clause}
                ORDER BY i.created_at DESC
                LIMIT ? OFFSET ?
                """,
                [*params, safe_limit, safe_offset],
            ).fetchall()

        items: List[Dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["matched_patterns"] = _json_loads(item.pop("matched_patterns_json", "[]"), [])
            item["file_ext"] = _file_ext_from_values(item.get("file_name"), item.get("file_path"))
            items.append(item)
        next_offset = safe_offset + len(items)
        has_more = next_offset < int(total)
        return {
            "total": int(total),
            "items": items,
            "limit": safe_limit,
            "offset": safe_offset,
            "has_more": bool(has_more),
            "next_offset": next_offset if has_more else None,
        }

    def _row_to_incident_item(self, row: Any) -> Dict[str, Any]:
        item = dict(row)
        item["matched_patterns"] = _json_loads(item.pop("matched_patterns_json", "[]"), [])
        item["file_ext"] = _file_ext_from_values(item.get("file_name"), item.get("file_path"))
        return item

    def list_incident_inbox_groups(
        self,
        *,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        branch: Optional[str] = None,
        q: Optional[str] = None,
        hostname: Optional[str] = None,
        source_kind: Optional[str] = None,
        file_ext: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        has_fragment: Optional[bool] = None,
        ack_by: Optional[str] = None,
        host_limit: int = 25,
        host_offset: int = 0,
        files_per_host: int = 25,
    ) -> Dict[str, Any]:
        where_clause, params = self._build_incident_where_clause(
            status=status,
            severity=severity,
            branch=branch,
            q=q,
            hostname=hostname,
            source_kind=source_kind,
            file_ext=file_ext,
            date_from=date_from,
            date_to=date_to,
            has_fragment=has_fragment,
            ack_by=ack_by,
        )
        safe_host_limit = max(1, min(100, int(host_limit)))
        safe_host_offset = max(0, int(host_offset))
        safe_files_per_host = max(1, min(100, int(files_per_host)))
        branch_needle = str(branch or "").strip().casefold()
        q_needle = str(q or "").strip().casefold()

        with self._lock, self._connect() as conn:
            total_incidents = conn.execute(
                f"""
                SELECT COUNT(*) as cnt
                FROM scan_incidents i
                LEFT JOIN scan_findings f ON f.id = i.finding_id
                LEFT JOIN scan_jobs j ON j.id = i.job_id
                {where_clause}
                """,
                params,
            ).fetchone()["cnt"]

            host_rows = conn.execute(
                f"""
                SELECT
                    i.hostname as hostname,
                    COUNT(*) as incidents_total,
                    SUM(CASE WHEN i.status='new' THEN 1 ELSE 0 END) as incidents_new,
                    MAX(i.created_at) as last_incident_at,
                    MAX(
                        CASE LOWER(i.severity)
                            WHEN 'high' THEN 3
                            WHEN 'medium' THEN 2
                            WHEN 'low' THEN 1
                            ELSE 0
                        END
                    ) as top_severity_rank,
                    COALESCE((
                        SELECT ix.branch
                        FROM scan_incidents ix
                        WHERE LOWER(ix.hostname) = LOWER(i.hostname)
                          AND TRIM(COALESCE(ix.branch, '')) <> ''
                        ORDER BY ix.created_at DESC
                        LIMIT 1
                    ), '') as branch,
                    COALESCE((
                        SELECT COALESCE(NULLIF(TRIM(ix.user_full_name), ''), NULLIF(TRIM(ix.user_login), ''), '')
                        FROM scan_incidents ix
                        WHERE LOWER(ix.hostname) = LOWER(i.hostname)
                          AND (
                            TRIM(COALESCE(ix.user_full_name, '')) <> ''
                            OR TRIM(COALESCE(ix.user_login, '')) <> ''
                          )
                        ORDER BY ix.created_at DESC
                        LIMIT 1
                    ), '') as user,
                    COALESCE((
                        SELECT a.ip_address
                        FROM scan_agents a
                        WHERE LOWER(a.hostname) = LOWER(i.hostname)
                          AND TRIM(COALESCE(a.ip_address, '')) <> ''
                        ORDER BY a.last_seen_at DESC
                        LIMIT 1
                    ), '') as ip_address
                FROM scan_incidents i
                LEFT JOIN scan_findings f ON f.id = i.finding_id
                LEFT JOIN scan_jobs j ON j.id = i.job_id
                {where_clause}
                GROUP BY i.hostname
                ORDER BY incidents_new DESC, top_severity_rank DESC, last_incident_at DESC, LOWER(i.hostname) ASC
                """,
                params,
            ).fetchall()

            hosts: List[Dict[str, Any]] = []
            for row in host_rows:
                host_name = str(row["hostname"] or "").strip()
                if not host_name:
                    continue
                host_entry = {
                    "id": f"host:{host_name}",
                    "hostname": host_name,
                    "branch": str(row["branch"] or "").strip(),
                    "user": str(row["user"] or "").strip(),
                    "ip_address": str(row["ip_address"] or "").strip(),
                    "incidents_total": int(row["incidents_total"] or 0),
                    "incidents_new": int(row["incidents_new"] or 0),
                    "last_incident_at": int(row["last_incident_at"] or 0),
                    "top_severity": _severity_label_from_rank(row["top_severity_rank"]),
                    "files": [],
                }
                if branch_needle and branch_needle not in host_entry["branch"].casefold():
                    continue
                if q_needle:
                    text = " ".join(
                        [
                            host_entry["hostname"],
                            host_entry["branch"],
                            host_entry["user"],
                            host_entry["ip_address"],
                        ]
                    ).casefold()
                    if q_needle not in text:
                        continue
                hosts.append(host_entry)

            total_hosts = len(hosts)
            paged_hosts = hosts[safe_host_offset:safe_host_offset + safe_host_limit]
            has_more = (safe_host_offset + len(paged_hosts)) < total_hosts

            for host_entry in paged_hosts:
                host_name = host_entry["hostname"]
                host_where = f"{where_clause} AND LOWER(i.hostname) = LOWER(?)" if where_clause else "WHERE LOWER(i.hostname) = LOWER(?)"
                host_params = [*params, host_name]
                file_rows = conn.execute(
                    f"""
                    SELECT
                        COALESCE(NULLIF(TRIM(i.file_path), ''), NULLIF(TRIM(j.file_name), ''), i.id) as file_key,
                        MAX(i.file_path) as file_path,
                        MAX(j.file_name) as file_name,
                        MAX(j.source_kind) as source_kind,
                        COUNT(*) as incidents_total,
                        SUM(CASE WHEN i.status='new' THEN 1 ELSE 0 END) as incidents_new,
                        MAX(i.created_at) as last_incident_at,
                        MAX(
                            CASE LOWER(i.severity)
                                WHEN 'high' THEN 3
                                WHEN 'medium' THEN 2
                                WHEN 'low' THEN 1
                                ELSE 0
                            END
                        ) as top_severity_rank
                    FROM scan_incidents i
                    LEFT JOIN scan_findings f ON f.id = i.finding_id
                    LEFT JOIN scan_jobs j ON j.id = i.job_id
                    {host_where}
                    GROUP BY file_key
                    ORDER BY incidents_new DESC, top_severity_rank DESC, last_incident_at DESC, LOWER(file_key) ASC
                    LIMIT ?
                    """,
                    [*host_params, safe_files_per_host],
                ).fetchall()

                files: List[Dict[str, Any]] = []
                for file_row in file_rows:
                    file_key = str(file_row["file_key"] or "").strip()
                    file_path = str(file_row["file_path"] or "").strip()
                    file_name = str(file_row["file_name"] or "").strip()
                    preview_row = conn.execute(
                        f"""
                        SELECT
                            i.*,
                            f.category,
                            f.short_reason,
                            f.matched_patterns_json,
                            j.source_kind,
                            j.file_name,
                            j.created_at as job_created_at
                        FROM scan_incidents i
                        LEFT JOIN scan_findings f ON f.id = i.finding_id
                        LEFT JOIN scan_jobs j ON j.id = i.job_id
                        {host_where}
                          AND COALESCE(NULLIF(TRIM(i.file_path), ''), NULLIF(TRIM(j.file_name), ''), i.id) = ?
                        ORDER BY i.created_at DESC
                        LIMIT 1
                        """,
                        [*host_params, file_key],
                    ).fetchone()
                    preview_incident = self._row_to_incident_item(preview_row) if preview_row is not None else None
                    patterns = preview_incident.get("matched_patterns") if preview_incident else []
                    files.append(
                        {
                            "id": f"file:{host_name}:{file_key}",
                            "host": host_name,
                            "file_key": file_key,
                            "file_path": file_path or file_name or file_key,
                            "file_name": file_name,
                            "file_ext": _file_ext_from_values(file_name, file_path),
                            "source_kind": str(file_row["source_kind"] or "").strip().lower(),
                            "incidents_total": int(file_row["incidents_total"] or 0),
                            "incidents_new": int(file_row["incidents_new"] or 0),
                            "last_incident_at": int(file_row["last_incident_at"] or 0),
                            "top_severity": _severity_label_from_rank(file_row["top_severity_rank"]),
                            "preview_incident": preview_incident,
                            "preview_incident_id": str((preview_incident or {}).get("id") or "").strip(),
                            "fragments": _top_fragments_from_patterns(patterns),
                        }
                    )
                host_entry["files"] = files

        return {
            "total_incidents": int(total_incidents),
            "total_hosts": int(total_hosts),
            "items": paged_hosts,
            "has_more": bool(has_more),
            "host_limit": safe_host_limit,
            "host_offset": safe_host_offset,
            "files_per_host": safe_files_per_host,
        }

    def bulk_ack_incidents(
        self,
        *,
        incident_ids: Optional[List[str]] = None,
        filters: Optional[Dict[str, Any]] = None,
        ack_by: str = "",
    ) -> Dict[str, Any]:
        now_ts = _now_ts()
        actor = str(ack_by or "").strip() or "web-user"
        ids = [str(item or "").strip() for item in (incident_ids or []) if str(item or "").strip()]
        filter_payload = filters if isinstance(filters, dict) else {}

        with self._lock, self._connect() as conn:
            if ids:
                placeholders = ",".join(["?"] * len(ids))
                total_matched = conn.execute(
                    f"SELECT COUNT(*) FROM scan_incidents WHERE id IN ({placeholders})",
                    ids,
                ).fetchone()[0]
                cursor = conn.execute(
                    f"""
                    UPDATE scan_incidents
                    SET status='ack', ack_at=?, ack_by=?
                    WHERE status='new' AND id IN ({placeholders})
                    """,
                    [now_ts, actor, *ids],
                )
                acked_count = cursor.rowcount if cursor.rowcount is not None else 0
            else:
                where_clause, params = self._build_incident_where_clause(
                    status=filter_payload.get("status"),
                    severity=filter_payload.get("severity"),
                    branch=filter_payload.get("branch"),
                    q=filter_payload.get("q"),
                    hostname=filter_payload.get("hostname"),
                    source_kind=filter_payload.get("source_kind"),
                    file_ext=filter_payload.get("file_ext"),
                    date_from=filter_payload.get("date_from"),
                    date_to=filter_payload.get("date_to"),
                    has_fragment=filter_payload.get("has_fragment"),
                    ack_by=filter_payload.get("ack_by"),
                )
                total_matched = conn.execute(
                    f"""
                    SELECT COUNT(*)
                    FROM scan_incidents i
                    LEFT JOIN scan_findings f ON f.id = i.finding_id
                    LEFT JOIN scan_jobs j ON j.id = i.job_id
                    {where_clause}
                    """,
                    params,
                ).fetchone()[0]
                ack_where = f"{where_clause} AND i.status='new'" if where_clause else "WHERE i.status='new'"
                rows = conn.execute(
                    f"""
                    SELECT i.id
                    FROM scan_incidents i
                    LEFT JOIN scan_findings f ON f.id = i.finding_id
                    LEFT JOIN scan_jobs j ON j.id = i.job_id
                    {ack_where}
                    """,
                    params,
                ).fetchall()
                ack_ids = [str(row["id"]) for row in rows]
                if ack_ids:
                    placeholders = ",".join(["?"] * len(ack_ids))
                    cursor = conn.execute(
                        f"""
                        UPDATE scan_incidents
                        SET status='ack', ack_at=?, ack_by=?
                        WHERE id IN ({placeholders})
                        """,
                        [now_ts, actor, *ack_ids],
                    )
                    acked_count = cursor.rowcount if cursor.rowcount is not None else len(ack_ids)
                else:
                    acked_count = 0
            conn.commit()

        return {"success": True, "acked_count": int(acked_count or 0), "total_matched": int(total_matched or 0)}

    def list_hosts(
        self,
        *,
        q: Optional[str] = None,
        branch: Optional[str] = None,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        return self._scan_host_read_store.list_hosts(
            q=q,
            branch=branch,
            status=status,
            severity=severity,
            limit=limit,
        )

    def list_hosts_table(
        self,
        *,
        q: Optional[str] = None,
        branch: Optional[str] = None,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: Optional[str] = None,
        sort_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._scan_host_read_store.list_hosts_table(
            q=q,
            branch=branch,
            status=status,
            severity=severity,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )

    def ack_incident(self, *, incident_id: str, ack_by: str) -> Optional[Dict[str, Any]]:
        iid = str(incident_id or "").strip()
        if not iid:
            return None
        now_ts = _now_ts()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT id, status FROM scan_incidents WHERE id=?",
                (iid,),
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                """
                UPDATE scan_incidents
                SET status='ack', ack_at=?, ack_by=?
                WHERE id=?
                """,
                (now_ts, str(ack_by or "").strip(), iid),
            )
            conn.commit()
        return {"id": iid, "status": "ack", "ack_at": now_ts}

    def list_host_scan_runs(self, *, hostname: str, limit: int = 30, offset: int = 0) -> Dict[str, Any]:
        return self._scan_host_read_store.list_host_scan_runs(hostname=hostname, limit=limit, offset=offset)

    def list_task_observations(
        self,
        *,
        task_id: str,
        limit: int = 200,
        offset: int = 0,
    ) -> Dict[str, Any]:
        return self._scan_host_read_store.list_task_observations(task_id=task_id, limit=limit, offset=offset)

    def get_scan_task_incident_report(self, *, task_id: str) -> Optional[Dict[str, Any]]:
        return self._scan_task_report_store.get_scan_task_incident_report(task_id=task_id)

    def list_agents(self) -> List[Dict[str, Any]]:
        return self._scan_agent_read_store.list_agents()

    def list_agents_activity(self, *, agent_ids: List[str]) -> Dict[str, Any]:
        return self._scan_agent_read_store.list_agents_activity(agent_ids=agent_ids)

    def list_agents_table(
        self,
        *,
        q: Optional[str] = None,
        branch: Optional[str] = None,
        online: Optional[str] = None,
        task_status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        sort_by: Optional[str] = None,
        sort_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._scan_agent_read_store.list_agents_table(
            q=q,
            branch=branch,
            online=online,
            task_status=task_status,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )

    def list_branches(self) -> List[str]:
        return self._scan_agent_read_store.list_branches()

    def dashboard(self) -> Dict[str, Any]:
        now_ts = _now_ts()
        day_seconds = 24 * 60 * 60
        window_start = now_ts - 29 * day_seconds
        with self._lock, self._connect() as conn:
            agents_total = conn.execute("SELECT COUNT(*) as c FROM scan_agents").fetchone()["c"]
            agents_online = conn.execute(
                "SELECT COUNT(*) as c FROM scan_agents WHERE last_seen_at >= ?",
                (now_ts - self.agent_online_timeout_sec,),
            ).fetchone()["c"]
            incidents_total = conn.execute(
                "SELECT COUNT(*) as c FROM scan_incidents",
            ).fetchone()["c"]
            incidents_new = conn.execute(
                "SELECT COUNT(*) as c FROM scan_incidents WHERE status='new'",
            ).fetchone()["c"]
            queue_active = conn.execute(
                """
                SELECT COUNT(*) as c
                FROM scan_tasks
                WHERE status IN ('queued', 'delivered', 'acknowledged') AND ttl_at > ?
                """,
                (now_ts,),
            ).fetchone()["c"]
            queue_expired = conn.execute(
                "SELECT COUNT(*) as c FROM scan_tasks WHERE status='expired'",
            ).fetchone()["c"]
            job_rows = conn.execute(
                """
                SELECT status, source_kind, COUNT(*) as c
                FROM scan_jobs
                GROUP BY status, source_kind
                """,
            ).fetchall()
            sev_rows = conn.execute(
                """
                SELECT severity, COUNT(*) as c
                FROM scan_incidents
                GROUP BY severity
                """,
            ).fetchall()
            branch_rows = conn.execute(
                """
                SELECT branch, COUNT(*) as c
                FROM scan_incidents
                GROUP BY branch
                ORDER BY c DESC
                LIMIT 10
                """
            ).fetchall()
            day_rows = conn.execute(
                """
                SELECT
                    DATE(created_at, 'unixepoch') as day_key,
                    COUNT(*) as c
                FROM scan_incidents
                WHERE created_at >= ?
                GROUP BY day_key
                ORDER BY day_key ASC
                """,
                (window_start,),
            ).fetchall()
            new_rows = conn.execute(
                """
                SELECT
                    COALESCE(NULLIF(TRIM(hostname), ''), 'unknown') as hostname,
                    MAX(created_at) as last_ts
                FROM scan_incidents
                WHERE status='new'
                GROUP BY COALESCE(NULLIF(TRIM(hostname), ''), 'unknown')
                ORDER BY last_ts DESC
                LIMIT 12
                """
            ).fetchall()
            ocr_timeout_jobs = conn.execute(
                """
                SELECT COUNT(*) AS c
                FROM scan_jobs
                WHERE error_text='OCR timeout'
                """
            ).fetchone()["c"]

        transient_stats = self.transient_pdf_spool_stats()
        daily_map = {str(row["day_key"]): int(row["c"] or 0) for row in day_rows}
        daily: List[Dict[str, Any]] = []
        start_day = window_start - (window_start % day_seconds)
        for idx in range(30):
            day_ts = start_day + idx * day_seconds
            day_key = time.strftime("%Y-%m-%d", time.gmtime(day_ts))
            daily.append({"date": day_key, "count": int(daily_map.get(day_key, 0))})

        job_counts: Dict[str, int] = {
            "queued": 0,
            "processing": 0,
            "done_clean": 0,
            "done_with_incident": 0,
            "failed": 0,
            "total": 0,
            "pdf_queued": 0,
            "pdf_processing": 0,
            "pdf_done_clean": 0,
            "pdf_done_with_incident": 0,
            "pdf_failed": 0,
            "pdf_total": 0,
            "text_queued": 0,
            "text_processing": 0,
        }
        for row in job_rows:
            status = str(row["status"] or "unknown").strip().lower() or "unknown"
            source_kind = str(row["source_kind"] or "unknown").strip().lower() or "unknown"
            count = int(row["c"] or 0)
            job_counts[status] = int(job_counts.get(status, 0)) + count
            job_counts["total"] += count
            if source_kind in {"pdf", "pdf_slice"}:
                key = f"pdf_{status}"
                job_counts[key] = int(job_counts.get(key, 0)) + count
                job_counts["pdf_total"] += count
            elif source_kind == "text":
                key = f"text_{status}"
                job_counts[key] = int(job_counts.get(key, 0)) + count

        job_counts["pending"] = int(job_counts.get("queued", 0)) + int(job_counts.get("processing", 0))
        job_counts["completed"] = int(job_counts.get("done_clean", 0)) + int(job_counts.get("done_with_incident", 0))
        job_counts["pdf_pending"] = int(job_counts.get("pdf_queued", 0)) + int(job_counts.get("pdf_processing", 0))
        job_counts["pdf_completed"] = int(job_counts.get("pdf_done_clean", 0)) + int(job_counts.get("pdf_done_with_incident", 0))

        return {
            "totals": {
                "agents_total": int(agents_total),
                "agents_online": int(agents_online),
                "agents_offline": int(max(0, agents_total - agents_online)),
                "incidents_total": int(incidents_total),
                "incidents_new": int(incidents_new),
                "queue_active": int(queue_active),
                "queue_expired": int(queue_expired),
                "server_queue_pending": int(job_counts["pending"]),
                "server_queue_queued": int(job_counts["queued"]),
                "server_queue_processing": int(job_counts["processing"]),
                "server_pdf_pending": int(job_counts["pdf_pending"]),
                "server_pdf_queued": int(job_counts["pdf_queued"]),
                "server_pdf_processing": int(job_counts["pdf_processing"]),
                "server_pdf_processed": int(job_counts["pdf_completed"]),
                "server_pdf_done_clean": int(job_counts["pdf_done_clean"]),
                "server_pdf_done_with_incident": int(job_counts["pdf_done_with_incident"]),
                "server_pdf_failed": int(job_counts["pdf_failed"]),
                "server_jobs_processed": int(job_counts["completed"]),
                "server_jobs_failed": int(job_counts["failed"]),
                "transient_pdf_count": int(transient_stats["count"]),
                "transient_pdf_gb": float(transient_stats["gb"]),
                "ocr_timeout_jobs": int(ocr_timeout_jobs or 0),
            },
            "job_queue": job_counts,
            "transient_pdf_spool": transient_stats,
            "by_severity": [{"severity": str(row["severity"] or "unknown"), "count": int(row["c"] or 0)} for row in sev_rows],
            "by_branch": [{"branch": str(row["branch"] or "Без филиала"), "count": int(row["c"] or 0)} for row in branch_rows],
            "daily": daily,
            "new_hosts": [str(row["hostname"] or "unknown") for row in new_rows],
        }

    def cleanup_retention(self, *, retention_days: int) -> Dict[str, int]:
        cutoff = _now_ts() - max(1, int(retention_days)) * 24 * 60 * 60
        with self._lock, self._connect() as conn:
            conn.execute(
                "DELETE FROM scan_tasks WHERE status IN ('completed', 'failed', 'expired') AND updated_at < ?",
                (cutoff,),
            )
            conn.execute("DELETE FROM scan_incidents WHERE created_at < ?", (cutoff,))
            conn.execute("DELETE FROM scan_findings WHERE created_at < ?", (cutoff,))
            conn.execute("DELETE FROM scan_jobs WHERE created_at < ?", (cutoff,))
            conn.commit()
        return {"artifact_rows": 0, "artifact_files": 0}
