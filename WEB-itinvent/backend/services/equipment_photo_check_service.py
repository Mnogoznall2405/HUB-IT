"""Provenance and the "проверено" / "отклонено" mark of equipment photos.

Photos live in the legacy SQL Server FILES table; the uploader (FILES.CREATE_USER is only
a display string) and the check result are kept in PostgreSQL ``app.equipment_photo_checks``.
Every read degrades to "unknown" when the table is not there yet (the migration is run
explicitly at release time) and every write that needs it reports it as unavailable.

The reject columns were added by a later migration: until it is applied they are left out of
every query/write (``reject_columns_available``), so the verify flow keeps working.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional

from sqlalchemy import delete, inspect, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import defer

from backend.appdb.db import app_session, is_app_database_configured
from backend.appdb.models import AppEquipmentPhotoCheck
from backend.database import equipment_photos

logger = logging.getLogger(__name__)

_MAX_ITEM_IDS_PER_QUERY = 1000
MAX_REJECT_REASON_LENGTH = 500
_REJECT_COLUMNS = (
    "rejected_by_user_id",
    "rejected_by_name",
    "rejected_at",
    "reject_reason",
)
_COLUMNS_RECHECK_SEC = 60.0

_columns_lock = threading.Lock()
_columns_state: dict[str, Any] = {"available": None, "checked_at": 0.0}


class PhotoCheckUnavailableError(Exception):
    """The check store is not configured or its table does not exist yet."""


class OwnPhotoVerificationError(Exception):
    """The uploader tried to check their own photo."""


class PhotoNotFoundError(Exception):
    """The photo is not attached to the item (anymore)."""


class VerificationNotAllowedError(Exception):
    """Only the one who set the mark or an administrator may withdraw it."""


class RejectReasonRequiredError(Exception):
    """A rejection must say why."""


def reset_columns_probe() -> None:
    """Forget the cached column probe (used after migrations and in tests)."""
    with _columns_lock:
        _columns_state["available"] = None
        _columns_state["checked_at"] = 0.0


def normalize_db_id(value: Any) -> str:
    return str(value or "").strip() or "default"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _norm_name(value: Any) -> str:
    return " ".join(_text(value).lower().split())


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _store_available(database_url: Optional[str]) -> bool:
    return bool(database_url) or is_app_database_configured()


def reject_columns_available(session) -> bool:
    """True once the migration with the reject columns is applied (cached, re-probed)."""
    with _columns_lock:
        available = _columns_state["available"]
        if available is True:
            return True
        if available is False and time.monotonic() - float(_columns_state["checked_at"]) < _COLUMNS_RECHECK_SEC:
            return False
    result = False
    try:
        table = AppEquipmentPhotoCheck.__table__
        connection = session.connection()
        # SQLite (tests, dev) has no "app" schema: the ORM translates it away.
        schema = table.schema if connection.dialect.name == "postgresql" else None
        names = {
            str(column.get("name"))
            for column in inspect(connection).get_columns(table.name, schema=schema)
        }
        result = all(column in names for column in _REJECT_COLUMNS)
    except Exception:
        logger.info("Equipment photo check column probe failed", exc_info=True)
    with _columns_lock:
        _columns_state["available"] = result
        _columns_state["checked_at"] = time.monotonic()
    return result


def reject_supported(database_url: Optional[str] = None) -> bool:
    """True when rejection can be stored (store configured, migration applied)."""
    if not _store_available(database_url):
        return False
    try:
        with app_session(database_url) as session:
            return reject_columns_available(session)
    except Exception:
        return False


def _deferred(with_reject: bool) -> list:
    if with_reject:
        return []
    return [
        defer(getattr(AppEquipmentPhotoCheck, name))
        for name in _REJECT_COLUMNS
    ]


def _row_state(row: AppEquipmentPhotoCheck, with_reject: bool) -> dict[str, Any]:
    state = {
        "file_no": int(row.file_no),
        "file_created_at": _text(row.file_created_at),
        "uploaded_by_user_id": row.uploaded_by_user_id,
        "uploaded_by_name": _text(row.uploaded_by_name),
        "verified_by_user_id": row.verified_by_user_id,
        "verified_by_name": _text(row.verified_by_name),
        "verified_at": row.verified_at.isoformat() if row.verified_at else None,
        "rejected_by_user_id": None,
        "rejected_by_name": "",
        "rejected_at": None,
        "reject_reason": "",
    }
    if with_reject:
        state.update(
            rejected_by_user_id=row.rejected_by_user_id,
            rejected_by_name=_text(row.rejected_by_name),
            rejected_at=row.rejected_at.isoformat() if row.rejected_at else None,
            reject_reason=_text(row.reject_reason),
        )
    return state


def _clear_verified(row: AppEquipmentPhotoCheck) -> None:
    row.verified_by_user_id = None
    row.verified_by_name = None
    row.verified_at = None


def _clear_rejected(row: AppEquipmentPhotoCheck) -> None:
    row.rejected_by_user_id = None
    row.rejected_by_name = None
    row.rejected_at = None
    row.reject_reason = None


def is_own_photo(
    *,
    state: Optional[dict[str, Any]],
    created_at: str,
    created_by: str,
    user_id: Any,
    aliases: Iterable[str],
) -> bool:
    """True when the current user uploaded this photo.

    Server-side provenance (valid only while the FILES.CREATE_DATE fingerprint
    matches) wins; otherwise fall back to the FILES.CREATE_USER display string
    compared with the user's full name / login.
    """
    if (
        state
        and state.get("uploaded_by_user_id") is not None
        and _text(state.get("file_created_at")) == _text(created_at)
    ):
        try:
            return int(state["uploaded_by_user_id"]) == int(user_id)
        except (TypeError, ValueError):
            return False
    wanted = {_norm_name(alias) for alias in aliases if _norm_name(alias)}
    return bool(_norm_name(created_by)) and _norm_name(created_by) in wanted


def is_verified(state: Optional[dict[str, Any]], created_at: str) -> bool:
    """A mark counts only while it still describes this FILES row (FILE_NO can be reused)."""
    return bool(
        state
        and state.get("verified_at")
        and _text(state.get("file_created_at")) == _text(created_at)
    )


def is_rejected(state: Optional[dict[str, Any]], created_at: str) -> bool:
    return bool(
        state
        and state.get("rejected_at")
        and _text(state.get("file_created_at")) == _text(created_at)
    )


def list_states(
    *, db_id: Any, item_id: int, database_url: Optional[str] = None
) -> Optional[dict[int, dict[str, Any]]]:
    """``{file_no: state}`` for the item, or None when the store is unavailable."""
    if not _store_available(database_url):
        return None
    try:
        with app_session(database_url) as session:
            with_reject = reject_columns_available(session)
            rows = session.scalars(
                select(AppEquipmentPhotoCheck)
                .options(*_deferred(with_reject))
                .where(
                    AppEquipmentPhotoCheck.db_id == normalize_db_id(db_id),
                    AppEquipmentPhotoCheck.item_id == int(item_id),
                )
            ).all()
            return {int(row.file_no): _row_state(row, with_reject) for row in rows}
    except Exception:
        logger.info("Equipment photo checks unavailable (item_id=%s)", item_id, exc_info=True)
        return None


def _load_row(session, db_id: Any, item_id: int, file_no: int, with_reject: bool):
    return session.scalar(
        select(AppEquipmentPhotoCheck)
        .options(*_deferred(with_reject))
        .where(
            AppEquipmentPhotoCheck.db_id == normalize_db_id(db_id),
            AppEquipmentPhotoCheck.item_id == int(item_id),
            AppEquipmentPhotoCheck.file_no == int(file_no),
        )
    )


def record_upload(
    *,
    db_id: Any,
    item_id: int,
    file_no: int,
    file_created_at: str,
    user_id: Any,
    user_name: str,
    database_url: Optional[str] = None,
) -> bool:
    """Remember who uploaded the photo. Best effort: an upload never fails on it."""
    if not _store_available(database_url):
        return False
    try:
        with app_session(database_url) as session:
            with_reject = reject_columns_available(session)
            row = _load_row(session, db_id, item_id, file_no, with_reject)
            if row is None:
                row = AppEquipmentPhotoCheck(
                    db_id=normalize_db_id(db_id),
                    item_id=int(item_id),
                    file_no=int(file_no),
                    created_at=_utc_now(),
                )
                session.add(row)
            # A reused FILE_NO starts over: provenance of the new photo, no marks.
            row.file_created_at = _text(file_created_at)[:64]
            row.uploaded_by_user_id = int(user_id) if user_id is not None else None
            row.uploaded_by_name = _text(user_name)[:255] or None
            _clear_verified(row)
            if with_reject:
                _clear_rejected(row)
        return True
    except Exception:
        logger.warning("Failed to record equipment photo provenance", exc_info=True)
        return False


def _check_photo(
    *,
    session,
    db_id: Any,
    item_id: int,
    file_no: int,
    meta: dict[str, Any],
    user_id: Any,
    aliases: Iterable[str],
    with_reject: bool,
):
    """Load (or start) the row for the photo and refuse the uploader's own photo."""
    created_at = _text(meta["created_at"])
    row = _load_row(session, db_id, item_id, file_no, with_reject)
    state = _row_state(row, with_reject) if row is not None else None
    if is_own_photo(
        state=state,
        created_at=created_at,
        created_by=meta["created_by"],
        user_id=user_id,
        aliases=aliases,
    ):
        raise OwnPhotoVerificationError("own photo")
    if row is None:
        row = AppEquipmentPhotoCheck(
            db_id=normalize_db_id(db_id),
            item_id=int(item_id),
            file_no=int(file_no),
            file_created_at=created_at[:64],
            created_at=_utc_now(),
        )
        session.add(row)
    elif _text(row.file_created_at) != created_at:
        # FILE_NO reused by a different photo: provenance and marks are stale.
        row.file_created_at = created_at[:64]
        row.uploaded_by_user_id = None
        row.uploaded_by_name = None
        _clear_verified(row)
        if with_reject:
            _clear_rejected(row)
    return row


def verify_photo(
    *,
    db_id: Any,
    item_id: int,
    file_no: int,
    user_id: Any,
    user_name: str,
    aliases: Iterable[str],
    get_db_fn: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    """Mark the photo as verified by the current user (idempotent); clears a rejection."""
    if not _store_available(database_url):
        raise PhotoCheckUnavailableError("photo checks are not configured")
    meta = equipment_photos.get_equipment_photo_meta(item_id, file_no, db_id, get_db_fn=get_db_fn)
    if meta is None:
        raise PhotoNotFoundError("photo not found")

    for attempt in range(2):
        try:
            with app_session(database_url) as session:
                with_reject = reject_columns_available(session)
                row = _check_photo(
                    session=session, db_id=db_id, item_id=item_id, file_no=file_no, meta=meta,
                    user_id=user_id, aliases=aliases, with_reject=with_reject,
                )
                if with_reject and row.rejected_at is not None:
                    _clear_rejected(row)
                    _clear_verified(row)
                if row.verified_at is None:
                    row.verified_by_user_id = int(user_id) if user_id is not None else None
                    row.verified_by_name = _text(user_name)[:255] or None
                    row.verified_at = _utc_now()
                session.flush()
                return _row_state(row, with_reject)
        except IntegrityError:
            # Concurrent first check created the row: read it back on retry.
            if attempt == 1:
                raise PhotoCheckUnavailableError("photo checks unavailable")
        except (OwnPhotoVerificationError, PhotoNotFoundError):
            raise
        except Exception as exc:
            logger.warning("Photo verification store failed", exc_info=True)
            raise PhotoCheckUnavailableError("photo checks unavailable") from exc
    raise PhotoCheckUnavailableError("photo checks unavailable")


def reject_photo(
    *,
    db_id: Any,
    item_id: int,
    file_no: int,
    user_id: Any,
    user_name: str,
    aliases: Iterable[str],
    reason: str,
    get_db_fn: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    """Reject the photo with a mandatory reason; replaces a verification."""
    cleaned = " ".join(_text(reason).split())
    if not cleaned:
        raise RejectReasonRequiredError("reason is required")
    cleaned = cleaned[:MAX_REJECT_REASON_LENGTH]
    if not _store_available(database_url):
        raise PhotoCheckUnavailableError("photo checks are not configured")
    meta = equipment_photos.get_equipment_photo_meta(item_id, file_no, db_id, get_db_fn=get_db_fn)
    if meta is None:
        raise PhotoNotFoundError("photo not found")

    for attempt in range(2):
        try:
            with app_session(database_url) as session:
                if not reject_columns_available(session):
                    raise PhotoCheckUnavailableError("reject columns are not migrated yet")
                row = _check_photo(
                    session=session, db_id=db_id, item_id=item_id, file_no=file_no, meta=meta,
                    user_id=user_id, aliases=aliases, with_reject=True,
                )
                _clear_verified(row)
                row.rejected_by_user_id = int(user_id) if user_id is not None else None
                row.rejected_by_name = _text(user_name)[:255] or None
                row.rejected_at = _utc_now()
                row.reject_reason = cleaned
                session.flush()
                # FILES.CREATE_USER: lets the caller tell the uploader when no provenance was recorded.
                return {**_row_state(row, True), "file_created_by": _text(meta.get("created_by"))}
        except IntegrityError:
            if attempt == 1:
                raise PhotoCheckUnavailableError("photo checks unavailable")
        except (OwnPhotoVerificationError, PhotoNotFoundError, PhotoCheckUnavailableError):
            raise
        except Exception as exc:
            logger.warning("Photo rejection store failed", exc_info=True)
            raise PhotoCheckUnavailableError("photo checks unavailable") from exc
    raise PhotoCheckUnavailableError("photo checks unavailable")


def update_reject_reason(
    *,
    db_id: Any,
    item_id: int,
    file_no: int,
    user_id: Any,
    is_admin: bool,
    reason: str,
    get_db_fn: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    """Change the text of an existing rejection; only who rejected it or an admin."""
    cleaned = " ".join(_text(reason).split())
    if not cleaned:
        raise RejectReasonRequiredError("reason is required")
    cleaned = cleaned[:MAX_REJECT_REASON_LENGTH]
    if not _store_available(database_url):
        raise PhotoCheckUnavailableError("photo checks are not configured")
    meta = equipment_photos.get_equipment_photo_meta(item_id, file_no, db_id, get_db_fn=get_db_fn)
    if meta is None:
        raise PhotoNotFoundError("photo not found")
    try:
        with app_session(database_url) as session:
            if not reject_columns_available(session):
                raise PhotoCheckUnavailableError("reject columns are not migrated yet")
            row = _load_row(session, db_id, item_id, file_no, True)
            state = _row_state(row, True) if row is not None else None
            if not is_rejected(state, _text(meta["created_at"])):
                raise PhotoNotFoundError("photo is not rejected")
            if not is_admin and row.rejected_by_user_id != user_id:
                raise VerificationNotAllowedError("not the one who rejected")
            row.reject_reason = cleaned
            session.flush()
            return _row_state(row, True)
    except (PhotoNotFoundError, VerificationNotAllowedError, PhotoCheckUnavailableError):
        raise
    except Exception as exc:
        logger.warning("Photo rejection edit failed", exc_info=True)
        raise PhotoCheckUnavailableError("photo checks unavailable") from exc


def unverify_photo(
    *,
    db_id: Any,
    item_id: int,
    file_no: int,
    user_id: Any,
    is_admin: bool,
    database_url: Optional[str] = None,
) -> bool:
    """Withdraw the current mark (verified or rejected); the one who set it or an admin."""
    if not _store_available(database_url):
        raise PhotoCheckUnavailableError("photo checks are not configured")
    try:
        with app_session(database_url) as session:
            with_reject = reject_columns_available(session)
            row = _load_row(session, db_id, item_id, file_no, with_reject)
            if row is None:
                return False
            rejected = with_reject and row.rejected_at is not None
            if rejected:
                if not is_admin and row.rejected_by_user_id != user_id:
                    raise VerificationNotAllowedError("not the one who rejected")
                _clear_rejected(row)
                return True
            if row.verified_at is None:
                return False
            if not is_admin and row.verified_by_user_id != user_id:
                raise VerificationNotAllowedError("not the verifier")
            _clear_verified(row)
            return True
    except VerificationNotAllowedError:
        raise
    except Exception as exc:
        logger.warning("Photo mark withdraw failed", exc_info=True)
        raise PhotoCheckUnavailableError("photo checks unavailable") from exc


def delete_photo_check(
    *, db_id: Any, item_id: int, file_no: int, database_url: Optional[str] = None
) -> None:
    """Drop provenance and marks of a deleted photo. Best effort."""
    if not _store_available(database_url):
        return
    try:
        with app_session(database_url) as session:
            session.execute(
                delete(AppEquipmentPhotoCheck).where(
                    AppEquipmentPhotoCheck.db_id == normalize_db_id(db_id),
                    AppEquipmentPhotoCheck.item_id == int(item_id),
                    AppEquipmentPhotoCheck.file_no == int(file_no),
                )
            )
    except Exception:
        logger.info("Failed to drop equipment photo check", exc_info=True)


def list_verified_keys(
    item_ids: Iterable[Any],
    db_id: Any = None,
    *,
    database_url: Optional[str] = None,
) -> Optional[set[tuple[int, int, str]]]:
    """``{(item_id, file_no, file_created_at)}`` of photos currently marked "проверено".

    The caller compares the fingerprint with FILES.CREATE_DATE; None when the store is unknown.
    """
    ids = sorted({int(value) for value in item_ids or []})
    if not ids:
        return set()
    if not _store_available(database_url):
        return None
    try:
        keys: set[tuple[int, int, str]] = set()
        with app_session(database_url) as session:
            with_reject = reject_columns_available(session)
            for offset in range(0, len(ids), _MAX_ITEM_IDS_PER_QUERY):
                chunk = ids[offset : offset + _MAX_ITEM_IDS_PER_QUERY]
                conditions = [
                    AppEquipmentPhotoCheck.db_id == normalize_db_id(db_id),
                    AppEquipmentPhotoCheck.item_id.in_(chunk),
                    AppEquipmentPhotoCheck.verified_at.is_not(None),
                ]
                if with_reject:
                    conditions.append(AppEquipmentPhotoCheck.rejected_at.is_(None))
                rows = session.execute(
                    select(
                        AppEquipmentPhotoCheck.item_id,
                        AppEquipmentPhotoCheck.file_no,
                        AppEquipmentPhotoCheck.file_created_at,
                    ).where(*conditions)
                ).all()
                keys.update((int(r[0]), int(r[1]), _text(r[2])) for r in rows)
        return keys
    except Exception:
        logger.info("Verified photo lookup unavailable", exc_info=True)
        return None


def lookup_mark_counts(
    item_ids: Iterable[Any],
    db_id: Any = None,
    *,
    get_db_fn: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> Optional[dict[int, dict[str, int]]]:
    """``{item_id: {"verified": n, "rejected": n}}``; None when unknown.

    A mark counts only while the photo still exists with the same FILES.CREATE_DATE.
    """
    ids = sorted({int(value) for value in item_ids or []})
    if not ids:
        return {}
    if not _store_available(database_url):
        return None
    try:
        candidates: dict[tuple[int, int], tuple[str, bool, bool]] = {}
        with app_session(database_url) as session:
            with_reject = reject_columns_available(session)
            for offset in range(0, len(ids), _MAX_ITEM_IDS_PER_QUERY):
                chunk = ids[offset : offset + _MAX_ITEM_IDS_PER_QUERY]
                columns = [
                    AppEquipmentPhotoCheck.item_id,
                    AppEquipmentPhotoCheck.file_no,
                    AppEquipmentPhotoCheck.file_created_at,
                    AppEquipmentPhotoCheck.verified_at,
                ]
                marked = AppEquipmentPhotoCheck.verified_at.is_not(None)
                if with_reject:
                    columns.append(AppEquipmentPhotoCheck.rejected_at)
                    marked = or_(marked, AppEquipmentPhotoCheck.rejected_at.is_not(None))
                rows = session.execute(
                    select(*columns).where(
                        AppEquipmentPhotoCheck.db_id == normalize_db_id(db_id),
                        AppEquipmentPhotoCheck.item_id.in_(chunk),
                        marked,
                    )
                ).all()
                for row in rows:
                    rejected_at = row[4] if with_reject else None
                    candidates[(int(row[0]), int(row[1]))] = (
                        _text(row[2]),
                        row[3] is not None and rejected_at is None,
                        rejected_at is not None,
                    )
        if not candidates:
            return {}
        existing = equipment_photos.lookup_photo_fingerprints(
            {item_id for item_id, _ in candidates}, db_id, get_db_fn=get_db_fn
        )
    except Exception:
        logger.info("Photo mark count lookup unavailable", exc_info=True)
        return None
    counts: dict[int, dict[str, int]] = {}
    for key, (fingerprint, verified, rejected) in candidates.items():
        if existing.get(key) != fingerprint:
            continue
        bucket = counts.setdefault(key[0], {"verified": 0, "rejected": 0})
        if verified:
            bucket["verified"] += 1
        if rejected:
            bucket["rejected"] += 1
    return counts


def lookup_verified_counts(
    item_ids: Iterable[Any],
    db_id: Any = None,
    *,
    get_db_fn: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> Optional[dict[int, int]]:
    """``{item_id: verified_photo_count}``; None when unknown (store/FILES unavailable)."""
    counts = lookup_mark_counts(item_ids, db_id, get_db_fn=get_db_fn, database_url=database_url)
    if counts is None:
        return None
    return {item_id: bucket["verified"] for item_id, bucket in counts.items()}
