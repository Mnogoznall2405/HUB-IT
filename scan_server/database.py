from __future__ import annotations

import base64
import copy
import json
import logging
import os
import random
import re
import sqlite3
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from agent_version import AGENT_VERSION

from .pattern_filters import expand_incident_pattern_filter
from .pdf_spool import PdfSpoolStore
from .pg_compat import NullLock, PgConnection, TimedLock
from .scan_agent_read_store import ScanAgentReadStore
from .scan_host_read_store import ScanHostReadStore
from .scan_task_report_store import ScanTaskIncidentReportStore
from .scan_view import InvalidScanView, normalize_scan_list_view

logger = logging.getLogger(__name__)

project_root = Path(__file__).resolve().parent.parent
web_root = project_root / "WEB-itinvent"
if web_root.exists() and str(web_root) not in sys.path:
    sys.path.insert(0, str(web_root))

ACTIVE_TASK_STATUSES = ("queued", "delivered", "acknowledged")
FINAL_TASK_STATUSES = ("completed", "failed", "expired")
PENDING_JOB_STATUSES = ("queued", "processing")
FINAL_JOB_STATUSES = ("done_clean", "done_with_incident", "analysis_incomplete", "failed")
# User-facing text written into scan_jobs.error_text; keep EN for legacy reopen matching.
MISSING_TRANSIENT_PDF_PAYLOAD = "Отсутствует временный файл PDF на сервере"
MISSING_TRANSIENT_PDF_PAYLOAD_MESSAGES = frozenset(
    {
        MISSING_TRANSIENT_PDF_PAYLOAD,
        "Missing transient PDF payload",
    }
)
_SQLITE_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# Hostnames / agent ids pasted into Scan Center search (ASCII labels, no spaces).
_HOSTNAME_LIKE_QUERY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,62}$")
_LIST_PATTERN_PREVIEW_LIMIT = 8
_LIST_PATTERN_VALUE_LIMIT = 120
# Short process-local read cache for expensive list endpoints (shared inventory data;
# not user-scoped). Invalidation is TTL-based; writes may lag up to TTL.
_READ_CACHE_LOCK = threading.Lock()
_READ_CACHE: Dict[str, Tuple[float, Any]] = {}
_READ_CACHE_TTL_SEC = 10.0
_READ_CACHE_MAX_ENTRIES = 64
# Per-key single-flight: identical cold misses share one heavy compute.
_READ_CACHE_INFLIGHT: Dict[str, threading.Event] = {}
_READ_CACHE_INFLIGHT_ERRORS: Dict[str, BaseException] = {}
# Test/gate counters (process-local).
_READ_CACHE_COMPUTE_COUNTS: Dict[str, int] = {}


def _load_dashboard_job_aggregates(
    conn,
    *,
    is_postgres: bool,
    performance_start: int,
) -> Tuple[List[Any], int, int]:
    """Load exact dashboard counters without forcing PostgreSQL into one heap scan."""

    if is_postgres:
        job_rows = conn.execute(
            """
            SELECT status, source_kind, COUNT(*) AS c
            FROM scan_jobs
            GROUP BY status, source_kind
            """
        ).fetchall()
        completed_row = conn.execute(
            f"""
            SELECT COUNT(*) AS c
            FROM scan_jobs
            WHERE status IN ({", ".join("?" for _ in FINAL_JOB_STATUSES)})
              AND finished_at >= ?
            """,
            [*FINAL_JOB_STATUSES, int(performance_start)],
        ).fetchone()
        ocr_timeout_row = conn.execute(
            """
            SELECT COUNT(*) AS c
            FROM scan_jobs
            WHERE error_text='OCR timeout'
            """
        ).fetchone()
        return (
            list(job_rows),
            int((completed_row["c"] if completed_row else 0) or 0),
            int((ocr_timeout_row["c"] if ocr_timeout_row else 0) or 0),
        )

    # SQLite performs better with one pass and does not have PostgreSQL's
    # visibility-map/index-only plan for the status/source aggregate.
    job_rows = conn.execute(
        f"""
        SELECT
            status,
            source_kind,
            COUNT(*) AS c,
            COALESCE(
                SUM(
                    CASE
                        WHEN status IN ({", ".join("?" for _ in FINAL_JOB_STATUSES)})
                         AND COALESCE(finished_at, 0) >= ?
                        THEN 1 ELSE 0
                    END
                ),
                0
            ) AS completed_24h_part,
            COALESCE(
                SUM(CASE WHEN error_text='OCR timeout' THEN 1 ELSE 0 END),
                0
            ) AS ocr_timeout_part
        FROM scan_jobs
        GROUP BY status, source_kind
        """,
        [*FINAL_JOB_STATUSES, int(performance_start)],
    ).fetchall()
    return (
        list(job_rows),
        sum(int(row["completed_24h_part"] or 0) for row in job_rows),
        sum(int(row["ocr_timeout_part"] or 0) for row in job_rows),
    )


def _read_cache_get(key: str) -> Optional[Any]:
    now = time.monotonic()
    with _READ_CACHE_LOCK:
        hit = _READ_CACHE.get(key)
        if not hit:
            return None
        ts, payload = hit
        if (now - ts) > _READ_CACHE_TTL_SEC:
            _READ_CACHE.pop(key, None)
            return None
        return copy.deepcopy(payload)


def _read_cache_set(key: str, payload: Any) -> None:
    with _READ_CACHE_LOCK:
        if len(_READ_CACHE) >= _READ_CACHE_MAX_ENTRIES:
            # Drop oldest entries.
            for old_key, _ in sorted(_READ_CACHE.items(), key=lambda item: item[1][0])[
                : max(1, _READ_CACHE_MAX_ENTRIES // 4)
            ]:
                _READ_CACHE.pop(old_key, None)
        _READ_CACHE[key] = (time.monotonic(), copy.deepcopy(payload))


def _read_cache_clear() -> None:
    """Process-local cache clear for gates/tests. Does not touch production processes."""
    with _READ_CACHE_LOCK:
        _READ_CACHE.clear()
        _READ_CACHE_INFLIGHT.clear()
        _READ_CACHE_INFLIGHT_ERRORS.clear()
        _READ_CACHE_COMPUTE_COUNTS.clear()


def _read_cache_compute_count(key: str) -> int:
    with _READ_CACHE_LOCK:
        return int(_READ_CACHE_COMPUTE_COUNTS.get(key, 0))


def _read_cache_single_flight(key: str, compute: Callable[[], Any]) -> Any:
    """Double-check locking + per-key in-flight wait. Errors are never cached."""
    cached = _read_cache_get(key)
    if cached is not None:
        return cached

    leader = False
    wait_event: Optional[threading.Event] = None
    with _READ_CACHE_LOCK:
        hit = _READ_CACHE.get(key)
        if hit is not None:
            ts, payload = hit
            if (time.monotonic() - ts) <= _READ_CACHE_TTL_SEC:
                return copy.deepcopy(payload)
            _READ_CACHE.pop(key, None)
        existing = _READ_CACHE_INFLIGHT.get(key)
        if existing is not None:
            wait_event = existing
        else:
            wait_event = threading.Event()
            _READ_CACHE_INFLIGHT[key] = wait_event
            _READ_CACHE_INFLIGHT_ERRORS.pop(key, None)
            leader = True

    if not leader:
        assert wait_event is not None
        wait_event.wait(timeout=120.0)
        cached = _read_cache_get(key)
        if cached is not None:
            return cached
        with _READ_CACHE_LOCK:
            err = _READ_CACHE_INFLIGHT_ERRORS.get(key)
        if err is not None:
            raise err
        # Leader failed without publishing — recompute (errors must not poison waiters forever).
        return _read_cache_single_flight(key, compute)

    try:
        payload = compute()
        _read_cache_set(key, payload)
        with _READ_CACHE_LOCK:
            _READ_CACHE_COMPUTE_COUNTS[key] = int(_READ_CACHE_COMPUTE_COUNTS.get(key, 0)) + 1
        return payload
    except BaseException as exc:
        with _READ_CACHE_LOCK:
            _READ_CACHE_INFLIGHT_ERRORS[key] = exc
        raise
    finally:
        with _READ_CACHE_LOCK:
            event = _READ_CACHE_INFLIGHT.pop(key, None)
            # Keep error briefly for waiters that just missed the event.set race, then drop.
            # Waiters already snapshot error above; clear so subsequent misses can retry.
            _READ_CACHE_INFLIGHT_ERRORS.pop(key, None)
        if event is not None:
            event.set()
_LIST_PATTERN_SNIPPET_LIMIT = 240
_SCAN_RUNTIME_COLUMNS = {
    "scan_jobs": {"event_id", "scan_task_id", "attempt_count", "metrics_json"},
    "scan_incidents": {"resolved_at", "resolved_reason", "resolved_by_task_id"},
    "scan_agents": {"outbox_depth", "dead_letter_depth", "last_ingest_ok_at"},
}


def _as_nonneg_int(value: Any, default: int = 0) -> int:
    try:
        return max(0, int(value))
    except Exception:
        return max(0, int(default or 0))


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


def _percentile(values: List[float], fraction: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(float(value) for value in values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * float(fraction))))
    return round(ordered[index], 1)


_DASHBOARD_PERFORMANCE_SAMPLE_LIMIT = 5000
_DASHBOARD_PENDING_SAMPLE_LIMIT = 2000
_SYSTEM_METRICS_DEFAULT_LIMIT = 1000
_SYSTEM_METRICS_DEFAULT_MAX_POINTS = 1000
_SCAN_RUN_RESULT_KEYS = (
    "scanned",
    "skipped",
    "queued",
    "deferred",
    "deduped",
    "deleted_from_state",
    "files_seen",
    "jobs_pending",
    "jobs_done_clean",
    "jobs_done_with_incident",
    "jobs_failed",
    "jobs_incomplete",
    "jobs_total",
    "outbox_pending",
    "force_rescan",
    "failed_job_errors",
    "error_text",
    "error",
    "message",
    "skipped_reasons",
    "unsupported",
    "excluded_by_extension",
)
_SCAN_RUN_PAYLOAD_KEYS = (
    "force_rescan",
    "server_pdf_pattern_ids",
    "agent_pattern_ids",
    "scan_extensions",
)


def _slim_mapping_keys(value: Any, keys: Iterable[str]) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    out: Dict[str, Any] = {}
    for key in keys:
        if key in value:
            out[key] = value[key]
    return out


def downsample_metric_points(items: List[Dict[str, Any]], max_points: int) -> List[Dict[str, Any]]:
    """Reduce dense time series while preserving first/last and local min/max peaks."""
    safe_max = max(2, int(max_points or 0))
    if len(items) <= safe_max:
        return items
    if safe_max == 2:
        return [items[0], items[-1]]

    bucket_count = max(1, safe_max // 2)
    bucket_size = max(1, (len(items) + bucket_count - 1) // bucket_count)
    selected: Dict[int, Dict[str, Any]] = {}

    def _metric(row: Dict[str, Any], key: str) -> float:
        try:
            return float(row.get(key) or 0.0)
        except Exception:
            return 0.0

    peak_keys = (
        "cpu_percent",
        "memory_percent",
        "disk_read_bps",
        "disk_write_bps",
        "network_sent_bps",
        "network_received_bps",
    )

    for bucket_idx in range(bucket_count):
        start = bucket_idx * bucket_size
        if start >= len(items):
            break
        chunk = items[start:start + bucket_size]
        if not chunk:
            continue
        for key in peak_keys:
            min_row = min(chunk, key=lambda row, metric=key: (_metric(row, metric), int(row.get("captured_at") or 0)))
            max_row = max(chunk, key=lambda row, metric=key: (_metric(row, metric), int(row.get("captured_at") or 0)))
            selected[int(min_row.get("captured_at") or 0)] = min_row
            selected[int(max_row.get("captured_at") or 0)] = max_row

    selected[int(items[0].get("captured_at") or 0)] = items[0]
    selected[int(items[-1].get("captured_at") or 0)] = items[-1]
    # Keep global extrema so later thinning cannot erase chart peaks.
    for key in peak_keys:
        min_row = min(items, key=lambda row, metric=key: (_metric(row, metric), int(row.get("captured_at") or 0)))
        max_row = max(items, key=lambda row, metric=key: (_metric(row, metric), int(row.get("captured_at") or 0)))
        selected[int(min_row.get("captured_at") or 0)] = min_row
        selected[int(max_row.get("captured_at") or 0)] = max_row
    ordered = [selected[key] for key in sorted(selected)]
    if len(ordered) <= safe_max:
        return ordered
    must_keep_rows: List[Dict[str, Any]] = [items[0], items[-1]]
    for key in peak_keys:
        must_keep_rows.append(min(items, key=lambda row, metric=key: (_metric(row, metric), int(row.get("captured_at") or 0))))
        must_keep_rows.append(max(items, key=lambda row, metric=key: (_metric(row, metric), int(row.get("captured_at") or 0))))
    must_map: Dict[int, Dict[str, Any]] = {}
    for row in must_keep_rows:
        must_map[int(row.get("captured_at") or 0)] = row
        if len(must_map) >= safe_max:
            break
    must_keep = set(must_map)
    keep_rows = list(must_map.values())
    remaining_slots = max(0, safe_max - len(keep_rows))
    fillers = [row for row in ordered if int(row.get("captured_at") or 0) not in must_keep]
    if remaining_slots and fillers:
        step = max(1, len(fillers) / float(remaining_slots))
        for idx in range(remaining_slots):
            source_idx = min(len(fillers) - 1, int(round(idx * step)))
            keep_rows.append(fillers[source_idx])
    keep_rows.sort(key=lambda row: int(row.get("captured_at") or 0))
    # Dedupe while preserving order.
    out: List[Dict[str, Any]] = []
    seen_ts: set[int] = set()
    for row in keep_rows:
        ts = int(row.get("captured_at") or 0)
        if ts in seen_ts:
            continue
        seen_ts.add(ts)
        out.append(row)
    return out[:safe_max] if len(out) > safe_max else out


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name, str(default)) or "").strip())
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.getenv(name, str(default)) or "").strip())
    except Exception:
        return float(default)


def _is_sqlite_busy_error(exc: BaseException) -> bool:
    text = str(exc or "").lower()
    return isinstance(exc, sqlite3.OperationalError) and (
        "database is locked" in text
        or "database table is locked" in text
        or "database is busy" in text
        or "busy" == text.strip()
    )


def _is_transient_db_error(exc: BaseException) -> bool:
    if _is_sqlite_busy_error(exc):
        return True
    text = str(exc or "").lower()
    return (
        "deadlock detected" in text
        or "lock_not_available" in text
        or "could not serialize" in text
        or "55p03" in text
        or "40p01" in text
    )


def _is_unique_violation(exc: BaseException) -> bool:
    """True for sqlite IntegrityError and PG unique violations (23505 / UniqueViolation).

    Used by queue_job / create_task race fallbacks so PG backends behave like SQLite
    when a covering unique index rejects a duplicate insert.
    """
    if isinstance(exc, sqlite3.IntegrityError):
        return True
    try:
        from sqlalchemy.exc import IntegrityError as SAIntegrityError

        if isinstance(exc, SAIntegrityError):
            return True
    except Exception:
        pass

    chain: List[BaseException] = []
    seen: set[int] = set()
    cur: Optional[BaseException] = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        chain.append(cur)
        cur = getattr(cur, "orig", None) or getattr(cur, "__cause__", None)  # type: ignore[assignment]

    for candidate in chain:
        pgcode = getattr(candidate, "pgcode", None) or getattr(candidate, "sqlstate", None)
        if str(pgcode or "") == "23505":
            return True
        name = type(candidate).__name__
        if name in {"UniqueViolation", "IntegrityError"} and not isinstance(candidate, OSError):
            module = str(getattr(type(candidate), "__module__", "") or "")
            if "psycopg" in module or "sqlite3" in module or "sqlalchemy" in module:
                return True
            if name == "UniqueViolation":
                return True

    text = str(exc or "").lower()
    return "unique" in text and ("violat" in text or "constraint" in text or "duplicate key" in text)


def _strip_null_chars(value: Any) -> Any:
    """Remove NUL chars so PostgreSQL can cast stored JSON to jsonb later."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, list):
        return [_strip_null_chars(item) for item in value]
    if isinstance(value, dict):
        return {key: _strip_null_chars(item) for key, item in value.items()}
    return value


def _json_dumps(value: Any) -> str:
    return json.dumps(_strip_null_chars(value), ensure_ascii=False)


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


def looks_like_hostname_query(value: Any) -> bool:
    """True when q looks like a hostname/agent id (fast path, no JSON scan).

    Avoid treating hyphenated file basenames (e.g. unique-secret-name) as hosts:
    require a digit, a dot (FQDN), or a short site-style prefix (TMN-PC…).
    IPv4 text and partial IPv4 prefixes must stay on the general search path,
    where Scan Center also checks the resolved IP address.
    """
    text = str(value or "").strip()
    if len(text) < 3 or len(text) > 63:
        return False
    if not _HOSTNAME_LIKE_QUERY_RE.fullmatch(text):
        return False
    if "." in text and all(ch.isdigit() or ch == "." for ch in text):
        return False
    if any(ch.isdigit() for ch in text) or "." in text:
        return True
    # Site-style labels without digits (TMN-PC, MSK-NB). Reject file stems like first-secret.
    return bool(re.match(r"^[A-Za-z]{2,5}-(?:PC|NB|WS|LT|SRV|VM)(?:[-A-Za-z0-9]*)?$", text, re.IGNORECASE))


def _slim_matched_patterns_for_list(patterns: Any) -> List[Dict[str, Any]]:
    """Keep list payloads small: pattern ids/names + short value/snippet only."""
    if not isinstance(patterns, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in patterns[:_LIST_PATTERN_PREVIEW_LIMIT]:
        if not isinstance(item, dict):
            continue
        pattern_id = str(item.get("pattern") or item.get("pattern_id") or "").strip()
        pattern_name = str(item.get("pattern_name") or pattern_id or "").strip()
        slim: Dict[str, Any] = {
            "pattern": pattern_id,
            "pattern_name": pattern_name or pattern_id,
        }
        value = str(item.get("value") or "").strip()
        if value:
            slim["value"] = value[:_LIST_PATTERN_VALUE_LIMIT]
        snippet = str(item.get("snippet") or "").strip()
        if snippet:
            slim["snippet"] = snippet[:_LIST_PATTERN_SNIPPET_LIMIT]
        out.append(slim)
    return out


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
        sqlite_busy_timeout_ms: Optional[int] = None,
        sqlite_busy_retry_attempts: Optional[int] = None,
        sqlite_busy_retry_base_ms: Optional[int] = None,
        database_url: str = "",
    ) -> None:
        self.db_path = Path(db_path)
        self.database_url = str(database_url or "").strip()
        self.backend = "postgres" if self.database_url else "sqlite"
        self._pg_engine = None
        self.archive_dir = Path(archive_dir)
        self.transient_dir = self.db_path.parent / "transient_jobs"
        self._pdf_spool = PdfSpoolStore(self.transient_dir)
        self.task_ack_timeout_sec = int(task_ack_timeout_sec)
        self.agent_online_timeout_sec = max(30, int(agent_online_timeout_sec))
        self.resolve_agent_sql_context = bool(resolve_agent_sql_context)
        self.job_processing_timeout_sec = max(60, int(job_processing_timeout_sec or 1800))
        self.sqlite_busy_timeout_ms = max(
            1000,
            min(
                300000,
                int(
                    sqlite_busy_timeout_ms
                    if sqlite_busy_timeout_ms is not None
                    else _env_int("SCAN_SQLITE_BUSY_TIMEOUT_MS", 30000)
                ),
            ),
        )
        self.sqlite_busy_retry_attempts = max(
            1,
            min(
                20,
                int(
                    sqlite_busy_retry_attempts
                    if sqlite_busy_retry_attempts is not None
                    else _env_int("SCAN_SQLITE_BUSY_RETRY_ATTEMPTS", 5)
                ),
            ),
        )
        self.sqlite_busy_retry_base_ms = max(
            10,
            min(
                5000,
                int(
                    sqlite_busy_retry_base_ms
                    if sqlite_busy_retry_base_ms is not None
                    else _env_int("SCAN_SQLITE_BUSY_RETRY_BASE_MS", 100)
                ),
            ),
        )
        # Process-wide RLock for both backends this release: several write paths still use
        # check-then-write still relies on unique indexes + race fallback via _is_unique_violation
        # (sqlite IntegrityError and PG 23505 / UniqueViolation).
        # TimedLock records wait/hold for optional timing headers.
        # SCAN_STORE_LOCK_MODE=null is a fail-closed-off stub for measured experiments only
        # (default/unknown → rlock). Do not enable in production without S1/S2 metrics + race fixes.
        lock_mode = str(os.getenv("SCAN_STORE_LOCK_MODE", "rlock") or "rlock").strip().lower()
        if lock_mode == "null":
            raw_lock = NullLock()
            self._lock_kind = "null"
        else:
            raw_lock = threading.RLock()
            self._lock_kind = "rlock"
        self._lock = TimedLock(raw_lock)
        # Short TTL caches for ingest backpressure hot path (2–5s).
        self._counts_cache_ttl_sec = max(2.0, min(5.0, _env_float("SCAN_JOB_COUNTS_CACHE_TTL_SEC", 3.0)))
        self._counts_cache_lock = threading.Lock()
        self._job_status_counts_cache: Optional[Tuple[float, Dict[str, int]]] = None
        self._pdf_job_status_counts_cache: Optional[Tuple[float, Dict[str, int]]] = None
        # Reconcile debounce: skip heavy job-count UPDATE unless force / TTL / every N jobs.
        self._reconcile_debounce_sec = max(1.0, min(2.0, _env_float("SCAN_RECONCILE_DEBOUNCE_SEC", 1.5)))
        self._reconcile_every_n_jobs = max(5, min(100, _env_int("SCAN_RECONCILE_EVERY_N_JOBS", 25)))
        self._reconcile_meta_lock = threading.Lock()
        self._reconcile_last_mono: Dict[str, float] = {}
        self._reconcile_pending_jobs: Dict[str, int] = {}
        # Light presence touch throttle (ingest/poll/result): ≤1 / 30s per agent.
        self._touch_throttle_sec = max(5.0, min(60.0, _env_float("SCAN_TOUCH_THROTTLE_SEC", 30.0)))
        self._touch_throttle_lock = threading.Lock()
        self._touch_last_mono: Dict[str, float] = {}
        if self.backend == "postgres":
            from .db import get_scan_engine

            self._pg_engine = get_scan_engine(self.database_url)
        self._scan_agent_read_store = ScanAgentReadStore(
            lock=self._lock,
            connect=self._connect,
            serialize_task_row=self._serialize_task_row,
            now=_now_ts,
            agent_online_timeout_sec=lambda: self.agent_online_timeout_sec,
            resolve_agent_sql_context_enabled=lambda: self.resolve_agent_sql_context,
            resolve_agent_sql_context=lambda mac_address, hostname: _resolve_agent_sql_context(mac_address, hostname),
            is_postgres=lambda: self.is_postgres,
        )
        self._scan_host_read_store = ScanHostReadStore(
            lock=self._lock,
            connect=self._connect,
            serialize_task_row=self._serialize_task_row,
            now=_now_ts,
            is_postgres=lambda: self.is_postgres,
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

    @property
    def is_postgres(self) -> bool:
        return self.backend == "postgres"

    def _connect(self):
        if self.is_postgres:
            assert self._pg_engine is not None
            return PgConnection(self._pg_engine)
        busy_timeout_ms = int(self.sqlite_busy_timeout_ms)
        conn = sqlite3.connect(
            self.db_path,
            timeout=max(1.0, busy_timeout_ms / 1000.0),
            check_same_thread=False,
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute(f"PRAGMA busy_timeout={busy_timeout_ms};")
        return conn

    def _run_write_transaction(self, context: str, operation):
        attempts = max(1, int(self.sqlite_busy_retry_attempts or 1))
        base_ms = max(10, int(self.sqlite_busy_retry_base_ms or 100))
        for attempt in range(1, attempts + 1):
            try:
                return operation()
            except Exception as exc:
                if not _is_transient_db_error(exc) or attempt >= attempts:
                    raise
                delay_ms = min(30000, base_ms * (2 ** (attempt - 1)))
                delay_ms += random.randint(0, base_ms)
                logger.warning(
                    "DB busy during %s (%s); retry %s/%s in %sms",
                    context,
                    self.backend,
                    attempt,
                    attempts,
                    delay_ms,
                )
                time.sleep(delay_ms / 1000.0)

    def _ensure_schema(self) -> None:
        if self.is_postgres:
            from .db import ensure_scan_schema

            ensure_scan_schema(self._pg_engine)
            with self._lock, self._connect() as conn:
                cursor_tasks = conn.execute(
                    "UPDATE scan_tasks SET status='queued', delivered_at=NULL WHERE status='delivered'"
                )
                if cursor_tasks.rowcount > 0:
                    logger.info(
                        "Found and reset %d stuck scan tasks from 'delivered' to 'queued'",
                        cursor_tasks.rowcount,
                    )
                self._reconcile_scan_tasks_locked(conn)
                conn.commit()
            return

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

                CREATE TABLE IF NOT EXISTS scan_task_system_metrics (
                    scan_task_id TEXT NOT NULL,
                    captured_at INTEGER NOT NULL,
                    cpu_percent REAL NOT NULL DEFAULT 0,
                    memory_percent REAL NOT NULL DEFAULT 0,
                    memory_used_bytes INTEGER NOT NULL DEFAULT 0,
                    memory_available_bytes INTEGER NOT NULL DEFAULT 0,
                    disk_read_bytes INTEGER NOT NULL DEFAULT 0,
                    disk_write_bytes INTEGER NOT NULL DEFAULT 0,
                    disk_read_bps REAL NOT NULL DEFAULT 0,
                    disk_write_bps REAL NOT NULL DEFAULT 0,
                    network_sent_bytes INTEGER NOT NULL DEFAULT 0,
                    network_received_bytes INTEGER NOT NULL DEFAULT 0,
                    network_sent_bps REAL NOT NULL DEFAULT 0,
                    network_received_bps REAL NOT NULL DEFAULT 0,
                    process_rss_bytes INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (scan_task_id, captured_at)
                );

                CREATE INDEX IF NOT EXISTS idx_scan_task_system_metrics_captured
                    ON scan_task_system_metrics(captured_at);

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
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    metrics_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE INDEX IF NOT EXISTS idx_scan_jobs_status_created
                    ON scan_jobs(status, created_at);

                CREATE INDEX IF NOT EXISTS idx_scan_jobs_agent_status_created
                    ON scan_jobs(agent_id, status, created_at);

                CREATE INDEX IF NOT EXISTS idx_scan_jobs_agent_created
                    ON scan_jobs(agent_id, created_at);

                CREATE INDEX IF NOT EXISTS idx_scan_jobs_created_at
                    ON scan_jobs(created_at);

                CREATE INDEX IF NOT EXISTS idx_scan_jobs_finished_at
                    ON scan_jobs(finished_at);

                CREATE INDEX IF NOT EXISTS idx_scan_jobs_status_source_kind
                    ON scan_jobs(status, source_kind);

                CREATE INDEX IF NOT EXISTS idx_scan_jobs_error_text
                    ON scan_jobs(error_text);

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

                CREATE INDEX IF NOT EXISTS idx_scan_incidents_severity
                    ON scan_incidents(severity);

                CREATE INDEX IF NOT EXISTS idx_scan_incidents_hostname_status_created
                    ON scan_incidents(hostname, status, created_at DESC);

                CREATE INDEX IF NOT EXISTS idx_scan_incidents_status_hostname_created
                    ON scan_incidents(status, hostname, created_at DESC);

                CREATE INDEX IF NOT EXISTS idx_scan_incidents_hostname_lower_created
                    ON scan_incidents(LOWER(hostname), created_at DESC);

                CREATE INDEX IF NOT EXISTS idx_scan_incidents_job
                    ON scan_incidents(job_id);

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

                CREATE INDEX IF NOT EXISTS idx_scan_observations_linked_job
                    ON scan_task_file_observations(linked_job_id)
                    WHERE linked_job_id <> '';

                CREATE INDEX IF NOT EXISTS idx_scan_observations_linked_incident
                    ON scan_task_file_observations(linked_incident_id)
                    WHERE linked_incident_id <> '';

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
                table_name="scan_jobs",
                column_name="metrics_json",
                ddl="ALTER TABLE scan_jobs ADD COLUMN metrics_json TEXT NOT NULL DEFAULT '{}'",
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
            self._ensure_column(
                conn,
                table_name="scan_agents",
                column_name="outbox_depth",
                ddl="ALTER TABLE scan_agents ADD COLUMN outbox_depth INTEGER NOT NULL DEFAULT 0",
            )
            self._ensure_column(
                conn,
                table_name="scan_agents",
                column_name="dead_letter_depth",
                ddl="ALTER TABLE scan_agents ADD COLUMN dead_letter_depth INTEGER NOT NULL DEFAULT 0",
            )
            self._ensure_column(
                conn,
                table_name="scan_agents",
                column_name="last_ingest_ok_at",
                ddl="ALTER TABLE scan_agents ADD COLUMN last_ingest_ok_at INTEGER NOT NULL DEFAULT 0",
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

    def _ensure_column(self, conn, *, table_name: str, column_name: str, ddl: str) -> None:
        if self.is_postgres:
            return
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

    def _get_counts_cache(self, slot: str) -> Optional[Dict[str, int]]:
        now = time.monotonic()
        with self._counts_cache_lock:
            hit = self._pdf_job_status_counts_cache if slot == "pdf" else self._job_status_counts_cache
            if not hit:
                return None
            ts, payload = hit
            if (now - ts) > self._counts_cache_ttl_sec:
                if slot == "pdf":
                    self._pdf_job_status_counts_cache = None
                else:
                    self._job_status_counts_cache = None
                return None
            return dict(payload)

    def _set_counts_cache(self, slot: str, payload: Dict[str, int]) -> None:
        stamped = (time.monotonic(), dict(payload))
        with self._counts_cache_lock:
            if slot == "pdf":
                self._pdf_job_status_counts_cache = stamped
            else:
                self._job_status_counts_cache = stamped

    def pdf_job_status_counts(self) -> Dict[str, int]:
        cached = self._get_counts_cache("pdf")
        if cached is not None:
            return cached
        counts: Dict[str, int] = {
            "pdf_queued": 0,
            "pdf_processing": 0,
            "pdf_done_clean": 0,
            "pdf_done_with_incident": 0,
            "pdf_failed": 0,
            "pdf_analysis_incomplete": 0,
            "pdf_total": 0,
            "pdf_pending": 0,
            "pdf_completed": 0,
        }
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT status, COUNT(*) AS c
                FROM scan_jobs
                WHERE source_kind IN ('pdf', 'pdf_slice', 'image', 'office')
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
        self._set_counts_cache("pdf", counts)
        return counts

    def job_status_counts(self) -> Dict[str, int]:
        """Pending/total job counts across *all* source kinds (pdf and non-pdf)."""
        cached = self._get_counts_cache("jobs")
        if cached is not None:
            return cached
        counts: Dict[str, int] = {
            "queued": 0,
            "processing": 0,
            "total": 0,
            "pending": 0,
        }
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) AS c FROM scan_jobs GROUP BY status"
            ).fetchall()
        for row in rows:
            job_status = str(row["status"] or "unknown").strip().lower() or "unknown"
            count = int(row["c"] or 0)
            counts[job_status] = int(counts.get(job_status, 0)) + count
            counts["total"] += count
        counts["pending"] = int(counts.get("queued", 0)) + int(counts.get("processing", 0))
        self._set_counts_cache("jobs", counts)
        return counts

    def ingest_backpressure_status(
        self,
        *,
        max_pending_pdf_jobs: int,
        transient_max_gb: float,
        max_pending_jobs: Optional[int] = None,
        retry_after_base_sec: int = 60,
        retry_after_max_sec: int = 600,
        pdf_queued: Optional[int] = None,
        pdf_processing: Optional[int] = None,
        total_pending: Optional[int] = None,
        spool: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        # Prefer caller-provided counters (e.g. dashboard job_queue) to avoid a second
        # full scan_jobs GROUP BY on the cold dashboard path.
        if pdf_queued is None or pdf_processing is None:
            counts = self.pdf_job_status_counts()
            pdf_queued_v = int(counts["pdf_queued"])
            pdf_processing_v = int(counts["pdf_processing"])
            pdf_pending = int(counts["pdf_pending"])
        else:
            pdf_queued_v = int(pdf_queued or 0)
            pdf_processing_v = int(pdf_processing or 0)
            pdf_pending = pdf_queued_v + pdf_processing_v
        spool_v = spool if isinstance(spool, dict) else self.transient_pdf_spool_stats()
        pending_limit = max(1, int(max_pending_pdf_jobs or 1))
        transient_limit_gb = max(0.1, float(transient_max_gb or 0.1))
        pending_ratio = pdf_pending / pending_limit
        transient_ratio = float(spool_v.get("gb") or 0.0) / transient_limit_gb if transient_limit_gb else 0.0

        reasons: List[str] = []
        if pdf_pending >= pending_limit:
            reasons.append("pdf_pending_limit")
        if float(spool_v.get("gb") or 0.0) >= transient_limit_gb:
            reasons.append("transient_size_limit")

        # General (all source kinds) queue-depth check, used to also throttle
        # non-PDF ingest instead of only guarding the PDF/OCR pipeline.
        if total_pending is None:
            total_counts = self.job_status_counts()
            total_pending_v = int(total_counts["pending"])
        else:
            total_pending_v = int(total_pending or 0)
        total_limit = max(1, int(max_pending_jobs)) if max_pending_jobs else None
        total_ratio = (total_pending_v / total_limit) if total_limit else 0.0
        total_reasons: List[str] = []
        if total_limit is not None and total_pending_v >= total_limit:
            total_reasons.append("total_pending_limit")

        overload_ratio = max([1.0] + [pending_ratio, transient_ratio, total_ratio])
        base_sec = max(1, int(retry_after_base_sec))
        max_sec = max(base_sec, int(retry_after_max_sec))
        retry_after_sec = int(min(max_sec, round(base_sec * overload_ratio)))

        return {
            "active": bool(reasons),
            "reasons": reasons,
            "pdf_pending": pdf_pending,
            "pdf_queued": pdf_queued_v,
            "pdf_processing": pdf_processing_v,
            "max_pending_pdf_jobs": pending_limit,
            "transient": spool_v,
            "transient_max_gb": transient_limit_gb,
            "total_active": bool(total_reasons),
            "total_reasons": total_reasons,
            "total_pending": total_pending_v,
            "max_pending_jobs": total_limit,
            "retry_after_sec": retry_after_sec,
        }

    def reconcile_job_pdf_spool(self) -> Dict[str, int]:
        now_ts = _now_ts()

        def _write() -> Dict[str, int]:
            removed_orphan = 0
            removed_final = 0
            failed_jobs = 0
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
                    and str(row["source_kind"] or "").strip().lower() in {"pdf_slice", "image", "office"}
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
                        SET status='analysis_incomplete', finished_at=?, error_text=?
                        WHERE id=?
                        """,
                        (now_ts, MISSING_TRANSIENT_PDF_PAYLOAD, job_id),
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

        return self._run_write_transaction("reconcile_job_pdf_spool", _write)

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
        return tid

    def _scan_task_job_counts(self, conn: sqlite3.Connection, task_id: str) -> Dict[str, int]:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS jobs_total,
                SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS jobs_pending,
                SUM(CASE WHEN status = 'done_clean' THEN 1 ELSE 0 END) AS jobs_done_clean,
                SUM(CASE WHEN status = 'done_with_incident' THEN 1 ELSE 0 END) AS jobs_done_with_incident,
                SUM(CASE WHEN status = 'analysis_incomplete' THEN 1 ELSE 0 END) AS jobs_incomplete,
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
                "jobs_incomplete": 0,
                "jobs_failed": 0,
            }
        return {
            "jobs_total": int(row["jobs_total"] or 0),
            "jobs_pending": int(row["jobs_pending"] or 0),
            "jobs_done_clean": int(row["jobs_done_clean"] or 0),
            "jobs_done_with_incident": int(row["jobs_done_with_incident"] or 0),
            "jobs_incomplete": int(row["jobs_incomplete"] or 0),
            "jobs_failed": int(row["jobs_failed"] or 0),
        }

    def _should_skip_reconcile(self, task_id: str, *, force: bool) -> bool:
        if force:
            with self._reconcile_meta_lock:
                self._reconcile_last_mono[task_id] = time.monotonic()
                self._reconcile_pending_jobs[task_id] = 0
            return False
        now_m = time.monotonic()
        with self._reconcile_meta_lock:
            pending = int(self._reconcile_pending_jobs.get(task_id, 0)) + 1
            self._reconcile_pending_jobs[task_id] = pending
            last = float(self._reconcile_last_mono.get(task_id, 0.0) or 0.0)
            if (now_m - last) < self._reconcile_debounce_sec and pending < self._reconcile_every_n_jobs:
                return True
            self._reconcile_last_mono[task_id] = now_m
            self._reconcile_pending_jobs[task_id] = 0
            return False

    def _reconcile_scan_task_progress_locked(
        self,
        conn: sqlite3.Connection,
        task_id: str,
        *,
        now_ts: Optional[int] = None,
        force: bool = False,
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
        # Final / force paths always run; hot ingest path may debounce.
        if status_value not in FINAL_TASK_STATUSES and self._should_skip_reconcile(tid, force=force):
            return None
        if status_value in FINAL_TASK_STATUSES:
            self._should_skip_reconcile(tid, force=True)

        current_result = _json_loads(row["result_json"], {})
        if not isinstance(current_result, dict):
            current_result = {}
        counts = self._scan_task_job_counts(conn, tid)
        if status_value in FINAL_TASK_STATUSES:
            phase = str(current_result.get("phase") or status_value).strip().lower() or status_value
            return {"status": status_value, "phase": phase, **counts}

        merged_result = dict(current_result)
        merged_result.update(counts)
        merged_result["clean"] = int(current_result.get("local_clean", current_result.get("clean", 0)) or 0) + int(
            counts.get("jobs_done_clean") or 0
        )
        merged_result["incidents"] = int(counts.get("jobs_done_with_incident") or 0)
        merged_result["incomplete"] = max(
            int(current_result.get("local_incomplete", current_result.get("incomplete", 0)) or 0),
            int(counts.get("jobs_incomplete") or 0) + int(counts.get("jobs_failed") or 0),
        )

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

        next_status = status_value
        next_error = str(row["error_text"] or "").strip() or None
        next_completed_at = None
        stale_before = update_now = int(now_ts or _now_ts())
        local_scan_stale_before = stale_before - self.task_ack_timeout_sec
        ingest_complete = merged_result.get("ingest_complete") is True
        legacy_ingest_complete = "ingest_complete" not in merged_result and phase in {"server_processing", "completed"}
        if (
            status_value == "acknowledged"
            and phase in {"server_processing", "completed"}
            and (ingest_complete or legacy_ingest_complete)
        ):
            if counts["jobs_failed"] > 0 or counts["jobs_incomplete"] > 0:
                next_status = "failed"
                phase = "failed"
                next_error = "Linked scan jobs are incomplete or failed"
                next_completed_at = int(now_ts or _now_ts())
            elif counts["jobs_pending"] == 0 and (counts["jobs_total"] > 0 or phase == "completed"):
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
            self._reconcile_scan_task_progress_locked(
                conn, str(row["id"] or ""), now_ts=now_ts, force=True
            )

    def upsert_agent_heartbeat(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        agent_id = str(payload.get("agent_id") or "").strip()
        hostname = str(payload.get("hostname") or "").strip()
        if not agent_id:
            agent_id = hostname or f"agent-{uuid.uuid4().hex[:8]}"
        now_ts = _now_ts()
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        has_outbox = "outbox_depth" in metadata or "outbox_depth" in payload
        has_dead = "dead_letter_depth" in metadata or "dead_letter_depth" in payload
        has_ingest_ok = "last_ingest_ok_at" in metadata or "last_ingest_ok_at" in payload
        outbox_depth = _as_nonneg_int(metadata.get("outbox_depth", payload.get("outbox_depth")), 0) if has_outbox else None
        dead_letter_depth = (
            _as_nonneg_int(metadata.get("dead_letter_depth", payload.get("dead_letter_depth")), 0) if has_dead else None
        )
        last_ingest_ok_at = (
            _as_nonneg_int(metadata.get("last_ingest_ok_at", payload.get("last_ingest_ok_at")), 0)
            if has_ingest_ok
            else None
        )
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
            "outbox_depth": 0 if outbox_depth is None else outbox_depth,
            "dead_letter_depth": 0 if dead_letter_depth is None else dead_letter_depth,
            "last_ingest_ok_at": 0 if last_ingest_ok_at is None else last_ingest_ok_at,
        }
        def _write() -> None:
            with self._lock, self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO scan_agents(
                        agent_id, hostname, branch, ip_address, version, status, last_seen_at,
                        last_heartbeat_json, updated_at, outbox_depth, dead_letter_depth, last_ingest_ok_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (agent_id) DO UPDATE SET
                        hostname=excluded.hostname,
                        branch=excluded.branch,
                        ip_address=excluded.ip_address,
                        version=excluded.version,
                        status=excluded.status,
                        last_seen_at=excluded.last_seen_at,
                        last_heartbeat_json=excluded.last_heartbeat_json,
                        updated_at=excluded.updated_at,
                        outbox_depth=CASE WHEN ? <> 0 THEN excluded.outbox_depth ELSE scan_agents.outbox_depth END,
                        dead_letter_depth=CASE WHEN ? <> 0 THEN excluded.dead_letter_depth ELSE scan_agents.dead_letter_depth END,
                        last_ingest_ok_at=CASE WHEN ? <> 0 THEN excluded.last_ingest_ok_at ELSE scan_agents.last_ingest_ok_at END
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
                        row["outbox_depth"],
                        row["dead_letter_depth"],
                        row["last_ingest_ok_at"],
                        1 if has_outbox else 0,
                        1 if has_dead else 0,
                        1 if has_ingest_ok else 0,
                    ),
                )
                conn.commit()

        self._run_write_transaction("upsert_agent_heartbeat", _write)
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
        """Light presence bump for ingest/poll/result.

        Updates scalar last_seen_at (+ optional hostname/branch/ip/status) without
        rewriting last_heartbeat_json. Full JSON updates stay on upsert_agent_heartbeat
        (heartbeat endpoint). Throttled to ≤1 write / SCAN_TOUCH_THROTTLE_SEC per agent.
        """
        normalized_agent_id = str(agent_id or "").strip()
        if not normalized_agent_id:
            return None
        now_m = time.monotonic()
        with self._touch_throttle_lock:
            last = float(self._touch_last_mono.get(normalized_agent_id, 0.0) or 0.0)
            if last and (now_m - last) < self._touch_throttle_sec:
                return None
            self._touch_last_mono[normalized_agent_id] = now_m

        now_ts = _now_ts()
        next_hostname = str(hostname or "").strip()
        next_branch = str(branch or "").strip()
        next_ip = str(ip_address or "").strip()
        next_status = str(status or "online").strip() or "online"
        # metadata is accepted for API compatibility but not persisted on the light path
        # (avoids read-modify-write of last_heartbeat_json on hot ingest/poll).
        _ = metadata

        def _write() -> Dict[str, Any]:
            with self._lock, self._connect() as conn:
                row = conn.execute(
                    """
                    SELECT agent_id, hostname, branch, ip_address, status, last_seen_at
                    FROM scan_agents
                    WHERE agent_id=?
                    LIMIT 1
                    """,
                    (normalized_agent_id,),
                ).fetchone()
                if row is None:
                    conn.execute(
                        """
                        INSERT INTO scan_agents(
                            agent_id, hostname, branch, ip_address, version, status, last_seen_at,
                            last_heartbeat_json, updated_at, outbox_depth, dead_letter_depth, last_ingest_ok_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
                        """,
                        (
                            normalized_agent_id,
                            next_hostname or normalized_agent_id,
                            next_branch,
                            next_ip,
                            "",
                            next_status,
                            now_ts,
                            "{}",
                            now_ts,
                        ),
                    )
                    conn.commit()
                    return {
                        "agent_id": normalized_agent_id,
                        "hostname": next_hostname or normalized_agent_id,
                        "branch": next_branch,
                        "ip_address": next_ip,
                        "status": next_status,
                        "last_seen_at": now_ts,
                    }
                conn.execute(
                    """
                    UPDATE scan_agents
                    SET last_seen_at=?,
                        updated_at=?,
                        hostname=CASE WHEN ? <> '' THEN ? ELSE hostname END,
                        branch=CASE WHEN ? <> '' THEN ? ELSE branch END,
                        ip_address=CASE WHEN ? <> '' THEN ? ELSE ip_address END,
                        status=CASE WHEN ? <> '' THEN ? ELSE status END
                    WHERE agent_id=?
                    """,
                    (
                        now_ts,
                        now_ts,
                        next_hostname,
                        next_hostname,
                        next_branch,
                        next_branch,
                        next_ip,
                        next_ip,
                        next_status,
                        next_status,
                        normalized_agent_id,
                    ),
                )
                conn.commit()
                return {
                    "agent_id": normalized_agent_id,
                    "hostname": next_hostname or str(row["hostname"] or ""),
                    "branch": next_branch or str(row["branch"] or ""),
                    "ip_address": next_ip or str(row["ip_address"] or ""),
                    "status": next_status or str(row["status"] or "online"),
                    "last_seen_at": now_ts,
                }

        return self._run_write_transaction("touch_agent_presence", _write)

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
        if command not in {"ping", "scan_now", "self_update"}:
            raise ValueError("command must be one of: ping, scan_now, self_update")

        now_ts = _now_ts()
        ttl_at = now_ts + max(1, int(ttl_days)) * 24 * 60 * 60
        due_at = now_ts
        key = str(dedupe_key or "").strip() or None
        payload_json = _json_dumps(payload or {})

        def _write() -> Dict[str, Any]:
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

                if command in {"scan_now", "self_update"}:
                    active_task = conn.execute(
                        """
                        SELECT id, command, status, created_at, ttl_at
                        FROM scan_tasks
                        WHERE agent_id=?
                          AND command IN ('scan_now', 'self_update')
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
                            "agent_id": agent_id,
                            "command": command,
                            "status": "blocked",
                            "blocked": True,
                            "blocking_job_id": str(active_job["id"] or ""),
                            "blocking_job_status": str(active_job["status"] or "").strip().lower(),
                            "reason": "agent_has_active_scan_job",
                            "created_at": int(active_job["created_at"] or now_ts),
                            "ttl_at": ttl_at,
                        }

                task_id = uuid.uuid4().hex
                try:
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
                except Exception as exc:
                    if not _is_unique_violation(exc):
                        raise
                    conn.rollback()
                    if key:
                        existing = conn.execute(
                            """
                            SELECT id, command, status, created_at, ttl_at
                            FROM scan_tasks
                            WHERE agent_id=? AND dedupe_key=?
                            ORDER BY created_at DESC
                            LIMIT 1
                            """,
                            (agent_id, key),
                        ).fetchone()
                        if existing:
                            return dict(existing)
                    raise
                return {
                    "id": task_id,
                    "agent_id": agent_id,
                    "command": command,
                    "status": "queued",
                    "created_at": now_ts,
                    "ttl_at": ttl_at,
                }

        try:
            return self._run_write_transaction("create_task", _write)
        except Exception as exc:
            if not _is_unique_violation(exc) or not key:
                raise
            # Race: covering unique (agent_id, dedupe_key) rejected insert — return survivor.
            with self._lock, self._connect() as conn:
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
            raise

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

        def _write() -> List[Dict[str, Any]]:
            out: List[Dict[str, Any]] = []
            with self._lock, self._connect() as conn:
                self._maintain_tasks(conn, now_ts)
                select_sql = """
                    SELECT id, command, payload_json, attempt_count, created_at, ttl_at
                    FROM scan_tasks
                    WHERE agent_id=?
                      AND status='queued'
                      AND due_at <= ?
                      AND next_attempt_at <= ?
                      AND ttl_at > ?
                    ORDER BY created_at ASC
                    LIMIT ?
                    """
                if self.is_postgres:
                    select_sql += "\nFOR UPDATE SKIP LOCKED"
                rows = conn.execute(
                    select_sql,
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

        return self._run_write_transaction("poll_tasks", _write) or []

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
        def _write() -> Optional[Dict[str, Any]]:
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

                is_scan_now = str(row["command"] or "").strip().lower() == "scan_now"
                stored_status = "acknowledged" if is_scan_now and normalized == "completed" else normalized
                stored_completed_at = None if stored_status == "acknowledged" else update_fields["completed_at"]

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
                        stored_status,
                        update_fields["updated_at"],
                        update_fields["result_json"],
                        update_fields["error_text"],
                        update_fields["acked_at"],
                        stored_completed_at,
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
                if stored_status == "acknowledged" and is_scan_now:
                    reconciled = self._reconcile_scan_task_progress_locked(
                        conn, tid, now_ts=now_ts, force=True
                    )
                    if isinstance(reconciled, dict):
                        returned_status = str(reconciled.get("status") or returned_status).strip().lower() or returned_status
                conn.commit()
            return {"task_id": tid, "status": returned_status}

        return self._run_write_transaction("report_task_result", _write)

    def _serialize_task_row(
        self,
        row: sqlite3.Row,
        now_ts: Optional[int] = None,
        *,
        slim: bool = False,
    ) -> Dict[str, Any]:
        current_ts = int(now_ts or _now_ts())
        item = dict(row)
        payload = _json_loads(item.pop("payload_json", "{}"), {})
        result = _json_loads(item.pop("result_json", "{}"), {})
        if slim:
            item["payload"] = _slim_mapping_keys(payload, _SCAN_RUN_PAYLOAD_KEYS)
            item["result"] = _slim_mapping_keys(result, _SCAN_RUN_RESULT_KEYS)
        else:
            item["payload"] = payload if isinstance(payload, dict) else {}
            item["result"] = result if isinstance(result, dict) else {}
        # Drop accidental join aggregates that are not task columns.
        item.pop("hostname", None)
        item.pop("failed_jobs_count", None)
        item.pop("failed_job_errors", None)
        item.pop("found_new", None)
        item.pop("found_duplicate", None)
        item.pop("deleted_count", None)
        item.pop("cleaned_count", None)
        item.pop("moved_count", None)
        item.pop("observations_total", None)
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
        view: str = "detail",
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
        resolved_view = normalize_scan_list_view(view, default="detail")
        slim = resolved_view == "summary"
        now_ts = _now_ts()

        with self._lock, self._connect() as conn:
            total = conn.execute(
                f"SELECT COUNT(*) as cnt FROM scan_tasks {where_clause}",
                params,
            ).fetchone()["cnt"]
            if slim:
                select_sql = """
                SELECT
                    id, agent_id, command, status, error_text, attempt_count,
                    created_at, updated_at, delivered_at, acked_at, completed_at,
                    ttl_at, next_attempt_at, due_at, dedupe_key,
                    payload_json, result_json
                """
            else:
                select_sql = "SELECT *"
            rows = conn.execute(
                f"""
                {select_sql}
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
            "items": [self._serialize_task_row(row, now_ts=now_ts, slim=slim) for row in rows],
            "view": resolved_view,
        }

    def active_scan_task_ids(self) -> List[str]:
        now_ts = _now_ts()
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id
                FROM scan_tasks
                WHERE command='scan_now'
                  AND status='acknowledged'
                  AND ttl_at > ?
                ORDER BY created_at ASC
                """,
                (now_ts,),
            ).fetchall()
        return [str(row["id"] or "").strip() for row in rows if str(row["id"] or "").strip()]

    def record_system_metric_samples(self, *, task_ids: Iterable[str], sample: Dict[str, Any]) -> int:
        normalized_ids = sorted({str(value or "").strip() for value in task_ids if str(value or "").strip()})
        if not normalized_ids or not isinstance(sample, dict):
            return 0
        captured_at = int(sample.get("captured_at") or _now_ts())
        values = (
            captured_at,
            float(sample.get("cpu_percent") or 0.0),
            float(sample.get("memory_percent") or 0.0),
            int(sample.get("memory_used_bytes") or 0),
            int(sample.get("memory_available_bytes") or 0),
            int(sample.get("disk_read_bytes") or 0),
            int(sample.get("disk_write_bytes") or 0),
            float(sample.get("disk_read_bps") or 0.0),
            float(sample.get("disk_write_bps") or 0.0),
            int(sample.get("network_sent_bytes") or 0),
            int(sample.get("network_received_bytes") or 0),
            float(sample.get("network_sent_bps") or 0.0),
            float(sample.get("network_received_bps") or 0.0),
            int(sample.get("process_rss_bytes") or 0),
        )

        def _write() -> int:
            with self._lock, self._connect() as conn:
                if self.is_postgres:
                    conn.executemany(
                        """
                        INSERT INTO scan_task_system_metrics(
                            scan_task_id, captured_at, cpu_percent, memory_percent,
                            memory_used_bytes, memory_available_bytes,
                            disk_read_bytes, disk_write_bytes, disk_read_bps, disk_write_bps,
                            network_sent_bytes, network_received_bytes,
                            network_sent_bps, network_received_bps, process_rss_bytes
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT (scan_task_id, captured_at) DO UPDATE SET
                            cpu_percent=EXCLUDED.cpu_percent,
                            memory_percent=EXCLUDED.memory_percent,
                            memory_used_bytes=EXCLUDED.memory_used_bytes,
                            memory_available_bytes=EXCLUDED.memory_available_bytes,
                            disk_read_bytes=EXCLUDED.disk_read_bytes,
                            disk_write_bytes=EXCLUDED.disk_write_bytes,
                            disk_read_bps=EXCLUDED.disk_read_bps,
                            disk_write_bps=EXCLUDED.disk_write_bps,
                            network_sent_bytes=EXCLUDED.network_sent_bytes,
                            network_received_bytes=EXCLUDED.network_received_bytes,
                            network_sent_bps=EXCLUDED.network_sent_bps,
                            network_received_bps=EXCLUDED.network_received_bps,
                            process_rss_bytes=EXCLUDED.process_rss_bytes
                        """,
                        [(task_id, *values) for task_id in normalized_ids],
                    )
                else:
                    conn.executemany(
                        """
                        INSERT OR REPLACE INTO scan_task_system_metrics(
                            scan_task_id, captured_at, cpu_percent, memory_percent,
                            memory_used_bytes, memory_available_bytes,
                            disk_read_bytes, disk_write_bytes, disk_read_bps, disk_write_bps,
                            network_sent_bytes, network_received_bytes,
                            network_sent_bps, network_received_bps, process_rss_bytes
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        [(task_id, *values) for task_id in normalized_ids],
                    )
                conn.commit()
            return len(normalized_ids)

        return int(self._run_write_transaction("record_system_metric_samples", _write) or 0)

    def list_task_system_metrics(
        self,
        *,
        task_id: str,
        limit: int = _SYSTEM_METRICS_DEFAULT_LIMIT,
        offset: int = 0,
        from_ts: Optional[int] = None,
        to_ts: Optional[int] = None,
        max_points: Optional[int] = None,
    ) -> Dict[str, Any]:
        normalized_task_id = str(task_id or "").strip()
        if not normalized_task_id:
            return {"task_id": "", "total": 0, "items": [], "summary": {}}
        safe_limit = max(1, min(20000, int(limit or _SYSTEM_METRICS_DEFAULT_LIMIT)))
        safe_offset = max(0, int(offset or 0))
        range_from = int(from_ts) if from_ts is not None else None
        range_to = int(to_ts) if to_ts is not None else None
        if range_from is not None and range_from <= 0:
            range_from = None
        if range_to is not None and range_to <= 0:
            range_to = None
        if range_from is not None and range_to is not None and range_to < range_from:
            range_from, range_to = range_to, range_from
        # Legacy: absent max_points means no downsample. Explicit 0 also disables.
        # Charts pass max_points (typically 1000) or view=chart at the API layer.
        if max_points is None:
            safe_max_points = 0
        else:
            safe_max_points = max(0, min(20000, int(max_points)))
        cache_key = ""
        if safe_max_points > 0 and self.is_postgres:
            cache_key = (
                f"metrics_chart|{self.db_path}|{self.database_url}|{normalized_task_id}|"
                f"{safe_limit}|{safe_offset}|{range_from}|{range_to}|{safe_max_points}"
            )
            return _read_cache_single_flight(
                cache_key,
                lambda: self._list_task_system_metrics_uncached(
                    normalized_task_id=normalized_task_id,
                    safe_limit=safe_limit,
                    safe_offset=safe_offset,
                    range_from=range_from,
                    range_to=range_to,
                    safe_max_points=safe_max_points,
                ),
            )
        return self._list_task_system_metrics_uncached(
            normalized_task_id=normalized_task_id,
            safe_limit=safe_limit,
            safe_offset=safe_offset,
            range_from=range_from,
            range_to=range_to,
            safe_max_points=safe_max_points,
        )

    def _list_task_system_metrics_uncached(
        self,
        *,
        normalized_task_id: str,
        safe_limit: int,
        safe_offset: int,
        range_from: Optional[int],
        range_to: Optional[int],
        safe_max_points: int,
    ) -> Dict[str, Any]:
        where_parts = ["scan_task_id=?"]
        params: List[Any] = [normalized_task_id]
        if range_from is not None:
            where_parts.append("captured_at >= ?")
            params.append(range_from)
        if range_to is not None:
            where_parts.append("captured_at <= ?")
            params.append(range_to)
        where_sql = " AND ".join(where_parts)
        metric_cols = (
            "captured_at, cpu_percent, memory_percent, memory_used_bytes, memory_available_bytes, "
            "disk_read_bytes, disk_write_bytes, disk_read_bps, disk_write_bps, "
            "network_sent_bytes, network_received_bytes, network_sent_bps, network_received_bps, "
            "process_rss_bytes"
        )

        with self._lock, self._connect() as conn:
            # Chart path first (skip COUNT): full COUNT/window over large series hits 57014.
            if safe_max_points > 0 and self.is_postgres:
                first = conn.execute(
                    f"""
                    SELECT {metric_cols}
                    FROM scan_task_system_metrics
                    WHERE {where_sql}
                    ORDER BY captured_at ASC
                    LIMIT 1
                    """,
                    params,
                ).fetchone()
                last = conn.execute(
                    f"""
                    SELECT {metric_cols}
                    FROM scan_task_system_metrics
                    WHERE {where_sql}
                    ORDER BY captured_at DESC
                    LIMIT 1
                    """,
                    params,
                ).fetchone()
                if first is None or last is None:
                    return {
                        "task_id": normalized_task_id,
                        "total": 0,
                        "total_estimated": False,
                        "items": [],
                        "summary": {},
                        "from_ts": range_from,
                        "to_ts": range_to,
                        "max_points": safe_max_points,
                        "raw_item_count": 0,
                        "downsampled": False,
                    }
                lo = int(first["captured_at"] or 0)
                hi = int(last["captured_at"] or 0)
                # Peak-safe path: when series is modest, fetch narrow columns once and
                # downsample in Python (preserves min/max). On timeout / large series,
                # fall back to nearest-grid (no multi-million Python load).
                _METRICS_EXACT_FETCH_CAP = 20000
                exact_total: Optional[int] = None
                try:
                    exact_total = int(
                        conn.execute(
                            f"SELECT COUNT(*) AS c FROM scan_task_system_metrics WHERE {where_sql}",
                            params,
                        ).fetchone()["c"]
                        or 0
                    )
                except Exception:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    exact_total = None
                use_grid = True
                items: List[Dict[str, Any]] = []
                total_estimated = True
                total = 0
                raw_item_count = 0
                if hi <= lo:
                    items = [dict(first)]
                    total_estimated = False
                    total = 1 if exact_total is None else int(exact_total)
                    raw_item_count = total
                    use_grid = False
                elif exact_total is not None and exact_total <= _METRICS_EXACT_FETCH_CAP:
                    try:
                        rows = conn.execute(
                            f"""
                            SELECT {metric_cols}
                            FROM scan_task_system_metrics
                            WHERE {where_sql}
                            ORDER BY captured_at ASC
                            """,
                            params,
                        ).fetchall()
                        items = [dict(row) for row in rows]
                        raw_item_count = len(items)
                        total = int(exact_total)
                        total_estimated = False
                        if len(items) > safe_max_points:
                            items = downsample_metric_points(items, safe_max_points)
                        use_grid = False
                    except Exception:
                        try:
                            conn.rollback()
                        except Exception:
                            pass
                        use_grid = True
                if use_grid:
                    grid_n = max(2, min(safe_max_points, 100))
                    rows = conn.execute(
                        f"""
                        WITH grid AS (
                            SELECT
                                CAST(? AS BIGINT)
                                + (
                                    (CAST(? AS BIGINT) - CAST(? AS BIGINT))
                                    * g
                                ) / CAST(? AS INTEGER) AS ts
                            FROM generate_series(0, CAST(? AS INTEGER)) AS g
                        )
                        SELECT DISTINCT ON (g.ts)
                            m.captured_at, m.cpu_percent, m.memory_percent, m.memory_used_bytes,
                            m.memory_available_bytes, m.disk_read_bytes, m.disk_write_bytes,
                            m.disk_read_bps, m.disk_write_bps, m.network_sent_bytes,
                            m.network_received_bytes, m.network_sent_bps, m.network_received_bps,
                            m.process_rss_bytes
                        FROM grid g
                        INNER JOIN LATERAL (
                            SELECT {metric_cols}
                            FROM scan_task_system_metrics
                            WHERE scan_task_id = ?
                              AND captured_at >= g.ts
                              {"AND captured_at <= ?" if range_to is not None else ""}
                            ORDER BY captured_at ASC
                            LIMIT 1
                        ) m ON TRUE
                        ORDER BY g.ts ASC, m.captured_at ASC
                        """,
                        [
                            lo,
                            hi,
                            lo,
                            grid_n,
                            grid_n,
                            normalized_task_id,
                            *([range_to] if range_to is not None else []),
                        ],
                    ).fetchall()
                    items = [dict(row) for row in rows]
                    if not items or int(items[0].get("captured_at") or 0) != lo:
                        items.insert(0, dict(first))
                    if not items or int(items[-1].get("captured_at") or 0) != hi:
                        items.append(dict(last))
                    seen: set[int] = set()
                    deduped: List[Dict[str, Any]] = []
                    for row in items:
                        key = int(row.get("captured_at") or 0)
                        if key in seen:
                            continue
                        seen.add(key)
                        deduped.append(row)
                    items = deduped
                    if len(items) > safe_max_points:
                        items = downsample_metric_points(items, safe_max_points)
                    if exact_total is not None:
                        total = int(exact_total)
                        total_estimated = False
                        raw_item_count = int(exact_total)
                    else:
                        total = max(len(items), int((hi - lo) / 30) + 1)
                        total_estimated = True
                        raw_item_count = int(total)
                cpu_vals = [float(x.get("cpu_percent") or 0.0) for x in items]
                mem_vals = [float(x.get("memory_percent") or 0.0) for x in items]
                summary = {
                    "cpu_percent_avg": round(sum(cpu_vals) / max(1, len(cpu_vals)), 2),
                    "cpu_percent_max": round(max(cpu_vals) if cpu_vals else 0.0, 2),
                    "memory_percent_max": round(max(mem_vals) if mem_vals else 0.0, 2),
                    "memory_used_bytes_max": max(int(x.get("memory_used_bytes") or 0) for x in items) if items else 0,
                    "process_rss_bytes_max": max(int(x.get("process_rss_bytes") or 0) for x in items) if items else 0,
                    "disk_read_bps_max": round(max((float(x.get("disk_read_bps") or 0.0) for x in items), default=0.0), 2),
                    "disk_write_bps_max": round(max((float(x.get("disk_write_bps") or 0.0) for x in items), default=0.0), 2),
                    "network_sent_bps_max": round(max((float(x.get("network_sent_bps") or 0.0) for x in items), default=0.0), 2),
                    "network_received_bps_max": round(
                        max((float(x.get("network_received_bps") or 0.0) for x in items), default=0.0), 2
                    ),
                    "started_at": lo,
                    "finished_at": hi,
                    "disk_read_bytes_delta": max(
                        0, int(last["disk_read_bytes"] or 0) - int(first["disk_read_bytes"] or 0)
                    ),
                    "disk_write_bytes_delta": max(
                        0, int(last["disk_write_bytes"] or 0) - int(first["disk_write_bytes"] or 0)
                    ),
                    "network_sent_bytes_delta": max(
                        0, int(last["network_sent_bytes"] or 0) - int(first["network_sent_bytes"] or 0)
                    ),
                    "network_received_bytes_delta": max(
                        0,
                        int(last["network_received_bytes"] or 0) - int(first["network_received_bytes"] or 0),
                    ),
                }
                return {
                    "task_id": normalized_task_id,
                    "total": int(total),
                    "total_estimated": bool(total_estimated),
                    "items": items,
                    "summary": summary,
                    "from_ts": range_from,
                    "to_ts": range_to,
                    "max_points": safe_max_points,
                    "raw_item_count": int(raw_item_count),
                    "downsampled": bool(int(total) > len(items) or len(items) < int(raw_item_count)),
                }

            total = int(
                conn.execute(
                    f"SELECT COUNT(*) AS c FROM scan_task_system_metrics WHERE {where_sql}",
                    params,
                ).fetchone()["c"]
                or 0
            )

            rows = conn.execute(
                f"""
                SELECT {metric_cols}
                FROM scan_task_system_metrics
                WHERE {where_sql}
                ORDER BY captured_at ASC
                LIMIT ? OFFSET ?
                """,
                [*params, safe_limit, safe_offset],
            ).fetchall()
            first = conn.execute(
                f"""
                SELECT {metric_cols}
                FROM scan_task_system_metrics
                WHERE {where_sql}
                ORDER BY captured_at ASC
                LIMIT 1
                """,
                params,
            ).fetchone()
            last = conn.execute(
                f"""
                SELECT {metric_cols}
                FROM scan_task_system_metrics
                WHERE {where_sql}
                ORDER BY captured_at DESC
                LIMIT 1
                """,
                params,
            ).fetchone()
            # Prefer summary from the page rows when a full aggregate would re-scan
            # a large series under statement_timeout (seen as SQLSTATE 57014).
            items = [dict(row) for row in rows]
            raw_count = len(items)
            if safe_max_points > 0:
                items = downsample_metric_points(items, safe_max_points)
            summary = {}
            if total and items and first is not None and last is not None:
                cpu_vals = [float(x.get("cpu_percent") or 0.0) for x in items]
                mem_vals = [float(x.get("memory_percent") or 0.0) for x in items]
                summary = {
                    "cpu_percent_avg": round(sum(cpu_vals) / max(1, len(cpu_vals)), 2),
                    "cpu_percent_max": round(max(cpu_vals) if cpu_vals else 0.0, 2),
                    "memory_percent_max": round(max(mem_vals) if mem_vals else 0.0, 2),
                    "memory_used_bytes_max": max(int(x.get("memory_used_bytes") or 0) for x in items),
                    "process_rss_bytes_max": max(int(x.get("process_rss_bytes") or 0) for x in items),
                    "disk_read_bps_max": round(max(float(x.get("disk_read_bps") or 0.0) for x in items), 2),
                    "disk_write_bps_max": round(max(float(x.get("disk_write_bps") or 0.0) for x in items), 2),
                    "network_sent_bps_max": round(max(float(x.get("network_sent_bps") or 0.0) for x in items), 2),
                    "network_received_bps_max": round(
                        max(float(x.get("network_received_bps") or 0.0) for x in items), 2
                    ),
                    "started_at": int(first["captured_at"] or 0),
                    "finished_at": int(last["captured_at"] or 0),
                    "disk_read_bytes_delta": max(
                        0, int(last["disk_read_bytes"] or 0) - int(first["disk_read_bytes"] or 0)
                    ),
                    "disk_write_bytes_delta": max(
                        0, int(last["disk_write_bytes"] or 0) - int(first["disk_write_bytes"] or 0)
                    ),
                    "network_sent_bytes_delta": max(
                        0, int(last["network_sent_bytes"] or 0) - int(first["network_sent_bytes"] or 0)
                    ),
                    "network_received_bytes_delta": max(
                        0,
                        int(last["network_received_bytes"] or 0) - int(first["network_received_bytes"] or 0),
                    ),
                }
        return {
            "task_id": normalized_task_id,
            "total": total,
            "total_estimated": False,
            "items": items,
            "summary": summary,
            "from_ts": range_from,
            "to_ts": range_to,
            "max_points": safe_max_points if safe_max_points > 0 else None,
            "raw_item_count": raw_count,
            "downsampled": bool(safe_max_points > 0 and (total > len(items) or raw_count > len(items))),
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
        if incident is None:
            return
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
            FROM scan_jobs
            WHERE scan_task_id=? AND file_hash <> '' AND status <> 'failed'
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
                        str(existing["status"] or "").strip().lower() in {"failed", "analysis_incomplete"}
                        and str(existing["error_text"] or "").strip() in MISSING_TRANSIENT_PDF_PAYLOAD_MESSAGES
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
            def _write_retry_job() -> None:
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

            self._run_write_transaction("queue_job_reopen_missing_payload", _write_retry_job)
            return {"job_id": retry_job_id, "status": "queued", "deduped": False, "reopened": True}

        spool_written = False
        if payload_pdf_bytes:
            self.write_job_pdf_spool(job_id=job_id, pdf_bytes=payload_pdf_bytes)
            spool_written = True
        try:
            def _write_new_job() -> None:
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
                        self._reconcile_scan_task_progress_locked(conn, effective_scan_task_id, now_ts=now_ts)
                    conn.commit()

            self._run_write_transaction("queue_job_insert", _write_new_job)
        except Exception as exc:
            if _is_unique_violation(exc):
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
            if spool_written:
                self.delete_job_pdf_spool(job_id=job_id)
            raise
        return {"job_id": job_id, "status": "queued", "deduped": False}

    def requeue_stale_processing_jobs(self, *, timeout_sec: Optional[int] = None) -> int:
        safe_timeout = max(60, int(timeout_sec or self.job_processing_timeout_sec))
        stale_before = _now_ts() - safe_timeout
        def _write() -> int:
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

        return int(self._run_write_transaction("requeue_stale_processing_jobs", _write) or 0)

    def requeue_interrupted_processing_jobs(self) -> int:
        """Recover jobs owned by the previous worker instance immediately on startup."""
        def _write() -> int:
            with self._lock, self._connect() as conn:
                touched_task_ids = [
                    str(row["scan_task_id"] or "").strip()
                    for row in conn.execute(
                        """
                        SELECT DISTINCT scan_task_id
                        FROM scan_jobs
                        WHERE status='processing'
                          AND scan_task_id IS NOT NULL
                          AND scan_task_id <> ''
                        """
                    ).fetchall()
                ]
                cursor = conn.execute(
                    """
                    UPDATE scan_jobs
                    SET status='queued',
                        started_at=NULL,
                        finished_at=NULL,
                        summary='Recovered after scan worker restart',
                        error_text=NULL,
                        attempt_count=CASE
                            WHEN COALESCE(attempt_count, 0) > 0 THEN attempt_count - 1
                            ELSE 0
                        END
                    WHERE status='processing'
                    """
                )
                for task_id in touched_task_ids:
                    self._reconcile_scan_task_progress_locked(conn, task_id)
                conn.commit()
                return int(cursor.rowcount or 0)

        return int(self._run_write_transaction("requeue_interrupted_processing_jobs", _write) or 0)

    def requeue_job_for_retry(self, *, job_id: str, error_text: str, summary: str = "") -> None:
        normalized_job_id = str(job_id or "").strip()
        if not normalized_job_id:
            return
        now_ts = _now_ts()
        def _write() -> None:
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

        self._run_write_transaction("requeue_job_for_retry", _write)

    def claim_next_jobs(self, limit: int) -> List[Dict[str, Any]]:
        batch_limit = max(1, min(100, int(limit or 1)))
        now_ts = _now_ts()

        def _write():
            with self._lock, self._connect() as conn:
                if self.is_postgres:
                    rows = conn.execute(
                        """
                        WITH cte AS (
                            SELECT id
                            FROM scan_jobs
                            WHERE status='queued'
                            ORDER BY created_at ASC
                            LIMIT ?
                            FOR UPDATE SKIP LOCKED
                        )
                        UPDATE scan_jobs AS j
                        SET status='processing',
                            started_at=?,
                            finished_at=NULL,
                            error_text=NULL,
                            attempt_count=COALESCE(attempt_count, 0) + 1
                        FROM cte
                        WHERE j.id = cte.id
                        RETURNING j.*
                        """,
                        (batch_limit, now_ts),
                    ).fetchall()
                    conn.commit()
                    return rows, True

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
                    return [], False
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
                return rows, False

        rows, already_updated = self._run_write_transaction("claim_next_jobs", _write) or ([], False)
        out: List[Dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            if already_updated:
                out.append(item)
                continue
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
        normalized_job_id = str(job_id or "").strip()

        def _write() -> None:
            with self._lock, self._connect() as conn:
                job_row = conn.execute(
                    "SELECT scan_task_id FROM scan_jobs WHERE id=? LIMIT 1",
                    (normalized_job_id,),
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
                        normalized_job_id,
                    ),
                )
                scan_task_id = str(job_row["scan_task_id"] or "").strip() if job_row is not None else ""
                if scan_task_id:
                    self._reconcile_scan_task_progress_locked(
                        conn, scan_task_id, now_ts=now_ts, force=True
                    )
                conn.commit()

        self._run_write_transaction("finalize_job", _write)
        self.delete_job_pdf_spool(job_id=job_id)

    def record_job_metrics(self, *, job_id: str, metrics: Dict[str, Any]) -> None:
        normalized_job_id = str(job_id or "").strip()
        if not normalized_job_id or not isinstance(metrics, dict):
            return
        encoded = _json_dumps(metrics)

        def _write() -> None:
            with self._lock, self._connect() as conn:
                conn.execute(
                    "UPDATE scan_jobs SET metrics_json=? WHERE id=?",
                    (encoded, normalized_job_id),
                )
                conn.commit()

        self._run_write_transaction("record_job_metrics", _write)

    def append_job_extraction_outcome(self, *, job_id: str, outcome: Dict[str, Any]) -> None:
        normalized_job_id = str(job_id or "").strip()
        if not normalized_job_id or not isinstance(outcome, dict):
            return

        def _write() -> None:
            with self._lock, self._connect() as conn:
                row = conn.execute(
                    "SELECT payload_json FROM scan_jobs WHERE id=? LIMIT 1",
                    (normalized_job_id,),
                ).fetchone()
                if row is None:
                    return
                payload = _json_loads(row["payload_json"], {})
                if not isinstance(payload, dict):
                    payload = {}
                metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
                outcomes = metadata.get("extraction_outcomes") if isinstance(metadata.get("extraction_outcomes"), list) else []
                outcomes.append(dict(outcome))
                metadata["extraction_outcomes"] = outcomes[-50:]
                payload["metadata"] = metadata
                conn.execute(
                    "UPDATE scan_jobs SET payload_json=? WHERE id=?",
                    (_json_dumps(payload), normalized_job_id),
                )
                conn.commit()

        self._run_write_transaction("append_job_extraction_outcome", _write)

    def add_artifact(self, *, job_id: str, artifact_type: str, storage_path: str, size_bytes: int) -> None:
        now_ts = _now_ts()

        def _write() -> None:
            with self._lock, self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO scan_artifacts(job_id, artifact_type, storage_path, size_bytes, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (job_id, artifact_type, storage_path, int(size_bytes), now_ts),
                )
                conn.commit()

        self._run_write_transaction("add_artifact", _write)

    def purge_all_artifacts(self) -> Dict[str, int]:
        """Remove orphaned/legacy scan artifacts on startup.

        Only artifacts whose job no longer exists (orphan) or whose job has
        already reached a final status (done_clean/done_with_incident/failed,
        i.e. "legacy") are purged. Artifacts still tied to a queued/processing
        job are left untouched, so a restart during active scanning cannot
        wipe evidence that is still in use.
        """
        archive_root = self.archive_dir

        def _write() -> Dict[str, Any]:
            with self._lock, self._connect() as conn:
                rows = conn.execute(
                    """
                    SELECT a.id, a.storage_path, j.status AS job_status
                    FROM scan_artifacts a
                    LEFT JOIN scan_jobs j ON j.id = a.job_id
                    """
                ).fetchall()
                purge_ids: List[str] = []
                keep_paths: set = set()
                for row in rows:
                    has_job = row["job_status"] is not None
                    job_status = str(row["job_status"] or "").strip().lower()
                    if not has_job or job_status in FINAL_JOB_STATUSES:
                        purge_ids.append(str(row["id"]))
                        continue
                    storage_path = str(row["storage_path"] or "").strip()
                    if storage_path:
                        try:
                            keep_paths.add(Path(storage_path).resolve())
                        except OSError:
                            keep_paths.add(Path(storage_path))
                removed_rows = 0
                if purge_ids:
                    placeholders = ",".join(["?"] * len(purge_ids))
                    cursor = conn.execute(
                        f"DELETE FROM scan_artifacts WHERE id IN ({placeholders})",
                        purge_ids,
                    )
                    removed_rows = cursor.rowcount if cursor.rowcount is not None else len(purge_ids)
                conn.commit()
            return {"removed_rows": removed_rows, "keep_paths": keep_paths}

        write_result = self._run_write_transaction("purge_all_artifacts", _write) or {}
        removed_rows = int(write_result.get("removed_rows") or 0)
        keep_paths = write_result.get("keep_paths") or set()

        removed_files = 0
        removed_dirs = 0
        if archive_root.exists():
            for path in sorted(archive_root.rglob("*"), key=lambda item: (item.is_file(), len(item.parts)), reverse=True):
                try:
                    if path.is_file():
                        if path.resolve() in keep_paths:
                            continue
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
        finalize_status: Optional[str] = None,
        finalize_summary: Optional[str] = None,
        finalize_error_text: Optional[str] = None,
    ) -> Dict[str, str]:
        now_ts = _now_ts()
        finding_id = uuid.uuid4().hex
        incident_id = uuid.uuid4().hex
        job_id = str(job.get("id") or "").strip()
        terminal_status = str(finalize_status or "").strip()

        def _write() -> None:
            with self._lock, self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO scan_findings(
                        id, job_id, severity, category, matched_patterns_json, short_reason, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        finding_id,
                        job_id,
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
                        job_id,
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
                observation_update = conn.execute(
                    """
                    UPDATE scan_task_file_observations
                    SET linked_incident_id=?, severity=?
                    WHERE linked_job_id=? AND linked_incident_id=''
                    """,
                    (incident_id, severity, job_id),
                )
                scan_task_id = str(job.get("scan_task_id") or "").strip()
                if int(observation_update.rowcount or 0) == 0 and scan_task_id:
                    self._record_scan_observation_locked(
                        conn,
                        scan_task_id=scan_task_id,
                        agent_id=str(job.get("agent_id") or ""),
                        hostname=str(job.get("hostname") or ""),
                        file_path=str(job.get("file_path") or ""),
                        file_hash=str(job.get("file_hash") or ""),
                        event_id=str(job.get("event_id") or ""),
                        observation_type="found_new",
                        linked_job_id=job_id,
                        linked_incident_id=incident_id,
                        source_kind=str(job.get("source_kind") or ""),
                        severity=severity,
                        created_at=now_ts,
                    )
                if terminal_status:
                    conn.execute(
                        """
                        UPDATE scan_jobs
                        SET status=?, finished_at=?, summary=?, error_text=?
                        WHERE id=?
                        """,
                        (
                            terminal_status,
                            now_ts,
                            str(finalize_summary or "").strip() or None,
                            str(finalize_error_text or "").strip() or None,
                            job_id,
                        ),
                    )
                    if scan_task_id:
                        self._reconcile_scan_task_progress_locked(
                            conn, scan_task_id, now_ts=now_ts, force=True
                        )
                conn.commit()

        self._run_write_transaction("create_finding_and_incident", _write)
        if terminal_status and job_id:
            self.delete_job_pdf_spool(job_id=job_id)
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
        pattern_id: Optional[str] = None,
        table_alias: str = "i",
    ) -> tuple[str, List[Any], bool, bool]:
        i_alias = str(table_alias or "i").strip() or "i"
        conditions: List[str] = []
        params: List[Any] = []
        needs_findings_join = False
        needs_jobs_join = False
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
            host_needle = str(hostname).strip().lower()
            if looks_like_hostname_query(host_needle):
                conditions.append(
                    f"(LOWER({i_alias}.hostname) = ? OR LOWER({i_alias}.hostname) LIKE ?)"
                )
                params.extend([host_needle, f"{host_needle}%"])
            else:
                conditions.append(f"LOWER({i_alias}.hostname) LIKE ?")
                params.append(f"%{host_needle}%")
        if source_kind:
            needs_jobs_join = True
            conditions.append("LOWER(COALESCE(j.source_kind, '')) = ?")
            params.append(str(source_kind).strip().lower())
        if file_ext:
            ext = str(file_ext).strip().lower().lstrip(".")
            if ext:
                needs_jobs_join = True
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
            needs_findings_join = True
            conditions.append("LENGTH(TRIM(COALESCE(f.matched_patterns_json, ''))) > 2")
        elif has_fragment is False:
            needs_findings_join = True
            conditions.append("LENGTH(TRIM(COALESCE(f.matched_patterns_json, ''))) <= 2")
        if ack_by:
            conditions.append(f"LOWER(COALESCE({i_alias}.ack_by, '')) LIKE ?")
            params.append(f"%{str(ack_by).strip().lower()}%")
        incident_pattern_ids = expand_incident_pattern_filter(pattern_id)
        if incident_pattern_ids:
            needs_findings_join = True
            placeholders = ", ".join("?" for _ in incident_pattern_ids)
            if self.is_postgres:
                # PostgreSQL jsonb forbids \u0000 inside JSON strings. Snippets from OCR/files
                # sometimes contain that escape; strip it before casting so pattern filters
                # (including the DSP group) do not 500 the whole inbox query.
                sanitized_json = "REPLACE(COALESCE(f.matched_patterns_json, '[]'), E'\\\\u0000', '')"
                conditions.append(
                    "EXISTS ("
                    "SELECT 1 FROM jsonb_array_elements("
                    f"CASE WHEN LEFT(TRIM({sanitized_json}), 1) = '[' "
                    f"THEN ({sanitized_json})::jsonb ELSE '[]'::jsonb END"
                    ") AS pattern_row "
                    "WHERE LOWER(COALESCE("
                    "pattern_row->>'pattern', "
                    "pattern_row->>'pattern_id', ''"
                    f")) IN ({placeholders})"
                    ")"
                )
            else:
                conditions.append(
                    "EXISTS ("
                    "SELECT 1 FROM json_each("
                    "CASE WHEN json_valid(COALESCE(f.matched_patterns_json, '[]')) "
                    "THEN COALESCE(f.matched_patterns_json, '[]') ELSE '[]' END"
                    ") pattern_row "
                    "WHERE LOWER(COALESCE("
                    "json_extract(pattern_row.value, '$.pattern'), "
                    "json_extract(pattern_row.value, '$.pattern_id'), ''"
                    f")) IN ({placeholders})"
                    ")"
                )
            params.extend(incident_pattern_ids)
        q_text = str(q or "").strip()
        if q_text:
            q_lower = q_text.lower()
            if looks_like_hostname_query(q_text):
                # Fast path: hostname equality/prefix only — skip findings/jobs/JSON scans.
                conditions.append(
                    f"(LOWER({i_alias}.hostname) = ? OR LOWER({i_alias}.hostname) LIKE ?)"
                )
                params.extend([q_lower, f"{q_lower}%"])
            else:
                needs_findings_join = True
                needs_jobs_join = True
                needle = f"%{q_lower}%"
                # Multi-field text search without matched_patterns_json (OCR blobs are huge).
                conditions.append(
                    "("
                    f"LOWER({i_alias}.hostname) LIKE ? OR LOWER({i_alias}.user_login) LIKE ? "
                    f"OR LOWER({i_alias}.user_full_name) LIKE ? OR LOWER({i_alias}.file_path) LIKE ? "
                    "OR LOWER(COALESCE(j.file_name, '')) LIKE ? "
                    "OR LOWER(COALESCE(j.source_kind, '')) LIKE ? OR LOWER(COALESCE(f.short_reason, '')) LIKE ?"
                    ")"
                )
                params.extend([needle, needle, needle, needle, needle, needle, needle])
        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        return where_clause, params, needs_findings_join, needs_jobs_join

    def list_incidents(
        self,
        *,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        branch: Optional[str] = None,
        q: Optional[str] = None,
        hostname: Optional[str] = None,
        task_id: Optional[str] = None,
        source_kind: Optional[str] = None,
        file_ext: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        has_fragment: Optional[bool] = None,
        ack_by: Optional[str] = None,
        pattern_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        view: str = "detail",
    ) -> Dict[str, Any]:
        resolved_view = normalize_scan_list_view(view, default="detail")
        safe_limit = max(1, min(5000, int(limit)))
        safe_offset = max(0, int(offset))
        # First-page PG read-cache (10s) for inbox/summary hot path.
        use_cache = (
            self.is_postgres
            and safe_offset == 0
            and resolved_view == "summary"
            and safe_limit <= 100
        )
        cache_key = (
            f"incidents|{self.db_path}|{self.database_url}|view={resolved_view}|"
            f"st={str(status or '')}|sev={str(severity or '')}|br={str(branch or '')}|"
            f"q={str(q or '')}|h={str(hostname or '')}|tid={str(task_id or '')}|"
            f"sk={str(source_kind or '')}|fe={str(file_ext or '')}|"
            f"df={str(date_from or '')}|dt={str(date_to or '')}|hf={has_fragment}|"
            f"ab={str(ack_by or '')}|pid={str(pattern_id or '')}|lim={safe_limit}"
        )
        if use_cache:
            return _read_cache_single_flight(
                cache_key,
                lambda: self._list_incidents_uncached(
                    status=status,
                    severity=severity,
                    branch=branch,
                    q=q,
                    hostname=hostname,
                    task_id=task_id,
                    source_kind=source_kind,
                    file_ext=file_ext,
                    date_from=date_from,
                    date_to=date_to,
                    has_fragment=has_fragment,
                    ack_by=ack_by,
                    pattern_id=pattern_id,
                    limit=safe_limit,
                    offset=safe_offset,
                    resolved_view=resolved_view,
                ),
            )
        return self._list_incidents_uncached(
            status=status,
            severity=severity,
            branch=branch,
            q=q,
            hostname=hostname,
            task_id=task_id,
            source_kind=source_kind,
            file_ext=file_ext,
            date_from=date_from,
            date_to=date_to,
            has_fragment=has_fragment,
            ack_by=ack_by,
            pattern_id=pattern_id,
            limit=safe_limit,
            offset=safe_offset,
            resolved_view=resolved_view,
        )

    def _list_incidents_uncached(
        self,
        *,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        branch: Optional[str] = None,
        q: Optional[str] = None,
        hostname: Optional[str] = None,
        task_id: Optional[str] = None,
        source_kind: Optional[str] = None,
        file_ext: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        has_fragment: Optional[bool] = None,
        ack_by: Optional[str] = None,
        pattern_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        resolved_view: str = "detail",
    ) -> Dict[str, Any]:
        where_clause, params, needs_findings_join, needs_jobs_join = self._build_incident_where_clause(
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
            pattern_id=pattern_id,
        )
        normalized_task_id = str(task_id or "").strip()
        if normalized_task_id:
            task_condition = "i.job_id IN (SELECT id FROM scan_jobs WHERE scan_task_id = ?)"
            if where_clause:
                where_clause = f"{where_clause} AND {task_condition}"
            else:
                where_clause = f"WHERE {task_condition}"
            params.append(normalized_task_id)
        safe_limit = max(1, min(5000, int(limit)))
        safe_offset = max(0, int(offset))
        summary = resolved_view == "summary"
        count_joins: List[str] = []
        if needs_findings_join:
            count_joins.append("LEFT JOIN scan_findings f ON f.id = i.finding_id")
        if needs_jobs_join:
            count_joins.append("LEFT JOIN scan_jobs j ON j.id = i.job_id")
        count_join_sql = ("\n                ".join(count_joins) + "\n                ") if count_joins else ""

        # Summary: explicit columns. Detail keeps i.* for backward-compatible fields.
        if summary:
            select_cols = """
                    i.id,
                    i.finding_id,
                    i.job_id,
                    i.agent_id,
                    i.hostname,
                    i.branch,
                    i.user_login,
                    i.user_full_name,
                    i.file_path,
                    i.severity,
                    i.status,
                    i.created_at,
                    i.ack_at,
                    i.ack_by,
                    f.category,
                    f.short_reason,
                    f.matched_patterns_json,
                    j.source_kind,
                    j.file_name,
                    j.created_at as job_created_at
            """
        else:
            select_cols = """
                    i.*,
                    f.category,
                    f.short_reason,
                    f.matched_patterns_json,
                    j.source_kind,
                    j.file_name,
                    j.created_at as job_created_at
            """

        with self._lock, self._connect() as conn:
            total = conn.execute(
                f"""
                SELECT COUNT(*) as cnt
                FROM scan_incidents i
                {count_join_sql}{where_clause}
                """,
                params,
            ).fetchone()["cnt"]
            rows = conn.execute(
                f"""
                SELECT
                    {select_cols}
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
            item = self._row_to_incident_item(row, slim_patterns=True)
            if summary:
                patterns = item.get("matched_patterns") if isinstance(item.get("matched_patterns"), list) else []
                item["matched_patterns"] = patterns[:3]
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
            "view": resolved_view,
        }

    def _row_to_incident_item(self, row: Any, *, slim_patterns: bool = True) -> Dict[str, Any]:
        item = dict(row)
        item.pop("file_key", None)
        item.pop("rn", None)
        patterns = _json_loads(item.pop("matched_patterns_json", "[]"), [])
        item["matched_patterns"] = (
            _slim_matched_patterns_for_list(patterns) if slim_patterns else patterns
        )
        item["file_ext"] = _file_ext_from_values(item.get("file_name"), item.get("file_path"))
        return item

    def _fetch_inbox_file_previews(
        self,
        conn: Any,
        *,
        host_where: str,
        host_params: List[Any],
        file_keys: List[str],
        summary: bool = False,
    ) -> Dict[str, Dict[str, Any]]:
        normalized_keys = [str(key or "").strip() for key in file_keys if str(key or "").strip()]
        if not normalized_keys:
            return {}
        placeholders = ", ".join("?" for _ in normalized_keys)
        file_key_expr = (
            "COALESCE(NULLIF(TRIM(i.file_path), ''), NULLIF(TRIM(j.file_name), ''), i.id)"
        )
        # Avoid i.* — OCR/pattern blobs on findings dominate inbox payload size.
        select_cols = f"""
            {file_key_expr} AS file_key,
            i.id,
            i.hostname,
            i.branch,
            i.status,
            i.severity,
            i.file_path,
            i.created_at,
            i.finding_id,
            i.job_id,
            f.category,
            f.short_reason,
            f.matched_patterns_json,
            j.source_kind,
            j.file_name,
            j.created_at as job_created_at
        """
        if self.is_postgres:
            rows = conn.execute(
                f"""
                SELECT DISTINCT ON ({file_key_expr})
                    {select_cols}
                FROM scan_incidents i
                LEFT JOIN scan_findings f ON f.id = i.finding_id
                LEFT JOIN scan_jobs j ON j.id = i.job_id
                {host_where}
                  AND {file_key_expr} IN ({placeholders})
                ORDER BY {file_key_expr}, i.created_at DESC
                """,
                [*host_params, *normalized_keys],
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT *
                FROM (
                    SELECT
                        {select_cols},
                        ROW_NUMBER() OVER (
                            PARTITION BY {file_key_expr}
                            ORDER BY i.created_at DESC
                        ) AS rn
                    FROM scan_incidents i
                    LEFT JOIN scan_findings f ON f.id = i.finding_id
                    LEFT JOIN scan_jobs j ON j.id = i.job_id
                    {host_where}
                      AND {file_key_expr} IN ({placeholders})
                ) ranked
                WHERE rn = 1
                """,
                [*host_params, *normalized_keys],
            ).fetchall()
        out: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            key = str(row["file_key"] or "").strip()
            if not key:
                continue
            item = self._row_to_incident_item(row, slim_patterns=True)
            if summary:
                patterns = item.get("matched_patterns") if isinstance(item.get("matched_patterns"), list) else []
                out[key] = {
                    "id": str(item.get("id") or "").strip(),
                    "severity": str(item.get("severity") or "").strip().lower(),
                    "status": str(item.get("status") or "").strip().lower(),
                    "matched_patterns": patterns[:3],
                }
            else:
                out[key] = item
        return out

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
        pattern_id: Optional[str] = None,
        host_limit: int = 25,
        host_offset: int = 0,
        files_per_host: Optional[int] = None,
        view: str = "detail",
    ) -> Dict[str, Any]:
        safe_host_limit = max(1, min(100, int(host_limit)))
        safe_host_offset = max(0, int(host_offset))
        resolved_view = normalize_scan_list_view(view, default="detail")
        summary = resolved_view == "summary"
        # None → summary hosts-only (0); detail keeps legacy preview of 25 files/host.
        if files_per_host is None:
            safe_files_per_host = 0 if summary else 25
        else:
            safe_files_per_host = max(0, min(100, int(files_per_host)))
        cache_key = (
            f"inbox_groups|{self.db_path}|{self.database_url}|"
            f"view={resolved_view}|"
            f"st={str(status or '')}|sev={str(severity or '')}|br={str(branch or '')}|"
            f"q={str(q or '')}|h={str(hostname or '')}|sk={str(source_kind or '')}|"
            f"fe={str(file_ext or '')}|df={str(date_from or '')}|dt={str(date_to or '')}|"
            f"hf={has_fragment}|ab={str(ack_by or '')}|pid={str(pattern_id or '')}|"
            f"hl={safe_host_limit}|ho={safe_host_offset}|fph={safe_files_per_host}"
        )
        if self.is_postgres:
            return _read_cache_single_flight(
                cache_key,
                lambda: self._list_incident_inbox_groups_uncached(
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
                    pattern_id=pattern_id,
                    host_limit=safe_host_limit,
                    host_offset=safe_host_offset,
                    files_per_host=safe_files_per_host,
                    summary=summary,
                    resolved_view=resolved_view,
                ),
            )
        return self._list_incident_inbox_groups_uncached(
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
            pattern_id=pattern_id,
            host_limit=safe_host_limit,
            host_offset=safe_host_offset,
            files_per_host=safe_files_per_host,
            summary=summary,
            resolved_view=resolved_view,
        )

    def _list_incident_inbox_groups_uncached(
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
        pattern_id: Optional[str] = None,
        host_limit: int = 25,
        host_offset: int = 0,
        files_per_host: int = 25,
        summary: bool = False,
        resolved_view: str = "detail",
    ) -> Dict[str, Any]:
        safe_host_limit = max(1, min(100, int(host_limit)))
        safe_host_offset = max(0, int(host_offset))
        safe_files_per_host = max(0, min(100, int(files_per_host)))
        where_clause, params, needs_findings_join, needs_jobs_join = self._build_incident_where_clause(
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
            pattern_id=pattern_id,
        )
        branch_needle = str(branch or "").strip().casefold()
        q_needle = str(q or "").strip().casefold()
        # Branch/q host-context filters still need post-agg Python filtering.
        needs_context_filter = bool(branch_needle) or (
            bool(q_needle) and not looks_like_hostname_query(q_needle)
        )
        # Expand/prefetch: hostname + one host page + file previews — skip full host COUNT.
        hostname_filter = str(hostname or "").strip()
        single_host_expand = (
            bool(hostname_filter)
            and safe_files_per_host > 0
            and safe_host_offset == 0
            and safe_host_limit == 1
            and not needs_context_filter
        )
        count_joins: List[str] = []
        if needs_findings_join:
            count_joins.append("LEFT JOIN scan_findings f ON f.id = i.finding_id")
        if needs_jobs_join:
            count_joins.append("LEFT JOIN scan_jobs j ON j.id = i.job_id")
        count_join_sql = ("\n                ".join(count_joins) + "\n                ") if count_joins else ""
        host_join_sql = ""
        if needs_findings_join or needs_jobs_join:
            host_join_sql = (
                "LEFT JOIN scan_findings f ON f.id = i.finding_id\n"
                "                LEFT JOIN scan_jobs j ON j.id = i.job_id\n                "
            )

        with self._lock, self._connect() as conn:
            total_incidents = conn.execute(
                f"""
                SELECT COUNT(*) as cnt
                FROM scan_incidents i
                {count_join_sql}{where_clause}
                """,
                params,
            ).fetchone()["cnt"]

            host_agg_sql = f"""
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
                    ) as top_severity_rank
                FROM scan_incidents i
                {host_join_sql}{where_clause}
                GROUP BY i.hostname
            """
            order_hosts = (
                "incidents_new DESC, top_severity_rank DESC, last_incident_at DESC, LOWER(hostname) ASC"
            )
            if not needs_context_filter:
                if single_host_expand:
                    host_row = conn.execute(
                        f"""
                        SELECT * FROM ({host_agg_sql}) host_agg
                        ORDER BY {order_hosts}
                        LIMIT 1
                        """,
                        params,
                    ).fetchone()
                    host_rows = [host_row] if host_row else []
                    total_hosts = 1 if host_row else 0
                    has_more = False
                else:
                    total_hosts = int(
                        conn.execute(
                            f"SELECT COUNT(*) AS cnt FROM ({host_agg_sql}) host_agg",
                            params,
                        ).fetchone()["cnt"]
                        or 0
                    )
                    host_rows = conn.execute(
                        f"""
                        SELECT * FROM ({host_agg_sql}) host_agg
                        ORDER BY {order_hosts}
                        LIMIT ? OFFSET ?
                        """,
                        [*params, safe_host_limit, safe_host_offset],
                    ).fetchall()
                paged_hosts = []
                host_names = [
                    str(row["hostname"] or "").strip()
                    for row in host_rows
                    if str(row["hostname"] or "").strip()
                ]
                context = self._scan_host_read_store._batch_host_list_context(conn, host_names)
                for row in host_rows:
                    host_name = str(row["hostname"] or "").strip()
                    if not host_name:
                        continue
                    ctx = context.get(host_name.casefold()) or {}
                    paged_hosts.append(
                        {
                            "id": f"host:{host_name}",
                            "hostname": host_name,
                            "branch": str(ctx.get("branch") or "").strip(),
                            "user": str(ctx.get("user") or "").strip(),
                            "ip_address": str(ctx.get("ip_address") or "").strip(),
                            "incidents_total": int(row["incidents_total"] or 0),
                            "incidents_new": int(row["incidents_new"] or 0),
                            "last_incident_at": int(row["last_incident_at"] or 0),
                            "top_severity": _severity_label_from_rank(row["top_severity_rank"]),
                            "files": [],
                        }
                    )
                if single_host_expand:
                    has_more = False
                else:
                    has_more = (safe_host_offset + len(paged_hosts)) < total_hosts
            else:
                host_rows = conn.execute(
                    f"""
                    SELECT * FROM ({host_agg_sql}) host_agg
                    ORDER BY {order_hosts}
                    """,
                    params,
                ).fetchall()
                host_names = [
                    str(row["hostname"] or "").strip()
                    for row in host_rows
                    if str(row["hostname"] or "").strip()
                ]
                context = self._scan_host_read_store._batch_host_list_context(conn, host_names)
                hosts: List[Dict[str, Any]] = []
                for row in host_rows:
                    host_name = str(row["hostname"] or "").strip()
                    if not host_name:
                        continue
                    ctx = context.get(host_name.casefold()) or {}
                    host_entry = {
                        "id": f"host:{host_name}",
                        "hostname": host_name,
                        "branch": str(ctx.get("branch") or "").strip(),
                        "user": str(ctx.get("user") or "").strip(),
                        "ip_address": str(ctx.get("ip_address") or "").strip(),
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

            # Batch file groups for all paged hosts (eliminates per-host N+1).
            # files_per_host=0 keeps hosts-only payload for overview open (lazy files on expand).
            host_names_page = [str(h.get("hostname") or "").strip() for h in paged_hosts if str(h.get("hostname") or "").strip()]
            files_by_host: Dict[str, List[Dict[str, Any]]] = {name.casefold(): [] for name in host_names_page}
            if host_names_page and safe_files_per_host > 0:
                host_placeholders = ", ".join("?" for _ in host_names_page)
                hosts_lower = [name.casefold() for name in host_names_page]
                host_filter = (
                    f"{where_clause} AND LOWER(i.hostname) IN ({host_placeholders})"
                    if where_clause
                    else f"WHERE LOWER(i.hostname) IN ({host_placeholders})"
                )
                file_key_expr = (
                    "COALESCE(NULLIF(TRIM(i.file_path), ''), NULLIF(TRIM(j.file_name), ''), i.id)"
                )
                file_agg_sql = f"""
                    SELECT
                        i.hostname AS hostname,
                        {file_key_expr} AS file_key,
                        MAX(i.file_path) AS file_path,
                        MAX(j.file_name) AS file_name,
                        MAX(j.source_kind) AS source_kind,
                        COUNT(*) AS incidents_total,
                        SUM(CASE WHEN i.status='new' THEN 1 ELSE 0 END) AS incidents_new,
                        MAX(i.created_at) AS last_incident_at,
                        MAX(
                            CASE LOWER(i.severity)
                                WHEN 'high' THEN 3
                                WHEN 'medium' THEN 2
                                WHEN 'low' THEN 1
                                ELSE 0
                            END
                        ) AS top_severity_rank
                    FROM scan_incidents i
                    LEFT JOIN scan_findings f ON f.id = i.finding_id
                    LEFT JOIN scan_jobs j ON j.id = i.job_id
                    {host_filter}
                    GROUP BY i.hostname, {file_key_expr}
                """
                order_files = (
                    "incidents_new DESC, top_severity_rank DESC, last_incident_at DESC, file_key ASC"
                )
                if len(host_names_page) == 1:
                    # Single-host expand: plain LIMIT, no PARTITION window.
                    file_rows = conn.execute(
                        f"""
                        SELECT * FROM ({file_agg_sql}) agg
                        ORDER BY {order_files}
                        LIMIT ?
                        """,
                        [*params, *hosts_lower, safe_files_per_host],
                    ).fetchall()
                else:
                    file_rows = conn.execute(
                        f"""
                        SELECT * FROM (
                            SELECT
                                agg.*,
                                ROW_NUMBER() OVER (
                                    PARTITION BY LOWER(agg.hostname)
                                    ORDER BY
                                        agg.incidents_new DESC,
                                        agg.top_severity_rank DESC,
                                        agg.last_incident_at DESC,
                                        agg.file_key ASC
                                ) AS rn
                            FROM ({file_agg_sql}) agg
                        ) ranked
                        WHERE rn <= ?
                        ORDER BY LOWER(hostname) ASC, rn ASC
                        """,
                        [*params, *hosts_lower, safe_files_per_host],
                    ).fetchall()

                # Optional preview ids (summary) or full previews (detail) — one batch.
                preview_map: Dict[str, Dict[str, Any]] = {}
                if summary:
                    if self.is_postgres and file_rows:
                        id_rows = conn.execute(
                            f"""
                            SELECT DISTINCT ON (LOWER(i.hostname), {file_key_expr})
                                LOWER(i.hostname) AS host_key,
                                {file_key_expr} AS file_key,
                                i.id
                            FROM scan_incidents i
                            LEFT JOIN scan_jobs j ON j.id = i.job_id
                            {host_filter}
                            ORDER BY LOWER(i.hostname), {file_key_expr}, i.created_at DESC
                            """,
                            [*params, *hosts_lower],
                        ).fetchall()
                        for row in id_rows:
                            preview_map[
                                f"{str(row['host_key'] or '').strip()}::{str(row['file_key'] or '').strip()}"
                            ] = {"id": str(row["id"] or "").strip()}
                else:
                    # Detail: keep legacy per-host preview helper for correctness.
                    for host_name in host_names_page:
                        host_where = (
                            f"{where_clause} AND LOWER(i.hostname) = LOWER(?)"
                            if where_clause
                            else "WHERE LOWER(i.hostname) = LOWER(?)"
                        )
                        host_params = [*params, host_name]
                        keys = [
                            str(r["file_key"] or "").strip()
                            for r in file_rows
                            if str(r["hostname"] or "").strip().casefold() == host_name.casefold()
                        ]
                        local = self._fetch_inbox_file_previews(
                            conn,
                            host_where=host_where,
                            host_params=host_params,
                            file_keys=keys,
                            summary=False,
                        )
                        for key, value in local.items():
                            preview_map[f"{host_name.casefold()}::{key}"] = value

                for file_row in file_rows:
                    host_name = str(file_row["hostname"] or "").strip()
                    if not host_name:
                        continue
                    file_key = str(file_row["file_key"] or "").strip()
                    file_path = str(file_row["file_path"] or "").strip()
                    file_name = str(file_row["file_name"] or "").strip()
                    preview_incident = preview_map.get(f"{host_name.casefold()}::{file_key}")
                    if summary:
                        fragments = []
                        preview_out = None
                    else:
                        patterns = preview_incident.get("matched_patterns") if preview_incident else []
                        fragments = _top_fragments_from_patterns(patterns)
                        preview_out = preview_incident
                    files_by_host.setdefault(host_name.casefold(), []).append(
                        {
                            "id": f"file:{host_name}:{file_key}",
                            "host": host_name,
                            "file_key": file_key,
                            "file_path": (file_path or file_name or file_key)[:500],
                            "file_name": file_name[:260],
                            "file_ext": _file_ext_from_values(file_name, file_path),
                            "source_kind": str(file_row["source_kind"] or "").strip().lower(),
                            "incidents_total": int(file_row["incidents_total"] or 0),
                            "incidents_new": int(file_row["incidents_new"] or 0),
                            "last_incident_at": int(file_row["last_incident_at"] or 0),
                            "top_severity": _severity_label_from_rank(file_row["top_severity_rank"]),
                            "preview_incident": preview_out,
                            "preview_incident_id": str((preview_incident or {}).get("id") or "").strip(),
                            "fragments": fragments,
                        }
                    )
            for host_entry in paged_hosts:
                host_entry["files"] = files_by_host.get(str(host_entry.get("hostname") or "").casefold(), [])

        return {
            "total_incidents": int(total_incidents),
            "total_hosts": int(total_hosts),
            "items": paged_hosts,
            "has_more": bool(has_more),
            "host_limit": safe_host_limit,
            "host_offset": safe_host_offset,
            "files_per_host": safe_files_per_host,
            "view": resolved_view,
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

        def _write() -> Dict[str, Any]:
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
                    where_clause, params, needs_findings_join, needs_jobs_join = self._build_incident_where_clause(
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
                        pattern_id=filter_payload.get("pattern_id"),
                    )
                    count_joins: List[str] = []
                    if needs_findings_join:
                        count_joins.append("LEFT JOIN scan_findings f ON f.id = i.finding_id")
                    if needs_jobs_join:
                        count_joins.append("LEFT JOIN scan_jobs j ON j.id = i.job_id")
                    count_join_sql = ("\n                        ".join(count_joins) + "\n                        ") if count_joins else ""
                    total_matched = conn.execute(
                        f"""
                        SELECT COUNT(*)
                        FROM scan_incidents i
                        {count_join_sql}{where_clause}
                        """,
                        params,
                    ).fetchone()[0]
                    ack_where = f"{where_clause} AND i.status='new'" if where_clause else "WHERE i.status='new'"
                    # Single UPDATE … WHERE id IN (SELECT …) — no SELECT-all into Python.
                    cursor = conn.execute(
                        f"""
                        UPDATE scan_incidents
                        SET status='ack', ack_at=?, ack_by=?
                        WHERE id IN (
                            SELECT i.id
                            FROM scan_incidents i
                            LEFT JOIN scan_findings f ON f.id = i.finding_id
                            LEFT JOIN scan_jobs j ON j.id = i.job_id
                            {ack_where}
                        )
                        """,
                        [now_ts, actor, *params],
                    )
                    acked_count = cursor.rowcount if cursor.rowcount is not None else 0
                conn.commit()
            return {"success": True, "acked_count": int(acked_count or 0), "total_matched": int(total_matched or 0)}

        return self._run_write_transaction("bulk_ack_incidents", _write)

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
        cache_key = (
            f"hosts_table|{self.db_path}|{self.database_url}|"
            f"q={str(q or '').strip().lower()}|b={str(branch or '').strip().lower()}|"
            f"s={str(status or '').strip().lower()}|sev={str(severity or '').strip().lower()}|"
            f"l={int(limit)}|o={int(offset)}|sb={str(sort_by or '')}|sd={str(sort_dir or '')}"
        )

        def _compute() -> Dict[str, Any]:
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

        if self.is_postgres:
            return _read_cache_single_flight(cache_key, _compute)
        return _compute()

    def ack_incident(self, *, incident_id: str, ack_by: str) -> Optional[Dict[str, Any]]:
        iid = str(incident_id or "").strip()
        if not iid:
            return None
        now_ts = _now_ts()

        def _write() -> Optional[Dict[str, Any]]:
            with self._lock, self._connect() as conn:
                row = conn.execute(
                    "SELECT id, status FROM scan_incidents WHERE id=?",
                    (iid,),
                ).fetchone()
                if row is None:
                    return None
                current_status = str(row["status"] or "").strip().lower()
                if current_status != "new":
                    return {"id": iid, "status": current_status, "changed": False}
                conn.execute(
                    """
                    UPDATE scan_incidents
                    SET status='ack', ack_at=?, ack_by=?
                    WHERE id=? AND status='new'
                    """,
                    (now_ts, str(ack_by or "").strip(), iid),
                )
                conn.commit()
            return {"id": iid, "status": "ack", "ack_at": now_ts, "ack_by": str(ack_by or "").strip(), "changed": True}

        return self._run_write_transaction("ack_incident", _write)

    def list_host_scan_runs(
        self,
        *,
        hostname: str,
        limit: int = 30,
        offset: int = 0,
        view: str = "detail",
    ) -> Dict[str, Any]:
        return self._scan_host_read_store.list_host_scan_runs(
            hostname=hostname,
            limit=limit,
            offset=offset,
            view=view,
        )

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
        cache_key = (
            f"agents_table|{self.db_path}|{self.database_url}|"
            f"q={str(q or '').strip().lower()}|b={str(branch or '').strip().lower()}|"
            f"on={str(online or '').strip().lower()}|ts={str(task_status or '').strip().lower()}|"
            f"l={int(limit)}|o={int(offset)}|sb={str(sort_by or '')}|sd={str(sort_dir or '')}"
        )

        def _compute() -> Dict[str, Any]:
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

        if self.is_postgres:
            return _read_cache_single_flight(cache_key, _compute)
        return _compute()

    def list_branches(self) -> List[str]:
        return self._scan_agent_read_store.list_branches()

    def list_incomplete_jobs(
        self,
        *,
        limit: int = 100,
        offset: int = 0,
        view: str = "summary",
    ) -> Dict[str, Any]:
        safe_limit = max(1, min(500, int(limit)))
        safe_offset = max(0, int(offset))
        resolved_view = normalize_scan_list_view(view, default="summary")
        summary = resolved_view == "summary"
        with self._lock, self._connect() as conn:
            total = int(
                conn.execute(
                    "SELECT COUNT(*) AS c FROM scan_jobs WHERE status IN ('analysis_incomplete', 'failed')"
                ).fetchone()["c"]
                or 0
            )
            if summary:
                # Never touch payload_json here: jobs often store huge pdf_slice_b64 and
                # even jsonb path extraction timed out (SQLSTATE 57014) under 5s.
                # Do NOT fake empty analysis_version / outcomes / count=0 — omit details.
                rows = conn.execute(
                    """
                    SELECT
                        id, agent_id, hostname, branch, file_path, file_name, source_kind,
                        status, summary, error_text, created_at, finished_at
                    FROM scan_jobs
                    WHERE status IN ('analysis_incomplete', 'failed')
                    ORDER BY COALESCE(finished_at, created_at) DESC
                    LIMIT ? OFFSET ?
                    """,
                    (safe_limit, safe_offset),
                ).fetchall()
                items = []
                for row in rows:
                    item = dict(row)
                    item["analysis_version"] = None
                    item["extraction_outcomes"] = None
                    item["extraction_outcomes_count"] = None
                    item["details_omitted"] = True
                    item["reason"] = str(item.get("error_text") or item.get("summary") or "analysis_incomplete")
                    items.append(item)
                return {
                    "items": items,
                    "total": total,
                    "limit": safe_limit,
                    "offset": safe_offset,
                    "view": resolved_view,
                    "details_omitted": True,
                }
            rows = conn.execute(
                """
                SELECT id, agent_id, hostname, branch, file_path, file_name, source_kind,
                       status, summary, error_text, created_at, finished_at, payload_json
                FROM scan_jobs
                WHERE status IN ('analysis_incomplete', 'failed')
                ORDER BY COALESCE(finished_at, created_at) DESC
                LIMIT ? OFFSET ?
                """,
                (safe_limit, safe_offset),
            ).fetchall()
        items: List[Dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            payload = _json_loads(item.pop("payload_json", "{}"), {})
            metadata = payload.get("metadata") if isinstance(payload, dict) and isinstance(payload.get("metadata"), dict) else {}
            item["analysis_version"] = str(metadata.get("analysis_version") or "")
            outcomes = metadata.get("extraction_outcomes") if isinstance(metadata.get("extraction_outcomes"), list) else []
            item["extraction_outcomes"] = outcomes[:20]
            item["extraction_outcomes_count"] = len(outcomes)
            item["reason"] = str(item.get("error_text") or item.get("summary") or "analysis_incomplete")
            items.append(item)
        return {
            "items": items,
            "total": total,
            "limit": safe_limit,
            "offset": safe_offset,
            "view": resolved_view,
        }

    def dashboard(self) -> Dict[str, Any]:
        t_lock0 = time.perf_counter()
        now_ts = _now_ts()
        day_seconds = 24 * 60 * 60
        window_start = now_ts - 29 * day_seconds
        performance_start = now_ts - day_seconds
        timing: Dict[str, float] = {}
        # Filesystem spool stats outside DB lock (TTL-cached inside spool helper).
        t_fs0 = time.perf_counter()
        transient_stats = self.transient_pdf_spool_stats()
        timing["spool_stats_ms"] = round((time.perf_counter() - t_fs0) * 1000.0, 2)
        with self._lock, self._connect() as conn:
            t_conn = time.perf_counter()
            timing["lock_wait_ms"] = round((t_conn - t_lock0) * 1000.0, 2)
            # One scan over agents for totals / online / outbox / versions.
            agent_agg = conn.execute(
                """
                SELECT
                    COUNT(*) AS agents_total,
                    COALESCE(SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END), 0) AS agents_online,
                    COALESCE(SUM(COALESCE(outbox_depth, 0)), 0) AS outbox_total,
                    COALESCE(SUM(COALESCE(dead_letter_depth, 0)), 0) AS dead_letter_total,
                    COALESCE(SUM(CASE WHEN COALESCE(outbox_depth, 0) > 0 THEN 1 ELSE 0 END), 0) AS agents_with_outbox,
                    COALESCE(SUM(CASE WHEN COALESCE(dead_letter_depth, 0) > 0 THEN 1 ELSE 0 END), 0) AS agents_with_dead_letter
                FROM scan_agents
                """,
                (now_ts - self.agent_online_timeout_sec,),
            ).fetchone()
            agents_total = int(agent_agg["agents_total"] or 0)
            agents_online = int(agent_agg["agents_online"] or 0)
            outbox_totals_row = agent_agg
            agent_version_rows = conn.execute(
                """
                SELECT COALESCE(NULLIF(TRIM(version), ''), 'unknown') AS version, COUNT(*) AS c
                FROM scan_agents
                GROUP BY COALESCE(NULLIF(TRIM(version), ''), 'unknown')
                ORDER BY c DESC, version ASC
                """
            ).fetchall()
            # Cheap rollout counters from active/recent self_update tasks.
            # Do NOT SELECT last_heartbeat_json for all agents — that payload is huge and
            # holds the SQLite lock long enough to starve /agents/table and UI loads.
            update_stuck_after_sec = 30 * 60
            task_queue_row = conn.execute(
                """
                SELECT
                    COALESCE(SUM(CASE
                        WHEN command='self_update'
                         AND status IN ('queued', 'delivered', 'acknowledged')
                         AND ttl_at > ?
                        THEN 1 ELSE 0 END), 0) AS update_pending,
                    COALESCE(SUM(CASE
                        WHEN status IN ('queued', 'delivered', 'acknowledged') AND ttl_at > ?
                        THEN 1 ELSE 0 END), 0) AS queue_active,
                    COALESCE(SUM(CASE WHEN status='expired' THEN 1 ELSE 0 END), 0) AS queue_expired
                FROM scan_tasks
                """,
                (now_ts, now_ts),
            ).fetchone()
            update_pending_row = {"c": int(task_queue_row["update_pending"] or 0)}
            queue_active = int(task_queue_row["queue_active"] or 0)
            queue_expired = int(task_queue_row["queue_expired"] or 0)
            # Bound stuck-update scan: only self_update rows, narrow columns.
            update_stuck_row = conn.execute(
                """
                SELECT COUNT(*) AS c
                FROM scan_tasks t
                LEFT JOIN scan_agents a ON lower(a.agent_id) = lower(t.agent_id)
                WHERE t.command='self_update'
                  AND t.status IN ('acknowledged', 'completed')
                  AND t.updated_at <= ?
                  AND (
                        t.result_json LIKE '%"pending_update": true%'
                     OR t.result_json LIKE '%"phase": "installer_launched"%'
                     OR t.result_json LIKE '%"phase": "verifying"%'
                     OR t.result_json LIKE '%"installer_launched": true%'
                  )
                  AND COALESCE(NULLIF(TRIM(a.version), ''), '') != ?
                """,
                (now_ts - update_stuck_after_sec, str(AGENT_VERSION)),
            ).fetchone()
            incident_agg = conn.execute(
                """
                SELECT
                    COUNT(*) AS incidents_total,
                    COALESCE(SUM(CASE WHEN status='new' THEN 1 ELSE 0 END), 0) AS incidents_new
                FROM scan_incidents
                """
            ).fetchone()
            incidents_total = int(incident_agg["incidents_total"] or 0)
            incidents_new = int(incident_agg["incidents_new"] or 0)
            t_jobs0 = time.perf_counter()
            job_rows, completed_24h_from_jobs, ocr_timeout_jobs = _load_dashboard_job_aggregates(
                conn,
                is_postgres=self.is_postgres,
                performance_start=performance_start,
            )
            timing["sql_jobs_groupby_ms"] = round((time.perf_counter() - t_jobs0) * 1000.0, 2)
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
            if self.is_postgres:
                day_rows = conn.execute(
                    """
                    SELECT
                        to_char(to_timestamp(created_at), 'YYYY-MM-DD') as day_key,
                        COUNT(*) as c
                    FROM scan_incidents
                    WHERE created_at >= ?
                    GROUP BY day_key
                    ORDER BY day_key ASC
                    """,
                    (window_start,),
                ).fetchall()
            else:
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
            # FE does not render incomplete_by_extension; avoid cold GROUP BY file_name.
            incomplete_rows = []
            # Skip result_json scan on cold dashboard — unsupported/deferred are helper-only
            # and blob deserialization dominated first-hit map/ser time.
            recent_task_results = []
            completed_24h_row = {"c": int(completed_24h_from_jobs)}
            # Bound metrics_json deserialization: finished sample only (OCR DPI / ocr_ms).
            # Cold-path caps (samples_capped already advertised in payload).
            perf_sample_limit = min(_DASHBOARD_PERFORMANCE_SAMPLE_LIMIT, 150)
            pending_sample_limit = min(_DASHBOARD_PENDING_SAMPLE_LIMIT, 100)
            finished_performance_rows = conn.execute(
                """
                SELECT status, source_kind, created_at, started_at, finished_at, metrics_json
                FROM scan_jobs
                WHERE COALESCE(finished_at, created_at) >= ?
                  AND status NOT IN ('queued', 'processing')
                ORDER BY COALESCE(finished_at, created_at) DESC
                LIMIT ?
                """,
                (performance_start, perf_sample_limit),
            ).fetchall()
            # Oldest pending: per-status LIMIT 1 (avoid IN(...)+ASC over large table).
            # Two scalar probes — SQLite rejects parenthesized UNION ALL subselects.
            queued_oldest = conn.execute(
                """
                SELECT created_at
                FROM scan_jobs
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                """
            ).fetchone()
            processing_oldest = conn.execute(
                """
                SELECT created_at
                FROM scan_jobs
                WHERE status = 'processing'
                ORDER BY created_at ASC
                LIMIT 1
                """
            ).fetchone()
            oldest_candidates = [
                int(row["created_at"] or 0)
                for row in (queued_oldest, processing_oldest)
                if row and row["created_at"]
            ]
            pending_oldest_row = {
                "oldest_created_at": min(oldest_candidates) if oldest_candidates else 0
            }
            # Pending sample via DESC — cheap with few thousand pending rows.
            pending_performance_rows = conn.execute(
                """
                SELECT status, source_kind, created_at, started_at, finished_at
                FROM scan_jobs
                WHERE status IN ('queued', 'processing')
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (pending_sample_limit,),
            ).fetchall()
            performance_rows = list(finished_performance_rows) + list(pending_performance_rows)
            timing["sql_total_ms"] = round((time.perf_counter() - t_conn) * 1000.0, 2)

        t_map0 = time.perf_counter()
        agent_versions = [
            {"version": str(row["version"] or "unknown"), "count": int(row["c"] or 0)}
            for row in agent_version_rows
        ]
        agents_current = sum(
            item["count"] for item in agent_versions if item["version"] == AGENT_VERSION
        )
        agents_outdated = max(0, int(agents_total) - int(agents_current))
        agents_update_pending = int((update_pending_row["c"] if update_pending_row else 0) or 0)
        agents_update_stuck = int((update_stuck_row["c"] if update_stuck_row else 0) or 0)
        agents_outbox_total = int((outbox_totals_row["outbox_total"] if outbox_totals_row else 0) or 0)
        agents_dead_letter_total = int((outbox_totals_row["dead_letter_total"] if outbox_totals_row else 0) or 0)
        agents_with_outbox = int((outbox_totals_row["agents_with_outbox"] if outbox_totals_row else 0) or 0)
        agents_with_dead_letter = int((outbox_totals_row["agents_with_dead_letter"] if outbox_totals_row else 0) or 0)
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
            "analysis_incomplete": 0,
            "total": 0,
            "pdf_queued": 0,
            "pdf_processing": 0,
            "pdf_done_clean": 0,
            "pdf_done_with_incident": 0,
            "pdf_failed": 0,
            "pdf_analysis_incomplete": 0,
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
            if source_kind in {"pdf", "pdf_slice", "image", "office"}:
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
        incomplete_by_extension: Dict[str, int] = {}
        for row in incomplete_rows:
            suffix = Path(str(row["file_name"] or "")).suffix.lower() or "<none>"
            incomplete_by_extension[suffix] = int(incomplete_by_extension.get(suffix) or 0) + int(row["c"] or 0)
        unsupported_files = 0
        deferred_files = 0
        skipped_by_extension: Dict[str, int] = {}
        for row in recent_task_results:
            result = _json_loads(row["result_json"], {})
            if not isinstance(result, dict):
                continue
            unsupported_files += int(result.get("unsupported") or 0)
            deferred_files += int(result.get("deferred") or 0)
            excluded_extensions = result.get("excluded_by_extension")
            if isinstance(excluded_extensions, dict):
                for extension, count in excluded_extensions.items():
                    key = str(extension or "<none>")
                    skipped_by_extension[key] = int(skipped_by_extension.get(key) or 0) + int(count or 0)

        queue_wait_values: List[float] = []
        processing_values: List[float] = []
        ocr_values: List[float] = []
        conversion_values: List[float] = []
        full_dpi_values: List[float] = []
        focused_dpi_values: List[float] = []
        completed_24h = int((completed_24h_row["c"] if completed_24h_row else 0) or 0)
        downscaled_large_pages = 0
        oldest_pending = int((pending_oldest_row["oldest_created_at"] if pending_oldest_row else 0) or 0)
        pending_oldest_age_sec = max(0, now_ts - oldest_pending) if oldest_pending else 0
        for row in performance_rows:
            created_at = int(row["created_at"] or 0)
            started_at = int(row["started_at"] or 0)
            finished_at = int(row["finished_at"] or 0)
            metrics: Dict[str, Any] = {}
            try:
                raw_metrics = row["metrics_json"]
            except (KeyError, IndexError):
                raw_metrics = None
            if raw_metrics:
                parsed = _json_loads(raw_metrics, {})
                if isinstance(parsed, dict):
                    metrics = parsed
            qw = metrics.get("queue_wait_ms")
            pm = metrics.get("processing_ms")
            om = metrics.get("ocr_ms")
            cm = metrics.get("conversion_ms")
            if qw is not None:
                queue_wait_values.append(float(qw or 0))
            elif created_at and started_at and started_at >= created_at:
                queue_wait_values.append(float(max(0, started_at - created_at) * 1000))
            if pm is not None:
                processing_values.append(float(pm or 0))
            elif started_at and finished_at and finished_at >= started_at:
                processing_values.append(float(max(0, finished_at - started_at) * 1000))
            if om is not None:
                ocr_values.append(float(om or 0))
            if cm is not None:
                conversion_values.append(float(cm or 0))
            ocr_meta = metrics.get("ocr") if isinstance(metrics.get("ocr"), dict) else {}
            full_dpi = ocr_meta.get("full_effective_dpi_min", metrics.get("full_effective_dpi_min"))
            focused_dpi = ocr_meta.get("focused_effective_dpi_min", metrics.get("focused_effective_dpi_min"))
            if full_dpi is not None:
                try:
                    full_dpi_values.append(float(full_dpi))
                except (TypeError, ValueError):
                    pass
            if focused_dpi is not None:
                try:
                    focused_dpi_values.append(float(focused_dpi))
                except (TypeError, ValueError):
                    pass
            lp = metrics.get("large_pages_downscaled", ocr_meta.get("large_pages_downscaled"))
            if lp is not None:
                try:
                    downscaled_large_pages += int(lp or 0)
                except (TypeError, ValueError):
                    pass
            elif full_dpi is not None:
                # Legacy samples expose downscale via DPI fields without an explicit counter.
                downscaled_large_pages += 1

        performance = {
            "window_hours": 24,
            "samples": len(performance_rows),
            "samples_capped": True,
            "completed": completed_24h,
            "throughput_per_hour": round(completed_24h / 24.0, 1),
            "pending_oldest_age_sec": max(0, pending_oldest_age_sec),
            "queue_wait_ms": {
                "p50": _percentile(queue_wait_values, 0.50),
                "p95": _percentile(queue_wait_values, 0.95),
            },
            "processing_ms": {
                "p50": _percentile(processing_values, 0.50),
                "p95": _percentile(processing_values, 0.95),
            },
            "ocr_ms": {
                "p50": _percentile(ocr_values, 0.50),
                "p95": _percentile(ocr_values, 0.95),
            },
            "conversion_ms": {
                "p50": _percentile(conversion_values, 0.50),
                "p95": _percentile(conversion_values, 0.95),
            },
            "large_pages_downscaled": downscaled_large_pages,
            "full_effective_dpi_min": min(full_dpi_values) if full_dpi_values else None,
            "focused_effective_dpi_min": min(focused_dpi_values) if focused_dpi_values else None,
        }

        timing["map_ser_ms"] = round((time.perf_counter() - t_map0) * 1000.0, 2)
        timing["total_ms"] = round((time.perf_counter() - t_lock0) * 1000.0, 2)

        return {
            "totals": {
                "agents_total": int(agents_total),
                "agents_online": int(agents_online),
                "agents_offline": int(max(0, agents_total - agents_online)),
                "agents_current_version": int(agents_current),
                "agents_outdated": int(agents_outdated),
                "agents_update_pending": int(agents_update_pending),
                "agents_update_stuck": int(agents_update_stuck),
                "agents_outbox_total": int(agents_outbox_total),
                "agents_dead_letter_total": int(agents_dead_letter_total),
                "agents_with_outbox": int(agents_with_outbox),
                "agents_with_dead_letter": int(agents_with_dead_letter),
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
                "server_pdf_incomplete": int(job_counts["pdf_analysis_incomplete"]),
                "server_jobs_processed": int(job_counts["completed"]),
                "server_jobs_failed": int(job_counts["failed"]),
                "analysis_incomplete": int(job_counts["analysis_incomplete"]),
                "unsupported_files": unsupported_files,
                "deferred_files": deferred_files,
                "transient_pdf_count": int(transient_stats["count"]),
                "transient_pdf_gb": float(transient_stats["gb"]),
                "ocr_timeout_jobs": int(ocr_timeout_jobs or 0),
            },
            "job_queue": job_counts,
            "expected_agent_version": AGENT_VERSION,
            "agent_versions": agent_versions,
            "performance": performance,
            "transient_pdf_spool": transient_stats,
            "by_severity": [{"severity": str(row["severity"] or "unknown"), "count": int(row["c"] or 0)} for row in sev_rows],
            "by_branch": [{"branch": str(row["branch"] or "Не определён"), "count": int(row["c"] or 0)} for row in branch_rows],
            "daily": daily,
            "new_hosts": [str(row["hostname"] or "unknown") for row in new_rows],
            "incomplete_by_extension": [
                {"extension": extension, "count": count}
                for extension, count in sorted(incomplete_by_extension.items(), key=lambda item: (-item[1], item[0]))
            ],
            "skipped_by_extension": [
                {"extension": extension, "count": count}
                for extension, count in sorted(skipped_by_extension.items(), key=lambda item: (-item[1], item[0]))
            ],
            "timing_breakdown_ms": timing,
        }

    def _count_retention_candidates_locked(
        self,
        conn: sqlite3.Connection,
        *,
        table: str,
        where_sql: str,
        params: tuple[Any, ...],
    ) -> int:
        row = conn.execute(f"SELECT COUNT(*) AS cnt FROM {table} WHERE {where_sql}", params).fetchone()
        return int(row["cnt"] if row is not None else 0)

    def _delete_retention_batches_locked(
        self,
        conn,
        *,
        table: str,
        where_sql: str,
        params: tuple[Any, ...],
        batch_size: int,
    ) -> int:
        total = 0
        safe_batch_size = max(1, min(5000, int(batch_size or 1000)))
        while True:
            if self.is_postgres:
                cursor = conn.execute(
                    f"""
                    DELETE FROM {table}
                    WHERE ctid IN (
                        SELECT ctid
                        FROM {table}
                        WHERE {where_sql}
                        LIMIT ?
                    )
                    """,
                    (*params, safe_batch_size),
                )
            else:
                cursor = conn.execute(
                    f"""
                    DELETE FROM {table}
                    WHERE rowid IN (
                        SELECT rowid
                        FROM {table}
                        WHERE {where_sql}
                        LIMIT ?
                    )
                    """,
                    (*params, safe_batch_size),
                )
            removed = int(cursor.rowcount or 0)
            if removed <= 0:
                break
            total += removed
            conn.commit()
            if removed < safe_batch_size:
                break
        return total

    def cleanup_retention(
        self,
        *,
        retention_days: int,
        clean_job_retention_days: Optional[int] = None,
        failed_job_retention_days: Optional[int] = None,
        incident_retention_days: Optional[int] = None,
        batch_size: int = 1000,
        dry_run: bool = False,
    ) -> Dict[str, int]:
        incident_days = max(1, int(incident_retention_days or retention_days))
        clean_days = max(1, int(clean_job_retention_days or _env_int("SCAN_CLEAN_JOB_RETENTION_DAYS", 14)))
        failed_days = max(1, int(failed_job_retention_days or _env_int("SCAN_FAILED_JOB_RETENTION_DAYS", 30)))
        clean_cutoff = _now_ts() - clean_days * 24 * 60 * 60
        failed_cutoff = _now_ts() - failed_days * 24 * 60 * 60
        incident_cutoff = _now_ts() - incident_days * 24 * 60 * 60
        task_cutoff = min(failed_cutoff, incident_cutoff)

        specs = [
            (
                "system_metrics",
                "scan_task_system_metrics",
                "scan_task_id IN (SELECT id FROM scan_tasks WHERE status IN ('completed', 'failed', 'expired') AND updated_at < ?)",
                (task_cutoff,),
            ),
            (
                "tasks",
                "scan_tasks",
                "status IN ('completed', 'failed', 'expired') AND updated_at < ?",
                (task_cutoff,),
            ),
            ("incidents", "scan_incidents", "created_at < ?", (incident_cutoff,)),
            ("findings", "scan_findings", "created_at < ?", (incident_cutoff,)),
            (
                "jobs_clean",
                "scan_jobs",
                """
                status='done_clean' AND created_at < ?
                AND NOT EXISTS (SELECT 1 FROM scan_incidents i WHERE i.job_id=scan_jobs.id)
                """,
                (clean_cutoff,),
            ),
            (
                "jobs_failed",
                "scan_jobs",
                """
                status IN ('failed', 'analysis_incomplete') AND created_at < ?
                AND NOT EXISTS (SELECT 1 FROM scan_incidents i WHERE i.job_id=scan_jobs.id)
                """,
                (failed_cutoff,),
            ),
            (
                "jobs_with_incident",
                "scan_jobs",
                "status='done_with_incident' AND created_at < ?",
                (incident_cutoff,),
            ),
        ]

        result = {
            "artifact_rows": 0,
            "artifact_files": 0,
            "observations": 0,
            "system_metrics": 0,
            "tasks": 0,
            "incidents": 0,
            "findings": 0,
            "jobs_clean": 0,
            "jobs_failed": 0,
            "jobs_with_incident": 0,
        }

        def _write() -> Dict[str, int]:
            with self._lock, self._connect() as conn:
                observation_where = """
                    scan_task_id IN (
                        SELECT id FROM scan_tasks
                        WHERE status IN ('completed', 'failed', 'expired') AND updated_at < ?
                    )
                    OR linked_incident_id IN (
                        SELECT id FROM scan_incidents WHERE created_at < ?
                    )
                    OR linked_job_id IN (
                        SELECT id FROM scan_jobs
                        WHERE (
                            status='done_clean' AND created_at < ?
                            AND NOT EXISTS (
                                SELECT 1 FROM scan_incidents i WHERE i.job_id=scan_jobs.id
                            )
                        ) OR (
                            status IN ('failed', 'analysis_incomplete') AND created_at < ?
                            AND NOT EXISTS (
                                SELECT 1 FROM scan_incidents i WHERE i.job_id=scan_jobs.id
                            )
                        ) OR (
                            status='done_with_incident' AND created_at < ?
                        )
                    )
                """
                observation_params = (
                    task_cutoff,
                    incident_cutoff,
                    clean_cutoff,
                    failed_cutoff,
                    incident_cutoff,
                )
                if dry_run:
                    result["observations"] = self._count_retention_candidates_locked(
                        conn,
                        table="scan_task_file_observations",
                        where_sql=observation_where,
                        params=observation_params,
                    )
                else:
                    result["observations"] = self._delete_retention_batches_locked(
                        conn,
                        table="scan_task_file_observations",
                        where_sql=observation_where,
                        params=observation_params,
                        batch_size=batch_size,
                    )
                for key, table, where_sql, params in specs:
                    if dry_run:
                        result[key] = self._count_retention_candidates_locked(
                            conn,
                            table=table,
                            where_sql=where_sql,
                            params=params,
                        )
                    else:
                        result[key] = self._delete_retention_batches_locked(
                            conn,
                            table=table,
                            where_sql=where_sql,
                            params=params,
                            batch_size=batch_size,
                        )
                if not dry_run:
                    conn.commit()
                return dict(result)

        return self._run_write_transaction("cleanup_retention", _write)
