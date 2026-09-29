"""Job registry persistence (PostgreSQL schema ``voice``)."""

from __future__ import annotations

import json
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from .config import config
from .db import get_voice_engine

logger = logging.getLogger("voice-server")

JOB_KINDS = {"process", "resume", "enroll"}
ACTIVE_STATUSES = {"queued", "processing"}
TERMINAL_STATUSES = {"done", "failed", "cancelled"}


def _engine():
    return get_voice_engine(config.database_url)


def _row_to_dict(row) -> Dict[str, Any]:
    data = dict(row._mapping)
    for key in ("created_at", "started_at", "finished_at", "updated_at"):
        value = data.get(key)
        if isinstance(value, datetime):
            data[key] = value.isoformat()
    # psycopg returns JSON columns already parsed; sqlite/other drivers return str.
    for key in ("settings", "speaker_map", "enroll", "result"):
        value = data.get(key)
        if isinstance(value, str):
            try:
                data[key] = json.loads(value)
            except (ValueError, TypeError):
                pass
    return data


def create_job(
    *,
    kind: str,
    created_by: str,
    job_id: Optional[str] = None,
    base_filename: Optional[str] = None,
    original_filename: Optional[str] = None,
    stored_path: Optional[str] = None,
    file_size: Optional[int] = None,
    settings: Optional[Dict[str, Any]] = None,
    speaker_map: Optional[Dict[str, str]] = None,
    enroll: Optional[List[Dict[str, Any]]] = None,
    parent_job_id: Optional[str] = None,
) -> Dict[str, Any]:
    if kind not in JOB_KINDS:
        raise ValueError(f"Unknown job kind: {kind}")
    job_id = str(job_id or "").strip() or uuid.uuid4().hex[:12]
    with _engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO voice.voice_jobs
                    (id, kind, status, base_filename, original_filename, stored_path,
                     file_size, settings, speaker_map, enroll, parent_job_id, created_by,
                     progress, cancel_requested)
                VALUES
                    (:id, :kind, 'queued', :base_filename, :original_filename, :stored_path,
                     :file_size, :settings, :speaker_map, :enroll, :parent_job_id, :created_by,
                     0, FALSE)
                """
            ),
            {
                "id": job_id,
                "kind": kind,
                "base_filename": base_filename,
                "original_filename": original_filename,
                "stored_path": stored_path,
                "file_size": file_size,
                "settings": json.dumps(settings or {}, ensure_ascii=False),
                "speaker_map": json.dumps(speaker_map or {}, ensure_ascii=False),
                "enroll": json.dumps(enroll or [], ensure_ascii=False),
                "parent_job_id": parent_job_id,
                "created_by": created_by,
            },
        )
    job = get_job(job_id)
    return job or {"id": job_id, "kind": kind, "status": "queued"}


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with _engine().connect() as conn:
        row = conn.execute(
            text("SELECT * FROM voice.voice_jobs WHERE id = :id"), {"id": job_id}
        ).fetchone()
    return _row_to_dict(row) if row else None


def list_jobs(
    *,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    query = "SELECT * FROM voice.voice_jobs"
    params: Dict[str, Any] = {"limit": limit, "offset": offset}
    if status:
        if status == "active":
            query += " WHERE status IN ('queued','processing')"
        elif status == "terminal":
            query += " WHERE status IN ('done','failed','cancelled')"
        else:
            query += " WHERE status = :status"
            params["status"] = status
    query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
    with _engine().connect() as conn:
        rows = conn.execute(text(query), params).fetchall()
    return [_row_to_dict(row) for row in rows]


def list_jobs_for_base(base_filename: str) -> List[Dict[str, Any]]:
    with _engine().connect() as conn:
        rows = conn.execute(
            text(
                "SELECT * FROM voice.voice_jobs WHERE base_filename = :base "
                "ORDER BY created_at DESC LIMIT 20"
            ),
            {"base": base_filename},
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def update_job(job_id: str, **fields: Any) -> None:
    if not fields:
        return
    allowed = {
        "status", "stage", "progress", "error", "log_tail", "result",
        "started_at", "finished_at", "cancel_requested", "base_filename",
        "speaker_map", "settings",
    }
    sets, params = [], {"id": job_id}
    for key, value in fields.items():
        if key not in allowed:
            continue
        if key in {"settings", "speaker_map", "result"} and not isinstance(value, str):
            value = json.dumps(value or {}, ensure_ascii=False)
        sets.append(f"{key} = :{key}")
        params[key] = value
    if not sets:
        return
    sets.append("updated_at = :now")
    params["now"] = datetime.now(timezone.utc)
    with _engine().begin() as conn:
        conn.execute(
            text(f"UPDATE voice.voice_jobs SET {', '.join(sets)} WHERE id = :id"), params
        )


def append_log_tail(job_id: str, line: str, max_lines: int) -> None:
    job = get_job(job_id)
    tail = ((job or {}).get("log_tail") or "")
    lines = (tail + line.rstrip("\r\n") + "\n").splitlines()[-max_lines:]
    update_job(job_id, log_tail="\n".join(lines))


def claim_next_job() -> Optional[Dict[str, Any]]:
    """Oldest queued job -> processing. FOR UPDATE SKIP LOCKED for safe multi-worker."""
    with _engine().begin() as conn:
        row = conn.execute(
            text(
                """
                SELECT id FROM voice.voice_jobs
                WHERE status = 'queued'
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
                """
            )
        ).fetchone()
        if not row:
            return None
        job_id = row._mapping["id"]
        conn.execute(
            text(
                "UPDATE voice.voice_jobs SET status = 'processing', "
                "started_at = :now, updated_at = :now WHERE id = :id"
            ),
            {"now": datetime.now(timezone.utc), "id": job_id},
        )
    return get_job(job_id)


def is_cancel_requested(job_id: str) -> bool:
    with _engine().connect() as conn:
        row = conn.execute(
            text("SELECT cancel_requested FROM voice.voice_jobs WHERE id = :id"),
            {"id": job_id},
        ).fetchone()
    return bool(row and row._mapping["cancel_requested"])


def request_cancel(job_id: str) -> bool:
    with _engine().begin() as conn:
        result = conn.execute(
            text(
                "UPDATE voice.voice_jobs SET cancel_requested = TRUE, updated_at = :now "
                "WHERE id = :id AND status IN ('queued','processing')"
            ),
            {"now": datetime.now(timezone.utc), "id": job_id},
        )
    return bool(getattr(result, "rowcount", 0))


def requeue_interrupted() -> int:
    """On worker start: jobs stuck in 'processing' (worker died) go back to queued."""
    with _engine().begin() as conn:
        result = conn.execute(
            text(
                "UPDATE voice.voice_jobs SET status = 'queued', stage = NULL, "
                "progress = 0, started_at = NULL, updated_at = :now "
                "WHERE status = 'processing'"
            ),
            {"now": datetime.now(timezone.utc)},
        )
    return int(getattr(result, "rowcount", 0) or 0)


def delete_job(job_id: str) -> bool:
    with _engine().begin() as conn:
        result = conn.execute(
            text(
                "DELETE FROM voice.voice_jobs WHERE id = :id "
                "AND status IN ('done','failed','cancelled')"
            ),
            {"id": job_id},
        )
    return bool(getattr(result, "rowcount", 0))


def list_done_jobs(*, limit: int = 20) -> List[Dict[str, Any]]:
    """Oldest finished jobs first — candidates for the archiver."""
    with _engine().connect() as conn:
        rows = conn.execute(
            text(
                "SELECT * FROM voice.voice_jobs WHERE status = 'done' "
                "AND base_filename IS NOT NULL "
                "ORDER BY finished_at ASC NULLS LAST LIMIT :limit"
            ),
            {"limit": limit},
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def mark_archived(job_id: str, archive_path: str) -> None:
    with _engine().begin() as conn:
        conn.execute(
            text(
                "UPDATE voice.voice_jobs SET archive_path = :p, "
                "archive_at = :now, updated_at = :now WHERE id = :id"
            ),
            {"p": archive_path, "now": datetime.now(timezone.utc), "id": job_id},
        )


def queue_stats() -> Dict[str, int]:
    stats = {"queued": 0, "processing": 0, "done": 0, "failed": 0, "cancelled": 0}
    with _engine().connect() as conn:
        rows = conn.execute(
            text("SELECT status, COUNT(*) AS n FROM voice.voice_jobs GROUP BY status")
        ).fetchall()
    for row in rows:
        stats[str(row._mapping["status"])] = int(row._mapping["n"])
    return stats


# ---------------------------------------------------------------------------
# Share links (token -> meeting, TTL enforced on resolve)
# ---------------------------------------------------------------------------

SHARE_MAX_AGE_DAYS = 30


def create_share_link(
    base_filename: str, *, ttl_hours: int, created_by: str
) -> Dict[str, Any]:
    ttl = min(max(int(ttl_hours or 72), 1), SHARE_MAX_AGE_DAYS * 24)
    now = datetime.now(tz=timezone.utc)
    rec = {
        "token": secrets.token_urlsafe(24),
        "base_filename": base_filename,
        "created_by": str(created_by or "")[:120],
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(hours=ttl)).isoformat(),
    }
    with _engine().begin() as conn:
        conn.execute(
            text("DELETE FROM voice.share_links WHERE expires_at <= :now"),
            {"now": now},
        )
        conn.execute(
            text(
                "INSERT INTO voice.share_links "
                "(token, base_filename, created_by, created_at, expires_at) "
                "VALUES (:token, :base, :by, :created, :expires)"
            ),
            {
                "token": rec["token"],
                "base": rec["base_filename"],
                "by": rec["created_by"],
                "created": now,
                "expires": now + timedelta(hours=ttl),
            },
        )
    return rec


def resolve_share_link(token: str) -> Optional[Dict[str, Any]]:
    safe_token = str(token or "").strip()
    if not safe_token or len(safe_token) > 64:
        return None
    now = datetime.now(tz=timezone.utc)
    with _engine().connect() as conn:
        row = conn.execute(
            text(
                "SELECT token, base_filename, created_by, created_at, expires_at "
                "FROM voice.share_links WHERE token = :t AND expires_at > :now"
            ),
            {"t": safe_token, "now": now},
        ).first()
    if row is None:
        return None
    rec = dict(row._mapping)
    for key in ("created_at", "expires_at"):
        if isinstance(rec.get(key), datetime):
            rec[key] = rec[key].isoformat()
    return rec


def revoke_share_link(token: str) -> bool:
    safe_token = str(token or "").strip()
    if not safe_token:
        return False
    with _engine().begin() as conn:
        result = conn.execute(
            text("DELETE FROM voice.share_links WHERE token = :t"),
            {"t": safe_token},
        )
    return bool(getattr(result, "rowcount", 0))


# ---------------------------------------------------------------------------
# Assignment statuses (per meeting base + assignment num)
# ---------------------------------------------------------------------------

def get_assignment_statuses(base_filename: str) -> List[Dict[str, Any]]:
    with _engine().connect() as conn:
        rows = conn.execute(
            text("SELECT * FROM voice.voice_assignment_statuses WHERE base_filename = :base"),
            {"base": base_filename},
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def upsert_assignment_status(
    base_filename: str,
    num: str,
    status: str = "pending",
    comment: str = "",
    marked_by: str = "",
) -> Dict[str, Any]:
    import uuid as _uuid
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    with _engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO voice.voice_assignment_statuses
                    (id, base_filename, num, status, comment, marked_by, created_at, updated_at)
                VALUES (:id, :base, :num, :st, :cm, :mb, :ts, :ts)
                ON CONFLICT (base_filename, num) DO UPDATE SET
                    status = :st, comment = :cm, marked_by = :mb, updated_at = :ts
                """
            ),
            {
                "id": _uuid.uuid4().hex[:12],
                "base": base_filename,
                "num": num,
                "st": status,
                "cm": comment,
                "mb": marked_by,
                "ts": now,
            },
        )
    return {"base_filename": base_filename, "num": num, "status": status, "comment": comment}