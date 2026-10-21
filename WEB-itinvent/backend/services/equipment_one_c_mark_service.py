"""Manual «reconciled with 1C» mark on ITINVENT equipment cards.

The automatic comparison with 1C is computed on read (see warehouse_1c_service) and is never
stored, so this app-owned table is the only place a mark lives and a recalculation cannot
touch it. Without the migration the table is missing: reads answer an empty map, writes raise
``OneCMarkUnavailableError`` (the route turns it into 503). The ``kind`` column (migration 0140)
is probed separately: without it every mark reads as "ok" and only "mismatch" writes answer 503.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import delete, inspect, select
from sqlalchemy.orm import defer
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, is_app_database_configured
from backend.appdb.models import AppEquipmentOneCMark

logger = logging.getLogger(__name__)

NOTE_MAX_LENGTH = 500
KIND_OK = "ok"
KIND_MISMATCH = "mismatch"
KINDS = (KIND_OK, KIND_MISMATCH)

_table_lock = threading.Lock()
_table_state: dict[str, Any] = {"available": None, "kind": False, "snapshot": False, "checked_at": 0.0}
_TABLE_RECHECK_SEC = 60.0


class OneCMarkUnavailableError(Exception):
    """The mark store is not configured or its table is not migrated yet."""


def reset_table_probe() -> None:
    with _table_lock:
        _table_state["available"] = None
        _table_state["kind"] = False
        _table_state["snapshot"] = False
        _table_state["checked_at"] = 0.0


def _probe(session) -> tuple[bool, bool, bool]:
    """(table exists, ``kind`` column exists, snapshot columns exist); cached until all are present."""
    with _table_lock:
        available = _table_state["available"]
        kind = bool(_table_state["kind"])
        snapshot = bool(_table_state["snapshot"])
        if available is True and kind and snapshot:
            return True, True, True
        if available is not None and time.monotonic() - float(_table_state["checked_at"]) < _TABLE_RECHECK_SEC:
            return bool(available), kind, snapshot
    has_table = has_kind = has_snapshot = False
    try:
        table = AppEquipmentOneCMark.__table__
        connection = session.connection()
        schema = table.schema if connection.dialect.name == "postgresql" else None
        inspector = inspect(connection)
        has_table = bool(inspector.has_table(table.name, schema=schema))
        if has_table:
            column_names = {str(column.get("name")) for column in inspector.get_columns(table.name, schema=schema)}
            has_kind = "kind" in column_names
            has_snapshot = {"part_no_snapshot", "model_snapshot"} <= column_names
    except Exception:
        logger.info("Equipment 1C mark table probe failed", exc_info=True)
    with _table_lock:
        _table_state["available"] = has_table
        _table_state["kind"] = has_kind
        _table_state["snapshot"] = has_snapshot
        _table_state["checked_at"] = time.monotonic()
    return has_table, has_kind, has_snapshot


def table_available(session) -> bool:
    """True once the migration is applied (cached; a negative answer is re-probed)."""
    return _probe(session)[0]


def _db_key(db_id: Any) -> str:
    return str(db_id or "").strip()[:128] or "default"


def normalize_inv_no(value: Any) -> str:
    """«1001», «1001.0» and « 1001 » are the same card."""
    text = str(value if value is not None else "").strip()
    if re.fullmatch(r"-?\d+\.0+", text):
        text = text.split(".", 1)[0]
    return text[:64]


def normalize_kind(value: Any) -> str:
    kind = str(value or KIND_OK).strip().lower()
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    return kind


def _normalize_snapshot_text(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


def _snapshot_text(value: Any, maximum: int) -> str:
    return " ".join(str(value or "").split())[:maximum]


def _load_options(query, *, has_kind: bool, has_snapshot: bool):
    """Skip columns the database does not have yet (code may run before the migration)."""
    if not has_kind:
        query = query.options(defer(AppEquipmentOneCMark.kind))
    if not has_snapshot:
        query = query.options(
            defer(AppEquipmentOneCMark.part_no_snapshot),
            defer(AppEquipmentOneCMark.model_snapshot),
        )
    return query


def _to_dict(row: AppEquipmentOneCMark, *, has_kind: bool, has_snapshot: bool = False) -> dict[str, Any]:
    marked_at = row.marked_at
    return {
        "kind": (row.kind or KIND_OK) if has_kind else KIND_OK,
        "inv_no": row.inv_no,
        "marked_by": row.marked_by or "",
        "marked_at": marked_at.isoformat() if marked_at else None,
        "note": row.note or "",
        # PART_NO / model of the card when it was marked; None - no snapshot (older mark or
        # migration 0142 not applied), which the UI treats as "cannot tell if it changed".
        "part_no_snapshot": row.part_no_snapshot if has_snapshot else None,
        "model_snapshot": row.model_snapshot if has_snapshot else None,
    }


def _require_store(database_url: Optional[str]) -> None:
    if not (database_url or is_app_database_configured()):
        raise OneCMarkUnavailableError("1C mark store is not configured")


def list_marks(db_id: Any, *, database_url: Optional[str] = None) -> dict[str, dict[str, Any]]:
    """inv_no -> mark for one database. Empty when the store or its table is missing."""
    if not (database_url or is_app_database_configured()):
        return {}
    try:
        with app_session(database_url) as session:
            has_table, has_kind, has_snapshot = _probe(session)
            if not has_table:
                return {}
            query = _load_options(
                select(AppEquipmentOneCMark).where(AppEquipmentOneCMark.db_id == _db_key(db_id)),
                has_kind=has_kind,
                has_snapshot=has_snapshot,
            )
            return {
                row.inv_no: _to_dict(row, has_kind=has_kind, has_snapshot=has_snapshot)
                for row in session.scalars(query).all()
            }
    except Exception:
        logger.warning("Failed to read equipment 1C marks", exc_info=True)
        return {}


def set_mark(
    db_id: Any,
    inv_no: Any,
    *,
    actor: str,
    note: str = "",
    kind: str = KIND_OK,
    part_no: Any = None,
    model: Any = None,
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    """Idempotent: a repeat keeps author and time and only updates the note.

    Switching the kind (ok <-> mismatch) is a new verdict, so it takes the new author and time.
    A "mismatch" needs a comment: the reviewer must say what does not match.

    ``part_no`` / ``model`` are the card's current values, stored as a snapshot. A repeat while the
    card differs from the stored snapshot is a fresh review: it takes the new author, time and
    snapshot. A mark without a snapshot (an older one) just gets it filled in; author and time stay.
    """
    key = normalize_inv_no(inv_no)
    if not key:
        raise ValueError("inv_no is required")
    mark_kind = normalize_kind(kind)
    clean_note = str(note or "").strip()[:NOTE_MAX_LENGTH]
    if mark_kind == KIND_MISMATCH and not clean_note:
        raise ValueError("Для отметки «не сходится» нужен комментарий")
    _require_store(database_url)
    for attempt in range(2):
        try:
            with app_session(database_url) as session:
                has_table, has_kind, has_snapshot = _probe(session)
                if not has_table:
                    raise OneCMarkUnavailableError("1C mark table is not migrated yet")
                if mark_kind == KIND_MISMATCH and not has_kind:
                    raise OneCMarkUnavailableError("1C mark kind column is not migrated yet")
                query = select(AppEquipmentOneCMark).where(
                    AppEquipmentOneCMark.db_id == _db_key(db_id),
                    AppEquipmentOneCMark.inv_no == key,
                )
                query = _load_options(query, has_kind=has_kind, has_snapshot=has_snapshot)
                row = session.scalar(query)
                snapshot_part = _snapshot_text(part_no, 200)
                snapshot_model = _snapshot_text(model, 255)

                def _write_snapshot(target: AppEquipmentOneCMark) -> None:
                    if has_snapshot:
                        target.part_no_snapshot = snapshot_part
                        target.model_snapshot = snapshot_model

                def _snapshot_differs(target: AppEquipmentOneCMark) -> bool:
                    return (
                        _normalize_snapshot_text(target.part_no_snapshot) != _normalize_snapshot_text(snapshot_part)
                        or _normalize_snapshot_text(target.model_snapshot) != _normalize_snapshot_text(snapshot_model)
                    )

                if row is None:
                    row = AppEquipmentOneCMark(
                        db_id=_db_key(db_id),
                        inv_no=key,
                        marked_by=str(actor or "")[:128],
                        marked_at=datetime.now(timezone.utc),
                        note=clean_note,
                    )
                    if has_kind:
                        row.kind = mark_kind
                    _write_snapshot(row)
                    session.add(row)
                elif has_kind and (row.kind or KIND_OK) != mark_kind:
                    row.kind = mark_kind
                    row.marked_by = str(actor or "")[:128]
                    row.marked_at = datetime.now(timezone.utc)
                    row.note = clean_note
                    _write_snapshot(row)
                elif has_snapshot and row.part_no_snapshot is not None and _snapshot_differs(row):
                    # The card changed after the previous review: this repeat is a new review.
                    row.marked_by = str(actor or "")[:128]
                    row.marked_at = datetime.now(timezone.utc)
                    if clean_note:
                        row.note = clean_note
                    _write_snapshot(row)
                else:
                    if clean_note and clean_note != row.note:
                        row.note = clean_note
                    if has_snapshot and row.part_no_snapshot is None:
                        _write_snapshot(row)
                session.flush()
                result = _to_dict(row, has_kind=has_kind, has_snapshot=has_snapshot)
            return result
        except IntegrityError:
            # A concurrent request created the same mark first: re-read and keep it.
            if attempt:
                raise
    raise OneCMarkUnavailableError("1C mark could not be stored")


def clear_mark(db_id: Any, inv_no: Any, *, database_url: Optional[str] = None) -> bool:
    """Remove the mark; False when there was none (idempotent)."""
    key = normalize_inv_no(inv_no)
    if not key:
        raise ValueError("inv_no is required")
    _require_store(database_url)
    with app_session(database_url) as session:
        if not table_available(session):
            raise OneCMarkUnavailableError("1C mark table is not migrated yet")
        result = session.execute(
            delete(AppEquipmentOneCMark).where(
                AppEquipmentOneCMark.db_id == _db_key(db_id),
                AppEquipmentOneCMark.inv_no == key,
            )
        )
        return bool(result.rowcount)
