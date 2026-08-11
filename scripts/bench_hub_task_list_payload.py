#!/usr/bin/env python3
"""Baseline/after bench for Hub list_tasks payload size and latency."""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "WEB-itinvent"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=False)

TITLE_PREFIX = "BenchListPayload "


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


def _summary(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"n": 0, "p50_ms": None, "p90_ms": None, "p95_ms": None, "max_ms": None, "avg_ms": None}
    return {
        "n": len(values),
        "p50_ms": _percentile(values, 50),
        "p90_ms": _percentile(values, 90),
        "p95_ms": _percentile(values, 95),
        "max_ms": round(max(values), 2),
        "avg_ms": round(statistics.fmean(values), 2),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", type=int, default=1253)
    parser.add_argument("--seed", type=int, default=100, help="tasks to ensure for N=100 page")
    parser.add_argument("--iterations", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--label", default="baseline")
    parser.add_argument("--out", default=str(ROOT / "tmp" / "hub-task-list-payload-baseline.json"))
    parser.add_argument("--keep", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    from backend.services.hub_service import hub_service
    from backend.services.sql_query_counter import track_sql_queries
    from backend.services.user_service import user_service

    user = user_service.get_by_id(int(args.user_id))
    if not user:
        raise SystemExit("user not found")
    assignee = user_service.get_by_id(1254) or user
    with hub_service._db_conn(write=True) as conn:
        hub_service._ensure_default_task_project(conn)
        conn.commit()
    projects = hub_service.list_task_projects(include_inactive=False)
    project_id = str((projects[0] or {}).get("id") or hub_service._DEFAULT_TASK_PROJECT_ID) if projects else str(hub_service._DEFAULT_TASK_PROJECT_ID)

    created: list[str] = []
    for index in range(max(0, int(args.seed))):
        task = hub_service.create_task(
            title=f"{TITLE_PREFIX}{uuid.uuid4().hex[:8]} #{index + 1}",
            description=("seed description " * 20) + f"#{index + 1}",
            assignee_user_id=int(assignee["id"]),
            controller_user_id=0,
            due_at=None,
            project_id=project_id,
            actor=user,
            checklist_items=[{"id": "c1", "text": "one", "done": False}, {"id": "c2", "text": "two", "done": True}],
            initial_status="new",
        )
        task_id = str((task or {}).get("id") or "")
        if task_id:
            created.append(task_id)

    limits = (1, 20, 100)
    report: dict[str, Any] = {
        "label": args.label,
        "collected_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "user_id": int(user["id"]),
        "seeded_tasks": len(created),
        "iterations": int(args.iterations),
        "warmup": int(args.warmup),
        "scenarios": {},
        "notes": {
            "payload_bytes": "utf-8 JSON of list_tasks payload before HTTP/gzip",
            "query_count": "hub connection executes inside track_sql_queries only",
            "memory": "not_instrumented",
            "http_compression": "not_applicable_service_level_bench",
        },
    }

    for limit in limits:
        latencies: list[float] = []
        query_counts: list[int] = []
        payload_bytes: list[int] = []
        item_counts: list[int] = []
        total = max(0, int(args.warmup)) + max(1, int(args.iterations))
        for index in range(total):
            hub_service._invalidate_tasks_list_cache()
            t0 = time.perf_counter()
            with track_sql_queries(correlation_id=f"list-{limit}-{index}") as session:
                payload = hub_service.list_tasks(
                    user_id=int(user["id"]),
                    scope="my",
                    role_scope="both",
                    limit=limit,
                    offset=0,
                    sort_by="updated_at",
                    sort_dir="desc",
                )
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if index < int(args.warmup):
                continue
            latencies.append(elapsed_ms)
            query_counts.append(session.count)
            payload_bytes.append(len(encoded))
            item_counts.append(len(payload.get("items") or []))
        sample_item = (payload.get("items") or [None])[0]
        report["scenarios"][f"N{limit}"] = {
            "limit": limit,
            "returned_tasks": item_counts[-1] if item_counts else 0,
            "latency_ms": _summary(latencies),
            "query_count": {
                "exact_last": query_counts[-1] if query_counts else None,
                "min": min(query_counts) if query_counts else None,
                "max": max(query_counts) if query_counts else None,
                "values_unique": sorted(set(query_counts)),
            },
            "payload_bytes_json_utf8": {
                "last": payload_bytes[-1] if payload_bytes else None,
                "avg": round(statistics.fmean(payload_bytes), 1) if payload_bytes else None,
                "min": min(payload_bytes) if payload_bytes else None,
                "max": max(payload_bytes) if payload_bytes else None,
            },
            "sample_item_keys": sorted(sample_item.keys()) if isinstance(sample_item, dict) else [],
            "db_time_ms": {"status": "not_instrumented"},
            "serialization_time_ms": {"status": "not_instrumented_separate_from_total"},
            "memory_bytes": {"status": "not_instrumented"},
        }

    if not args.keep:
        deleted = 0
        for task_id in created:
            try:
                if hub_service.delete_task(task_id=task_id, actor_user_id=0, is_admin=True):
                    deleted += 1
            except Exception as exc:  # noqa: BLE001
                print(f"WARN delete {task_id}: {exc}", file=sys.stderr)
        report["deleted_tasks"] = deleted

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report["scenarios"].items()}, ensure_ascii=False, indent=2))
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
