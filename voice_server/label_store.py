"""Persistence for diarization labeling projects (``voice.label_projects``).

Saves use optimistic locking on ``version``: a stale editor gets ``None`` back
(-> HTTP 409) instead of silently overwriting someone else's corrections.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from .config import config
from .db import get_voice_engine

_JSON_KEYS = ("settings", "auto_segments", "segments", "speakers", "variants")
_DATE_KEYS = ("created_at", "updated_at", "edited_at")
_LIST_COLUMNS = (
    "id, title, original_filename, duration, status, job_id, aux_job_id, settings, speakers, "
    "version, error, created_by, updated_by, edited_at, created_at, updated_at"
)


def _engine():
    return get_voice_engine(config.database_url)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _row_to_dict(row) -> Dict[str, Any]:
    data = dict(row._mapping)
    for key in _DATE_KEYS:
        value = data.get(key)
        if isinstance(value, datetime):
            data[key] = value.isoformat()
    # psycopg returns JSON already parsed; sqlite returns str.
    for key in _JSON_KEYS:
        value = data.get(key)
        if isinstance(value, str):
            try:
                data[key] = json.loads(value)
            except (ValueError, TypeError):
                data[key] = None
    return data


def create_project(
    *,
    title: str,
    created_by: str,
    original_filename: str,
    media_path: str,
    settings: Dict[str, Any],
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    project_id = project_id or uuid.uuid4().hex[:12]
    now = _now()
    with _engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO voice.label_projects
                    (id, title, original_filename, media_path, status, settings,
                     segments, speakers, version, created_by, updated_by,
                     created_at, updated_at)
                VALUES
                    (:id, :title, :orig, :media, 'queued', :settings,
                     :segments, :speakers, 0, :by, :by, :now, :now)
                """
            ),
            {
                "id": project_id,
                "title": title,
                "orig": original_filename,
                "media": media_path,
                "settings": _dumps(settings or {}),
                "segments": _dumps([]),
                "speakers": _dumps({}),
                "by": created_by,
                "now": now,
            },
        )
    return get_project(project_id) or {"id": project_id}


def get_project(project_id: str) -> Optional[Dict[str, Any]]:
    with _engine().connect() as conn:
        row = conn.execute(
            text("SELECT * FROM voice.label_projects WHERE id = :id"), {"id": project_id}
        ).fetchone()
    return _row_to_dict(row) if row else None


def list_projects(*, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    # Segments are heavy (thousands of rows per meeting): not part of the list view.
    with _engine().connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT {_LIST_COLUMNS} FROM voice.label_projects "
                "ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
            ),
            {"limit": limit, "offset": offset},
        ).fetchall()
    return [_row_to_dict(row) for row in rows]


def set_job(project_id: str, job_id: str) -> None:
    with _engine().begin() as conn:
        conn.execute(
            text(
                "UPDATE voice.label_projects SET job_id = :job, status = 'queued', "
                "error = NULL, updated_at = :now WHERE id = :id"
            ),
            {"job": job_id, "now": _now(), "id": project_id},
        )


def set_aux_job(project_id: str, job_id: str) -> None:
    """Variant/enroll jobs: tracked separately so the ready labeling stays editable."""
    with _engine().begin() as conn:
        conn.execute(
            text("UPDATE voice.label_projects SET aux_job_id = :job, updated_at = :now WHERE id = :id"),
            {"job": job_id, "now": _now(), "id": project_id},
        )


def set_variant(project_id: str, name: str, payload: Optional[Dict[str, Any]]) -> None:
    """Merge (or remove with ``None``) one diarization variant (row-locked read-modify-write)."""
    engine = _engine()
    lock = " FOR UPDATE" if engine.dialect.name == "postgresql" else ""
    with engine.begin() as conn:
        row = conn.execute(
            text(f"SELECT variants FROM voice.label_projects WHERE id = :id{lock}"),
            {"id": project_id},
        ).fetchone()
        if row is None:
            return
        current = row._mapping["variants"]
        if isinstance(current, str):
            try:
                current = json.loads(current)
            except (ValueError, TypeError):
                current = None
        variants = dict(current or {})
        if payload is None:
            variants.pop(name, None)
        else:
            variants[name] = payload
        conn.execute(
            text("UPDATE voice.label_projects SET variants = :v, updated_at = :now WHERE id = :id"),
            {"v": _dumps(variants), "now": _now(), "id": project_id},
        )


def set_status(project_id: str, status: str, error: Optional[str] = None) -> None:
    with _engine().begin() as conn:
        conn.execute(
            text(
                "UPDATE voice.label_projects SET status = :st, error = :err, "
                "updated_at = :now WHERE id = :id"
            ),
            {"st": status, "err": error, "now": _now(), "id": project_id},
        )


def apply_draft(
    project_id: str,
    *,
    segments: List[Dict[str, Any]],
    duration: Optional[float],
    audio_path: Optional[str],
) -> None:
    """Store the automatic draft; replaces working segments only if nobody edited yet.

    Always bumps ``version`` so an editor opened before the draft arrived
    cannot overwrite it with its empty state.
    """
    with _engine().begin() as conn:
        conn.execute(
            text(
                """
                UPDATE voice.label_projects SET
                    auto_segments = :auto,
                    segments = CASE WHEN edited_at IS NULL THEN :auto ELSE segments END,
                    duration = :duration,
                    audio_path = :audio,
                    status = 'ready',
                    error = NULL,
                    version = version + 1,
                    updated_at = :now
                WHERE id = :id
                """
            ),
            {
                "auto": _dumps(segments),
                "duration": duration,
                "audio": audio_path,
                "now": _now(),
                "id": project_id,
            },
        )


def save_labeling(
    project_id: str,
    *,
    expected_version: int,
    segments: List[Dict[str, Any]],
    speakers: Dict[str, Any],
    title: Optional[str],
    updated_by: str,
) -> Optional[Dict[str, Any]]:
    """Compare-and-set save. Returns the fresh project, or None on version conflict."""
    now = _now()
    params: Dict[str, Any] = {
        "segments": _dumps(segments),
        "speakers": _dumps(speakers),
        "by": updated_by,
        "now": now,
        "id": project_id,
        "v": int(expected_version),
    }
    title_sql = ""
    if title:
        title_sql = "title = :title, "
        params["title"] = title
    with _engine().begin() as conn:
        result = conn.execute(
            text(
                f"""
                UPDATE voice.label_projects SET
                    {title_sql}segments = :segments,
                    speakers = :speakers,
                    version = version + 1,
                    updated_by = :by,
                    edited_at = :now,
                    updated_at = :now
                WHERE id = :id AND version = :v AND status = 'ready'
                """
            ),
            params,
        )
        if not getattr(result, "rowcount", 0):
            return None
    return get_project(project_id)


def delete_project(project_id: str) -> bool:
    with _engine().begin() as conn:
        result = conn.execute(
            text("DELETE FROM voice.label_projects WHERE id = :id"), {"id": project_id}
        )
    return bool(getattr(result, "rowcount", 0))
