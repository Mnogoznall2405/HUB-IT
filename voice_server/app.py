"""VoiceVideo hub integration API (``/api/v1/voice/*`` behind IIS ARR).

A dedicated process (``python -m voice_server``) that fronts the VoiceVideo
pipeline: upload queue, processing status, speaker naming, voice library,
reports. Auth mirrors scan_server: the hub session is validated through the
main backend ``/auth/me`` and ``voice.*`` permissions.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import tempfile
import time
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from .auth import (
    PERM_MANAGE,
    PERM_READ,
    PERM_UPLOAD,
    require_web_permission,
    user_has_permission,
    web_actor,
)
from .config import config
from . import pipeline, store

logger = logging.getLogger("voice-server")

app = FastAPI(
    title="HUB-IT VoiceVideo",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

JOB_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _job_or_404(job_id: str) -> Dict[str, Any]:
    if not JOB_ID_RE.match(str(job_id or "")):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


def _parse_date_param(value: Optional[str], *, end_of_day: bool) -> Optional[float]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    if end_of_day and len(raw) <= 10:
        parsed = parsed + timedelta(days=1) - timedelta(seconds=1)
    return parsed.timestamp()


def _meeting_or_404(base: str) -> str:
    if not pipeline.transcript_path(base):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return pipeline.sanitize_base(base)


def _require_manage_or_owner(user: Dict[str, Any], job: Dict[str, Any]) -> None:
    if user_has_permission(user, PERM_MANAGE):
        return
    if (
        user_has_permission(user, PERM_UPLOAD)
        and str(job.get("created_by") or "") == web_actor(user)
    ):
        return
    raise HTTPException(
        status.HTTP_403_FORBIDDEN, f"Insufficient permissions: {PERM_MANAGE}"
    )


def _job_view(job: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": job.get("id"),
        "kind": job.get("kind"),
        "status": job.get("status"),
        "stage": job.get("stage"),
        "progress": job.get("progress") or 0,
        "base_filename": job.get("base_filename"),
        "original_filename": job.get("original_filename"),
        "file_size": job.get("file_size"),
        "settings": job.get("settings") or {},
        "speaker_map": job.get("speaker_map") or {},
        "result": job.get("result") or {},
        "error": job.get("error"),
        "created_by": job.get("created_by"),
        "created_at": job.get("created_at"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
        "parent_job_id": job.get("parent_job_id"),
    }


def _meeting_view(
    meeting: Dict[str, Any],
    jobs: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    base = meeting.get("base_filename") or ""
    if jobs is None:
        jobs = store.list_jobs_for_base(base)
    return {
        **meeting,
        "jobs": [_job_view(j) for j in jobs],
        "latest_job": _job_view(jobs[0]) if jobs else None,
        "clips": pipeline.list_clips(base),
        "has_media": bool(pipeline.find_source_media(base)),
    }


_TRASH_RETENTION_DAYS = 30


def _trash_root() -> Path:
    return pipeline.vv_root() / ".trash"


def _sweep_trash(root: Path) -> None:
    cutoff = time.time() - _TRASH_RETENTION_DAYS * 86400
    try:
        for day_dir in root.iterdir():
            if not day_dir.is_dir():
                continue
            try:
                if day_dir.stat().st_mtime > cutoff:
                    continue
                shutil.rmtree(day_dir, ignore_errors=True)
                logger.info("trash: removed expired %s", day_dir.name)
            except OSError:
                continue
    except OSError:
        pass


def _move_to_trash(target: Path, actor: str) -> Path:
    day_dir = _trash_root() / datetime.now(timezone.utc).strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    dest = day_dir / target.name
    if dest.exists():
        dest = day_dir / f"{target.name}.{uuid.uuid4().hex[:6]}"
    shutil.move(str(target), str(dest))
    logger.info("trash: %s moved to %s by %s", target, dest, actor)
    _sweep_trash(_trash_root())
    return dest


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "service": "voice", "root_ok": pipeline.vv_root().exists()}


_META_CACHE_TTL_SEC = 300
_meta_cache: Dict[str, tuple[float, Any]] = {}


def _meta_cached(key: str, builder):
    hit = _meta_cache.get(key)
    now = time.monotonic()
    if hit and hit[0] > now:
        return hit[1]
    value = builder()
    _meta_cache[key] = (now + _META_CACHE_TTL_SEC, value)
    return value


@app.get("/api/v1/voice/overview")
def overview(user: Dict[str, Any] = Depends(require_web_permission(PERM_READ))) -> Dict[str, Any]:
    return _meta_cached(
        "overview",
        lambda: {
            "voicevideo_root": str(pipeline.vv_root()),
            "voicevideo_root_exists": pipeline.vv_root().exists(),
            "queue": store.queue_stats(),
            "voices_count": len(pipeline.list_reference_voices()),
            "meetings_count": pipeline.list_meetings(limit=1)["total"],
            "upload_max_bytes": config.upload_max_bytes,
            "worker_concurrency": config.worker_concurrency,
        },
    )


@app.get("/api/v1/voice/options")
def options(user: Dict[str, Any] = Depends(require_web_permission(PERM_READ))) -> Dict[str, Any]:
    return _meta_cached("options", pipeline.processing_options)


# ---------------------------------------------------------------------------
# Jobs (upload / queue / status)
# ---------------------------------------------------------------------------

@app.post("/api/v1/voice/jobs", status_code=status.HTTP_201_CREATED)
async def create_process_job(
    file: UploadFile = File(...),
    settings_json: Optional[str] = Form(None),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_UPLOAD)),
) -> Dict[str, Any]:
    original_name = Path(file.filename or "upload").name
    if not pipeline.is_supported_media(original_name):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Unsupported format: {Path(original_name).suffix}",
        )
    try:
        settings = json.loads(settings_json) if settings_json else {}
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid settings JSON")
    if not isinstance(settings, dict):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Settings must be an object")

    job_id = uuid.uuid4().hex[:12]
    stem = pipeline.sanitize_name(Path(original_name).stem) or "meeting"
    stored_name = f"j{job_id}_{stem}{Path(original_name).suffix.lower()}"
    stored_path = pipeline.input_dir() / stored_name
    pipeline.input_dir().mkdir(parents=True, exist_ok=True)

    size = 0
    try:
        with open(stored_path, "wb") as dest:
            while True:
                chunk = await file.read(4 * 1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > config.upload_max_bytes:
                    dest.close()
                    stored_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"File exceeds {config.upload_max_bytes // (1024 * 1024)} MB limit",
                    )
                dest.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        stored_path.unlink(missing_ok=True)
        logger.exception("Upload failed")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Upload failed: {exc}")

    job = store.create_job(
        kind="process",
        job_id=job_id,
        created_by=web_actor(user),
        base_filename=Path(stored_name).stem,
        original_filename=original_name,
        stored_path=str(stored_path),
        file_size=size,
        settings=settings,
    )
    return _job_view(job)


@app.get("/api/v1/voice/jobs")
def list_jobs(
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    jobs = store.list_jobs(status=status_filter, limit=limit, offset=offset)
    return {"items": [_job_view(j) for j in jobs], "queue": store.queue_stats()}


@app.get("/api/v1/voice/jobs/{job_id}")
def job_detail(
    job_id: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    job = _job_or_404(job_id)
    view = _job_view(job)
    base = str(job.get("base_filename") or "")
    if base:
        view["speakers"] = pipeline.meeting_speakers(base)
        view["reports"] = pipeline.list_report_files(base)
        view["clips"] = pipeline.list_clips(base)
        view["has_media"] = bool(pipeline.find_source_media(base))
    return view


@app.get("/api/v1/voice/jobs/{job_id}/log")
def job_log(
    job_id: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    job = _job_or_404(job_id)
    return {"id": job_id, "log_tail": job.get("log_tail") or ""}


@app.post("/api/v1/voice/jobs/{job_id}/retry", status_code=status.HTTP_201_CREATED)
def retry_job(
    job_id: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    job = _job_or_404(job_id)
    _require_manage_or_owner(user, job)
    if job.get("kind") != "process":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only process jobs can be retried")
    if job.get("status") not in ("failed", "cancelled"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Only failed or cancelled jobs can be retried")
    stored_path = Path(str(job.get("stored_path") or ""))
    if not stored_path.name or not stored_path.exists():
        raise HTTPException(status.HTTP_409_CONFLICT, "Исходный файл уже удалён — загрузите заново")
    new = store.create_job(
        kind="process",
        created_by=web_actor(user),
        base_filename=str(job.get("base_filename") or ""),
        original_filename=job.get("original_filename"),
        stored_path=str(stored_path),
        file_size=job.get("file_size"),
        settings=job.get("settings") or {},
        parent_job_id=job_id,
    )
    return _job_view(new)


@app.post("/api/v1/voice/jobs/{job_id}/cancel")
def cancel_job(
    job_id: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    job = _job_or_404(job_id)
    _require_manage_or_owner(user, job)
    if job.get("status") in store.TERMINAL_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Job already finished")
    store.request_cancel(job_id)
    if job.get("status") == "queued":
        store.update_job(job_id, status="cancelled")
    return {"id": job_id, "status": "cancel_requested"}


@app.delete("/api/v1/voice/jobs/{job_id}")
def delete_job(
    job_id: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    job = _job_or_404(job_id)
    if job.get("status") in store.ACTIVE_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cancel the job first")
    if not store.delete_job(job_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot delete active job")
    return {"id": job_id, "deleted": True}


# ---------------------------------------------------------------------------
# Meetings (processed reports)
# ---------------------------------------------------------------------------

@app.get("/api/v1/voice/meetings")
def list_meetings(
    q: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    unresolved: bool = Query(False),
    order: str = Query("desc"),
    tag: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    participant: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    page = pipeline.list_meetings(
        q=q, limit=limit, offset=offset,
        unresolved_only=unresolved,
        order="asc" if str(order).lower() == "asc" else "desc",
        tag=tag, project=project, participant=participant,
        date_from=_parse_date_param(date_from, end_of_day=False),
        date_to=_parse_date_param(date_to, end_of_day=True),
    )
    meetings = page["items"]
    bases = {str(m.get("base_filename") or "") for m in meetings}
    jobs_by_base: Dict[str, List[Dict[str, Any]]] = {}
    for job in store.list_jobs(limit=500):
        base = str(job.get("base_filename") or "")
        if base in bases and len(jobs_by_base.get(base, [])) < 20:
            jobs_by_base.setdefault(base, []).append(job)
    return {
        "items": [
            _meeting_view(m, jobs_by_base.get(str(m.get("base_filename") or ""), []))
            for m in meetings
        ],
        "total": page["total"],
    }


@app.get("/api/v1/voice/meetings/{base}")
def meeting_detail(
    base: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    safe_base = _meeting_or_404(base)
    media_info = pipeline.source_media_info(safe_base)
    parts = pipeline.media_parts(safe_base)
    if not media_info["has_media"]:
        part_expiries = [
            pipeline.source_media_info(p["base"])["source_expires_at"]
            for p in parts if p.get("has_media")
        ]
        part_expiries = [e for e in part_expiries if e]
        if part_expiries:
            media_info = {"has_media": True, "source_expires_at": max(part_expiries)}
    return {
        "base_filename": safe_base,
        "reports": pipeline.list_report_files(safe_base),
        "clips": pipeline.list_clips(safe_base),
        "speakers": pipeline.meeting_speakers(safe_base),
        "jobs": [_job_view(j) for j in store.list_jobs_for_base(safe_base)],
        **media_info,
        "media_parts": parts,
        "web_meta": pipeline.meeting_web_meta(safe_base),
        "voices": pipeline.list_reference_voices(),
    }


class AssignmentStatusPayload(BaseModel):
    num: str = Field(..., min_length=1, max_length=16)
    status: str = Field("done", pattern="^(pending|in_progress|done)$")
    comment: str = Field("", max_length=2000)


@app.get("/api/v1/voice/meetings/{base}/assignments/status")
def get_assignment_statuses(
    base: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    safe_base = _meeting_or_404(base)
    return {"items": store.get_assignment_statuses(safe_base)}


@app.put("/api/v1/voice/meetings/{base}/assignments/status")
def update_assignment_status(
    base: str,
    payload: AssignmentStatusPayload,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    safe_base = _meeting_or_404(base)
    return store.upsert_assignment_status(
        safe_base,
        num=payload.num,
        status=payload.status,
        comment=payload.comment,
        marked_by=web_actor(user),
    )


@app.get("/api/v1/voice/meetings/{base}/assignments")
def meeting_assignments(
    base: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    safe_base = _meeting_or_404(base)
    return {"items": pipeline.meeting_assignments(safe_base)}


@app.delete("/api/v1/voice/meetings/{base}")
def delete_meeting(
    base: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    safe_base = _meeting_or_404(base)
    active = [
        j for j in store.list_jobs_for_base(safe_base)
        if j.get("status") in store.ACTIVE_STATUSES
    ]
    if active:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "По встрече есть активная задача — сначала отмените её",
        )
    actor = web_actor(user)
    moved = 0
    mdir = pipeline.meeting_dir(safe_base)
    if mdir and mdir.exists():
        _move_to_trash(mdir, actor)
        moved += 1
    out = pipeline.output_dir()
    # Flat artifact naming is <base>_<kind>.<ext>; extend here if new kinds appear.
    known_kinds = (
        "report", "transcript", "protocol", "summary", "insights",
        "action_registry", "web_meta",
    )
    try:
        for entry in list(out.iterdir()):
            if not entry.is_file() or not entry.name.startswith(f"{safe_base}_"):
                continue
            rest = entry.name[len(safe_base) + 1:]
            # Flat artifacts are <base>_{report|transcript|protocol}.<ext>;
            # guards against wiping <base>_part2_* when deleting <base>.
            if rest.split(".")[0] in known_kinds:
                _move_to_trash(entry, actor)
                moved += 1
    except OSError:
        pass
    media = pipeline.find_source_media(safe_base)
    if media:
        _move_to_trash(media, actor)
        moved += 1
    logger.info("meeting %s moved to trash (%d items) by %s", safe_base, moved, actor)
    return {"base_filename": safe_base, "deleted": True, "trashed_items": moved}


class MeetingMetaPayload(BaseModel):
    tags: List[str] = Field(default_factory=list, max_length=20)
    project: str = Field(default="", max_length=120)


@app.put("/api/v1/voice/meetings/{base}/meta")
def update_meeting_meta(
    base: str,
    payload: MeetingMetaPayload,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    safe_base = _meeting_or_404(base)
    meta = pipeline.save_meeting_web_meta(
        safe_base, tags=payload.tags, project=payload.project
    )
    if meta is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Cannot save meta")
    return meta


class ShareLinkPayload(BaseModel):
    ttl_hours: int = Field(default=72, ge=1, le=720)


@app.post("/api/v1/voice/meetings/{base}/share")
def create_share_link(
    base: str,
    payload: ShareLinkPayload,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    safe_base = _meeting_or_404(base)
    return store.create_share_link(
        safe_base, ttl_hours=payload.ttl_hours, created_by=web_actor(user)
    )


@app.get("/api/v1/voice/share/{token}")
def resolve_share_link(
    token: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    rec = store.resolve_share_link(token)
    if rec is None or _share_target_gone(rec):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ссылка недействительна или истекла")
    return rec


@app.delete("/api/v1/voice/share/{token}")
def revoke_share_link(
    token: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    rec = store.resolve_share_link(token)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found")
    if not user_has_permission(user, PERM_MANAGE) and rec.get("created_by") != web_actor(user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, f"Insufficient permissions: {PERM_MANAGE}"
        )
    store.revoke_share_link(token)
    return {"revoked": True, "token": token}


def _share_target_gone(rec: Dict[str, Any]) -> bool:
    base = str(rec.get("base_filename") or "")
    return not pipeline.meeting_dir(base) and not pipeline.find_source_media(base)


def _share_or_404(token: str) -> Dict[str, Any]:
    rec = store.resolve_share_link(token)
    if rec is None or _share_target_gone(rec):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ссылка недействительна или истекла")
    return rec


# ---------------------------------------------------------------------------
# Public share endpoints — no session required; access is bounded by the
# unguessable token + server-side expiry (see ShareLinkPayload.ttl_hours).
# ---------------------------------------------------------------------------

@app.get("/api/v1/voice/public/{token}")
def public_share_report(token: str) -> HTMLResponse:
    rec = _share_or_404(token)
    base = str(rec["base_filename"])
    reports = pipeline.list_report_files(base)
    html_report = next(
        (r for r in reports if str(r.get("name") or "").lower().endswith(".html")),
        None,
    )
    if not html_report:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Нет HTML-отчёта для этой ссылки")
    path = pipeline.resolve_report_file(base, str(html_report["name"]))
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    return _report_inline_html(
        base, path, url_prefix=f"/api/v1/voice/public/{quote(token, safe='')}"
    )


@app.get("/api/v1/voice/public/{token}/clips/{name}")
def public_share_clip(token: str, name: str) -> FileResponse:
    rec = _share_or_404(token)
    path = pipeline.resolve_clip_file(str(rec["base_filename"]), name)
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    return FileResponse(path, media_type=None)


@app.get("/api/v1/voice/public/{token}/media")
def public_share_media(token: str, part: Optional[str] = Query(None)) -> FileResponse:
    rec = _share_or_404(token)
    rec_base = str(rec["base_filename"])
    # For merged meetings ?part=<child base> selects that part's recording.
    target = rec_base
    if part:
        allowed = {p["base"] for p in pipeline.media_parts(rec_base)}
        if part in allowed:
            target = part
    path = pipeline.find_source_media(target)
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source media not found")
    return FileResponse(path, media_type=None)


_EXPORT_MAX_MEETINGS = 20
_EXPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024  # 2 GiB raw content cap


@app.get("/api/v1/voice/export/reports.zip")
def export_reports_zip(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> FileResponse:
    """ZIP bundle: <base>/<report files> + <base>/clips/ for the date range."""
    result = pipeline.list_meetings(
        limit=_EXPORT_MAX_MEETINGS, offset=0,
        date_from=_parse_date_param(date_from, end_of_day=False),
        date_to=_parse_date_param(date_to, end_of_day=True),
    )
    items = result.get("items") or []
    if not items:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Нет протоколов за выбранный период")
    tmp_dir = pipeline.vv_root() / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(
        prefix="vv_export_", suffix=".zip", delete=False, dir=tmp_dir,
    )
    tmp_path = Path(tmp.name)
    packed = 0
    total_bytes = 0
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
            for item in items:
                base = str(item.get("base_filename") or "")
                if not base:
                    continue
                wrote = False
                for rep in pipeline.list_report_files(base):
                    rep_path = pipeline.resolve_report_file(base, str(rep.get("name") or ""))
                    if rep_path and rep_path.is_file():
                        total_bytes += rep_path.stat().st_size
                        if total_bytes > _EXPORT_MAX_BYTES:
                            raise HTTPException(
                                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                "Архив превышает 2 ГБ — сузьте период",
                            )
                        zf.write(rep_path, arcname=f"{base}/{rep_path.name}")
                        wrote = True
                mdir = pipeline.meeting_dir(base)
                clips_dir = mdir / "clips" if mdir else None
                if clips_dir and clips_dir.exists():
                    for clip in sorted(clips_dir.iterdir()):
                        if clip.is_file():
                            total_bytes += clip.stat().st_size
                            if total_bytes > _EXPORT_MAX_BYTES:
                                raise HTTPException(
                                    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                    "Архив превышает 2 ГБ — сузьте период",
                                )
                            zf.write(clip, arcname=f"{base}/clips/{clip.name}")
                            wrote = True
                if wrote:
                    packed += 1
    except Exception:
        tmp.close()
        tmp_path.unlink(missing_ok=True)
        raise
    tmp.close()
    if packed == 0:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Нет файлов отчётов за выбранный период")
    stamp = f"{date_from or 'all'}_{date_to or 'all'}"
    return FileResponse(
        tmp_path,
        media_type="application/zip",
        filename=f"voice_protocols_{stamp}.zip",
        background=BackgroundTask(lambda: tmp_path.unlink(missing_ok=True)),
    )


@app.get("/api/v1/voice/meetings/{base}/topics")
def meeting_topics(
    base: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    safe_base = _meeting_or_404(base)
    return {"items": pipeline.meeting_topics(safe_base)}


@app.get("/api/v1/voice/meetings/{base}/transcript")
def meeting_transcript(
    base: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    safe_base = _meeting_or_404(base)
    data = pipeline.load_transcript(safe_base) or {}
    segments = data.get("segments") or []
    sliced = segments[offset:offset + limit]
    return {
        "base_filename": safe_base,
        "total": len(segments),
        "offset": offset,
        "segments": [
            {
                "speaker": s.get("speaker"),
                "text": s.get("text"),
                "start": s.get("start", s.get("start_time")),
                "end": s.get("end", s.get("end_time")),
                "start_time_formatted": s.get("start_time_formatted"),
                "end_time_formatted": s.get("end_time_formatted"),
            }
            for s in sliced
        ],
    }


_REPORT_PLAYER_SNIPPET = """
<style>
.vv-floating-player{position:fixed;right:16px;bottom:16px;z-index:99999;display:none;
  background:#16181d;border-radius:12px;box-shadow:0 10px 36px rgba(0,0,0,.5);
  padding:8px;width:min(430px,92vw)}
.vv-floating-player.vv-open{display:block}
.vv-floating-player video{width:100%;max-height:42vh;display:block;border-radius:8px;background:#000}
.vv-bar{display:flex;align-items:center;gap:8px;color:#e8eaf0;
  font:13px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;padding:4px 4px 8px}
.vv-bar .vv-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vv-bar button{background:#2c313c;color:#e8eaf0;border:0;border-radius:6px;
  padding:3px 10px;cursor:pointer;font-size:14px}
.timestamp.vv-ts{cursor:pointer;border-bottom:1px dotted currentColor}
.timestamp.vv-ts:hover{color:#1976d2}
.vv-back-btn{position:fixed;top:12px;left:12px;z-index:100000;
  background:#1976d2;color:#fff;border:0;border-radius:8px;
  padding:8px 16px;font:600 13px/1.2 -apple-system,"Segoe UI",Roboto,sans-serif;
  cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);text-decoration:none;display:inline-block}
.vv-back-btn:hover{background:#1565c0}
</style>
<a class="vv-back-btn" href="javascript:if(window.history.length>1)window.history.back();else window.location.href='/voice';">&#8592; &#1050; &#1087;&#1088;&#1086;&#1090;&#1086;&#1082;&#1086;&#1083;&#1072;&#1084;</a>
<div class="vv-floating-player" id="vvPlayer">
  <div class="vv-bar"><span class="vv-title" id="vvTitle"></span>
  <button type="button" id="vvClose" aria-label="Закрыть">✕</button></div>
  <video id="vvVideo" controls playsinline preload="metadata"></video>
</div>
<script>
(function(){
var CFG=__VV_MEDIA_CFG__;
var P=document.getElementById('vvPlayer'),V=document.getElementById('vvVideo'),
    T=document.getElementById('vvTitle');
document.getElementById('vvClose').addEventListener('click',function(){
  P.classList.remove('vv-open');V.pause();
});
function openPlayer(src,title,seek){
  T.textContent=title||'Фрагмент';
  if(V.getAttribute('src')!==src)V.setAttribute('src',src);
  P.classList.add('vv-open');
  var go=function(){if(typeof seek==='number')V.currentTime=seek;V.play().catch(function(){});};
  if(V.readyState>=1)go();else V.addEventListener('loadedmetadata',go,{once:true});
}
function tsToSeconds(text){
  var m=String(text||'').trim().match(/^(?:(\\d+):)?(\\d{1,2}):(\\d{2})$/);
  if(!m)return null;
  return (+m[1]||0)*3600+(+m[2])*60+(+m[3]);
}
function mediaFor(t){
  if(CFG.media)return{url:CFG.media,local:t};
  var parts=(CFG.parts||[]).filter(function(p){return p.offset<=t;});
  var part=parts.length?parts[parts.length-1]:(CFG.parts||[])[0];
  return part?{url:part.url,local:Math.max(0,t-part.offset)}:null;
}
document.addEventListener('click',function(e){
  var a=e.target.closest?e.target.closest('a[href]'):null;
  if(a&&/\\/clips\\//.test(a.getAttribute('href')||'')){
    e.preventDefault();
    openPlayer(a.getAttribute('href'),'Фрагмент '+(a.textContent||'').trim());
    return;
  }
  var ts=e.target.closest?e.target.closest('.timestamp'):null;
  if(ts){
    var s=tsToSeconds(ts.textContent);
    var media=s==null?null:mediaFor(s);
    if(media)openPlayer(media.url,'Запись',media.local);
  }
});
document.querySelectorAll('.timestamp').forEach(function(el){
  el.classList.add('vv-ts');el.title='Прослушать с этого момента';
});
})();
</script>
"""


def _report_inline_html(
    safe_base: str, path: Path, *, url_prefix: Optional[str] = None
) -> HTMLResponse:
    """Serve report HTML with clip links rewritten to API URLs and an
    in-page player: clip links and transcript timestamps play inline.
    ``url_prefix`` overrides the route prefix for public share links."""
    base_q = quote(safe_base, safe="")
    prefix = url_prefix or f"/api/v1/voice/meetings/{base_q}"
    html = path.read_text(encoding="utf-8", errors="replace")
    html = re.sub(
        r'(\b(?:href|src)\s*=\s*["\'])(?:\./)?clips/',
        rf'\g<1>{prefix}/clips/',
        html,
    )
    parts = [
        {
            "url": f"{prefix}/media?part={quote(p['base'], safe='')}",
            "offset": p["offset"],
        }
        for p in pipeline.media_parts(safe_base)
        if p["has_media"]
    ]
    media_url = (
        f"{prefix}/media" if pipeline.find_source_media(safe_base) else None
    )
    cfg = json.dumps({"media": media_url, "parts": parts})
    snippet = _REPORT_PLAYER_SNIPPET.replace("__VV_MEDIA_CFG__", cfg)
    if "</body>" in html:
        html = html.replace("</body>", snippet + "</body>", 1)
    else:
        html += snippet
    return HTMLResponse(html)


def _report_zip_response(safe_base: str, report_path: Path) -> FileResponse:
    """ZIP bundle: report file + clips/ folder, so relative links work offline."""
    tmp_dir = pipeline.vv_root() / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(
        prefix="vv_report_", suffix=".zip", delete=False, dir=tmp_dir,
    )
    tmp_path = Path(tmp.name)
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(report_path, arcname=report_path.name)
            mdir = pipeline.meeting_dir(safe_base)
            clips_dir = mdir / "clips" if mdir else None
            if clips_dir and clips_dir.exists():
                for clip in sorted(clips_dir.iterdir()):
                    if clip.is_file():
                        zf.write(clip, arcname=f"clips/{clip.name}")
    except Exception:
        tmp.close()
        tmp_path.unlink(missing_ok=True)
        raise
    tmp.close()
    return FileResponse(
        tmp_path,
        media_type="application/zip",
        filename=f"{report_path.stem}_files.zip",
        background=BackgroundTask(lambda: tmp_path.unlink(missing_ok=True)),
    )


@app.get("/api/v1/voice/meetings/{base}/reports/{name:path}")
def meeting_report_file(
    base: str,
    name: str,
    download: Optional[str] = Query(None),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> FileResponse:
    safe_base = _meeting_or_404(base)
    # HTML reports reference clips via relative 'clips/<file>' links.
    normalized = name.replace("\\", "/")
    if normalized.startswith("clips/"):
        clip = pipeline.resolve_clip_file(safe_base, normalized.split("/", 1)[-1])
        if not clip:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
        return FileResponse(clip, media_type=None)
    path = pipeline.resolve_report_file(safe_base, normalized)
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    dl = str(download or "").strip().lower()
    if dl in ("1", "true", "zip"):
        # Bundles keep fragment links working after download.
        if dl == "zip" or pipeline.list_clips(safe_base):
            return _report_zip_response(safe_base, path)
        return FileResponse(
            path, filename=path.name, media_type=None,
            content_disposition_type="attachment",
        )
    if path.suffix.lower() == ".html":
        return _report_inline_html(safe_base, path)
    return FileResponse(path, media_type=None)


@app.get("/api/v1/voice/meetings/{base}/clips/{name}")
def meeting_clip_file(
    base: str,
    name: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> FileResponse:
    safe_base = _meeting_or_404(base)
    path = pipeline.resolve_clip_file(safe_base, name)
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    return FileResponse(path, media_type=None)


@app.get("/api/v1/voice/meetings/{base}/media")
def meeting_media(
    base: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> FileResponse:
    safe_base = _meeting_or_404(base)
    path = pipeline.find_source_media(safe_base)
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source media not found")
    return FileResponse(path, media_type=None)


@app.get("/api/v1/voice/meetings/{base}/speakers/{speaker}/sample")
def meeting_speaker_sample(
    base: str,
    speaker: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> FileResponse:
    safe_base = _meeting_or_404(base)
    path = pipeline.resolve_speaker_sample(safe_base, speaker)
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sample not found")
    return FileResponse(path, media_type="audio/wav")


class SpeakerAssignRequest(BaseModel):
    assignments: Dict[str, str] = Field(default_factory=dict)
    enroll_new: List[str] = Field(default_factory=list)


@app.post("/api/v1/voice/meetings/{base}/speakers/assign", status_code=status.HTTP_201_CREATED)
def assign_speakers(
    base: str,
    payload: SpeakerAssignRequest,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    safe_base = _meeting_or_404(base)
    assignments = {
        str(k).strip(): str(v).strip()
        for k, v in (payload.assignments or {}).items()
        if str(k).strip() and str(v).strip()
    }
    # --speaker-map is a ";"/"="-delimited CLI string: such chars in names would corrupt it.
    assignments = {
        k: v for k, v in assignments.items()
        if ";" not in k and "=" not in k and ";" not in v and "=" not in v
    }
    if not assignments:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Empty assignments")

    known_voices = {v["name"] for v in pipeline.list_reference_voices()}
    enroll_new = {str(n).strip() for n in (payload.enroll_new or []) if str(n).strip()}
    enroll_items: List[Dict[str, Any]] = []
    for speaker, name in assignments.items():
        if name in known_voices:
            continue  # existing voice: map only, no new enrollment
        if enroll_new and name not in enroll_new:
            continue
        sample = pipeline.resolve_speaker_sample(safe_base, speaker)
        if not sample:
            continue
        enroll_items.append({"speaker": speaker, "name": name, "sample": str(sample)})

    job = store.create_job(
        kind="resume",
        created_by=web_actor(user),
        base_filename=safe_base,
        speaker_map=assignments,
        enroll=enroll_items,
    )
    return _job_view(job)


# ---------------------------------------------------------------------------
# Reference voice library
# ---------------------------------------------------------------------------

@app.get("/api/v1/voice/voices")
def list_voices(
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> Dict[str, Any]:
    return {"items": pipeline.list_reference_voices()}


@app.get("/api/v1/voice/voices/{name}/sample")
def voice_sample(
    name: str,
    file: Optional[str] = Query(None),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_READ)),
) -> FileResponse:
    path = pipeline.resolve_voice_sample(name, file)
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice sample not found")
    return FileResponse(path, media_type="audio/wav")


@app.post("/api/v1/voice/voices", status_code=status.HTTP_201_CREATED)
async def enroll_voice(
    name: str = Form(...),
    file: UploadFile = File(...),
    replace: bool = Form(False),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    safe_name = pipeline.sanitize_base(name)
    if not safe_name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid speaker name")
    sample_name = Path(file.filename or "sample.wav").name
    if Path(sample_name).suffix.lower() not in pipeline.AUDIO_SAMPLE_EXTENSIONS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Audio file required")

    staging_dir = pipeline.vv_root() / "tmp" / "enroll_staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    staging_path = staging_dir / f"{uuid.uuid4().hex[:12]}_{safe_name}{Path(sample_name).suffix.lower()}"
    try:
        with open(staging_path, "wb") as dest:
            shutil.copyfileobj(file.file, dest, length=4 * 1024 * 1024)
    except Exception as exc:
        staging_path.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Upload failed: {exc}")

    job = store.create_job(
        kind="enroll",
        created_by=web_actor(user),
        enroll=[{"name": safe_name, "sample": str(staging_path), "replace": bool(replace)}],
    )
    return _job_view(job)


@app.delete("/api/v1/voice/voices/{name}")
def delete_voice(
    name: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    safe_name = pipeline.sanitize_base(name)
    speaker_dir = pipeline.voices_dir() / safe_name if safe_name else None
    if not speaker_dir or not speaker_dir.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice not found")
    try:
        dest = _move_to_trash(speaker_dir, web_actor(user))
    except OSError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Delete failed: {exc}")
    return {"name": safe_name, "deleted": True, "trashed_to": dest.name}
