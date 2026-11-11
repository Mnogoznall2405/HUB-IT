#!/usr/bin/env python3
"""TASK-AUDIT: SQL inventory, EXPLAIN, review-queue, side-effects notes (read-mostly)."""
from __future__ import annotations

import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tmp" / "hub-task-audit"
sys.path.insert(0, str(ROOT / "WEB-itinvent"))
sys.path.insert(0, str(ROOT / "scripts"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=False)

from _hub_task_bench_common import TITLE_PREFIX, ensure_project_id, git_commit, write_json  # noqa: E402


def _explain(conn, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any]:
    try:
        # SqlAlchemyCompatConnection may wrap execute
        cur = conn.execute(f"EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) {sql}", params)
        row = cur.fetchone()
        if row is None:
            return {"error": "empty_explain"}
        raw = row[0] if not hasattr(row, "keys") else row[list(row.keys())[0]]
        if isinstance(raw, str):
            plan = json.loads(raw)
        elif isinstance(raw, (list, dict)):
            plan = raw
        else:
            plan = json.loads(str(raw))
        root = plan[0] if isinstance(plan, list) and plan else plan
        plan_node = root.get("Plan") if isinstance(root, dict) else None
        return {
            "sql": " ".join(sql.split())[:500],
            "planning_time_ms": root.get("Planning Time") if isinstance(root, dict) else None,
            "execution_time_ms": root.get("Execution Time") if isinstance(root, dict) else None,
            "node_type": (plan_node or {}).get("Node Type"),
            "actual_rows": (plan_node or {}).get("Actual Rows"),
            "plan_rows": (plan_node or {}).get("Plan Rows"),
            "shared_hit_blocks": (plan_node or {}).get("Shared Hit Blocks"),
            "shared_read_blocks": (plan_node or {}).get("Shared Read Blocks"),
            "temp_read_blocks": (plan_node or {}).get("Temp Read Blocks"),
            "temp_written_blocks": (plan_node or {}).get("Temp Written Blocks"),
            "plan": root,
        }
    except Exception as exc:  # noqa: BLE001
        return {"sql": " ".join(sql.split())[:500], "error": f"{type(exc).__name__}: {exc}"}


def main() -> int:
    from backend.services.hub_service import hub_service
    from backend.services.user_service import user_service
    from backend.services.sql_query_counter import track_sql_queries

    OUT.mkdir(parents=True, exist_ok=True)
    explain_dir = OUT / "explain-before"
    explain_dir.mkdir(parents=True, exist_ok=True)

    creator = user_service.get_by_id(1253)
    assignee = user_service.get_by_id(1254)
    if not creator or not assignee:
        raise SystemExit("bench users missing")
    project_id = ensure_project_id(hub_service)
    marker = f"sql-{uuid.uuid4().hex[:8]}"

    # Seed a few tasks for EXPLAIN realism (cleanup at end)
    created: list[str] = []
    for i in range(30):
        t = hub_service.create_task(
            title=f"{TITLE_PREFIX}{marker} #{i}",
            description="sql audit",
            assignee_user_id=int(assignee["id"]),
            controller_user_id=0,
            due_at=None,
            project_id=project_id,
            actor=creator,
            initial_status="review" if i % 5 == 0 else "in_progress",
        )
        tid = str((t or {}).get("id") or "")
        if tid:
            created.append(tid)
            if i % 5 == 0:
                # leave in review if possible
                try:
                    hub_service.start_task(task_id=tid, user=assignee)
                    hub_service.submit_task(task_id=tid, user=assignee, comment="r", file_name=None, file_bytes=None, file_mime=None)
                except Exception:
                    pass

    sql_inventory: list[dict[str, Any]] = []
    explains: dict[str, Any] = {}

    # Capture list_tasks SQL via counter if available; also EXPLAIN common patterns
    with hub_service._db_conn(write=False) as conn:
        # Review queue snapshot (read-only product analysis)
        review_rows = conn.execute(
            f"""
            SELECT id, title, status, controller_user_id, created_by_user_id, assignee_user_id,
                   due_at, submitted_at, updated_at, created_at, reviewed_at
            FROM {hub_service._TASKS_TABLE}
            WHERE status = 'review'
            ORDER BY COALESCE(submitted_at, updated_at) ASC
            LIMIT 500
            """
        ).fetchall()
        review_items = [dict(r) for r in review_rows]

        overdue_rows = conn.execute(
            f"""
            SELECT COUNT(*) AS c FROM {hub_service._TASKS_TABLE}
            WHERE status NOT IN ('done','cancelled') AND due_at IS NOT NULL AND due_at < ?
            """,
            (datetime.now(timezone.utc).replace(microsecond=0).isoformat(),),
        ).fetchone()

        # EXPLAIN list-like filter
        explains["list_assignee_status"] = _explain(
            conn,
            f"""
            SELECT id FROM {hub_service._TASKS_TABLE}
            WHERE assignee_user_id = ? AND status = ?
            ORDER BY updated_at DESC
            LIMIT 100
            """,
            (int(assignee["id"]), "in_progress"),
        )
        explains["list_review_queue"] = _explain(
            conn,
            f"""
            SELECT id FROM {hub_service._TASKS_TABLE}
            WHERE status = 'review'
            ORDER BY updated_at DESC
            LIMIT 100
            """,
        )
        explains["notifications_by_entity"] = _explain(
            conn,
            f"""
            SELECT id FROM {hub_service._NOTIF_TABLE}
            WHERE entity_type = ? AND entity_id = ?
            LIMIT 50
            """,
            ("task", created[0] if created else ""),
        )
        explains["comments_by_task"] = _explain(
            conn,
            f"""
            SELECT id FROM {hub_service._TASK_COMMENTS_TABLE}
            WHERE task_id = ?
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (created[0] if created else "",),
        )
        explains["attachments_by_task"] = _explain(
            conn,
            f"""
            SELECT id FROM {hub_service._TASK_ATTACH_TABLE}
            WHERE task_id = ?
            LIMIT 50
            """,
            (created[0] if created else "",),
        )
        explains["status_log_by_task"] = _explain(
            conn,
            f"""
            SELECT id FROM {hub_service._TASK_STATUS_LOG_TABLE}
            WHERE task_id = ?
            ORDER BY changed_at DESC
            LIMIT 50
            """,
            (created[0] if created else "",),
        )
        explains["reports_by_task"] = _explain(
            conn,
            f"""
            SELECT id FROM {hub_service._TASK_REPORTS_TABLE}
            WHERE task_id = ?
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (created[0] if created else "",),
        )

        # Delegate links count
        try:
            from backend.appdb.models import AppTaskDelegateUserLink
            from backend.appdb.db import get_app_session

            with get_app_session() as session:
                delegate_total = session.query(AppTaskDelegateUserLink).count()
        except Exception as exc:  # noqa: BLE001
            delegate_total = f"unavailable: {exc}"

    # Measure get_task query count + side-effect of mark-read separately
    detail_qc = None
    if created:
        with track_sql_queries(correlation_id="detail-sql") as session:
            hub_service.get_task(created[0], user_id=int(creator["id"]), is_admin=True)
        detail_qc = session.count

    list_qc = None
    with track_sql_queries(correlation_id="list-sql") as session:
        hub_service.list_tasks(
            user_id=int(creator["id"]),
            scope="my",
            role_scope="both",
            limit=100,
            offset=0,
            sort_by="updated_at",
            sort_dir="desc",
        )
    list_qc = session.count

    create_stages = None
    t0 = time.perf_counter()
    from backend.services.sql_query_counter import track_hub_stage_timings

    with track_hub_stage_timings() as samples:
        t = hub_service.create_task(
            title=f"{TITLE_PREFIX}{marker} stageprobe",
            description="probe",
            assignee_user_id=int(assignee["id"]),
            controller_user_id=0,
            due_at=None,
            project_id=project_id,
            actor=creator,
        )
        created.append(str((t or {}).get("id") or ""))
    create_ms = (time.perf_counter() - t0) * 1000.0
    if samples:
        create_stages = dict(samples[-1].stages or {})

    # Notifications fanout count for last create
    notif_count = 0
    if created:
        with hub_service._db_conn(write=False) as conn:
            row = conn.execute(
                f"SELECT COUNT(*) AS c FROM {hub_service._NOTIF_TABLE} WHERE entity_type='task' AND entity_id=?",
                (created[-1],),
            ).fetchone()
            notif_count = int(row["c"] if row else 0)

    # Review queue enrichment
    now = datetime.now(timezone.utc)
    enriched = []
    for item in review_items[:200]:
        submitted = item.get("submitted_at") or item.get("updated_at")
        age_hours = None
        try:
            if submitted:
                dt = datetime.fromisoformat(str(submitted).replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                age_hours = round((now - dt).total_seconds() / 3600.0, 2)
        except Exception:
            age_hours = None
        controller_id = int(item.get("controller_user_id") or 0)
        creator_id = int(item.get("created_by_user_id") or 0)
        assignee_id = int(item.get("assignee_user_id") or 0)
        delegates = user_service.get_delegate_user_ids(assignee_id) if assignee_id else []
        with hub_service._db_conn(write=False) as conn:
            n = conn.execute(
                f"""
                SELECT COUNT(*) AS c FROM {hub_service._NOTIF_TABLE}
                WHERE entity_type='task' AND entity_id=? AND event_type IN ('task.submitted','task.review_required')
                """,
                (item["id"],),
            ).fetchone()
            notif_n = int(n["c"] if n else 0)
        blocked_reason = None
        # Impossible review heuristic: no controller and creator inactive?
        creator_u = user_service.get_by_id(creator_id) if creator_id else None
        controller_u = user_service.get_by_id(controller_id) if controller_id else None
        if controller_id <= 0 and (not creator_u or not creator_u.get("is_active", True)):
            blocked_reason = "no_controller_and_inactive_creator"
        elif controller_id > 0 and controller_u and not controller_u.get("is_active", True) and (not creator_u or not creator_u.get("is_active", True)):
            blocked_reason = "inactive_controller_and_creator"
        enriched.append(
            {
                "id": item.get("id"),
                "title": item.get("title"),
                "age_hours": age_hours,
                "controller_user_id": controller_id,
                "created_by_user_id": creator_id,
                "assignee_user_id": assignee_id,
                "due_at": item.get("due_at"),
                "submitted_at": item.get("submitted_at"),
                "last_activity": item.get("updated_at"),
                "review_notification_count": notif_n,
                "assignee_delegate_count": len(delegates),
                "blocked_reason": blocked_reason,
            }
        )

    ages = [x["age_hours"] for x in enriched if x.get("age_hours") is not None]
    review_doc = {
        "collected_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "git_commit": git_commit(),
        "review_count_sampled": len(review_items),
        "review_count_note": "LIMIT 500 oldest-by-submitted",
        "overdue_open_count": int(overdue_rows["c"] if overdue_rows else 0),
        "age_hours": {
            "min": min(ages) if ages else None,
            "max": max(ages) if ages else None,
            "avg": round(sum(ages) / len(ages), 2) if ages else None,
            "p50": sorted(ages)[len(ages) // 2] if ages else None,
        },
        "blocked_candidates": [x for x in enriched if x.get("blocked_reason")],
        "oldest_20": sorted(enriched, key=lambda x: -(x.get("age_hours") or 0))[:20],
        "no_auto_reminders": True,
    }

    # Side effects analysis (static + probe)
    side_effects = {
        "collected_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "create_probe": {
            "total_ms": round(create_ms, 2),
            "stages": create_stages,
            "notifications_rows_for_task": notif_count,
            "notification_model": "one hub_notifications row per recipient (loop in _create_task_notifications)",
            "email": "queued in same notifications TX via _queue_task_email_notifications (hub_task_email_outbox)",
            "push": "deferred flush after notifications TX (_hub_push_deferred); counted in push_flush_ms",
            "chat_discussion": "not auto-created on create; publish on update/start/submit/review/reopen via API layer AFTER service return",
        },
        "tx_boundaries": {
            "create_submit_review": "business write commit THEN separate notifications+email commit THEN enrich; push flush after",
            "update_start_delete_comments_attachments": "single TX under process RLock including notifications when applicable",
            "http_500_after_commit_risk": [
                "API publish_task_discussion_updated after successful service write (start/submit/review/update/reopen)",
                "API delete_task_discussion after delete_task commit",
                "mark_task_notifications_read after get_task (separate locked write)",
            ],
            "lost_on_restart": [
                "in-memory deferred push jobs if process dies mid-flush",
                "email outbox rows survive (DB) if committed",
                "chat publish is best-effort post-commit",
            ],
            "sync_in_http_latency": [
                "hub notification inserts",
                "email outbox enqueue",
                "push flush (deferred batch still before return)",
                "enrich/_task_with_latest_report on create/submit/review",
            ],
        },
        "batching": {
            "notifications": "not batch-insert; per-recipient _create_notification",
            "recipients_include": "assignee + delegates + controller + observers (event-dependent)",
        },
    }

    # Delegate analysis
    cold = []
    warm = []
    user_service._invalidate_delegate_links_cache()
    for i in range(40):
        if i % 10 == 0:
            user_service._invalidate_delegate_links_cache()
        t1 = time.perf_counter()
        ids = user_service.get_delegate_user_ids(int(assignee["id"]))
        ms = (time.perf_counter() - t1) * 1000.0
        (cold if i % 10 == 0 else warm).append(ms)
    delegate_doc = {
        "collected_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "cache_ttl_sec": user_service._delegate_links_cache_ttl_sec,
        "cache_scope": "full links list (not per-owner map)",
        "delegate_links_total": delegate_total,
        "get_delegate_user_ids_cold_ms": {
            "n": len(cold),
            "p95": sorted(cold)[int(0.95 * (len(cold) - 1))] if cold else None,
            "avg": round(sum(cold) / len(cold), 3) if cold else None,
            "max": max(cold) if cold else None,
        },
        "get_delegate_user_ids_warm_ms": {
            "n": len(warm),
            "p95": sorted(warm)[int(0.95 * (len(warm) - 1))] if warm else None,
            "avg": round(sum(warm) / len(warm), 3) if warm else None,
            "max": max(warm) if warm else None,
        },
        "calls_per_create": "at least 1× _task_delegate_user_ids(assignee) during notify",
        "calls_per_submit_review": "1–2× for assignee delegates",
        "map_cache": "not implemented — do not add until cost confirmed",
        "scanned_rows": "full delegate link table/list on cold cache miss",
    }

    # Lock analysis (static)
    lock_doc = {
        "collected_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "process_rlock": "HubService._lock (RLock)",
        "pg_db_conn_skips_lock": True,
        "still_locked_on_pg": [
            "update_task",
            "delete_task",
            "start_task",
            "reopen_task",
            "list/add/mark comments",
            "list_task_status_log",
            "add/get attachments",
            "get_report",
            "mark_*_notifications_read",
            "task projects/objects writes",
            "announcement writes",
        ],
        "unlocked_on_pg": ["create_task", "submit_task", "review_task", "get_task", "list_tasks", "get_task_analytics", "poll/unread"],
        "instrumentation": {
            "lock_wait_ms": "not_instrumented",
            "lock_hold_ms": "not_instrumented",
            "waiters": "not_instrumented",
        },
        "baseline_contention": "WRITE-CONTENTION-01 create p95~566ms at c=20 (no RLock on create; pool/notify amplification)",
    }

    sql_inventory = [
        {"op": "list_tasks", "query_count_sample": list_qc, "source": "hub_service.list_tasks", "n_plus_one": "no (flat ~8)"},
        {"op": "get_task", "query_count_sample": detail_qc, "source": "hub_service.get_task / _task_with_latest_report", "n_plus_one": "check explain + qc"},
        {"op": "review_queue", "source": "status='review' ORDER BY submitted_at", "index_hint": "controller_user_id,status,updated_at and status filters"},
        {"op": "notifications_entity", "source": "entity_type+entity_id", "index": "(entity_type, entity_id) present"},
        {"op": "create_task", "stages": create_stages, "source": "INSERT hub_tasks + status_log; then notifications"},
    ]

    write_json(OUT / "sql-inventory.md.json", {"items": sql_inventory})  # temp; also write md
    (OUT / "sql-inventory.md").write_text(
        "# SQL inventory (TASK-AUDIT)\n\n"
        + f"git: `{git_commit()}`\n\n"
        + "\n".join(
            f"- **{i['op']}**: query_count={i.get('query_count_sample')} source=`{i.get('source')}` notes={i.get('n_plus_one') or i.get('index') or ''}"
            for i in sql_inventory
        )
        + "\n\nSee `explain-before/*.json` for EXPLAIN (ANALYZE, BUFFERS, WAL).\n",
        encoding="utf-8",
    )
    for name, payload in explains.items():
        write_json(explain_dir / f"{name}.json", payload)

    write_json(OUT / "review-queue.md.json", review_doc)
    (OUT / "review-queue.md").write_text(
        "# Review queue (read-only)\n\n"
        f"- sampled review tasks: **{review_doc['review_count_sampled']}**\n"
        f"- overdue open: **{review_doc['overdue_open_count']}**\n"
        f"- age hours p50/avg/max: {review_doc['age_hours']}\n"
        f"- blocked candidates: **{len(review_doc['blocked_candidates'])}**\n"
        "- auto-reminders: **not enabled** (audit only)\n\n"
        "## Oldest 20\n\n"
        + "\n".join(
            f"- `{x['id']}` age={x['age_hours']}h controller={x['controller_user_id']} "
            f"creator={x['created_by_user_id']} notifs={x['review_notification_count']} "
            f"delegates={x['assignee_delegate_count']} blocked={x['blocked_reason']}"
            for x in review_doc["oldest_20"]
        )
        + "\n",
        encoding="utf-8",
    )
    write_json(OUT / "side-effects.md.json", side_effects)
    (OUT / "side-effects.md").write_text(
        "# Side effects (task write-path)\n\n"
        + json.dumps(side_effects, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    write_json(OUT / "delegate-analysis.md.json", delegate_doc)
    (OUT / "delegate-analysis.md").write_text(
        "# Delegate path\n\n" + json.dumps(delegate_doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_json(OUT / "lock-analysis.md.json", lock_doc)
    (OUT / "lock-analysis.md").write_text(
        "# Lock analysis\n\n" + json.dumps(lock_doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("Wrote SQL/EXPLAIN/review/side-effects/delegate/lock artifacts")

    for tid in created:
        try:
            hub_service.delete_task(task_id=tid, actor_user_id=int(creator["id"]), is_admin=True)
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
