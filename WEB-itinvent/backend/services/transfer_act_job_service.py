from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppTransferActJob
from backend.services.transfer_service import register_act_records


logger = logging.getLogger(__name__)

TERMINAL_STATUSES = {"done", "failed"}
_memory_jobs: dict[str, dict[str, Any]] = {}
_memory_lock = threading.RLock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


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
) -> dict[str, Any]:
    job_id = str(uuid4())
    username = str(getattr(user, "username", "") or "").strip()
    user_id_raw = getattr(user, "id", None)
    try:
        user_id = int(user_id_raw) if user_id_raw not in (None, "") else None
    except (TypeError, ValueError):
        user_id = None

    if _app_db_available():
        with app_session() as session:
            row = AppTransferActJob(
                id=job_id,
                operation=str(operation or "").strip(),
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
        return get_job(job_id) or {"id": job_id, "status": "queued"}

    with _memory_lock:
        _memory_jobs[job_id] = {
            "id": job_id,
            "operation": str(operation or "").strip(),
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
    return get_job(job_id) or {"id": job_id, "status": "queued"}


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


def mark_done(job_id: str, result: dict[str, Any], status_text: str = "Акты созданы") -> None:
    normalized_id = str(job_id or "").strip()
    if not normalized_id:
        return
    now = _now()
    if _app_db_available():
        with app_session() as session:
            row = session.get(AppTransferActJob, normalized_id)
            if row is None:
                return
            row.status = "done"
            row.status_text = status_text
            row.result_json = _json_dumps(result)
            row.error_text = None
            row.completed_at = now
            row.updated_at = now
        return

    with _memory_lock:
        row = _memory_jobs.get(normalized_id)
        if row:
            row["status"] = "done"
            row["status_text"] = status_text
            row["result_json"] = _json_dumps(result)
            row["error_text"] = None
            row["completed_at"] = now.isoformat()
            row["updated_at"] = now.isoformat()


def mark_failed(job_id: str, error_text: str, result: Optional[dict[str, Any]] = None) -> None:
    normalized_id = str(job_id or "").strip()
    if not normalized_id:
        return
    now = _now()
    safe_error = str(error_text or "Не удалось создать акты").strip()
    safe_result = result or {
        "success_count": 0,
        "failed_count": 1,
        "transferred": [],
        "failed": [{"inv_no": "", "error": safe_error}],
        "acts": [],
    }
    if _app_db_available():
        with app_session() as session:
            row = session.get(AppTransferActJob, normalized_id)
            if row is None:
                return
            row.status = "failed"
            row.status_text = "Создание актов завершилось ошибкой"
            row.result_json = _json_dumps(safe_result)
            row.error_text = safe_error
            row.completed_at = now
            row.updated_at = now
        return

    with _memory_lock:
        row = _memory_jobs.get(normalized_id)
        if row:
            row["status"] = "failed"
            row["status_text"] = "Создание актов завершилось ошибкой"
            row["result_json"] = _json_dumps(safe_result)
            row["error_text"] = safe_error
            row["completed_at"] = now.isoformat()
            row["updated_at"] = now.isoformat()


def response_payload(job_id: str) -> Optional[dict[str, Any]]:
    job = get_job(job_id)
    if not job:
        return None

    result = dict(job.get("result") or {})
    public_result = {key: value for key, value in result.items() if key != "_act_records"}
    return {
        "success_count": int(public_result.get("success_count") or 0),
        "failed_count": int(public_result.get("failed_count") or 0),
        "transferred": list(public_result.get("transferred") or []),
        "failed": list(public_result.get("failed") or []),
        "acts": list(public_result.get("acts") or []),
        "upload_reminder_created": bool(public_result.get("upload_reminder_created") or False),
        "upload_reminder_task_id": public_result.get("upload_reminder_task_id"),
        "upload_reminder_id": public_result.get("upload_reminder_id"),
        "upload_reminder_warning": public_result.get("upload_reminder_warning"),
        "upload_reminder_controller_username": public_result.get("upload_reminder_controller_username"),
        "upload_reminder_controller_fallback_used": bool(public_result.get("upload_reminder_controller_fallback_used") or False),
        "job_id": job.get("id"),
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
