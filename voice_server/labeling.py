"""Diarization labeling: auto draft by pyannote, corrected by a person in the web editor.

Flow: upload media -> ``label`` job (``voice_video/label_draft.py``: raw-audio
diarization, optional STT text) -> draft lands in ``voice.label_projects`` ->
the editor saves corrected segments + speaker -> employee mapping (optimistic
lock on ``version``) -> RTTM export for DER evaluation of diarization variants.
"""
from __future__ import annotations

import json
import logging
import math
import re
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field

from .auth import PERM_MANAGE, require_web_permission, web_actor
from .config import config
from . import label_store, pipeline, store

logger = logging.getLogger("voice-server")

router = APIRouter(prefix="/api/v1/voice/labeling", tags=["voice-labeling"])

PROJECT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
SPEAKER_LABEL_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_SEGMENTS = 20000
MAX_SPEAKERS = 64
MAX_TEXT_LEN = 4000
MAX_NAME_LEN = 256
MAX_SPEAKERS_SETTING = 20
# Browser-playable sources; anything else is played from the draft's mp3.
BROWSER_VIDEO_EXTENSIONS = {".mp4", ".webm", ".m4v", ".mov"}
DRAFT_FILE = "draft.json"


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested)
# ---------------------------------------------------------------------------

def labeling_root() -> Path:
    return pipeline.vv_root() / "labeling"


def project_dir(project_id: str) -> Optional[Path]:
    if not PROJECT_ID_RE.match(str(project_id or "")):
        return None
    return pipeline._inside(labeling_root(), labeling_root() / project_id)


def normalize_settings(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Whitelist + clamp label-job settings coming from the upload form."""
    raw = raw if isinstance(raw, dict) else {}

    def _int(key: str, lo: int, hi: int) -> int:
        try:
            value = int(raw.get(key) or 0)
        except (TypeError, ValueError):
            value = 0
        return min(hi, max(lo, value)) if value else 0

    settings: Dict[str, Any] = {
        "num_speakers": _int("num_speakers", 1, MAX_SPEAKERS_SETTING),
        "min_speakers": _int("min_speakers", 1, MAX_SPEAKERS_SETTING),
        "max_speakers": _int("max_speakers", 1, MAX_SPEAKERS_SETTING),
        "with_text": bool(raw.get("with_text", True)),
    }
    if settings["min_speakers"] and settings["max_speakers"] and settings["min_speakers"] > settings["max_speakers"]:
        settings["min_speakers"], settings["max_speakers"] = settings["max_speakers"], settings["min_speakers"]
    stt_engine = str(raw.get("stt_engine") or "").strip()
    if stt_engine in pipeline.STT_ENGINES:
        settings["stt_engine"] = stt_engine
    separator = str(raw.get("separator") or "").strip()
    if separator in pipeline.SEPARATOR_ENGINES:
        settings["separator"] = separator
    language = str(raw.get("language") or "").strip()
    if language in pipeline.LANGUAGES:
        settings["language"] = language
    return settings


def _finite(value: Any, field: str, idx: int) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"segment {idx}: {field} is not a number")
    if not math.isfinite(number):
        raise ValueError(f"segment {idx}: {field} is not finite")
    return number


def validate_segments(
    segments: Any, duration: Optional[float] = None
) -> List[Dict[str, Any]]:
    """Validate editor segments; returns a clean list sorted by start time."""
    if not isinstance(segments, list):
        raise ValueError("segments must be a list")
    if len(segments) > MAX_SEGMENTS:
        raise ValueError(f"too many segments (>{MAX_SEGMENTS})")
    limit = (float(duration) + 5.0) if duration else None
    clean: List[Dict[str, Any]] = []
    seen_ids = set()
    for idx, seg in enumerate(segments):
        if not isinstance(seg, dict):
            raise ValueError(f"segment {idx}: not an object")
        start = _finite(seg.get("start"), "start", idx)
        end = _finite(seg.get("end"), "end", idx)
        if start < 0 or end <= start:
            raise ValueError(f"segment {idx}: invalid bounds {start}..{end}")
        if limit is not None and end > limit:
            raise ValueError(f"segment {idx}: end {end} beyond media duration")
        speaker = str(seg.get("speaker") or "").strip()
        if not SPEAKER_LABEL_RE.match(speaker):
            raise ValueError(f"segment {idx}: invalid speaker label")
        seg_id = str(seg.get("id") or "").strip()[:32] or f"s{idx + 1}"
        if seg_id in seen_ids:
            seg_id = f"{seg_id}_{idx}"
        seen_ids.add(seg_id)
        clean.append(
            {
                "id": seg_id,
                "start": round(start, 3),
                "end": round(end, 3),
                "speaker": speaker,
                "text": str(seg.get("text") or "")[:MAX_TEXT_LEN],
            }
        )
    clean.sort(key=lambda s: (s["start"], s["end"]))
    return clean


def validate_speakers(speakers: Any) -> Dict[str, Dict[str, Any]]:
    """{label: {name, user_id}} -> cleaned mapping; empty names are dropped."""
    if speakers is None:
        return {}
    if not isinstance(speakers, dict):
        raise ValueError("speakers must be an object")
    if len(speakers) > MAX_SPEAKERS:
        raise ValueError(f"too many speakers (>{MAX_SPEAKERS})")
    clean: Dict[str, Dict[str, Any]] = {}
    for label, info in speakers.items():
        label = str(label or "").strip()
        if not SPEAKER_LABEL_RE.match(label):
            raise ValueError(f"invalid speaker label: {label!r}")
        info = info if isinstance(info, dict) else {"name": info}
        name = str(info.get("name") or "").strip()[:MAX_NAME_LEN]
        if not name:
            continue
        user_id = info.get("user_id")
        try:
            user_id = int(user_id) if user_id not in (None, "") else None
        except (TypeError, ValueError):
            user_id = None
        clean[label] = {"name": name, "user_id": user_id}
    return clean


def _rttm_token(value: str) -> str:
    token = re.sub(r"\s+", "_", str(value or "").strip())
    return token or "UNKNOWN"


def segments_to_rttm(
    file_id: str,
    segments: List[Dict[str, Any]],
    speakers: Optional[Dict[str, Dict[str, Any]]] = None,
    *,
    use_names: bool = False,
) -> str:
    """NIST RTTM (``SPEAKER <file> 1 <onset> <dur> <NA> <NA> <who> <NA> <NA>``)."""
    speakers = speakers or {}
    file_token = _rttm_token(file_id)
    lines = []
    for seg in sorted(segments or [], key=lambda s: float(s.get("start") or 0)):
        start = float(seg.get("start") or 0)
        dur = float(seg.get("end") or 0) - start
        if dur <= 0:
            continue
        label = str(seg.get("speaker") or "UNKNOWN")
        who = label
        if use_names and (speakers.get(label) or {}).get("name"):
            who = speakers[label]["name"]
        lines.append(
            f"SPEAKER {file_token} 1 {start:.3f} {dur:.3f} <NA> <NA> {_rttm_token(who)} <NA> <NA>"
        )
    return "\n".join(lines) + ("\n" if lines else "")


def load_draft(out_dir: Path) -> Dict[str, Any]:
    """Read ``draft.json`` written by ``label_draft.py``; validates segments."""
    path = out_dir / DRAFT_FILE
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("draft.json: object expected")
    duration = data.get("duration")
    duration = float(duration) if isinstance(duration, (int, float)) and duration > 0 else None
    segments = validate_segments(data.get("segments") or [], duration)
    audio_name = Path(str(data.get("audio") or "")).name
    audio_path = None
    if audio_name:
        candidate = pipeline._inside(out_dir, out_dir / audio_name)
        if candidate and candidate.exists():
            audio_path = str(candidate)
    return {"segments": segments, "duration": duration, "audio_path": audio_path}


def playback_source(project: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """What the editor plays: original video if the browser can, else draft mp3."""
    pdir = project_dir(str(project.get("id") or ""))
    if not pdir:
        return None
    media = Path(str(project.get("media_path") or ""))
    if media.name and media.suffix.lower() in BROWSER_VIDEO_EXTENSIONS:
        safe = pipeline._inside(pdir, media)
        if safe and safe.exists():
            return {"kind": "video", "path": safe}
    audio = Path(str(project.get("audio_path") or ""))
    if audio.name:
        safe = pipeline._inside(pdir, audio)
        if safe and safe.exists():
            return {"kind": "audio", "path": safe}
    if media.name:
        safe = pipeline._inside(pdir, media)
        if safe and safe.exists():
            return {"kind": "audio", "path": safe}
    return None


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def _project_or_404(project_id: str) -> Dict[str, Any]:
    if not PROJECT_ID_RE.match(str(project_id or "")):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    project = label_store.get_project(project_id)
    if not project:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return project


def _job_brief(job_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not job_id:
        return None
    job = store.get_job(str(job_id))
    if not job:
        return None
    return {
        "id": job.get("id"),
        "status": job.get("status"),
        "stage": job.get("stage"),
        "progress": job.get("progress") or 0,
        "error": job.get("error"),
    }


def _effective_status(project: Dict[str, Any], job: Optional[Dict[str, Any]]) -> str:
    """A job cancelled in the queue (or crashed) never reaches the runner: show it as failed."""
    st = str(project.get("status") or "")
    if st in ("queued", "processing") and job and job.get("status") in ("failed", "cancelled"):
        return "failed"
    return st


def _project_view(project: Dict[str, Any], *, full: bool) -> Dict[str, Any]:
    view = {
        key: project.get(key)
        for key in (
            "id", "title", "original_filename", "duration", "status", "error",
            "version", "created_by", "updated_by", "created_at", "updated_at", "edited_at",
        )
    }
    view["settings"] = project.get("settings") or {}
    view["speakers"] = project.get("speakers") or {}
    view["job"] = _job_brief(project.get("job_id"))
    view["status"] = _effective_status(project, view["job"])
    if view["status"] == "failed" and not view.get("error") and view["job"]:
        view["error"] = view["job"].get("error") or "Построение черновика отменено"
    if full:
        segments = project.get("segments") or []
        view["segments"] = segments
        view["auto_segments_count"] = len(project.get("auto_segments") or [])
        source = playback_source(project) if project.get("status") == "ready" else None
        view["media_kind"] = source["kind"] if source else None
    return view


def _enqueue_label_job(project: Dict[str, Any], actor: str) -> Dict[str, Any]:
    job = store.create_job(
        kind="label",
        created_by=actor,
        original_filename=project.get("original_filename"),
        stored_path=str(project.get("media_path") or ""),
        settings={**(project.get("settings") or {}), "label_project_id": project["id"]},
    )
    label_store.set_job(project["id"], str(job["id"]))
    return job


@router.get("/projects")
def list_projects(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    items = label_store.list_projects(limit=limit, offset=offset)
    return {"items": [_project_view(p, full=False) for p in items]}


@router.post("/projects", status_code=status.HTTP_201_CREATED)
async def create_project(
    file: UploadFile = File(...),
    title: str = Form(""),
    settings_json: Optional[str] = Form(None),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    original_name = Path(file.filename or "upload").name
    if not pipeline.is_supported_media(original_name):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Unsupported format: {Path(original_name).suffix}",
        )
    try:
        raw_settings = json.loads(settings_json) if settings_json else {}
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid settings JSON")
    settings = normalize_settings(raw_settings)

    project_id = uuid.uuid4().hex[:12]
    pdir = project_dir(project_id)
    if not pdir:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Labeling dir unavailable")
    pdir.mkdir(parents=True, exist_ok=True)
    # Unique stem: the worker cleans temp/<stem>* after the run.
    media_path = pdir / f"label_{project_id}{Path(original_name).suffix.lower()}"

    size = 0
    try:
        with open(media_path, "wb") as dest:
            while True:
                chunk = await file.read(4 * 1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > config.upload_max_bytes:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"File exceeds {config.upload_max_bytes // (1024 * 1024)} MB limit",
                    )
                dest.write(chunk)
    except HTTPException:
        shutil.rmtree(pdir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(pdir, ignore_errors=True)
        logger.exception("Labeling upload failed")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Upload failed: {exc}")

    actor = web_actor(user)
    project = label_store.create_project(
        project_id=project_id,
        title=(str(title or "").strip() or Path(original_name).stem)[:512],
        created_by=actor,
        original_filename=original_name,
        media_path=str(media_path),
        settings=settings,
    )
    _enqueue_label_job(project, actor)
    return _project_view(label_store.get_project(project_id) or project, full=False)


@router.get("/projects/{project_id}")
def get_project(
    project_id: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    return _project_view(_project_or_404(project_id), full=True)


class LabelingSavePayload(BaseModel):
    version: int = Field(..., ge=0)
    segments: List[Dict[str, Any]] = Field(default_factory=list)
    speakers: Dict[str, Any] = Field(default_factory=dict)
    title: Optional[str] = Field(None, max_length=512)


@router.put("/projects/{project_id}")
def save_project(
    project_id: str,
    payload: LabelingSavePayload,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    project = _project_or_404(project_id)
    if project.get("status") != "ready":
        raise HTTPException(status.HTTP_409_CONFLICT, "Черновик разметки ещё не готов")
    try:
        segments = validate_segments(payload.segments, project.get("duration"))
        speakers = validate_speakers(payload.speakers)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    saved = label_store.save_labeling(
        project_id,
        expected_version=payload.version,
        segments=segments,
        speakers=speakers,
        title=(payload.title or "").strip() or None,
        updated_by=web_actor(user),
    )
    if saved is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Разметку уже изменили (другая вкладка или пользователь) — перезагрузите её",
        )
    return _project_view(saved, full=True)


@router.post("/projects/{project_id}/retry", status_code=status.HTTP_201_CREATED)
def retry_project(
    project_id: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    project = _project_or_404(project_id)
    job = _job_brief(project.get("job_id"))
    if job and job.get("status") in store.ACTIVE_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Черновик уже строится")
    if _effective_status(project, job) != "failed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Повтор доступен только после ошибки")
    media = Path(str(project.get("media_path") or ""))
    if not media.name or not media.exists():
        raise HTTPException(status.HTTP_409_CONFLICT, "Исходный файл удалён — загрузите заново")
    _enqueue_label_job(project, web_actor(user))
    return _project_view(label_store.get_project(project_id) or project, full=False)


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> Dict[str, Any]:
    project = _project_or_404(project_id)
    job = _job_brief(project.get("job_id"))
    if job and job.get("status") in store.ACTIVE_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Сначала отмените построение черновика")
    pdir = project_dir(project_id)
    if pdir and pdir.exists():
        from .app import _move_to_trash  # lazy: app imports this module

        try:
            _move_to_trash(pdir, web_actor(user))
        except OSError as exc:
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Delete failed: {exc}")
    label_store.delete_project(project_id)
    return {"id": project_id, "deleted": True}


@router.get("/projects/{project_id}/media")
def project_media(
    project_id: str,
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> FileResponse:
    source = playback_source(_project_or_404(project_id))
    if not source:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Media not found")
    return FileResponse(source["path"], media_type=None)


@router.get("/projects/{project_id}/rttm")
def project_rttm(
    project_id: str,
    names: bool = Query(False),
    source: str = Query("edited", pattern="^(edited|auto)$"),
    user: Dict[str, Any] = Depends(require_web_permission(PERM_MANAGE)),
) -> PlainTextResponse:
    project = _project_or_404(project_id)
    segments = project.get("auto_segments") if source == "auto" else project.get("segments")
    body = segments_to_rttm(
        project_id, segments or [], project.get("speakers") or {}, use_names=names
    )
    suffix = "_auto" if source == "auto" else ""
    return PlainTextResponse(
        body,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="label_{project_id}{suffix}.rttm"'},
    )
