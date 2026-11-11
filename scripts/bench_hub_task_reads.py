#!/usr/bin/env python3
"""TASK-AUDIT: Hub task read-path benches (list / detail / dashboard)."""
from __future__ import annotations

import argparse
import json
import sys
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
    ensure_project_id,
    new_run_meta,
    run_closed_loop,
    summary,
    write_json,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Bench Hub task reads")
    p.add_argument("--creator-id", type=int, default=1253)
    p.add_argument("--assignee-id", type=int, default=1254)
    p.add_argument("--iterations", type=int, default=100)
    p.add_argument("--warmup", type=int, default=15)
    p.add_argument("--concurrency", type=str, default="1,5,10,20")
    p.add_argument("--seed-max", type=int, default=500)
    p.add_argument("--skip-detail-enrich", action="store_true")
    p.add_argument("--out", default=str(ROOT / "tmp" / "hub-task-audit" / "bench-reads.json"))
    p.add_argument("--keep", action="store_true")
    return p.parse_args()


def _payload_bytes(obj: Any) -> int:
    return len(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def main() -> int:
    args = parse_args()
    from backend.services.hub_service import hub_service
    from backend.services.sql_query_counter import track_sql_queries
    from backend.services.user_service import user_service

    creator = user_service.get_by_id(int(args.creator_id))
    assignee = user_service.get_by_id(int(args.assignee_id))
    if not creator or not assignee:
        raise SystemExit("creator/assignee not found")
    project_id = ensure_project_id(hub_service)
    marker = f"reads-{uuid.uuid4().hex[:10]}"
    created: list[str] = []

    print(f"Seeding up to {args.seed_max} tasks marker={marker}")
    for index in range(max(0, int(args.seed_max))):
        task = hub_service.create_task(
            title=f"{TITLE_PREFIX}{marker} seed#{index + 1}",
            description=("seed desc " * 12) + f"#{index + 1}",
            assignee_user_id=int(assignee["id"]),
            controller_user_id=0,
            due_at=None,
            project_id=project_id,
            actor=creator,
            checklist_items=[{"id": f"c{i}", "text": f"item {i}", "done": i % 2 == 0} for i in range(3)],
            initial_status="new" if index % 4 else "in_progress",
        )
        tid = str((task or {}).get("id") or "")
        if tid:
            created.append(tid)

    # Enrich a few detail shapes
    detail_shapes: dict[str, str] = {}
    if created:
        empty_id = created[0]
        detail_shapes["empty"] = empty_id
        ordinary_id = created[1] if len(created) > 1 else created[0]
        detail_shapes["ordinary"] = ordinary_id
        # comments-heavy
        comments_id = created[2] if len(created) > 2 else created[0]
        # Legacy comments API may be blocked when task discussion chat is enabled;
        # seed rows directly so detail enrich still has a comments-heavy shape.
        try:
            for i in range(20):
                hub_service.add_task_comment(task_id=comments_id, user=assignee, body=f"bench comment {i}")
        except ValueError as exc:
            if "use_task_discussion_chat" not in str(exc):
                raise
            from datetime import datetime, timezone
            import uuid as _uuid

            now_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
            with hub_service._db_conn(write=True) as conn:
                for i in range(20):
                    conn.execute(
                        f"""
                        INSERT INTO {hub_service._TASK_COMMENTS_TABLE}
                        (id, task_id, user_id, username, full_name, body, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            str(_uuid.uuid4()),
                            comments_id,
                            int(assignee["id"]),
                            str(assignee.get("username") or ""),
                            str(assignee.get("full_name") or ""),
                            f"bench comment {i}",
                            now_iso,
                        ),
                    )
                conn.commit()
        detail_shapes["comments_20"] = comments_id
        # checklist 50
        checklist_id = created[3] if len(created) > 3 else created[0]
        hub_service.update_task(
            checklist_id,
            {"checklist_items": [{"id": f"x{i}", "text": f"check {i}", "done": False} for i in range(50)]},
            actor_user_id=int(creator["id"]),
            is_admin=True,
        )
        detail_shapes["checklist_50"] = checklist_id
        # many observers
        observers_id = created[4] if len(created) > 4 else created[0]
        hub_service.update_task(
            observers_id,
            {"observer_user_ids": [int(assignee["id"])]},
            actor_user_id=int(creator["id"]),
            is_admin=True,
        )
        detail_shapes["observers"] = observers_id
        # reports via submit cycle on a dedicated task
        report_id = created[5] if len(created) > 5 else created[0]
        for _ in range(min(10, 10)):
            try:
                hub_service.start_task(task_id=report_id, user=assignee)
            except Exception:
                pass
            try:
                hub_service.submit_task(
                    task_id=report_id,
                    user=assignee,
                    comment="bench report",
                    file_name=None,
                    file_bytes=None,
                    file_mime=None,
                )
            except Exception:
                break
            try:
                hub_service.review_task(
                    task_id=report_id,
                    reviewer=creator,
                    decision="reject",
                    comment="bench reject for more reports",
                    is_admin=True,
                )
            except Exception:
                break
        detail_shapes["reports_multi"] = report_id

    conc_levels = [int(x.strip()) for x in str(args.concurrency).split(",") if x.strip()]
    report = new_run_meta(marker=marker, hub_service=hub_service)
    report["scenarios"] = {}

    list_filters = [
        {"name": "my_both_default", "kwargs": {"scope": "my", "role_scope": "both", "sort_by": "updated_at", "sort_dir": "desc"}},
        {"name": "status_in_progress", "kwargs": {"scope": "my", "role_scope": "both", "status_filter": "in_progress", "sort_by": "status", "sort_dir": "asc"}},
        {"name": "role_assignee", "kwargs": {"scope": "my", "role_scope": "assignee", "sort_by": "updated_at", "sort_dir": "desc"}},
        {"name": "role_creator", "kwargs": {"scope": "my", "role_scope": "creator", "sort_by": "updated_at", "sort_dir": "desc"}},
        {"name": "role_controller", "kwargs": {"scope": "my", "role_scope": "controller", "sort_by": "updated_at", "sort_dir": "desc"}},
        {"name": "focus_review", "kwargs": {"scope": "my", "role_scope": "both", "focus_mode": "review", "sort_by": "updated_at", "sort_dir": "desc"}},
        {"name": "focus_overdue", "kwargs": {"scope": "my", "role_scope": "both", "focus_mode": "overdue", "sort_by": "due_at", "sort_dir": "asc"}},
        {"name": "assignee_filter", "kwargs": {"scope": "my", "role_scope": "both", "assignee_user_id": int(assignee["id"]), "sort_by": "updated_at", "sort_dir": "desc"}},
        {"name": "controller_filter", "kwargs": {"scope": "my", "role_scope": "controller", "sort_by": "updated_at", "sort_dir": "desc"}},
        {"name": "q_marker", "kwargs": {"scope": "my", "role_scope": "both", "q": marker, "sort_by": "updated_at", "sort_dir": "desc"}},
        {"name": "sort_due_desc", "kwargs": {"scope": "my", "role_scope": "both", "sort_by": "due_at", "sort_dir": "desc"}},
        {"name": "page_offset_100", "kwargs": {"scope": "my", "role_scope": "both", "sort_by": "updated_at", "sort_dir": "desc", "offset": 100}},
    ]

    for limit in (1, 20, 100, 500):
        for filt in list_filters:
            # Full matrix only for default filter; others at limit=100 to keep wall time sane
            if filt["name"] != "my_both_default" and limit != 100:
                continue
            for conc in conc_levels:
                if filt["name"] != "my_both_default" and conc != 1:
                    continue
                if limit == 500 and conc > 5:
                    continue

                def make_worker(limit_n: int = limit, filt_kwargs: dict = filt["kwargs"]):
                    def worker_fn(index: int, is_warmup: bool) -> dict[str, Any]:
                        hub_service._invalidate_tasks_list_cache()
                        t0 = time.perf_counter()
                        try:
                            with track_sql_queries(correlation_id=f"list-{limit_n}-{index}") as session:
                                payload = hub_service.list_tasks(
                                    user_id=int(creator["id"]),
                                    limit=limit_n,
                                    offset=int(filt_kwargs.get("offset") or 0),
                                    allow_all_scope=True,
                                    **{k: v for k, v in filt_kwargs.items() if k != "offset"},
                                )
                            elapsed = (time.perf_counter() - t0) * 1000.0
                            return {
                                "ok": True,
                                "total_ms": elapsed,
                                "query_count": session.count,
                                "payload_bytes": _payload_bytes(payload),
                                "rows_returned": len(payload.get("items") or []),
                                "cache": "forced_miss",
                            }
                        except Exception as exc:
                            from _hub_task_bench_common import classify_db_error

                            return {
                                "ok": False,
                                "total_ms": (time.perf_counter() - t0) * 1000.0,
                                "error": {"failed_stage": "list", **classify_db_error(exc)},
                            }

                    return worker_fn

                key = f"list_L{limit}_{filt['name']}_c{conc}"
                print(f"RUN {key}")
                result = run_closed_loop(
                    attempted_target=int(args.iterations),
                    concurrency=conc,
                    warmup=int(args.warmup),
                    worker_fn=make_worker(),
                )
                samples = result.pop("success_samples", [])
                qcounts = [int(s.get("query_count") or 0) for s in samples]
                pbytes = [int(s.get("payload_bytes") or 0) for s in samples]
                rows = [int(s.get("rows_returned") or 0) for s in samples]
                report["scenarios"][key] = {
                    **result,
                    "query_count": {
                        "last": qcounts[-1] if qcounts else None,
                        "min": min(qcounts) if qcounts else None,
                        "max": max(qcounts) if qcounts else None,
                        "avg": round(sum(qcounts) / len(qcounts), 2) if qcounts else None,
                    },
                    "payload_bytes": summary([float(x) for x in pbytes]),
                    "rows_returned": summary([float(x) for x in rows]),
                    "memory_allocation": "not_instrumented",
                    "http_total_ms": "not_instrumented",
                    "serialization_ms": "not_instrumented",
                    "db_time_ms": "not_instrumented_separate",
                    "cache_hit_miss": "forced_invalidate_before_each_op",
                }

    # Warm cache list
    for conc in (1,):
        def warm_worker(index: int, is_warmup: bool) -> dict[str, Any]:
            t0 = time.perf_counter()
            try:
                with track_sql_queries(correlation_id=f"warm-{index}") as session:
                    payload = hub_service.list_tasks(
                        user_id=int(creator["id"]),
                        scope="my",
                        role_scope="both",
                        limit=100,
                        offset=0,
                        sort_by="updated_at",
                        sort_dir="desc",
                    )
                return {
                    "ok": True,
                    "total_ms": (time.perf_counter() - t0) * 1000.0,
                    "query_count": session.count,
                    "payload_bytes": _payload_bytes(payload),
                    "rows_returned": len(payload.get("items") or []),
                }
            except Exception as exc:
                from _hub_task_bench_common import classify_db_error

                return {"ok": False, "total_ms": (time.perf_counter() - t0) * 1000.0, "error": {"failed_stage": "list_warm", **classify_db_error(exc)}}

        # prime once
        hub_service.list_tasks(user_id=int(creator["id"]), scope="my", role_scope="both", limit=100, offset=0, sort_by="updated_at", sort_dir="desc")
        print("RUN list_warm_cache_L100_c1")
        result = run_closed_loop(
            attempted_target=int(args.iterations),
            concurrency=1,
            warmup=int(args.warmup),
            worker_fn=warm_worker,
        )
        samples = result.pop("success_samples", [])
        qcounts = [int(s.get("query_count") or 0) for s in samples]
        report["scenarios"]["list_warm_cache_L100_c1"] = {
            **result,
            "query_count": {"last": qcounts[-1] if qcounts else None, "min": min(qcounts) if qcounts else None, "max": max(qcounts) if qcounts else None},
            "cache_hit_miss": "no_invalidate_soft_cache_may_hit",
        }

    # Detail shapes
    for shape, task_id in detail_shapes.items():
        def make_detail(tid: str = task_id, shape_name: str = shape):
            def worker_fn(index: int, is_warmup: bool) -> dict[str, Any]:
                t0 = time.perf_counter()
                try:
                    with track_sql_queries(correlation_id=f"detail-{shape_name}-{index}") as session:
                        item = hub_service.get_task(tid, user_id=int(creator["id"]), is_admin=True)
                    elapsed = (time.perf_counter() - t0) * 1000.0
                    return {
                        "ok": bool(item),
                        "total_ms": elapsed,
                        "query_count": session.count,
                        "payload_bytes": _payload_bytes(item or {}),
                        "rows_returned": 1 if item else 0,
                    }
                except Exception as exc:
                    from _hub_task_bench_common import classify_db_error

                    return {
                        "ok": False,
                        "total_ms": (time.perf_counter() - t0) * 1000.0,
                        "error": {"failed_stage": "detail", **classify_db_error(exc)},
                    }

            return worker_fn

        for conc in conc_levels:
            if shape != "ordinary" and conc != 1:
                continue
            key = f"detail_{shape}_c{conc}"
            print(f"RUN {key}")
            result = run_closed_loop(
                attempted_target=int(args.iterations),
                concurrency=conc,
                warmup=int(args.warmup),
                worker_fn=make_detail(),
            )
            samples = result.pop("success_samples", [])
            qcounts = [int(s.get("query_count") or 0) for s in samples]
            pbytes = [int(s.get("payload_bytes") or 0) for s in samples]
            report["scenarios"][key] = {
                **result,
                "task_id": task_id,
                "query_count": {
                    "last": qcounts[-1] if qcounts else None,
                    "min": min(qcounts) if qcounts else None,
                    "max": max(qcounts) if qcounts else None,
                },
                "payload_bytes": summary([float(x) for x in pbytes]),
                "enrich_breakdown": "not_instrumented_per_substage",
            }

    # Dashboard
    for user_label, user in (("creator", creator), ("assignee", assignee)):
        for conc in (1, 5, 10, 20):
            if user_label != "creator" and conc != 1:
                continue

            def make_dash(uid: int = int(user["id"])):
                def worker_fn(index: int, is_warmup: bool) -> dict[str, Any]:
                    # alternate cold/warm
                    if index % 2 == 0:
                        hub_service._invalidate_dashboard_cache(uid)
                    t0 = time.perf_counter()
                    try:
                        with track_sql_queries(correlation_id=f"dash-{uid}-{index}") as session:
                            payload = hub_service.get_dashboard(user_id=uid, announcements_limit=20, tasks_limit=10)
                        my_tasks = payload.get("my_tasks") or {}
                        items = my_tasks.get("items") if isinstance(my_tasks, dict) else []
                        return {
                            "ok": True,
                            "total_ms": (time.perf_counter() - t0) * 1000.0,
                            "query_count": session.count,
                            "payload_bytes": _payload_bytes(payload),
                            "rows_returned": len(items or []),
                        }
                    except Exception as exc:
                        from _hub_task_bench_common import classify_db_error

                        return {
                            "ok": False,
                            "total_ms": (time.perf_counter() - t0) * 1000.0,
                            "error": {"failed_stage": "dashboard", **classify_db_error(exc)},
                        }

                return worker_fn

            key = f"dashboard_{user_label}_c{conc}"
            print(f"RUN {key}")
            result = run_closed_loop(
                attempted_target=int(args.iterations),
                concurrency=conc,
                warmup=int(args.warmup),
                worker_fn=make_dash(),
            )
            samples = result.pop("success_samples", [])
            qcounts = [int(s.get("query_count") or 0) for s in samples]
            pbytes = [int(s.get("payload_bytes") or 0) for s in samples]
            report["scenarios"][key] = {
                **result,
                "query_count": {
                    "last": qcounts[-1] if qcounts else None,
                    "min": min(qcounts) if qcounts else None,
                    "max": max(qcounts) if qcounts else None,
                },
                "payload_bytes": summary([float(x) for x in pbytes]),
            }

    report["seeded_task_ids_count"] = len(created)
    report["detail_shapes"] = detail_shapes
    write_json(Path(args.out), report)
    print(f"Wrote {args.out}")

    if not args.keep:
        print(f"Cleanup {len(created)} seeded tasks…")
        for tid in created:
            try:
                hub_service.delete_task(task_id=tid, actor_user_id=int(creator["id"]), is_admin=True)
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
