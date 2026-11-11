"""Shared helpers for Hub task audit benches (TASK-AUDIT)."""
from __future__ import annotations

import json
import math
import re
import statistics
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
TITLE_PREFIX = "BenchAudit "

NOT_INSTRUMENTED = "not_instrumented"

STAGE_KEYS = (
    "validate_ms",
    "db_pool_wait_ms",
    "lock_wait_ms",
    "db_write_ms",
    "status_log_ms",
    "notifications_ms",
    "email_enqueue_ms",
    "push_enqueue_or_flush_ms",
    "chat_discussion_ms",
    "commit_ms",
    "serialize_ms",
    "http_total_ms",
    "enrich_ms",
    "push_flush_ms",
)


def git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(ROOT),
            check=True,
            capture_output=True,
            text=True,
        )
        return (result.stdout or "").strip() or None
    except Exception:
        return None


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 2)
    rank = (len(ordered) - 1) * (pct / 100.0)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return round(ordered[low], 2)
    weight = rank - low
    return round(ordered[low] * (1.0 - weight) + ordered[high] * weight, 2)


def summary(values: list[float], *, status: str = "measured") -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": status,
        "n": len(values) if status == "measured" else 0,
        "p50_ms": None,
        "p90_ms": None,
        "p95_ms": None,
        "p99_ms": None,
        "avg_ms": None,
        "max_ms": None,
    }
    if status != "measured" or not values:
        if status == "measured" and not values:
            payload["status"] = "not_available"
        return payload
    payload.update(
        {
            "p50_ms": percentile(values, 50),
            "p90_ms": percentile(values, 90),
            "p95_ms": percentile(values, 95),
            "p99_ms": percentile(values, 99),
            "avg_ms": round(statistics.fmean(values), 2),
            "max_ms": round(max(values), 2),
            "p99_note": "advisory_only_at_n_lt_500" if len(values) < 500 else "usable_for_conclusions",
        }
    )
    return payload


def redact_database_target(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url)
        host = parsed.hostname or "unknown-host"
        port = f":{parsed.port}" if parsed.port else ""
        db = (parsed.path or "").lstrip("/") or "unknown-db"
        return f"{parsed.scheme}://***:***@{host}{port}/{db}"
    except Exception:
        return "redacted"


def extract_sqlstate(exc: BaseException | None) -> str | None:
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        for attr in ("sqlstate", "pgcode"):
            value = getattr(current, attr, None)
            if value:
                return str(value)
        orig = getattr(current, "orig", None)
        if isinstance(orig, BaseException):
            current = orig
            continue
        current = current.__cause__ or current.__context__
    return None


def classify_db_error(exc: BaseException) -> dict[str, Any]:
    text = str(exc)
    sqlstate = extract_sqlstate(exc)
    lowered = text.lower()
    exc_name = type(exc).__name__
    if exc_name == "TaskTransitionConflict" or "task_transition_conflict" in lowered:
        error_class = "task_transition_conflict"
    elif sqlstate == "40P01" or "deadlock" in lowered or "взаимоблокиров" in lowered:
        error_class = "deadlock_detected"
        sqlstate = sqlstate or "40P01"
    elif sqlstate == "40001" or "serialization" in lowered:
        error_class = "serialization_failure"
        sqlstate = sqlstate or "40001"
    elif "queuepool" in lowered or "pool timeout" in lowered:
        error_class = "pool_timeout"
    elif "lock timeout" in lowered or sqlstate == "55P03":
        error_class = "lock_timeout"
        sqlstate = sqlstate or "55P03"
    elif "unique" in lowered or sqlstate == "23505":
        error_class = "unique_violation"
        sqlstate = sqlstate or "23505"
    else:
        error_class = "other_error"
    failing_sql = None
    sql_match = re.search(r"\[SQL:\s*(.*?)\]", text, flags=re.DOTALL)
    if sql_match:
        failing_sql = " ".join(sql_match.group(1).split())[:240]
    return {
        "error_class": error_class,
        "sqlstate": sqlstate,
        "exception_type": type(exc).__name__,
        "message": text.splitlines()[0][:300],
        "failing_sql_operation": failing_sql,
    }


def collect_db_env(hub_service: Any) -> dict[str, Any]:
    from backend.appdb.db import get_app_database_url, get_app_engine
    from backend.config import config

    url = get_app_database_url() if hub_service._use_app_db else None
    dialect = None
    driver = None
    server_version = None
    pool_size = None
    max_overflow = None
    pool_timeout = None
    if url:
        engine = get_app_engine(url)
        dialect = str(engine.dialect.name)
        driver = str(getattr(engine, "driver", None) or engine.dialect.driver)
        pool = engine.pool
        if hasattr(pool, "size"):
            try:
                pool_size = int(pool.size())
            except Exception:
                pool_size = getattr(pool, "size", None)
        max_overflow = getattr(pool, "_max_overflow", None)
        pool_timeout = getattr(pool, "_timeout", None)
        try:
            with engine.connect() as conn:
                server_version = conn.exec_driver_sql("SELECT version()").scalar()
                if server_version:
                    server_version = str(server_version).splitlines()[0][:160]
        except Exception as exc:  # noqa: BLE001
            server_version = f"unavailable: {type(exc).__name__}"
    elif hub_service.db_path:
        dialect = "sqlite"
        driver = "sqlite3"
        server_version = "sqlite3"
    return {
        "db_backend": dialect,
        "db_server_version": server_version,
        "driver": driver,
        "pool_size": pool_size,
        "max_overflow": max_overflow,
        "pool_timeout": pool_timeout,
        "database_target": redact_database_target(url) if url else (str(hub_service.db_path) if hub_service.db_path else None),
        "app_is_production_flag": bool(config.app.is_production),
        "uses_postgres_app_db": bool(hub_service._uses_postgres_app_db()),
    }


def ensure_project_id(hub_service: Any) -> str:
    with hub_service._db_conn(write=True) as conn:
        hub_service._ensure_default_task_project(conn)
        conn.commit()
    projects = hub_service.list_task_projects(include_inactive=False)
    for item in projects:
        project_id = str((item or {}).get("id") or "").strip()
        if project_id:
            return project_id
    return str(hub_service._DEFAULT_TASK_PROJECT_ID)


def empty_stage_timings() -> dict[str, Any]:
    return {key: None for key in STAGE_KEYS}


def merge_instrumented_stages(raw: dict[str, Any] | None) -> dict[str, Any]:
    out = empty_stage_timings()
    if not raw:
        return out
    mapping = {
        "validate_ms": "validate_ms",
        "db_write_ms": "db_write_ms",
        "notifications_ms": "notifications_ms",
        "enrich_ms": "enrich_ms",
        "push_flush_ms": "push_enqueue_or_flush_ms",
        "status_log_ms": "status_log_ms",
        "email_enqueue_ms": "email_enqueue_ms",
    }
    for src, dst in mapping.items():
        if src in raw and raw[src] is not None:
            try:
                out[dst] = round(float(raw[src]), 3)
            except (TypeError, ValueError):
                out[dst] = None
    if "push_flush_ms" in raw and raw["push_flush_ms"] is not None:
        try:
            out["push_flush_ms"] = round(float(raw["push_flush_ms"]), 3)
        except (TypeError, ValueError):
            out["push_flush_ms"] = None
    return out


def run_closed_loop(
    *,
    attempted_target: int,
    concurrency: int,
    warmup: int,
    worker_fn: Callable[[int, bool], dict[str, Any]],
) -> dict[str, Any]:
    """Closed-loop: workers claim next attempt only after finishing previous."""
    for index in range(max(0, warmup)):
        worker_fn(index, True)

    state_lock = threading.Lock()
    claimed = 0
    attempted = 0
    succeeded = 0
    failed = 0
    totals: list[float] = []
    attempt_totals: list[float] = []
    errors_by_class: dict[str, int] = {}
    errors_by_sqlstate: dict[str, int] = {}
    errors_by_stage: dict[str, int] = {}
    failure_samples: list[dict[str, Any]] = []
    extras: list[dict[str, Any]] = []

    wall_started = time.perf_counter()

    def worker() -> None:
        nonlocal claimed, attempted, succeeded, failed
        while True:
            with state_lock:
                if claimed >= attempted_target:
                    return
                index = claimed
                claimed += 1
                attempted += 1
            result = worker_fn(warmup + index, False)
            with state_lock:
                attempt_totals.append(float(result.get("total_ms") or 0.0))
                if result.get("ok"):
                    succeeded += 1
                    totals.append(float(result.get("total_ms") or 0.0))
                    extras.append(result)
                else:
                    failed += 1
                    err = result.get("error") or {}
                    cls = str(err.get("error_class") or "other_error")
                    errors_by_class[cls] = errors_by_class.get(cls, 0) + 1
                    if err.get("sqlstate"):
                        key = str(err["sqlstate"])
                        errors_by_sqlstate[key] = errors_by_sqlstate.get(key, 0) + 1
                    stage = str(err.get("failed_stage") or "unknown")
                    errors_by_stage[stage] = errors_by_stage.get(stage, 0) + 1
                    if len(failure_samples) < 30:
                        failure_samples.append({"index": index, **err})

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        futures = [pool.submit(worker) for _ in range(max(1, concurrency))]
        for fut in as_completed(futures):
            fut.result()

    wall_s = max(1e-9, time.perf_counter() - wall_started)
    return {
        "load_model": "closed_loop",
        "concurrency": concurrency,
        "warmup": warmup,
        "attempted": attempted,
        "succeeded": succeeded,
        "failed": failed,
        "error_rate": round(failed / attempted, 6) if attempted else None,
        "throughput_ops_per_s": round(succeeded / wall_s, 3),
        "wall_s": round(wall_s, 3),
        "latency_success_ms": summary(totals),
        "latency_attempted_ms": summary(attempt_totals),
        "errors_by_class": errors_by_class,
        "errors_by_sqlstate": errors_by_sqlstate,
        "errors_by_stage": errors_by_stage,
        "failure_samples": failure_samples,
        "success_samples": extras,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def new_run_meta(*, marker: str, hub_service: Any) -> dict[str, Any]:
    return {
        "collected_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "git_commit": git_commit(),
        "run_marker": marker,
        "title_prefix": TITLE_PREFIX,
        "db": collect_db_env(hub_service),
        "notes": {
            "missing_stages": "null / not_instrumented (never coerced to 0)",
            "cleanup": "outside measured section",
            "production_data": "bench tasks only; marker-prefixed titles",
        },
    }
