#!/usr/bin/env python3
"""TASK-AUDIT: Hub task write-path + multi-assignee benches."""
from __future__ import annotations

import argparse
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

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
    new_run_meta,
    run_closed_loop,
    summary,
    write_json,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Bench Hub task write operations")
    p.add_argument("--creator-id", type=int, default=1253)
    p.add_argument("--assignee-id", type=int, default=1254)
    p.add_argument("--iterations", type=int, default=100)
    p.add_argument("--warmup", type=int, default=15)
    p.add_argument("--concurrency", type=str, default="1,5,10,20")
    p.add_argument("--out", default=str(ROOT / "tmp" / "hub-task-audit" / "bench-writes.json"))
    p.add_argument("--multi-out", default=str(ROOT / "tmp" / "hub-task-audit" / "bench-multi-assignee.json"))
    p.add_argument("--keep", action="store_true")
    p.add_argument("--skip-multi", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    from backend.services.hub_service import hub_service
    from backend.services.sql_query_counter import track_hub_stage_timings, track_sql_queries
    from backend.services.user_service import user_service

    creator = user_service.get_by_id(int(args.creator_id))
    assignee = user_service.get_by_id(int(args.assignee_id))
    if not creator or not assignee:
        raise SystemExit("creator/assignee not found")
    project_id = ensure_project_id(hub_service)
    hub_service.prepare_task_status_log_schema()
    marker = f"writes-{uuid.uuid4().hex[:10]}"
    created_ids: list[str] = []
    created_lock = threading.Lock()
    conc_levels = [int(x.strip()) for x in str(args.concurrency).split(",") if x.strip()]

    report = new_run_meta(marker=marker, hub_service=hub_service)
    report["scenarios"] = {}
    multi_report = new_run_meta(marker=f"{marker}-multi", hub_service=hub_service)
    multi_report["scenarios"] = {}
    multi_report["notes_extra"] = {
        "api_behavior": "POST /tasks loops create_task per assignee; separate hub_tasks rows",
        "idempotency_key": False,
        "partial_success": "API returns after loop; mid-loop failure raises before response (no partial envelope)",
    }

    def track_created(task_id: str) -> None:
        if not task_id:
            return
        with created_lock:
            created_ids.append(task_id)

    def seed_task(*, status: str = "new") -> str:
        task = hub_service.create_task(
            title=f"{TITLE_PREFIX}{marker} seed-{uuid.uuid4().hex[:8]}",
            description="seed",
            assignee_user_id=int(assignee["id"]),
            controller_user_id=0,
            due_at=None,
            project_id=project_id,
            actor=creator,
            initial_status=status,
        )
        tid = str((task or {}).get("id") or "")
        track_created(tid)
        return tid

    # Small pools + on-demand replenish (cleanup after). Avoid pre-creating 1000+
    # notified tasks — hub_notifications INSERT dominates wall time.
    pool_seed = 24
    print(f"Pre-seeding task pools (seed={pool_seed})…")
    update_pool = [seed_task() for _ in range(pool_seed)]
    comment_pool = [seed_task() for _ in range(min(40, pool_seed))]
    start_pool = [seed_task(status="new") for _ in range(pool_seed)]
    submit_pool: list[str] = []
    for _ in range(pool_seed):
        tid = seed_task(status="new")
        hub_service.start_task(task_id=tid, user=assignee)
        submit_pool.append(tid)
    def _seed_review_task() -> str:
        tid = seed_task(status="new")
        hub_service.start_task(task_id=tid, user=assignee)
        hub_service.submit_task(task_id=tid, user=assignee, comment="pre", file_name=None, file_bytes=None, file_mime=None)
        return tid

    review_approve_pool = [_seed_review_task() for _ in range(pool_seed)]
    review_reject_pool = [_seed_review_task() for _ in range(pool_seed)]
    delete_pool = [seed_task() for _ in range(pool_seed)]
    checklist_pool = [seed_task() for _ in range(pool_seed)]
    observer_pool = [seed_task() for _ in range(pool_seed)]
    print("Pre-seed complete")

    pool_indexes = {
        "update": 0,
        "start": 0,
        "submit": 0,
        "review_approve": 0,
        "review_reject": 0,
        # kept for replenish branch compatibility
        "review": 0,
        "delete": 0,
        "checklist": 0,
        "observer": 0,
        "comment": 0,
    }
    pool_lock = threading.Lock()

    def next_from(name: str, pool: list[str]) -> str:
        with pool_lock:
            idx = pool_indexes[name]
            pool_indexes[name] = idx + 1
            if idx >= len(pool):
                # replenish
                if name == "start":
                    tid = seed_task(status="new")
                    pool.append(tid)
                elif name == "submit":
                    tid = seed_task(status="new")
                    hub_service.start_task(task_id=tid, user=assignee)
                    pool.append(tid)
                elif name.startswith("review"):
                    pool.append(_seed_review_task())
                else:
                    tid = seed_task()
                    pool.append(tid)
                return pool[idx] if idx < len(pool) else pool[-1]
            return pool[idx]

    def run_op_scenario(name: str, conc: int, fn) -> None:
        key = f"{name}_c{conc}"
        print(f"RUN {key}")

        def worker_fn(index: int, is_warmup: bool) -> dict[str, Any]:
            t0 = time.perf_counter()
            stages_raw: dict[str, Any] = {}
            query_count = None
            try:
                with track_hub_stage_timings() as stage_samples, track_sql_queries(correlation_id=f"{name}-{index}") as session:
                    meta = fn(index)
                    query_count = session.count
                for sample in stage_samples:
                    if sample.op:
                        stages_raw = dict(sample.stages or {})
                        break
                return {
                    "ok": bool(meta.get("ok", True)),
                    "total_ms": (time.perf_counter() - t0) * 1000.0,
                    "query_count": query_count,
                    "stages": merge_instrumented_stages(stages_raw),
                    "extra": {k: v for k, v in meta.items() if k != "ok"},
                    "error": meta.get("error"),
                }
            except Exception as exc:
                return {
                    "ok": False,
                    "total_ms": (time.perf_counter() - t0) * 1000.0,
                    "query_count": query_count,
                    "stages": merge_instrumented_stages(stages_raw),
                    "error": {"failed_stage": name, **classify_db_error(exc)},
                }

        result = run_closed_loop(
            attempted_target=int(args.iterations),
            concurrency=conc,
            warmup=int(args.warmup),
            worker_fn=worker_fn,
        )
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
        report["scenarios"][key] = {
            **result,
            "query_count": {
                "last": qcounts[-1] if qcounts else None,
                "min": min(qcounts) if qcounts else None,
                "max": max(qcounts) if qcounts else None,
                "avg": round(sum(qcounts) / len(qcounts), 2) if qcounts else None,
            },
            "stage_timings": {k: summary(v) for k, v in stage_buckets.items()},
            "stage_keys_null_if_missing": True,
            "uses_process_rlock": name
            in {"update", "delete", "start", "comment_create", "checklist_update", "observer_update", "attachment_register"},
        }

    # --- create ---
    def op_create(index: int) -> dict[str, Any]:
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
        track_created(tid)
        return {"ok": bool(tid), "task_id": tid}

    # --- update ---
    def op_update(index: int) -> dict[str, Any]:
        tid = next_from("update", update_pool)
        updated = hub_service.update_task(
            tid,
            {"description": f"updated {index} {uuid.uuid4().hex[:6]}"},
            actor_user_id=int(creator["id"]),
            is_admin=False,
        )
        return {"ok": bool(updated), "task_id": tid, "updated_at": (updated or {}).get("updated_at")}

    # --- delete ---
    def op_delete(index: int) -> dict[str, Any]:
        tid = next_from("delete", delete_pool)
        ok = hub_service.delete_task(task_id=tid, actor_user_id=int(creator["id"]), is_admin=True)
        return {"ok": bool(ok), "task_id": tid}

    # --- comment ---
    discussion_chat_blocks_comments = False
    try:
        from backend.chat.task_discussion import is_task_discussion_chat_enabled

        discussion_chat_blocks_comments = bool(is_task_discussion_chat_enabled())
    except Exception:
        discussion_chat_blocks_comments = False
    report["comment_api_blocked_by_discussion_chat"] = discussion_chat_blocks_comments

    def op_comment(index: int) -> dict[str, Any]:
        if discussion_chat_blocks_comments:
            return {
                "ok": False,
                "error": {
                    "failed_stage": "comment_create",
                    "error_class": "feature_blocked",
                    "message": "use_task_discussion_chat",
                    "sqlstate": None,
                },
            }
        tid = comment_pool[index % len(comment_pool)]
        created = hub_service.add_task_comment(task_id=tid, user=assignee, body=f"bench comment {index}")
        return {"ok": bool(created), "task_id": tid}

    # --- checklist ---
    def op_checklist(index: int) -> dict[str, Any]:
        tid = next_from("checklist", checklist_pool)
        items = [{"id": f"c{i}", "text": f"i{i}", "done": (i + index) % 2 == 0} for i in range(10)]
        updated = hub_service.update_task(tid, {"checklist_items": items}, actor_user_id=int(creator["id"]), is_admin=False)
        return {"ok": bool(updated), "task_id": tid}

    # --- observer ---
    def op_observer(index: int) -> dict[str, Any]:
        tid = next_from("observer", observer_pool)
        ids = [int(assignee["id"])] if index % 2 == 0 else []
        updated = hub_service.update_task(tid, {"observer_user_ids": ids}, actor_user_id=int(creator["id"]), is_admin=False)
        return {"ok": bool(updated), "task_id": tid}

    # --- attachment (small bytes) ---
    def op_attach(index: int) -> dict[str, Any]:
        tid = comment_pool[index % len(comment_pool)]
        created = hub_service.add_task_attachment(
            task_id=tid,
            user=creator,
            file_name=f"bench-{index}.txt",
            file_bytes=b"bench-attachment-payload",
            file_mime="text/plain",
            can_review=True,
        )
        return {"ok": bool(created), "task_id": tid}

    # --- start / submit / review ---
    def op_start(index: int) -> dict[str, Any]:
        tid = next_from("start", start_pool)
        updated = hub_service.start_task(task_id=tid, user=assignee)
        return {"ok": bool(updated) and str((updated or {}).get("status")) == "in_progress", "task_id": tid}

    def op_submit(index: int) -> dict[str, Any]:
        tid = next_from("submit", submit_pool)
        updated = hub_service.submit_task(
            task_id=tid,
            user=assignee,
            comment=f"submit {index}",
            file_name=None,
            file_bytes=None,
            file_mime=None,
        )
        return {"ok": bool(updated) and str((updated or {}).get("status")) == "review", "task_id": tid}

    def op_approve(index: int) -> dict[str, Any]:
        tid = next_from("review_approve", review_approve_pool)
        updated = hub_service.review_task(
            task_id=tid,
            reviewer=creator,
            decision="approve",
            comment="ok",
            is_admin=False,
        )
        return {"ok": bool(updated) and str((updated or {}).get("status")) == "done", "task_id": tid}

    def op_reject(index: int) -> dict[str, Any]:
        tid = next_from("review_reject", review_reject_pool)
        updated = hub_service.review_task(
            task_id=tid,
            reviewer=creator,
            decision="reject",
            comment="rework",
            is_admin=False,
        )
        return {"ok": bool(updated) and str((updated or {}).get("status")) == "in_progress", "task_id": tid}

    ops = [
        ("create", op_create, True),
        ("update", op_update, True),
        ("delete", op_delete, True),
        ("comment_create", op_comment, True),
        ("checklist_update", op_checklist, True),
        ("observer_update", op_observer, True),
        ("attachment_register", op_attach, False),  # full conc matrix expensive on FS; still run all conc
        ("start", op_start, True),
        ("submit", op_submit, True),
        ("approve", op_approve, True),
        ("reject", op_reject, True),
    ]

    for name, fn, full_conc in ops:
        if name == "comment_create" and discussion_chat_blocks_comments:
            report["scenarios"]["comment_create_skipped"] = {
                "skipped": True,
                "reason": "TASK_DISCUSSION_CHAT_ENABLED blocks legacy comment API (use_task_discussion_chat)",
            }
            continue
        for conc in conc_levels:
            if not full_conc and conc > 10:
                continue
            run_op_scenario(name, conc, fn)

    # Multi-assignee: emulate API loop
    if not args.skip_multi:
        # Build fake assignee list by repeating available users (same id allowed only once in API — use unique ids)
        # Find more users or clone with same assignee (API dedupes) — measure sequential create_task N times
        assignee_candidates = [int(assignee["id"])]
        # try nearby ids
        for uid in range(int(assignee["id"]), int(assignee["id"]) + 80):
            u = user_service.get_by_id(uid)
            if u and bool(u.get("is_active", True)):
                if int(u["id"]) not in assignee_candidates:
                    assignee_candidates.append(int(u["id"]))
            if len(assignee_candidates) >= 50:
                break
        multi_report["assignee_candidates"] = len(assignee_candidates)

        for n in (1, 5, 10, 20, 50):
            ids = assignee_candidates[:n]
            if len(ids) < n:
                multi_report["scenarios"][f"multi_{n}"] = {
                    "skipped": True,
                    "reason": f"only {len(ids)} active users available for distinct assignees",
                    "available": len(ids),
                }
                continue
            for conc in (1,):  # multi create is already N sequential; concurrency on outer creates
                # also measure c=5 for n=5 as contention proxy
                pass

            def make_multi(n_assignees: int = n, id_list: list[int] = ids):
                def worker_fn(index: int, is_warmup: bool) -> dict[str, Any]:
                    t0 = time.perf_counter()
                    created_local: list[str] = []
                    try:
                        with track_sql_queries(correlation_id=f"multi-{n_assignees}-{index}") as session:
                            for aid in id_list:
                                task = hub_service.create_task(
                                    title=f"{TITLE_PREFIX}{marker} multi{n_assignees}#{index}-{aid}",
                                    description="multi",
                                    assignee_user_id=aid,
                                    controller_user_id=0,
                                    due_at=None,
                                    project_id=project_id,
                                    actor=creator,
                                    initial_status="new",
                                )
                                tid = str((task or {}).get("id") or "")
                                if tid:
                                    created_local.append(tid)
                                    track_created(tid)
                        elapsed = (time.perf_counter() - t0) * 1000.0
                        return {
                            "ok": len(created_local) == n_assignees,
                            "total_ms": elapsed,
                            "query_count": session.count,
                            "tasks_created": len(created_local),
                            "assignees": n_assignees,
                        }
                    except Exception as exc:
                        return {
                            "ok": False,
                            "total_ms": (time.perf_counter() - t0) * 1000.0,
                            "tasks_created": len(created_local),
                            "error": {"failed_stage": "multi_create", **classify_db_error(exc)},
                        }

                return worker_fn

            for conc in ([1, 5] if n <= 10 else [1]):
                key = f"multi_assignees_{n}_c{conc}"
                print(f"RUN {key}")
                # fewer iterations for large N to keep wall time acceptable but >=100 for n<=10
                iters = int(args.iterations) if n <= 10 else max(20, int(args.iterations) // 5)
                result = run_closed_loop(
                    attempted_target=iters,
                    concurrency=conc,
                    warmup=min(int(args.warmup), 15),
                    worker_fn=make_multi(),
                )
                samples = result.pop("success_samples", [])
                qcounts = [int(s.get("query_count") or 0) for s in samples if s.get("query_count") is not None]
                multi_report["scenarios"][key] = {
                    **result,
                    "assignees_n": n,
                    "separate_tasks_per_assignee": True,
                    "query_count": {
                        "last": qcounts[-1] if qcounts else None,
                        "min": min(qcounts) if qcounts else None,
                        "max": max(qcounts) if qcounts else None,
                        "avg": round(sum(qcounts) / len(qcounts), 2) if qcounts else None,
                    },
                    "idempotency_key": False,
                    "retry_creates_duplicates": True,
                }

            # double-submit simulation for n=5
            if n == 5:
                t0 = time.perf_counter()
                first_ids = []
                second_ids = []
                for aid in ids:
                    t = hub_service.create_task(
                        title=f"{TITLE_PREFIX}{marker} dbl-a-{aid}",
                        description="dbl",
                        assignee_user_id=aid,
                        controller_user_id=0,
                        due_at=None,
                        project_id=project_id,
                        actor=creator,
                    )
                    first_ids.append(str((t or {}).get("id") or ""))
                for aid in ids:
                    t = hub_service.create_task(
                        title=f"{TITLE_PREFIX}{marker} dbl-b-{aid}",
                        description="dbl",
                        assignee_user_id=aid,
                        controller_user_id=0,
                        due_at=None,
                        project_id=project_id,
                        actor=creator,
                    )
                    second_ids.append(str((t or {}).get("id") or ""))
                for tid in first_ids + second_ids:
                    track_created(tid)
                multi_report["double_click_simulation_n5"] = {
                    "first_batch_ids": first_ids,
                    "second_batch_ids": second_ids,
                    "overlap": sorted(set(first_ids) & set(second_ids)),
                    "duplicates_created": len(first_ids) + len(second_ids),
                    "elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                    "conclusion": "retry creates new distinct task rows; no Idempotency-Key",
                }

    # Delegate cost probe
    delegate_report: dict[str, Any] = {"cold": [], "warm": []}
    for i in range(30):
        t0 = time.perf_counter()
        ids = user_service.get_delegate_user_ids(int(assignee["id"]))
        delegate_report["cold" if i == 0 else "warm"].append((time.perf_counter() - t0) * 1000.0)
    # force cold if cache clear exists
    try:
        cache = getattr(user_service, "_delegate_cache", None)
        if cache is not None:
            cache.clear()
    except Exception:
        pass
    cold_ms = []
    warm_ms = []
    for i in range(50):
        if i % 10 == 0:
            try:
                cache = getattr(user_service, "_delegate_cache", None)
                if cache is not None:
                    cache.clear()
            except Exception:
                pass
        t0 = time.perf_counter()
        user_service.get_delegate_user_ids(int(assignee["id"]))
        ms = (time.perf_counter() - t0) * 1000.0
        if i % 10 == 0:
            cold_ms.append(ms)
        else:
            warm_ms.append(ms)
    report["delegate_probe"] = {
        "cold_ms": summary(cold_ms),
        "warm_ms": summary(warm_ms),
        "note": "map-cache not implemented; measure only",
    }

    write_json(Path(args.out), report)
    write_json(Path(args.multi_out), multi_report)
    print(f"Wrote {args.out}")
    print(f"Wrote {args.multi_out}")

    if not args.keep:
        print(f"Cleanup {len(created_ids)} tasks…")
        for tid in list(dict.fromkeys(created_ids)):
            try:
                hub_service.delete_task(task_id=tid, actor_user_id=int(creator["id"]), is_admin=True)
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
