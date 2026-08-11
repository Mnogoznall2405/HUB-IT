#!/usr/bin/env python3
"""Re-measure create/reject scenarios and merge into bench-writes.json."""
from __future__ import annotations

import json
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "WEB-itinvent"))
sys.path.insert(0, str(ROOT / "scripts"))
from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=False)

from _hub_task_bench_common import (  # noqa: E402
    TITLE_PREFIX,
    classify_db_error,
    ensure_project_id,
    merge_instrumented_stages,
    run_closed_loop,
    summary,
)

OUT = ROOT / "tmp" / "hub-task-audit" / "bench-writes.json"


def main() -> int:
    from backend.services.hub_service import hub_service
    from backend.services.sql_query_counter import track_hub_stage_timings, track_sql_queries
    from backend.services.user_service import user_service

    creator = user_service.get_by_id(1253)
    assignee = user_service.get_by_id(1254)
    project_id = ensure_project_id(hub_service)
    hub_service.prepare_task_status_log_schema()
    marker = f"crrej-{uuid.uuid4().hex[:8]}"
    created: list[str] = []
    lock = threading.Lock()
    report = json.loads(OUT.read_text(encoding="utf-8"))

    def track(tid: str) -> None:
        if tid:
            with lock:
                created.append(tid)

    def run_named(name, conc, fn, *, uses_lock: bool = False):
        def worker_fn(index: int, is_warmup: bool):
            t0 = time.perf_counter()
            stages_raw = {}
            qc = None
            try:
                with track_hub_stage_timings() as samples, track_sql_queries(correlation_id=f"{name}-{index}") as session:
                    meta = fn(index)
                    qc = session.count
                for sample in samples:
                    stages_raw = dict(sample.stages or {})
                    break
                return {
                    "ok": bool(meta.get("ok", True)),
                    "total_ms": (time.perf_counter() - t0) * 1000.0,
                    "query_count": qc,
                    "stages": merge_instrumented_stages(stages_raw),
                    "error": meta.get("error"),
                }
            except Exception as exc:
                return {
                    "ok": False,
                    "total_ms": (time.perf_counter() - t0) * 1000.0,
                    "query_count": qc,
                    "stages": merge_instrumented_stages(stages_raw),
                    "error": {"failed_stage": name, **classify_db_error(exc)},
                }

        result = run_closed_loop(attempted_target=100, concurrency=conc, warmup=15, worker_fn=worker_fn)
        samples = result.pop("success_samples", [])
        qcounts = [int(s.get("query_count") or 0) for s in samples if s.get("query_count") is not None]
        stage_buckets: dict[str, list[float]] = {}
        for s in samples:
            for sk, sv in (s.get("stages") or {}).items():
                if sv is None:
                    continue
                try:
                    stage_buckets.setdefault(sk, []).append(float(sv))
                except (TypeError, ValueError):
                    continue
        report["scenarios"][f"{name}_c{conc}"] = {
            **result,
            "query_count": {
                "last": qcounts[-1] if qcounts else None,
                "min": min(qcounts) if qcounts else None,
                "max": max(qcounts) if qcounts else None,
                "avg": round(sum(qcounts) / len(qcounts), 2) if qcounts else None,
            },
            "stage_timings": {k: summary(v) for k, v in stage_buckets.items()},
            "rerun_fix": True,
            "uses_process_rlock": uses_lock,
        }
        print(
            f"done {name}_c{conc} p95={(result.get('latency_success_ms') or {}).get('p95_ms')} "
            f"ok={result.get('succeeded')} fail={result.get('failed')}"
        )

    def op_create(index: int):
        task = hub_service.create_task(
            title=f"{TITLE_PREFIX}{marker} create#{index}",
            description="bench create",
            assignee_user_id=int(assignee["id"]),
            controller_user_id=0,
            due_at=None,
            project_id=project_id,
            actor=creator,
            initial_status="new",
        )
        tid = str((task or {}).get("id") or "")
        track(tid)
        return {"ok": bool(tid)}

    print("Pre-seed reject pool…")
    reject_pool: list[str] = []
    for i in range(500):
        task = hub_service.create_task(
            title=f"{TITLE_PREFIX}{marker} rejseed#{i}",
            description="seed",
            assignee_user_id=int(assignee["id"]),
            controller_user_id=0,
            due_at=None,
            project_id=project_id,
            actor=creator,
            initial_status="new",
        )
        tid = str((task or {}).get("id") or "")
        track(tid)
        hub_service.start_task(task_id=tid, user=assignee)
        hub_service.submit_task(task_id=tid, user=assignee, comment="pre", file_name=None, file_bytes=None, file_mime=None)
        reject_pool.append(tid)
    reject_idx = 0
    reject_lock = threading.Lock()

    def op_reject(index: int):
        nonlocal reject_idx
        with reject_lock:
            if reject_idx >= len(reject_pool):
                raise RuntimeError("reject pool exhausted")
            tid = reject_pool[reject_idx]
            reject_idx += 1
        updated = hub_service.review_task(
            task_id=tid,
            reviewer=creator,
            decision="reject",
            comment="rework",
            is_admin=False,
        )
        return {"ok": bool(updated) and str((updated or {}).get("status")) == "in_progress"}

    for conc in (1, 5, 10, 20):
        run_named("create", conc, op_create)
    for conc in (1, 5, 10, 20):
        run_named("reject", conc, op_reject)

    report["create_reject_rerun_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"merged into {OUT}")
    for tid in created:
        try:
            hub_service.delete_task(task_id=tid, actor_user_id=int(creator["id"]), is_admin=True)
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
