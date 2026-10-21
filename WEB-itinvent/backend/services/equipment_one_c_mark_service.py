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
_table_state: dict[str, Any] = {"available": None, "kind": False, "checked_at": 0.0}
_TABLE_RECHECK_SEC = 60.0


class OneCMarkUnavailableError(Exception):
    """The mark store is not configured or its table is not migrated yet."""


def reset_table_probe() -> None:
    with _table_lock:
        _table_state["available"] = None
        _table_state["kind"] = False
        _table_state["checked_at"] = 0.0


def _probe(session) -> tuple[bool, bool]:
    """(table exists, ``kind`` column exists); cached until both are present, else re-probed."""
    with _table_lock:
        available = _table_state["available"]
        kind = bool(_table_state["kind"])
        if available is True and kind:
            return True, True
        if available is not None and time.monotonic() - float(_table_state["checked_at"]) < _TABLE_RECHECK_SEC:
            return bool(available), kind
    has_table = has_kind = False
    try:
        table = AppEquipmentOneCMark.__table__
        connection = session.connection()
        schema = table.schema if connection.dialect.name == "postgresql" else None
        inspector = inspect(connection)
        has_table = bool(inspector.has_table(table.name, schema=schema))
        if has_table:
            has_kind = any(
                str(column.get("name")) == "kind" for column in inspector.get_columns(table.name, schema=schema)
            )
    except Exception:
        logger.info("Equipment 1C mark table probe failed", exc_info=True)
    with _table_lock:
        _table_state["available"] = has_table
        _table_state["kind"] = has_kind
        _table_state["checked_at"] = time.monotonic()
    return has_table, has_kind


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


def _to_dict(row: AppEquipmentOneCMark, *, has_kind: bool) -> dict[str, Any]:
    marked_at = row.marked_at
    return {
        "kind": (row.kind or KIND_OK) if has_kind else KIND_OK,
        "inv_no": row.inv_no,
        "marked_by": row.marked_by or "",
        "marked_at": marked_at.isoformat() if marked_at else None,
        "note": row.note or "",
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
            has_table, has_kind = _probe(session)
            if not has_table:
                return {}
            query = select(AppEquipmentOneCMark).where(AppEquipmentOneCMark.db_id == _db_key(db_id))
            if not has_kind:
                query = query.options(defer(AppEquipmentOneCMark.kind))
            return {row.inv_no: _to_dict(row, has_kind=has_kind) for row in session.scalars(query).all()}
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
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    """Idempotent: a repeat keeps author and time and only updates the note.

    Switching the kind (ok <-> mismatch) is a new verdict, so it takes the new author and time.
    A "mismatch" needs a comment: the reviewer must say what does not match.
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
                has_table, has_kind = _probe(session)
                if not has_table:
                    raise OneCMarkUnavailableError("1C mark table is not migrated yet")
                if mark_kind == KIND_MISMATCH and not has_kind:
                    raise OneCMarkUnavailableError("1C mark kind column is not migrated yet")
                query = select(AppEquipmentOneCMark).where(
                    AppEquipmentOneCMark.db_id == _db_key(db_id),
                    AppEquipmentOneCMark.inv_no == key,
                )
                if not has_kind:
                    query = query.options(defer(AppEquipmentOneCMark.kind))
                row = session.scalar(query)
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
                    session.add(row)
                elif has_kind and (row.kind or KIND_OK) != mark_kind:
                    row.kind = mark_kind
                    row.marked_by = str(actor or "")[:128]
                    row.marked_at = datetime.now(timezone.utc)
                    row.note = clean_note
                elif clean_note and clean_note != row.note:
                    row.note = clean_note
                session.flush()
                result = _to_dict(row, has_kind=has_kind)
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
