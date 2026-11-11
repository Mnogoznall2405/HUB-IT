"""Review queue of equipment photos: rejected marks and photos nobody has checked yet.

Photos live in the legacy SQL Server FILES table, the marks in PostgreSQL
``app.equipment_photo_checks``.  The two stores are joined here, in the
application: a mark describes a photo only while FILES.CREATE_DATE still equals
the fingerprint stored with it (FILE_NO is a MAX+1 counter and can be reused).

Both lists are read-only and bounded: at most ``SCAN_CAP`` marks / FILES rows are
examined per call, so a huge database cannot turn the queue into a full scan.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, Iterable, Optional

from sqlalchemy import select

from backend.appdb.models import AppEquipmentPhotoCheck
from backend.database import equipment_photos
from backend.services import equipment_photo_check_service as checks

logger = logging.getLogger(__name__)

STATUS_REJECTED = "rejected"
STATUS_UNCHECKED = "unchecked"
REVIEW_STATUSES = (STATUS_REJECTED, STATUS_UNCHECKED)

DEFAULT_SINCE_DAYS = 30
MAX_SINCE_DAYS = 365
DEFAULT_LIMIT = 50
MAX_LIMIT = 200
SCAN_CAP = 1500
SUMMARY_TTL_SEC = 60.0
_ITEM_ID_CHUNK = 1000

_summary_lock = threading.Lock()
_summary_cache: dict[tuple[str, Any, int], tuple[float, dict[str, Any]]] = {}


class PhotoReviewUnavailableError(Exception):
    """The mark store or FILES could not be read."""


def clamp_since_days(value: Any) -> int:
    try:
        days = int(value)
    except (TypeError, ValueError):
        return DEFAULT_SINCE_DAYS
    return max(1, min(days, MAX_SINCE_DAYS))


def clamp_limit(value: Any) -> int:
    try:
        limit = int(value)
    except (TypeError, ValueError):
        return DEFAULT_LIMIT
    return max(1, min(limit, MAX_LIMIT))


def _text(value: Any) -> str:
    return str(value or "").strip()


def _chunks(values: list[int]) -> Iterable[list[int]]:
    for offset in range(0, len(values), _ITEM_ID_CHUNK):
        yield values[offset : offset + _ITEM_ID_CHUNK]


def _load_states(
    item_ids: list[int], db_id: Any, database_url: Optional[str]
) -> tuple[dict[tuple[int, int], dict[str, Any]], bool]:
    """``{(item_id, file_no): state}`` for the items and whether reject marks are supported."""
    states: dict[tuple[int, int], dict[str, Any]] = {}
    with checks.app_session(database_url) as session:
        with_reject = checks.reject_columns_available(session)
        for chunk in _chunks(item_ids):
            rows = session.scalars(
                select(AppEquipmentPhotoCheck)
                .options(*checks._deferred(with_reject))
                .where(
                    AppEquipmentPhotoCheck.db_id == checks.normalize_db_id(db_id),
                    AppEquipmentPhotoCheck.item_id.in_(chunk),
                )
            ).all()
            for row in rows:
                state = checks._row_state(row, with_reject)
                states[(int(row.item_id), int(row.file_no))] = state
    return states, with_reject


def _rejected_rows(db_id: Any, database_url: Optional[str]) -> Optional[list[dict[str, Any]]]:
    """Newest rejection marks, or None when reject marks are not supported yet."""
    with checks.app_session(database_url) as session:
        if not checks.reject_columns_available(session):
            return None
        rows = session.scalars(
            select(AppEquipmentPhotoCheck)
            .where(
                AppEquipmentPhotoCheck.db_id == checks.normalize_db_id(db_id),
                AppEquipmentPhotoCheck.rejected_at.is_not(None),
            )
            .order_by(AppEquipmentPhotoCheck.rejected_at.desc())
            .limit(SCAN_CAP)
        ).all()
        result = []
        for row in rows:
            state = checks._row_state(row, True)
            state["item_id"] = int(row.item_id)
            result.append(state)
        return result


def _recent_photos(
    db_id: Any, since_days: int, get_db_fn: Optional[Callable]
) -> list[dict[str, Any]]:
    """Newest photo rows (no BLOBs) of the last ``since_days`` days."""
    db = (get_db_fn or equipment_photos._default_get_db)(db_id)
    rows = db.execute_query(
        f"""
        SELECT TOP {int(SCAN_CAP)}
            f.ITEM_ID AS item_id,
            f.FILE_NO AS file_no,
            f.CREATE_DATE AS created_at,
            f.CREATE_USER AS created_by
        FROM FILES f
        INNER JOIN ITEMS i
            ON i.ID = f.ITEM_ID
           AND i.CI_TYPE = f.CI_TYPE
        WHERE f.FILE_TYPE = {equipment_photos.FILE_TYPE_PHOTO}
          AND f.CREATE_DATE >= DATEADD(day, -?, GETDATE())
        ORDER BY f.CREATE_DATE DESC, f.FILE_NO DESC
        """,
        (int(since_days),),
    )
    result = []
    for row in rows or []:
        try:
            result.append({
                "item_id": int(row.get("item_id")),
                "file_no": int(row.get("file_no")),
                "created_at": _text(row.get("created_at")),
                "created_by": _text(row.get("created_by")),
            })
        except (TypeError, ValueError):
            continue
    return result


def _item_labels(
    item_ids: list[int], db_id: Any, get_item_rows: Optional[Callable]
) -> dict[int, dict[str, Any]]:
    if not item_ids:
        return {}
    if get_item_rows is None:
        from backend.database import queries

        get_item_rows = queries.get_equipment_items_by_ids
    labels: dict[int, dict[str, Any]] = {}
    for row in get_item_rows(item_ids, db_id) or []:
        try:
            labels[int(row.get("item_id"))] = row
        except (TypeError, ValueError):
            continue
    return labels


def _public_row(
    *,
    status: str,
    item_id: int,
    file_no: int,
    created_at: str,
    state: Optional[dict[str, Any]],
    created_by: str,
    own: bool,
    mine: bool,
    label: Optional[dict[str, Any]],
) -> dict[str, Any]:
    label = label or {}
    state = state or {}
    return {
        "status": status,
        "item_id": item_id,
        "file_no": file_no,
        "inv_no": _text(label.get("inv_no")),
        "model_name": _text(label.get("model_name")),
        "serial_no": _text(label.get("serial_no")),
        "employee_name": _text(label.get("employee_name")),
        "branch_name": _text(label.get("branch_name")),
        "location_name": _text(label.get("location_name")),
        "created_at": created_at,
        "created_by": created_by,
        "uploaded_by_name": _text(state.get("uploaded_by_name")) or created_by,
        "rejected_by": _text(state.get("rejected_by_name")) if status == STATUS_REJECTED else "",
        "rejected_at": state.get("rejected_at") if status == STATUS_REJECTED else None,
        "reject_reason": _text(state.get("reject_reason")) if status == STATUS_REJECTED else "",
        "is_own": own,
        "uploaded_by_me": mine,
    }


def collect_review(
    *,
    db_id: Any,
    since_days: int,
    user_id: Any,
    aliases: Iterable[str],
    get_db_fn: Optional[Callable] = None,
    get_item_rows: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    """Both queues for one database, newest first.

    Raises :class:`PhotoReviewUnavailableError` when the stores cannot be read; a
    database without the reject columns still returns the "unchecked" queue.
    """
    alias_list = [alias for alias in aliases if _text(alias)]
    try:
        rejected_marks = _rejected_rows(db_id, database_url)
        recent = _recent_photos(db_id, since_days, get_db_fn)
    except Exception as exc:  # store or FILES down: say "unknown", never "empty"
        logger.warning("Photo review queue unavailable", exc_info=True)
        raise PhotoReviewUnavailableError("photo review unavailable") from exc

    try:
        item_ids = sorted({
            *(row["item_id"] for row in recent),
            *(row["item_id"] for row in (rejected_marks or [])),
        })
        states, _ = _load_states(item_ids, db_id, database_url) if item_ids else ({}, False)
        fingerprints = (
            equipment_photos.lookup_photo_fingerprints(item_ids, db_id, get_db_fn=get_db_fn)
            if item_ids
            else {}
        )
    except Exception as exc:
        logger.warning("Photo review queue unavailable", exc_info=True)
        raise PhotoReviewUnavailableError("photo review unavailable") from exc

    rejected: list[dict[str, Any]] = []
    for mark in rejected_marks or []:
        key = (mark["item_id"], mark["file_no"])
        if fingerprints.get(key) != _text(mark.get("file_created_at")):
            continue  # photo deleted or FILE_NO reused: the mark is stale
        created_at = fingerprints[key]
        mine = checks.is_own_photo(
            state=mark, created_at=created_at, created_by="", user_id=user_id, aliases=alias_list
        )
        rejected.append({
            "key": key, "created_at": created_at, "state": mark,
            "created_by": "", "own": mine, "mine": mine,
        })

    unchecked: list[dict[str, Any]] = []
    for photo in recent:
        key = (photo["item_id"], photo["file_no"])
        state = states.get(key)
        created_at = photo["created_at"]
        if checks.is_verified(state, created_at) or checks.is_rejected(state, created_at):
            continue
        own = checks.is_own_photo(
            state=state, created_at=created_at, created_by=photo["created_by"],
            user_id=user_id, aliases=alias_list,
        )
        if own:
            continue  # the uploader never checks their own photo
        unchecked.append({
            "key": key, "created_at": created_at, "state": state,
            "created_by": photo["created_by"], "own": False, "mine": False,
        })

    return {
        "rejected": rejected,
        "unchecked": unchecked,
        "reject_supported": rejected_marks is not None,
        "scan_capped": len(recent) >= SCAN_CAP or len(rejected_marks or []) >= SCAN_CAP,
        "since_days": since_days,
        "_get_item_rows": get_item_rows,
    }


def _matches_query(row: dict[str, Any], needle: str) -> bool:
    if not needle:
        return True
    haystack = " ".join(
        _text(row.get(field)).casefold()
        for field in (
            "inv_no", "model_name", "serial_no", "employee_name", "branch_name",
            "location_name", "reject_reason", "rejected_by", "uploaded_by_name",
        )
    )
    return all(token in haystack for token in needle.split())


def list_review(
    *,
    db_id: Any,
    status: str,
    since_days: int = DEFAULT_SINCE_DAYS,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
    query: str = "",
    user_id: Any = None,
    aliases: Iterable[str] = (),
    get_db_fn: Optional[Callable] = None,
    get_item_rows: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    if status not in REVIEW_STATUSES:
        raise ValueError("status must be rejected or unchecked")
    collected = collect_review(
        db_id=db_id, since_days=since_days, user_id=user_id, aliases=aliases,
        get_db_fn=get_db_fn, get_item_rows=get_item_rows, database_url=database_url,
    )
    entries = collected[status]
    item_ids = sorted({entry["key"][0] for entry in entries})
    try:
        labels = _item_labels(item_ids, db_id, get_item_rows)
    except Exception as exc:
        logger.warning("Photo review item lookup failed", exc_info=True)
        raise PhotoReviewUnavailableError("photo review unavailable") from exc

    needle = " ".join(_text(query).casefold().split())
    rows = []
    for entry in entries:
        item_id, file_no = entry["key"]
        row = _public_row(
            status=status, item_id=item_id, file_no=file_no, created_at=entry["created_at"],
            state=entry["state"], created_by=entry["created_by"], own=entry["own"],
            mine=entry["mine"], label=labels.get(item_id),
        )
        if _matches_query(row, needle):
            rows.append(row)
    start = max(0, int(offset))
    page = rows[start : start + clamp_limit(limit)]
    return {
        "status": status,
        "items": page,
        "total": len(rows),
        "offset": start,
        "limit": clamp_limit(limit),
        "reject_supported": collected["reject_supported"],
        "scan_capped": collected["scan_capped"],
        "since_days": since_days,
    }


def review_summary(
    *,
    db_id: Any,
    since_days: int = DEFAULT_SINCE_DAYS,
    user_id: Any = None,
    aliases: Iterable[str] = (),
    refresh: bool = False,
    get_db_fn: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    """Counters for the queue badge, cached briefly per (database, user, window)."""
    key = (checks.normalize_db_id(db_id), user_id, int(since_days))
    now = time.monotonic()
    if not refresh:
        with _summary_lock:
            cached = _summary_cache.get(key)
            if cached and now - cached[0] < SUMMARY_TTL_SEC:
                return dict(cached[1])
    collected = collect_review(
        db_id=db_id, since_days=since_days, user_id=user_id, aliases=aliases,
        get_db_fn=get_db_fn, database_url=database_url,
    )
    payload = {
        "rejected": len(collected["rejected"]),
        "unchecked": len(collected["unchecked"]),
        "mine_rejected": sum(1 for entry in collected["rejected"] if entry["mine"]),
        "reject_supported": collected["reject_supported"],
        "scan_capped": collected["scan_capped"],
        "since_days": since_days,
    }
    with _summary_lock:
        _summary_cache[key] = (now, payload)
        if len(_summary_cache) > 256:
            _summary_cache.clear()
    return dict(payload)


def reset_cache() -> None:
    with _summary_lock:
        _summary_cache.clear()
