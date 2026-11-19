"""Reclassify DLP activity seconds against per-branch work schedules.

Schedules live in ``app.branch_work_schedules`` keyed by the resolved inventory
``branch_name``. Reclassification happens at query time (buckets are never
rewritten), so a saved schedule applies retroactively to already stored data.

Semantics (agreed with the user):
- ``active`` seconds are never reclassified — real input is real work, even at 2am.
- ``passive``/``away``/``locked`` inside the lunch window → ``break_sec`` (перерыв).
- The same states outside the workday (or on a non-workday) → ``offshift_sec``;
  they no longer count into «отошёл».
- ``tz_offset_minutes`` shifts server-local bucket timestamps to branch-local time.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_SCHED_TTL_SEC = 60.0
_sched_lock = threading.Lock()
_sched_cache: Dict[str, Any] = {"expires": 0.0, "by_branch": {}}

ZONE_WORK = "work"
ZONE_LUNCH = "lunch"
ZONE_OFF = "off"

# Agent timestamps are wall-clock digits of the server site (Tyumen, UTC+05,
# no DST). Anchor conversions to it explicitly so results do not depend on
# the OS timezone the backend happens to run under.
TYUMEN_TZ = timezone(timedelta(hours=5))


def _norm_branch(value: Any) -> str:
    return str(value or "").strip().lower()


def invalidate_schedules_cache() -> None:
    with _sched_lock:
        _sched_cache["expires"] = 0.0


def load_schedules(store: Any) -> Dict[str, Dict[str, Any]]:
    """All configured schedules keyed by normalized branch name (60s cache)."""
    now = time.time()
    with _sched_lock:
        if float(_sched_cache.get("expires") or 0.0) > now:
            return _sched_cache.get("by_branch") or {}
    try:
        rows = store.list_branch_work_schedules() or []
    except Exception:
        logger.warning("dlp schedules: failed to load, reclassification skipped", exc_info=True)
        rows = []
    by_branch = {
        _norm_branch(row.get("branch_name")): row
        for row in rows
        if _norm_branch(row.get("branch_name"))
    }
    with _sched_lock:
        _sched_cache["expires"] = now + _SCHED_TTL_SEC
        _sched_cache["by_branch"] = by_branch
    return by_branch


def schedule_for_branch(schedules: Dict[str, Dict[str, Any]], branch_name: Any) -> Optional[Dict[str, Any]]:
    return schedules.get(_norm_branch(branch_name))


def bucket_zone(schedule: Optional[Dict[str, Any]], bucket_start: datetime) -> str:
    """Classify a 5-minute bucket (by midpoint) into work / lunch / off."""
    if not schedule:
        return ZONE_WORK
    local = bucket_start.astimezone(TYUMEN_TZ) + timedelta(minutes=int(schedule.get("tz_offset_minutes") or 0))
    mask = int(schedule.get("workdays_mask") if schedule.get("workdays_mask") is not None else 31)
    if not ((mask >> local.weekday()) & 1):
        return ZONE_OFF
    # Midpoint of a 5-minute bucket decides the zone — the 2.5-minute boundary
    # error is acceptable and keeps a single zone per rendered cell.
    minute = local.hour * 60 + local.minute + 2
    lunch_start = schedule.get("lunch_start_min")
    lunch_end = schedule.get("lunch_end_min")
    if lunch_start is not None and lunch_end is not None and int(lunch_start) <= minute < int(lunch_end):
        return ZONE_LUNCH
    if minute < int(schedule.get("work_start_min") or 0) or minute >= int(schedule.get("work_end_min") or 24 * 60):
        return ZONE_OFF
    return ZONE_WORK


def split_bucket(schedule: Optional[Dict[str, Any]], bucket_start: datetime, passive: float = 0.0, away: float = 0.0, locked: float = 0.0) -> Dict[str, float]:
    """Split idle-kind seconds of one bucket into work-zone vs break vs offshift."""
    zone = bucket_zone(schedule, bucket_start)
    passive = float(passive or 0)
    away = float(away or 0)
    locked = float(locked or 0)
    if zone == ZONE_WORK:
        return {
            "zone": zone,
            "passive": passive,
            "away": away,
            "locked": locked,
            "break": 0.0,
            "offshift": 0.0,
        }
    idle = passive + away + locked
    return {
        "zone": zone,
        "passive": 0.0,
        "away": 0.0,
        "locked": 0.0,
        "break": idle if zone == ZONE_LUNCH else 0.0,
        "offshift": idle if zone == ZONE_OFF else 0.0,
    }


def apply_to_attention_rows(store: Any, stats: List[Dict[str, Any]], day: str) -> None:
    """Patch dlp_attention_stats rows in place: work-zone-only away/passive/locked
    plus break_sec/offshift_sec for hosts whose branch has a schedule."""
    schedules = load_schedules(store)
    if not schedules or not stats:
        return
    targets: Dict[str, Dict[str, Any]] = {}
    for row in stats:
        sched = schedule_for_branch(schedules, row.get("branch_name"))
        if sched is not None:
            targets[str(row.get("computer_name") or "")] = sched
    for row in stats:
        row.setdefault("break_sec", 0.0)
        row.setdefault("offshift_sec", 0.0)
    if not targets:
        return
    try:
        buckets_by_host = store.list_dlp_activity_buckets(computer_names=list(targets.keys()), day=day)
    except Exception:
        logger.warning("dlp schedules: bucket fetch failed, reclassification skipped", exc_info=True)
        return
    for row in stats:
        sched = targets.get(str(row.get("computer_name") or ""))
        if sched is None:
            continue
        totals = {"passive": 0.0, "away": 0.0, "locked": 0.0, "break": 0.0, "offshift": 0.0}
        for bucket in buckets_by_host.get(str(row.get("computer_name") or ""), []):
            parts = split_bucket(
                sched,
                bucket["bucket_start"],
                bucket.get("passive"),
                bucket.get("away"),
                bucket.get("locked"),
            )
            for key in totals:
                totals[key] += parts[key]
        row["passive_sec"] = round(totals["passive"], 1)
        row["away_sec"] = round(totals["away"], 1)
        row["locked_sec"] = round(totals["locked"], 1)
        row["break_sec"] = round(totals["break"], 1)
        row["offshift_sec"] = round(totals["offshift"], 1)


def apply_to_activity_payload(schedule: Optional[Dict[str, Any]], payload: Dict[str, Any]) -> None:
    """Patch list_dlp_activity payload in place: per-bucket zone + split seconds
    and work-zone-only summary totals with break_sec/offshift_sec."""
    if not payload:
        return
    buckets = payload.get("buckets") or []
    totals = {"passive": 0.0, "away": 0.0, "locked": 0.0, "break": 0.0, "offshift": 0.0}
    active_offshift = 0.0
    for bucket in buckets:
        try:
            start = datetime.fromisoformat(str(bucket.get("bucket_start") or ""))
        except ValueError:
            bucket["zone"] = ZONE_WORK
            bucket.setdefault("break_sec", 0.0)
            bucket.setdefault("offshift_sec", 0.0)
            continue
        parts = split_bucket(
            schedule,
            start,
            bucket.get("passive_sec"),
            bucket.get("away_sec"),
            bucket.get("locked_sec"),
        )
        bucket["zone"] = parts["zone"]
        bucket["passive_sec"] = round(parts["passive"], 1)
        bucket["away_sec"] = round(parts["away"], 1)
        bucket["locked_sec"] = round(parts["locked"], 1)
        bucket["break_sec"] = round(parts["break"], 1)
        bucket["offshift_sec"] = round(parts["offshift"], 1)
        if parts["zone"] == ZONE_OFF:
            # Active seconds stay active even outside the shift — track the
            # off-shift share separately so the UI can report it honestly.
            active_offshift += float(bucket.get("active_sec") or 0.0)
        for key in totals:
            totals[key] += parts[key]
    summary = payload.get("summary")
    if isinstance(summary, dict):
        summary["passive_sec"] = round(totals["passive"], 1)
        summary["away_sec"] = round(totals["away"], 1)
        summary["locked_sec"] = round(totals["locked"], 1)
        summary["break_sec"] = round(totals["break"], 1)
        summary["offshift_sec"] = round(totals["offshift"], 1)
        summary["active_offshift_sec"] = round(active_offshift, 1)
        active = float(summary.get("active_sec") or 0.0)
        awake = active + totals["passive"] + totals["away"]
        summary["activity_pct"] = round(active / awake * 100.0, 1) if awake > 0 else None


def serialize_schedule(row: Dict[str, Any]) -> Dict[str, Any]:
    """Public JSON shape for a schedule row (minutes -> HH:MM kept raw for the UI)."""
    return {
        "branch_name": str(row.get("branch_name") or ""),
        "work_start_min": int(row.get("work_start_min") or 0),
        "work_end_min": int(row.get("work_end_min") or 0),
        "lunch_start_min": row.get("lunch_start_min"),
        "lunch_end_min": row.get("lunch_end_min"),
        "tz_offset_minutes": int(row.get("tz_offset_minutes") or 0),
        "workdays_mask": int(row.get("workdays_mask") if row.get("workdays_mask") is not None else 31),
        "updated_by": str(row.get("updated_by") or ""),
        "updated_at": row.get("updated_at"),
    }
