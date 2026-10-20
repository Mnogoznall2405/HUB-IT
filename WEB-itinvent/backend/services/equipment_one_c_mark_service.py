"""Manual «reconciled with 1C» mark on ITINVENT equipment cards.

The automatic comparison with 1C is computed on read (see warehouse_1c_service) and is never
stored, so this app-owned table is the only place a mark lives and a recalculation cannot
touch it. Without the migration the table is missing: reads answer an empty map, writes raise
``OneCMarkUnavailableError`` (the route turns it into 503).
"""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import delete, inspect, select
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, is_app_database_configured
from backend.appdb.models import AppEquipmentOneCMark

logger = logging.getLogger(__name__)

NOTE_MAX_LENGTH = 500

_table_lock = threading.Lock()
_table_state: dict[str, Any] = {"available": None, "checked_at": 0.0}
_TABLE_RECHECK_SEC = 60.0


class OneCMarkUnavailableError(Exception):
    """The mark store is not configured or its table is not migrated yet."""


def reset_table_probe() -> None:
    with _table_lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0


def table_available(session) -> bool:
    """True once the migration is applied (cached; a negative answer is re-probed)."""
    with _table_lock:
        available = _table_state["available"]
        if available is True:
            return True
        if available is False and time.monotonic() - float(_table_state["checked_at"]) < _TABLE_RECHECK_SEC:
            return False
    result = False
    try:
        table = AppEquipmentOneCMark.__table__
        connection = session.connection()
        schema = table.schema if connection.dialect.name == "postgresql" else None
        result = bool(inspect(connection).has_table(table.name, schema=schema))
    except Exception:
        logger.info("Equipment 1C mark table probe failed", exc_info=True)
    with _table_lock:
        _table_state["available"] = result
        _table_state["checked_at"] = time.monotonic()
    return result


def _db_key(db_id: Any) -> str:
    return str(db_id or "").strip()[:128] or "default"


def normalize_inv_no(value: Any) -> str:
    """«1001», «1001.0» and « 1001 » are the same card."""
    text = str(value if value is not None else "").strip()
    if re.fullmatch(r"-?\d+\.0+", text):
        text = text.split(".", 1)[0]
    return text[:64]


def _to_dict(row: AppEquipmentOneCMark) -> dict[str, Any]:
    marked_at = row.marked_at
    return {
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
            if not table_available(session):
                return {}
            rows = session.scalars(
                select(AppEquipmentOneCMark).where(AppEquipmentOneCMark.db_id == _db_key(db_id))
            ).all()
            return {row.inv_no: _to_dict(row) for row in rows}
    except Exception:
        logger.warning("Failed to read equipment 1C marks", exc_info=True)
        return {}


def set_mark(
    db_id: Any, inv_no: Any, *, actor: str, note: str = "", database_url: Optional[str] = None
) -> dict[str, Any]:
    """Idempotent: an existing mark keeps its author and time, only the note may change."""
    key = normalize_inv_no(inv_no)
    if not key:
        raise ValueError("inv_no is required")
    clean_note = str(note or "").strip()[:NOTE_MAX_LENGTH]
    _require_store(database_url)
    for attempt in range(2):
        try:
            with app_session(database_url) as session:
                if not table_available(session):
                    raise OneCMarkUnavailableError("1C mark table is not migrated yet")
                row = session.scalar(
                    select(AppEquipmentOneCMark).where(
                        AppEquipmentOneCMark.db_id == _db_key(db_id),
                        AppEquipmentOneCMark.inv_no == key,
                    )
                )
                if row is None:
                    row = AppEquipmentOneCMark(
                        db_id=_db_key(db_id),
                        inv_no=key,
                        marked_by=str(actor or "")[:128],
                        marked_at=datetime.now(timezone.utc),
                        note=clean_note,
                    )
                    session.add(row)
                elif clean_note and clean_note != row.note:
                    row.note = clean_note
                session.flush()
                result = _to_dict(row)
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
