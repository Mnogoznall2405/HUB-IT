#!/usr/bin/env python3
"""Collect Hub task performance baseline (readonly SELECT)."""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env", override=False)

OUTPUT = ROOT / "tmp" / "hub-task-perf-baseline.json"


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 3)
    rank = (len(ordered) - 1) * (pct / 100.0)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return round(ordered[low], 3)
    weight = rank - low
    return round(ordered[low] * (1.0 - weight) + ordered[high] * weight, 3)


def _parse_ts(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def main() -> int:
    url = os.getenv("APP_DATABASE_URL")
    if not url:
        raise SystemExit("APP_DATABASE_URL is not configured")
    eng = create_engine(url)
    now = datetime.now(timezone.utc)
    out: dict[str, Any] = {
        "collected_at": _utcnow_iso(),
        "source": "app.hub_tasks / app.hub_task_status_log",
    }

    with eng.connect() as c:
        by_status = {
            str(r[0] or ""): int(r[1] or 0)
            for r in c.execute(text("SELECT status, COUNT(*) FROM app.hub_tasks GROUP BY status ORDER BY 1")).fetchall()
        }
        total = sum(by_status.values())
        out["volume"] = {"total": total, "by_status": by_status, "in_review": int(by_status.get("review") or 0)}

        create_day_7 = c.execute(
            text(
                """
                SELECT left(created_at, 10) AS day, COUNT(*)
                FROM app.hub_tasks
                WHERE created_at >= :since
                GROUP BY 1
                ORDER BY 1
                """
            ),
            {"since": (now.replace(hour=0, minute=0, second=0, microsecond=0)).isoformat()},
        ).fetchall()
        # last 7/30 days by string compare on ISO dates works if timestamps are ISO
        create_by_day_30 = [
            {"day": str(r[0]), "count": int(r[1])}
            for r in c.execute(
                text(
                    """
                    SELECT left(created_at, 10) AS day, COUNT(*)
                    FROM app.hub_tasks
                    WHERE left(created_at, 10) >= :since
                    GROUP BY 1
                    ORDER BY 1
                    """
                ),
                {"since": (now.date().fromordinal(now.date().toordinal() - 29)).isoformat()},
            ).fetchall()
        ]
        create_by_hour_7 = [
            {"hour": str(r[0]), "count": int(r[1])}
            for r in c.execute(
                text(
                    """
                    SELECT left(created_at, 13) AS hour, COUNT(*)
                    FROM app.hub_tasks
                    WHERE left(created_at, 10) >= :since
                    GROUP BY 1
                    ORDER BY 1
                    """
                ),
                {"since": (now.date().fromordinal(now.date().toordinal() - 6)).isoformat()},
            ).fetchall()
        ]
        day_counts_7 = [item["count"] for item in create_by_day_30 if item["day"] >= (now.date().fromordinal(now.date().toordinal() - 6)).isoformat()]
        out["create_rate"] = {
            "by_day_30": create_by_day_30,
            "by_hour_7": create_by_hour_7,
            "avg_per_day_7": round(sum(day_counts_7) / max(1, len(day_counts_7)), 2),
            "total_7d": int(sum(day_counts_7)),
            "total_30d": int(sum(item["count"] for item in create_by_day_30)),
        }

        review_rows = c.execute(
            text(
                """
                SELECT id, submitted_at, created_at, controller_user_id, controller_username
                FROM app.hub_tasks
                WHERE status = 'review'
                """
            )
        ).mappings().all()
        ages_hours: list[float] = []
        for row in review_rows:
            start = _parse_ts(row.get("submitted_at")) or _parse_ts(row.get("created_at"))
            if start is None:
                continue
            ages_hours.append(max(0.0, (now - start).total_seconds() / 3600.0))
        out["review_queue"] = {
            "count": len(review_rows),
            "age_hours_p50": _percentile(ages_hours, 50),
            "age_hours_p95": _percentile(ages_hours, 95),
            "age_hours_max": round(max(ages_hours), 3) if ages_hours else None,
        }

        lead_rows = c.execute(
            text(
                """
                SELECT created_at, submitted_at, reviewed_at, completed_at, status
                FROM app.hub_tasks
                WHERE left(created_at, 10) >= :since
                """
            ),
            {"since": (now.date().fromordinal(now.date().toordinal() - 29)).isoformat()},
        ).mappings().all()
        create_to_review_h: list[float] = []
        review_to_done_h: list[float] = []
        for row in lead_rows:
            created = _parse_ts(row.get("created_at"))
            submitted = _parse_ts(row.get("submitted_at"))
            reviewed = _parse_ts(row.get("reviewed_at"))
            completed = _parse_ts(row.get("completed_at"))
            if created and submitted:
                create_to_review_h.append(max(0.0, (submitted - created).total_seconds() / 3600.0))
            end = reviewed or completed
            if submitted and end:
                review_to_done_h.append(max(0.0, (end - submitted).total_seconds() / 3600.0))
        out["lead_time_hours_30d"] = {
            "create_to_review_count": len(create_to_review_h),
            "create_to_review_p50": _percentile(create_to_review_h, 50),
            "create_to_review_p95": _percentile(create_to_review_h, 95),
            "review_to_done_count": len(review_to_done_h),
            "review_to_done_p50": _percentile(review_to_done_h, 50),
            "review_to_done_p95": _percentile(review_to_done_h, 95),
        }

        top_controllers = [
            {
                "controller_user_id": int(r[0] or 0),
                "controller_username": str(r[1] or ""),
                "tasks": int(r[2] or 0),
                "in_review": int(r[3] or 0),
            }
            for r in c.execute(
                text(
                    """
                    SELECT controller_user_id,
                           max(controller_username) AS controller_username,
                           COUNT(*) AS tasks,
                           COUNT(*) FILTER (WHERE status = 'review') AS in_review
                    FROM app.hub_tasks
                    WHERE controller_user_id > 0
                      AND left(created_at, 10) >= :since
                    GROUP BY controller_user_id
                    ORDER BY tasks DESC
                    LIMIT 10
                    """
                ),
                {"since": (now.date().fromordinal(now.date().toordinal() - 29)).isoformat()},
            ).fetchall()
        ]
        controller_5 = c.execute(
            text(
                """
                SELECT
                  COUNT(*) FILTER (WHERE status = 'review') AS in_review,
                  COUNT(*) FILTER (WHERE reviewed_at IS NOT NULL AND left(reviewed_at, 10) >= :since) AS reviewed_30d,
                  COUNT(*) FILTER (WHERE status = 'done' AND left(completed_at, 10) >= :since) AS done_30d
                FROM app.hub_tasks
                WHERE controller_user_id = 5
                """
            ),
            {"since": (now.date().fromordinal(now.date().toordinal() - 29)).isoformat()},
        ).mappings().one()
        out["controllers"] = {
            "top_30d": top_controllers,
            "user_5": dict(controller_5),
        }

        transitions = [
            {"old_status": str(r[0] or ""), "new_status": str(r[1] or ""), "count": int(r[2] or 0)}
            for r in c.execute(
                text(
                    """
                    SELECT old_status, new_status, COUNT(*)
                    FROM app.hub_task_status_log
                    WHERE left(changed_at, 10) >= :since
                    GROUP BY 1, 2
                    ORDER BY 3 DESC
                    LIMIT 30
                    """
                ),
                {"since": (now.date().fromordinal(now.date().toordinal() - 6)).isoformat()},
            ).fetchall()
        ]
        out["status_log_7d"] = transitions

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
