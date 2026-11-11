#!/usr/bin/env python3
"""Credible Hub task workflow bench + PR1b deadlock diagnosis.

Load model: closed_loop — a worker starts the next workflow only after the previous
one finishes. Concurrent scenarios use N workers sharing a global attempt quota.

No automatic retry of failed workflows (retries would mask the root cause).
"""
from __future__ import annotations

import argparse
import json
import math
import random
import re
import statistics
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
sys.path.insert(0, str(WEB_ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=False)

TITLE_PREFIX = "BenchWorkflow "

WORKFLOW_STEPS = {
    "create": ("create",),
    "create_start": ("create", "start"),
    "create_start_submit": ("create", "start", "submit"),
    "full": ("create", "start", "submit", "review"),
    "full_no_cleanup": ("create", "start", "submit", "review"),
}

NOT_INSTRUMENTED_STAGES = (
    "db_pool_wait_ms",
    "commit_ms",
    "chat_publish_ms",
    "http_total_ms",
)


def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(ROOT),
            check=True,
            capture_output=True,
            text=True,
        )
        commit = (result.stdout or "").strip()
        return commit or None
    except Exception:
        return None


def _percentile(values: list[float], pct: float) -> float | None:
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


def _summary(values: list[float], *, status: str = "measured", denominator: str = "") -> dict[str, Any]:
    payload: dict[str, Any] = {
        "status": status,
        "n": len(values) if status == "measured" else 0,
        "denominator": denominator or None,
        "p50_ms": None,
        "p90_ms": None,
        "p95_ms": None,
        "p99_ms": None,
        "avg_ms": None,
        "max_ms": None,
    }
    if status != "measured":
        return payload
    if not values:
        payload["status"] = "not_available"
        return payload
    payload.update(
        {
            "p50_ms": _percentile(values, 50),
            "p90_ms": _percentile(values, 90),
            "p95_ms": _percentile(values, 95),
            "p99_ms": _percentile(values, 99),
            "avg_ms": round(statistics.fmean(values), 2),
            "max_ms": round(max(values), 2),
            "p99_note": (
                "advisory_only_at_n_lt_500" if len(values) < 500 else "usable_for_conclusions"
            ),
        }
    )
    return payload


def _redact_database_target(url: str | None) -> str | None:
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


def _extract_sqlstate(exc: BaseException | None) -> str | None:
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


def _classify_db_error(exc: BaseException) -> dict[str, Any]:
    text = str(exc)
    sqlstate = _extract_sqlstate(exc)
    lowered = text.lower()
    if sqlstate == "40P01" or "deadlockdetected" in lowered or "взаимоблокиров" in lowered or "deadlock" in lowered:
        error_class = "deadlock_detected"
        sqlstate = sqlstate or "40P01"
    elif sqlstate == "40001" or "serialization" in lowered:
        error_class = "serialization_failure"
        sqlstate = sqlstate or "40001"
    elif "queuepool" in lowered or "pool timeout" in lowered or "connection timed out" in lowered:
        error_class = "pool_timeout"
    elif "lock timeout" in lowered or sqlstate == "55P03":
        error_class = "lock_timeout"
        sqlstate = sqlstate or "55P03"
    elif "unique" in lowered or sqlstate == "23505":
        error_class = "unique_violation"
        sqlstate = sqlstate or "23505"
    else:
        error_class = "other_db_error"
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bench Hub create/start/submit/review path")
    parser.add_argument(
        "--iterations",
        type=int,
        default=100,
        help="workflow_attempted target per scenario (not 'completed')",
    )
    parser.add_argument("--warmup", type=int, default=15)
    parser.add_argument("--concurrency", type=int, default=1)
    parser.add_argument(
        "--steps",
        choices=sorted(WORKFLOW_STEPS),
        default="full",
        help="Which stages to run in each workflow attempt",
    )
    parser.add_argument(
        "--ab-mode",
        choices=("fixed", "current_legacy_ddl", "ensure_once"),
        default="fixed",
        help=(
            "fixed=production fix (no PG DDL in hot path); "
            "current_legacy_ddl=force CREATE IF NOT EXISTS every ensure (PR1b A); "
            "ensure_once=prepare schema once then fixed path (PR1b B)"
        ),
    )
    parser.add_argument(
        "--shared-task",
        action="store_true",
        help="Contention test: workers mutate one shared task (not the SLO scenario)",
    )
    parser.add_argument("--scenario", default="", help="label written into report")
    parser.add_argument("--creator-id", type=int, default=1253)
    parser.add_argument("--assignee-id", type=int, default=1254)
    parser.add_argument("--controller-id", type=int, default=0)
    parser.add_argument("--out", default=str(ROOT / "tmp" / "hub-task-workflow-bench.json"))
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--run-id", default="")
    return parser.parse_args()


def _scenario_name(args: argparse.Namespace) -> str:
    if str(args.scenario or "").strip():
        return str(args.scenario).strip()
    conc = max(1, int(args.concurrency))
    base = "seq" if conc <= 1 else f"c{conc:02d}"
    parts = [f"workflow_closed_loop_{base}", str(args.steps), str(args.ab_mode)]
    if args.shared_task:
        parts.append("shared_task")
    return "__".join(parts)


def _collect_db_env(hub_service: Any) -> dict[str, Any]:
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
        "database_target": _redact_database_target(url) if url else (str(hub_service.db_path) if hub_service.db_path else None),
        "is_production_like": bool(config.app.is_production and dialect == "postgresql"),
        "app_is_production_flag": bool(config.app.is_production),
        "uses_postgres_app_db": bool(hub_service._uses_postgres_app_db()),
    }


def main() -> int:
    args = parse_args()
    from backend.services.hub_service import hub_service
    from backend.services.sql_query_counter import track_hub_diag_timings, track_hub_stage_timings
    from backend.services.user_service import user_service

    attempted_target = max(1, int(args.iterations))
    warmup_count = max(0, int(args.warmup))
    concurrency = max(1, int(args.concurrency))
    steps = list(WORKFLOW_STEPS[str(args.steps)])
    cleanup_during_measurement = str(args.steps) != "full_no_cleanup" and not bool(args.keep)
    # Measurement never includes cleanup latency in workflow totals; cleanup is always separate.
    defer_cleanup_until_end = True
    scenario = _scenario_name(args)
    run_id = str(args.run_id or "").strip() or uuid.uuid4().hex
    started_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    git_commit = _git_commit()

    creator = user_service.get_by_id(int(args.creator_id))
    assignee = user_service.get_by_id(int(args.assignee_id))
    if not creator or not assignee:
        raise SystemExit("creator/assignee users not found")
    controller_id = int(args.controller_id or 0)
    controller = creator
    if controller_id > 0:
        controller = user_service.get_by_id(controller_id)
        if not controller:
            raise SystemExit(f"controller user {controller_id} not found")
        if not hub_service._user_can_review_tasks(controller):
            print(f"WARN: controller {controller_id} lacks tasks.review; creator will review")
            controller = creator
            controller_id = 0

    db_env = _collect_db_env(hub_service)
    if db_env.get("db_backend") != "postgresql":
        print(
            "WARN: concurrent deadlock results are only transferable when db_backend=postgresql. "
            f"Current backend={db_env.get('db_backend')}",
            file=sys.stderr,
        )

    with hub_service._db_conn(write=True) as conn:
        hub_service._ensure_default_task_project(conn)
        conn.commit()
    projects = hub_service.list_task_projects(include_inactive=False)
    project_id = ""
    for item in projects:
        project_id = str((item or {}).get("id") or "").strip()
        if project_id:
            break
    if not project_id:
        project_id = str(hub_service._DEFAULT_TASK_PROJECT_ID)

    ab_prepare: dict[str, Any] | None = None
    if args.ab_mode == "current_legacy_ddl":
        hub_service._status_log_force_ddl_every_call = True
        hub_service._task_status_log_ready = False
        ab_prepare = {"mode": "current_legacy_ddl", "forced_ddl_every_ensure": True}
    elif args.ab_mode == "ensure_once":
        hub_service._status_log_force_ddl_every_call = False
        ab_prepare = hub_service.prepare_task_status_log_schema()
        ab_prepare = {"mode": "ensure_once", **ab_prepare}
    else:
        hub_service._status_log_force_ddl_every_call = False
        ab_prepare = hub_service.prepare_task_status_log_schema()
        ab_prepare = {"mode": "fixed", **ab_prepare}

    created_ids: list[str] = []
    created_lock = threading.Lock()
    print_lock = threading.Lock()
    shared_task_id: str | None = None
    if args.shared_task:
        shared = hub_service.create_task(
            title=f"{TITLE_PREFIX}shared-{uuid.uuid4().hex[:8]}",
            description="shared contention task",
            assignee_user_id=int(assignee["id"]),
            controller_user_id=controller_id,
            due_at=None,
            project_id=project_id,
            actor=creator,
            initial_status="new",
        )
        shared_task_id = str((shared or {}).get("id") or "")
        if not shared_task_id:
            raise SystemExit("shared task create failed")
        created_ids.append(shared_task_id)

    def run_one_workflow(*, index: int, is_warmup: bool) -> dict[str, Any]:
        worker_id = threading.get_ident()
        correlation_id = f"{run_id}:{index}:{worker_id}"
        if concurrency > 1 and not is_warmup:
            time.sleep(random.uniform(0.0, 0.03))
        cycle_started = time.perf_counter()
        stage_ms: dict[str, float] = {}
        diag_ms: dict[str, float] = {}
        stage_by_op: dict[str, dict[str, Any]] = {}
        task_id = shared_task_id or ""
        failed_stage: str | None = None
        error_info: dict[str, Any] | None = None
        with track_hub_stage_timings() as stage_samples, track_hub_diag_timings() as diag_timings:
            try:
                if "create" in steps and not args.shared_task:
                    marker = uuid.uuid4().hex[:8]
                    title = f"{TITLE_PREFIX}{marker} #{index + 1}"
                    t0 = time.perf_counter()
                    task = hub_service.create_task(
                        title=title,
                        description="bench workflow task",
                        assignee_user_id=int(assignee["id"]),
                        controller_user_id=controller_id,
                        due_at=None,
                        project_id=project_id,
                        actor=creator,
                        initial_status="new",
                    )
                    stage_ms["create"] = (time.perf_counter() - t0) * 1000.0
                    task_id = str((task or {}).get("id") or "")
                    if not task_id:
                        raise RuntimeError("create_task returned empty id")
                    with created_lock:
                        created_ids.append(task_id)
                elif args.shared_task:
                    task_id = str(shared_task_id)

                if "start" in steps:
                    t0 = time.perf_counter()
                    started = hub_service.start_task(task_id=task_id, user=assignee)
                    stage_ms["start"] = (time.perf_counter() - t0) * 1000.0
                    if not started and not args.shared_task:
                        raise RuntimeError(f"start_task failed for {task_id}")

                if "submit" in steps:
                    t0 = time.perf_counter()
                    submitted = hub_service.submit_task(
                        task_id=task_id,
                        user=assignee,
                        comment="bench report",
                        file_name=None,
                        file_bytes=None,
                        file_mime=None,
                    )
                    stage_ms["submit"] = (time.perf_counter() - t0) * 1000.0
                    if (not submitted or str(submitted.get("status")) != "review") and not args.shared_task:
                        raise RuntimeError(f"submit_task failed for {task_id}: {submitted}")

                if "review" in steps:
                    t0 = time.perf_counter()
                    reviewed = hub_service.review_task(
                        task_id=task_id,
                        reviewer=controller,
                        decision="approve",
                        comment="bench approve",
                        is_admin=False,
                    )
                    stage_ms["review"] = (time.perf_counter() - t0) * 1000.0
                    if (not reviewed or str(reviewed.get("status")) != "done") and not args.shared_task:
                        raise RuntimeError(f"review_task failed for {task_id}: {reviewed}")
            except Exception as exc:
                for step_name in steps:
                    if step_name not in stage_ms:
                        failed_stage = step_name
                        break
                failed_stage = failed_stage or "unknown"
                error_info = {
                    "failed_stage": failed_stage,
                    **_classify_db_error(exc),
                }
            finally:
                diag_ms.update(dict(diag_timings))
                for sample in stage_samples:
                    stage_by_op[sample.op] = dict(sample.stages)

        total_ms = (time.perf_counter() - cycle_started) * 1000.0
        label = "warmup" if is_warmup else "attempt"
        with print_lock:
            if error_info:
                print(
                    f"{label} FAIL idx={index + 1} stage={error_info.get('failed_stage')} "
                    f"class={error_info.get('error_class')} total={total_ms:.1f} corr={correlation_id}"
                )
            else:
                parts = " ".join(f"{k}={v:.1f}" for k, v in stage_ms.items())
                print(f"{label} idx={index + 1} {parts} total={total_ms:.1f} corr={correlation_id}")
        return {
            "ok": error_info is None,
            "task_id": task_id,
            "correlation_id": correlation_id,
            "worker_id": worker_id,
            "stage_ms": stage_ms,
            "diag_ms": diag_ms,
            "stage_by_op": stage_by_op,
            "total_ms": total_ms,
            "error": error_info,
        }

    warmup_failures = 0
    for index in range(warmup_count):
        warmup_result = run_one_workflow(index=index, is_warmup=True)
        if not warmup_result.get("ok"):
            warmup_failures += 1
            print(f"WARN warmup idx={index} failed: {warmup_result.get('error')}", file=sys.stderr)

    success_timings: dict[str, list[float]] = {step: [] for step in ("create", "start", "submit", "review", "total")}
    attempt_timings: dict[str, list[float]] = {step: [] for step in ("create", "start", "submit", "review", "total")}
    diag_success: dict[str, list[float]] = {}
    nested_stage_values: dict[str, dict[str, list[float]]] = {}

    workflow_attempted = 0
    workflow_succeeded = 0
    workflow_failed = 0
    deadlock_affected_workflows = 0
    deadlock_events = 0
    retry_attempts = 0  # explicitly zero — no retries
    errors_by_stage = {step: 0 for step in ("create", "start", "submit", "review", "cleanup", "unknown")}
    errors_by_class: dict[str, int] = {}
    errors_by_sqlstate: dict[str, int] = {}
    failure_samples: list[dict[str, Any]] = []
    state_lock = threading.Lock()
    claimed = 0

    wall_started = time.perf_counter()

    def worker() -> None:
        nonlocal claimed, workflow_attempted, workflow_succeeded, workflow_failed
        nonlocal deadlock_affected_workflows, deadlock_events
        while True:
            with state_lock:
                if claimed >= attempted_target:
                    return
                index = claimed
                claimed += 1
                workflow_attempted += 1
            result = run_one_workflow(index=warmup_count + index, is_warmup=False)
            with state_lock:
                for key, value in (result.get("stage_ms") or {}).items():
                    attempt_timings.setdefault(key, []).append(float(value))
                attempt_timings["total"].append(float(result["total_ms"]))
                if result.get("ok"):
                    workflow_succeeded += 1
                    for key, value in (result.get("stage_ms") or {}).items():
                        success_timings.setdefault(key, []).append(float(value))
                    success_timings["total"].append(float(result["total_ms"]))
                    for key, value in (result.get("diag_ms") or {}).items():
                        diag_success.setdefault(str(key), []).append(float(value))
                    for op, stages in (result.get("stage_by_op") or {}).items():
                        op_bucket = nested_stage_values.setdefault(str(op), {})
                        for stage_key, stage_value in (stages or {}).items():
                            if stage_value is None:
                                continue
                            try:
                                op_bucket.setdefault(str(stage_key), []).append(float(stage_value))
                            except (TypeError, ValueError):
                                continue
                else:
                    workflow_failed += 1
                    error_info = result.get("error") or {}
                    failed_stage = str(error_info.get("failed_stage") or "unknown")
                    error_class = str(error_info.get("error_class") or "other_db_error")
                    errors_by_stage[failed_stage] = errors_by_stage.get(failed_stage, 0) + 1
                    errors_by_class[error_class] = errors_by_class.get(error_class, 0) + 1
                    if error_info.get("sqlstate"):
                        key = str(error_info["sqlstate"])
                        errors_by_sqlstate[key] = errors_by_sqlstate.get(key, 0) + 1
                    if error_class == "deadlock_detected":
                        deadlock_affected_workflows += 1
                        deadlock_events += 1
                    if len(failure_samples) < 30:
                        failure_samples.append(
                            {
                                "attempt_index": index,
                                "worker_id": result.get("worker_id"),
                                "correlation_id": result.get("correlation_id"),
                                **error_info,
                            }
                        )

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(worker) for _ in range(concurrency)]
        for future in as_completed(futures):
            future.result()

    duration_seconds = round(time.perf_counter() - wall_started, 3)

    # Cleanup always after measurement window.
    cleanup_ms_values: list[float] = []
    cleanup_errors = 0
    deleted = 0
    cleanup_started = time.perf_counter()
    if not args.keep:
        for task_id in list(created_ids):
            t0 = time.perf_counter()
            try:
                if hub_service.delete_task(task_id=task_id, actor_user_id=0, is_admin=True):
                    deleted += 1
            except Exception as exc:  # noqa: BLE001
                cleanup_errors += 1
                errors_by_stage["cleanup"] = errors_by_stage.get("cleanup", 0) + 1
                print(f"WARN delete {task_id}: {exc}", file=sys.stderr)
            cleanup_ms_values.append((time.perf_counter() - t0) * 1000.0)
    cleanup_total_ms = round((time.perf_counter() - cleanup_started) * 1000.0, 2)

    workflow_success_rate = (
        round(workflow_succeeded / float(workflow_attempted), 4) if workflow_attempted else None
    )
    workflow_error_rate = (
        round(workflow_failed / float(workflow_attempted), 4) if workflow_attempted else None
    )
    successful_throughput = (
        round(workflow_succeeded / duration_seconds, 3) if duration_seconds > 0 else None
    )
    attempted_throughput = (
        round(workflow_attempted / duration_seconds, 3) if duration_seconds > 0 else None
    )

    latency_successful = {
        key: _summary(values, denominator="workflow_succeeded")
        for key, values in success_timings.items()
    }
    latency_all_attempts = {
        key: _summary(values, denominator="attempts_that_reached_stage")
        for key, values in attempt_timings.items()
    }
    diag_summary = {
        key: _summary(values, denominator="workflow_succeeded")
        for key, values in diag_success.items()
    }
    for expected in (
        "status_log_ensure_ms",
        "status_log_insert_ms",
        "task_row_update_ms",
        "notifications_write_ms",
        "transaction_total_ms",
    ):
        if expected not in diag_summary:
            diag_summary[expected] = _summary([], status="not_instrumented", denominator="n/a")

    stage_summaries: dict[str, Any] = {
        stage: _summary([], status="not_instrumented", denominator="n/a")
        for stage in NOT_INSTRUMENTED_STAGES
    }
    for op, stage_map in nested_stage_values.items():
        for stage_key, values in stage_map.items():
            stage_summaries[f"{op}.{stage_key}"] = _summary(
                values, denominator="workflow_succeeded_with_stage_sample"
            )

    report = {
        "run_id": run_id,
        "started_at": started_at,
        "git_commit": git_commit,
        "scenario": scenario,
        "steps": steps,
        "ab_mode": args.ab_mode,
        "ab_prepare": ab_prepare,
        "shared_task": bool(args.shared_task),
        "sample_size_successful": workflow_succeeded,
        "sample_size_attempted": workflow_attempted,
        "warmup_count": warmup_count,
        "warmup_failures": warmup_failures,
        "measurement_count_attempted": attempted_target,
        "concurrency": concurrency,
        "load_model": "closed_loop",
        "load_model_description": (
            "closed_loop: each worker starts the next workflow only after the previous "
            "workflow completes; concurrency=N means N such workers sharing the attempt quota"
        ),
        "duration_seconds": duration_seconds,
        "duration_denominator": "measurement_window_excluding_cleanup",
        "workflow_attempted": workflow_attempted,
        "workflow_succeeded": workflow_succeeded,
        "workflow_failed": workflow_failed,
        "workflow_success_rate": workflow_success_rate,
        "workflow_error_rate": workflow_error_rate,
        "rates_denominator": "workflow_attempted",
        "deadlock_affected_workflows": deadlock_affected_workflows,
        "deadlock_events": deadlock_events,
        "retry_attempts": retry_attempts,
        "retry_policy": "none_no_masking",
        "successful_throughput": successful_throughput,
        "attempted_throughput": attempted_throughput,
        "throughput_denominator": "duration_seconds_measurement_window",
        "errors_by_stage": errors_by_stage,
        "errors_by_class": errors_by_class,
        "errors_by_sqlstate": errors_by_sqlstate,
        "failure_samples": failure_samples,
        "db_env": db_env,
        "creator_id": int(creator["id"]),
        "assignee_id": int(assignee["id"]),
        "controller_id": controller_id,
        "project_id": project_id,
        "deleted_tasks": deleted,
        "kept": bool(args.keep),
        "latency_successful_workflows": latency_successful,
        "latency_attempts_reaching_stage": latency_all_attempts,
        "diag_timings_successful": diag_summary,
        "stage_summary": stage_summaries,
        "cleanup": {
            "status": "measured" if cleanup_ms_values else ("skipped" if args.keep else "not_available"),
            "deferred_until_after_measurement": defer_cleanup_until_end,
            "excluded_from_workflow_latency": True,
            "deleted_tasks": deleted,
            "cleanup_errors": cleanup_errors,
            "total_ms": cleanup_total_ms if cleanup_ms_values else None,
            "per_task": _summary(cleanup_ms_values, denominator="cleanup_task_attempts")
            if cleanup_ms_values
            else _summary([], status="skipped" if args.keep else "not_available", denominator="n/a"),
        },
        "thresholds": {
            "create_p95_ms": 500,
            "review_p95_ms": 800,
            "workflow_error_rate_max": 0.01,
            "deadlock_affected_workflows_max": 0,
        },
        "notes": {
            "p99_at_n_100": "advisory_only; prefer n>=500 for p99 conclusions",
            "missing_stage_policy": (
                "measured=numeric samples present; not_instrumented=no timer; "
                "not_available=expected timer but no samples; never invent 0 for missing stages"
            ),
            "do_not_call_attempted_completed": (
                "workflow_succeeded is the only 'completed successfully' count; "
                "workflow_attempted is the measurement quota"
            ),
        },
    }
    create_p95 = (latency_successful.get("create") or {}).get("p95_ms")
    review_p95 = (latency_successful.get("review") or {}).get("p95_ms")
    report["pass"] = {
        "create_p95": create_p95 is None or create_p95 <= 500,
        "review_p95": review_p95 is None or review_p95 <= 800,
        "attempt_quota": workflow_attempted >= attempted_target,
        "error_rate_under_1pct": (workflow_error_rate or 0.0) < 0.01,
        "deadlock_free": deadlock_affected_workflows == 0,
        "postgresql_backend": db_env.get("db_backend") == "postgresql",
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "scenario": scenario,
                "ab_mode": args.ab_mode,
                "db_backend": db_env.get("db_backend"),
                "workflow_attempted": workflow_attempted,
                "workflow_succeeded": workflow_succeeded,
                "workflow_failed": workflow_failed,
                "workflow_error_rate": workflow_error_rate,
                "deadlock_affected_workflows": deadlock_affected_workflows,
                "deadlock_events": deadlock_events,
                "successful_throughput": successful_throughput,
                "attempted_throughput": attempted_throughput,
                "errors_by_stage": errors_by_stage,
                "errors_by_class": errors_by_class,
                "latency_successful_workflows": {
                    k: latency_successful[k]
                    for k in ("create", "start", "submit", "review", "total")
                    if k in latency_successful
                },
                "pass": report["pass"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"wrote {out_path}")
    ok = (
        report["pass"]["attempt_quota"]
        and report["pass"]["error_rate_under_1pct"]
        and report["pass"]["deadlock_free"]
    )
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
