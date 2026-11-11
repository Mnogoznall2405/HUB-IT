"""Recovery ledger of equipment photo inserts (BE-04).

The photo row is committed in SQL Server (legacy FILES) while the upload checkpoint (result.json)
lives on disk, so a failure between the two used to make a retry insert the same photo again.
The ledger lives in the app PostgreSQL and is written *before* the insert ("inserting") and
completed right after it ("done"). A retry that finds an unfinished entry looks the photo up in
FILES instead of blindly inserting, and a finished entry answers with the stored FILE_NO.

When the table is missing (code deployed before the release migration) every call degrades to
"no ledger": uploads keep working with the previous, non-idempotent behaviour.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from backend.appdb.db import app_session, is_app_database_configured
from backend.appdb.models import AppEquipmentPhotoUploadLedger

logger = logging.getLogger(__name__)

STATE_INSERTING = "inserting"
STATE_DONE = "done"

_warned_unavailable = False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _unavailable(exc: Exception) -> None:
    global _warned_unavailable
    if not _warned_unavailable:
        _warned_unavailable = True
        logger.warning("Equipment photo upload ledger is unavailable (migration not applied?): %s", exc)


def _row_dict(row: AppEquipmentPhotoUploadLedger) -> dict[str, Any]:
    started = row.started_at
    if started is not None and started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return {
        "upload_id": str(row.upload_id),
        "item_id": int(row.item_id),
        "state": str(row.state),
        "file_no": int(row.file_no) if row.file_no is not None else None,
        "started_at": started,
        "age_seconds": max(0.0, time.time() - started.timestamp()) if started else 0.0,
    }


def is_available() -> bool:
    return bool(is_app_database_configured())


def get(upload_id: str) -> Optional[dict[str, Any]]:
    if not is_available():
        return None
    try:
        with app_session() as session:
            row = session.get(AppEquipmentPhotoUploadLedger, str(upload_id))
            return _row_dict(row) if row is not None else None
    except SQLAlchemyError as exc:
        _unavailable(exc)
        return None


def begin(upload_id: str, *, item_id: int, created_by: str) -> bool:
    """Record the intent to insert. Returns False when the ledger could not be written."""
    if not is_available():
        return False
    try:
        with app_session() as session:
            row = session.get(AppEquipmentPhotoUploadLedger, str(upload_id))
            now = _utcnow()
            if row is None:
                row = AppEquipmentPhotoUploadLedger(upload_id=str(upload_id))
                session.add(row)
            row.item_id = int(item_id)
            row.created_by = str(created_by or "")[:64]
            row.state = STATE_INSERTING
            row.file_no = None
            row.started_at = now
            row.updated_at = now
        return True
    except SQLAlchemyError as exc:
        _unavailable(exc)
        return False


def finish(upload_id: str, *, file_no: int) -> None:
    if not is_available():
        return
    try:
        with app_session() as session:
            row = session.get(AppEquipmentPhotoUploadLedger, str(upload_id))
            if row is None:
                return
            row.state = STATE_DONE
            row.file_no = int(file_no)
            row.updated_at = _utcnow()
    except SQLAlchemyError as exc:
        _unavailable(exc)
        logger.error("Photo insert committed but ledger finish failed upload_id=%s file_no=%s", upload_id, file_no)


def discard(upload_id: str) -> None:
    """Forget the entry (its photo was deleted, the same file may be uploaded again)."""
    if not is_available():
        return
    try:
        with app_session() as session:
            row = session.get(AppEquipmentPhotoUploadLedger, str(upload_id))
            if row is not None:
                session.delete(row)
    except SQLAlchemyError as exc:
        _unavailable(exc)


def claimed_file_nos(item_id: int) -> set[int]:
    """FILE_NOs of this item already owned by finished ledger entries (not candidates for adoption)."""
    if not is_available():
        return set()
    try:
        with app_session() as session:
            rows = session.scalars(
                select(AppEquipmentPhotoUploadLedger.file_no).where(
                    AppEquipmentPhotoUploadLedger.item_id == int(item_id),
                    AppEquipmentPhotoUploadLedger.state == STATE_DONE,
                    AppEquipmentPhotoUploadLedger.file_no.is_not(None),
                )
            ).all()
            return {int(value) for value in rows}
    except SQLAlchemyError as exc:
        _unavailable(exc)
        return set()
