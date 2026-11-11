from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppTransferActJob
from backend.services.transfer_service import register_act_records


logger = logging.getLogger(__name__)

TERMINAL_STATUSES = {"done", "failed"}
_memory_jobs: dict[str, dict[str, Any]] = {}
_memory_lock = threading.RLock()


def _positive_int_env(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(str(os.getenv(name, default)).strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


# A job becomes eligible for recovery only after its worker stopped renewing
# this lease.  The API keeps it alive while the background task is active; a
# retry with the same operation_id can therefore safely recover a job left in
# ``processing`` by a backend restart.
TRANSFER_ACT_JOB_LEASE_SECONDS = _positive_int_env(
    "TRANSFER_ACT_JOB_LEASE_SECONDS",
    15 * 60,
    minimum=60,
    maximum=24 * 60 * 60,
)


def execution_lease_heartbeat_seconds() -> int:
    """Return a bounded heartbeat interval shorter than the recovery lease."""
    return max(5, min(60, int(TRANSFER_ACT_JOB_LEASE_SECONDS // 3)))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _is_processing_lease_stale(value: Any, *, now: datetime | None = None) -> bool:
    updated_at = _as_utc_datetime(value)
    if updated_at is None:
        # A persisted processing job without a lease timestamp is unsafe to
        # leave permanently blocked after upgrading from an older runtime.
        return True
    current = now or _now()
    return updated_at <= current - timedelta(seconds=TRANSFER_ACT_JOB_LEASE_SECONDS)


# Per-worker-thread claim tokens (job_id -> ``started_at`` written by this
# thread's successful claim).  A job runner claims and finalizes in one thread.
_claims = threading.local()


def _remember_claim(job_id: str, token: Any) -> None:
    if not hasattr(_claims, "tokens"):
        _claims.tokens = {}
    _claims.tokens[job_id] = token


def _claim_token(job_id: str) -> Any:
    return getattr(_claims, "tokens", {}).get(job_id)


def execution_claim_token(job_id: str) -> Any:
    """Capture the current worker's claim for its separate heartbeat thread."""
    return _claim_token(str(job_id or "").strip())


def _forget_claim(job_id: str) -> None:
    getattr(_claims, "tokens", {}).pop(job_id, None)


def _json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, default=str)


def _json_loads(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    try:
        return json.loads(str(value))
    except Exception:
        return default


def _app_db_available() -> bool:
    if not is_app_database_configured():
        return False
    try:
        initialize_app_schema()
        return True
    except Exception as exc:
        logger.warning("Transfer act jobs: app DB unavailable, using memory fallback: %s", exc)
        return False


class TransferOperationConflict(ValueError):
    """The idempotency key was already used for a different transfer scope."""


def _normalize_operation_id(operation_id: Optional[str]) -> str:
    normalized = str(operation_id or "").strip()
    if not normalized:
        return str(uuid4())
    if len(normalized) < 8 or len(normalized) > 64:
        raise ValueError("operation_id must contain 8 to 64 characters")
    if not all(char.isalnum() or char in "._:-" for char in normalized):
        raise ValueError("operation_id contains unsupported characters")
    return normalized


def _job_matches_scope(
    job: dict[str, Any],
    *,
    operation: str,
    db_id: Optional[str],
    user_id: Optional[int],
    payload: Optional[dict[str, Any]] = None,
) -> bool:
    matches = (
        str(job.get("operation") or "").strip() == str(operation or "").strip()
        and (str(job.get("db_id") or "").strip() or None) == (str(db_id or "").strip() or None)
        and job.get("user_id") == user_id
    )
    if not matches or payload is None:
        return matches
    return dict(job.get("payload") or {}) == dict(payload or {})


def _existing_job_or_conflict(
    job_id: str,
    *,
    operation: str,
    db_id: Optional[str],
    user_id: Optional[int],
    payload: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    existing = get_job(job_id)
    if existing is None:
        return None
    if not _job_matches_scope(
        existing,
        operation=operation,
        db_id=db_id,
        user_id=user_id,
        payload=payload,
    ):
        raise TransferOperationConflict("operation_id is already used by another operation")
    existing["created"] = False
    return existing


def _normalize_job_row(row: AppTransferActJob | dict[str, Any]) -> dict[str, Any]:
    if isinstance(row, dict):
        payload = dict(row)
        payload["payload"] = _json_loads(payload.pop("payload_json", "{}"), {})
        payload["result"] = _json_loads(payload.pop("result_json", "{}"), {})
        return payload

    return {
        "id": row.id,
        "operation": row.operation,
        "status": row.status,
        "status_text": row.status_text,
        "db_id": row.db_id,
        "user_id": row.user_id,
        "username": row.username,
        "request_count": row.request_count,
        "payload": _json_loads(row.payload_json, {}),
        "result": _json_loads(row.result_json, {}),
        "error_text": row.error_text,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def create_job(
    *,
    operation: str,
    payload: dict[str, Any],
    db_id: Optional[str],
    user: Any,
    request_count: int,
    operation_id: Optional[str] = None,
) -> dict[str, Any]:
    job_id = _normalize_operation_id(operation_id)
    payload = dict(payload or {})
    normalized_operation = str(operation or "").strip()
    if normalized_operation.lower() in {"transfer", "location_transfer"}:
        # Persist the outbound boundary with the operation itself, not only in
        # a successful worker response.  This is the durable starting point
        # for a future explicit outbox project.
        payload.setdefault("one_c_sync_state", "not_requested")
    username = str(getattr(user, "username", "") or "").strip()
    user_id_raw = getattr(user, "id", None)
    try:
        user_id = int(user_id_raw) if user_id_raw not in (None, "") else None
    except (TypeError, ValueError):
        user_id = None

    existing = _existing_job_or_conflict(
        job_id,
        operation=operation,
        db_id=db_id,
        user_id=user_id,
        payload=payload,
    )
    if existing is not None:
        if str(existing.get("status") or "").strip() == "processing":
            resumed = requeue_stale_processing_job(job_id)
            if resumed is not None and resumed.get("resumed"):
                resumed["created"] = False
                return resumed
        return existing

    if _app_db_available():
        with app_session() as session:
            row = AppTransferActJob(
                id=job_id,
                operation=normalized_operation,
                status="queued",
                status_text="Акты поставлены в очередь на создание",
                db_id=str(db_id or "").strip() or None,
                user_id=user_id,
                username=username,
                request_count=max(0, int(request_count or 0)),
                payload_json=_json_dumps(payload),
                result_json="{}",
                created_at=_now(),
                updated_at=_now(),
            )
            session.add(row)
            # Detect a concurrent idempotent request before the session commits.
            try:
                session.flush()
            except IntegrityError:
                # A concurrent request committed the same operation key first.
                # Roll back the failed insert, then return that exact operation
                # only when its user, DB scope and payload match.
                session.rollback()
                existing_row = session.get(AppTransferActJob, job_id)
                if existing_row is None:
                    raise
                existing = _normalize_job_row(existing_row)
                if not _job_matches_scope(
                    existing,
                    operation=operation,
                    db_id=db_id,
                    user_id=user_id,
                    payload=payload,
                ):
                    raise TransferOperationConflict(
                        "operation_id is already used by another operation"
                    )
                if str(existing.get("status") or "").strip() == "processing":
                    resumed = requeue_stale_processing_job(job_id)
                    if resumed is not None and resumed.get("resumed"):
                        resumed["created"] = False
                        return resumed
                existing["created"] = False
                return existing
        created = get_job(job_id) or {"id": job_id, "status": "queued"}
        created["created"] = True
        return created

    with _memory_lock:
        existing_memory = _memory_jobs.get(job_id)
        if existing_memory is not None:
            existing = _normalize_job_row(existing_memory)
            if not _job_matches_scope(
                existing,
                operation=operation,
                db_id=db_id,
                user_id=user_id,
                payload=payload,
            ):
                raise TransferOperationConflict("operation_id is already used by another operation")
            if str(existing.get("status") or "").strip() == "processing":
                resumed = requeue_stale_processing_job(job_id)
                if resumed is not None and resumed.get("resumed"):
                    resumed["created"] = False
                    return resumed
            existing["created"] = False
            return existing
        _memory_jobs[job_id] = {
            "id": job_id,
            "operation": normalized_operation,
            "status": "queued",
            "status_text": "Акты поставлены в очередь на создание",
            "db_id": str(db_id or "").strip() or None,
            "user_id": user_id,
            "username": username,
            "request_count": max(0, int(request_count or 0)),
            "payload_json": _json_dumps(payload),
            "result_json": "{}",
            "error_text": None,
            "started_at": None,
            "completed_at": None,
            "created_at": _now().isoformat(),
            "updated_at": _now().isoformat(),
        }
    created = get_job(job_id) or {"id": job_id, "status": "queued"}
    created["created"] = True
    return created


def get_job(job_id: str) -> Optional[dict[str, Any]]:
    normalized_id = str(job_id or "").strip()
    if not normalized_id:
        return None

    if _app_db_available():
        with app_session() as session:
            row = session.get(AppTransferActJob, normalized_id)
            if row is None:
                return None
            payload = _normalize_job_row(row)
    else:
        with _memory_lock:
            row = _memory_jobs.get(normalized_id)
            payload = _normalize_job_row(row) if row else None

    if payload:
        result = dict(payload.get("result") or {})
        register_act_records(list(result.get("_act_records") or []))
    return payload


def requeue_stale_processing_job(job_id: str) -> Optional[dict[str, Any]]:
    """Return a durable job to ``queued`` only after its execution lease expires.

    This is intentionally a compare-and-swap operation.  Concurrent retries
    may all observe the stale job, but only one can requeue it; later worker
    claims remain guarded by ``claim_for_execution``.
    """
    normalized_id = str(job_id or "").strip()
    if not normalized_id:
        return None

    now = _now()
    cutoff = now - timedelta(seconds=TRANSFER_ACT_JOB_LEASE_SECONDS)
    resume_text = "Задание возобновлено после истечения lease воркера"

    if _app_db_available():
        with app_session() as session:
            resumed = session.execute(
                update(AppTransferActJob)
                .where(
                    AppTransferActJob.id == normalized_id,
                    AppTransferActJob.status == "processing",
                    AppTransferActJob.updated_at <= cutoff,
                )
                .values(
                    status="queued",
                    status_text=resume_text,
                    started_at=None,
                    updated_at=now,
                )
            )
            row = session.get(AppTransferActJob, normalized_id)
            if row is None:
                return None
            payload = _normalize_job_row(row)
            payload["resumed"] = bool(resumed.rowcount)
            return payload

    with _memory_lock:
        row = _memory_jobs.get(normalized_id)
        if row is None:
            return None
        resumed = False
        if str(row.get("status") or "").strip() == "processing" and _is_processing_lease_stale(
            row.get("updated_at") or row.get("started_at"),
            now=now,
        ):
            row["status"] = "queued"
            row["status_text"] = resume_text
            row["started_at"] = None
            row["updated_at"] = now.isoformat()
            resumed = True
        payload = _normalize_job_row(row)
        payload["resumed"] = resumed
        return payload


def requeue_failed_job(job_id: str, status_text: str = "Операция повторно поставлена в очередь") -> bool:
    """Atomically move a ``failed`` durable job back to ``queued``.

    Retries of a failed idempotent operation must pass through this
    compare-and-swap so two concurrent retries cannot both resume the same
    operation.  The stored ``result_json`` is preserved — resume logic reads
    already-completed stages from it.
    """
    normalized_id = str(job_id or "").strip()
    if not normalized_id:
        return False

    now = _now()
    if _app_db_available():
        with app_session() as session:
            resumed = session.execute(
                update(AppTransferActJob)
                .where(
                    AppTransferActJob.id == normalized_id,
                    AppTransferActJob.status == "failed",
                )
                .values(
                    status="queued",
                    status_text=status_text,
                    completed_at=None,
                    updated_at=now,
                )
            )
            return bool(resumed.rowcount)

    with _memory_lock:
        row = _memory_jobs.get(normalized_id)
        if not row or str(row.get("status") or "").strip() != "failed":
            return False
        row["status"] = "queued"
        row["status_text"] = status_text
        row["completed_at"] = None
        row["updated_at"] = now.isoformat()
        return True


def touch_execution_lease(job_id: str, *, claim_token: Any = None) -> bool:
    """Renew an actively claimed job so a live worker is never requeued."""
    normalized_id = str(job_id or "").strip()
    if not normalized_id:
        return False
    token = claim_token if claim_token is not None else _claim_token(normalized_id)
    if token is None:
        return False
    now = _now()
    if _app_db_available():
        with app_session() as session:
            renewed = session.execute(
                update(AppTransferActJob)
                .where(
                    AppTransferActJob.id == normalized_id,
                    AppTransferActJob.status == "processing",
                    AppTransferActJob.started_at == token,
                )
                .values(updated_at=now)
            )
            return bool(renewed.rowcount)

    with _memory_lock:
        row = _memory_jobs.get(normalized_id)
        if not row or row.get("status") != "processing" or row.get("started_at") != token:
            return False
        row["updated_at"] = now.isoformat()
        return True


def checkpoint_processing_result(
    job_id: str,
    result: dict[str, Any],
    *,
    status_text: str = "Результат перемещения сохранён; завершается оформление актов",
) -> bool:
    """Durably persist a recoverable in-progress transfer stage.

    ``result_json`` is not reserved for terminal jobs: a worker writes the
    generated act records while it still owns the execution lease.  If the
    process then dies before ``mark_done``, the retried operation can reuse
    the same deterministic act IDs/files and skip an already-created reminder.
    Physical paths remain private because ``response_payload`` removes
    ``_act_records`` before returning the result to an API caller.
    """
    normalized_id = str(job_id or "").strip()
    if not normalized_id:
        return False
    token = _claim_token(normalized_id)
    if token is None:
        return False
    now = _now()
    serialized = _json_dumps(result)
    if _app_db_available():
        with app_session() as session:
            updated = session.execute(
                update(AppTransferActJob)
                .where(
                    AppTransferActJob.id == normalized_id,
                    AppTransferActJob.status == "processing",
                    AppTransferActJob.started_at == token,
                )
                .values(
                    result_json=serialized,
                    status_text=str(status_text or "")[:500],
                    updated_at=now,
                )
            )
            return bool(updated.rowcount)

    with _memory_lock:
        row = _memory_jobs.get(normalized_id)
        if not row or row.get("status") != "processing" or row.get("started_at") != token:
            return False
        row["result_json"] = serialized
        row["status_text"] = str(status_text or "")[:500]
        row["updated_at"] = now.isoformat()
        return True


def mark_processing(job_id: str, status_text: str = "Создание актов выполняется") -> None:
    normalized_id = str(job_id or "").strip()
    if not normalized_id:
        return
    now = _now()
    if _app_db_available():
        with app_session() as session:
            row = session.get(AppTransferActJob, normalized_id)
            if row is None:
                return
            row.status = "processing"
            row.status_text = status_text
            row.started_at = row.started_at or now
            row.updated_at = now
        return

    with _memory_lock:
        row = _memory_jobs.get(normalized_id)
        if row:
            row["status"] = "processing"
            row["status_text"] = status_text
            row["started_at"] = row.get("started_at") or now.isoformat()
            row["updated_at"] = now.isoformat()


def claim_for_execution(job_id: str, status_text: str) -> bool:
    """Atomically claim a queued job so retries/restarts cannot run it twice.

    ``started_at`` is rewritten on every claim and is remembered (per worker
    thread) as a fencing token: ``mark_done``/``mark_failed`` only apply while
    the job still carries that exact value, so a worker that lost its lease
    cannot finalize a job that was requeued and claimed by someone else.
    """
    normalized_id = str(job_id or "").strip()
    if not normalized_id:
        return False
    now = _now()
    if _app_db_available():
        with app_session() as session:
            claimed = session.execute(
                update(AppTransferActJob)
                .where(
                    AppTransferActJob.id == normalized_id,
                    AppTransferActJob.status == "queued",
                )
                .values(
                    status="processing",
                    status_text=status_text,
                    started_at=now,
                    updated_at=now,
                )
            )
            if claimed.rowcount:
                _remember_claim(normalized_id, now)
            return bool(claimed.rowcount)

    with _memory_lock:
        row = _memory_jobs.get(normalized_id)
        if not row or row.get("status") != "queued":
            return False
        row["status"] = "processing"
        row["status_text"] = status_text
        row["started_at"] = now.isoformat()
        row["updated_at"] = now.isoformat()
        _remember_claim(normalized_id, row["started_at"])
        return True


def _finalize_processing_job(job_id: str, values: dict[str, Any], *, outcome: str) -> bool:
    """Apply a terminal transition only if the caller still owns the job.

    The job must be ``processing`` and, when this thread claimed it, still
    carry the claim's ``started_at`` token.  Returns ``False`` (and changes
    nothing) when the lease was lost: the job was requeued, re-claimed by
    another worker or already reached a terminal status.
    """
    normalized_id = str(job_id or "").strip()
    if not normalized_id:
        return False
    token = _claim_token(normalized_id)
    now = _now()
    values = {**values, "completed_at": now, "updated_at": now}
    applied = False
    if _app_db_available():
        conditions = [
            AppTransferActJob.id == normalized_id,
            AppTransferActJob.status == "processing",
        ]
        if token is not None:
            conditions.append(AppTransferActJob.started_at == token)
        with app_session() as session:
            applied = bool(
                session.execute(
                    update(AppTransferActJob).where(*conditions).values(**values)
                ).rowcount
            )
    else:
        with _memory_lock:
            row = _memory_jobs.get(normalized_id)
            if (
                row
                and str(row.get("status") or "").strip() == "processing"
                and (token is None or row.get("started_at") == token)
            ):
                for key, value in values.items():
                    row[key] = value.isoformat() if isinstance(value, datetime) else value
                applied = True
    if applied:
        _forget_claim(normalized_id)
    else:
        # Keep the token: a worker that lost its lease stays fenced off.
        logger.warning(
            "Transfer act job %s ignored: lease lost or job already finalized job_id=%s",
            outcome,
            normalized_id,
        )
    return applied


def mark_done(job_id: str, result: dict[str, Any], status_text: str = "Акты созданы") -> bool:
    """Finish a job owned by the caller; ``False`` means the lease was lost."""
    return _finalize_processing_job(
        job_id,
        {
            "status": "done",
            "status_text": status_text,
            "result_json": _json_dumps(result),
            "error_text": None,
        },
        outcome="mark_done",
    )


def mark_failed(job_id: str, error_text: str, result: Optional[dict[str, Any]] = None) -> bool:
    """Fail a job owned by the caller; ``False`` means the lease was lost."""
    safe_error = str(error_text or "Не удалось создать акты").strip()
    safe_result = result or {
        "success_count": 0,
        "failed_count": 1,
        "transferred": [],
        "failed": [{"inv_no": "", "error": safe_error}],
        "acts": [],
    }
    return _finalize_processing_job(
        job_id,
        {
            "status": "failed",
            "status_text": "Создание актов завершилось ошибкой",
            "result_json": _json_dumps(safe_result),
            "error_text": safe_error,
        },
        outcome="mark_failed",
    )


def response_payload(job_id: str) -> Optional[dict[str, Any]]:
    job = get_job(job_id)
    if not job:
        return None

    result = dict(job.get("result") or {})
    public_result = {key: value for key, value in result.items() if key != "_act_records"}
    # A job result is durable state, but the retry list is derived from its
    # failed rows on every read.  This prevents a stale/corrupt field from
    # causing the UI to resend an item that was already transferred.
    retry_inv_nos: list[str] = []
    for item in public_result.get("failed") or []:
        if not isinstance(item, dict):
            continue
        if item.get("retryable") is False:
            continue
        inv_no = str(item.get("inv_no") or "").strip()
        if inv_no and inv_no not in retry_inv_nos:
            retry_inv_nos.append(inv_no)
    return {
        "success_count": int(public_result.get("success_count") or 0),
        "failed_count": int(public_result.get("failed_count") or 0),
        "transferred": list(public_result.get("transferred") or []),
        "failed": list(public_result.get("failed") or []),
        "retry_inv_nos": retry_inv_nos,
        "acts": list(public_result.get("acts") or []),
        "upload_reminder_created": bool(public_result.get("upload_reminder_created") or False),
        "upload_reminder_task_id": public_result.get("upload_reminder_task_id"),
        "upload_reminder_id": public_result.get("upload_reminder_id"),
        "upload_reminder_warning": public_result.get("upload_reminder_warning"),
        "upload_reminder_controller_username": public_result.get("upload_reminder_controller_username"),
        "upload_reminder_controller_fallback_used": bool(public_result.get("upload_reminder_controller_fallback_used") or False),
        "job_id": job.get("id"),
        "operation_id": job.get("id"),
        "one_c_sync_state": public_result.get("one_c_sync_state")
        or (
            "not_requested"
            if str(job.get("operation") or "").strip() in {"transfer", "location_transfer"}
            else None
        ),
        "job_status": job.get("status"),
        "job_status_text": job.get("status_text") or "",
        "job_error": job.get("error_text"),
        "job_operation": job.get("operation"),
        "job_request_count": int(job.get("request_count") or 0),
        "job_created_at": job.get("created_at"),
        "job_started_at": job.get("started_at"),
        "job_completed_at": job.get("completed_at"),
    }


def snapshot_recent(limit: int = 20) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit or 20), 100))
    if not _app_db_available():
        with _memory_lock:
            rows = sorted(_memory_jobs.values(), key=lambda item: str(item.get("created_at") or ""), reverse=True)
            return [_normalize_job_row(row) for row in rows[:safe_limit]]

    with app_session() as session:
        rows = session.execute(
            select(AppTransferActJob).order_by(AppTransferActJob.created_at.desc()).limit(safe_limit)
        ).scalars().all()
        return [_normalize_job_row(row) for row in rows]
