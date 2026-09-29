"""Filesystem helpers around the VoiceVideo project tree (``VOICEVIDEO_ROOT``).

The pipeline itself lives outside the monorepo and stays source of truth for:
  - ``output/<base>/``               — transcript JSON, reports (md/html/pdf/docx), clips/
  - ``unassigned_speakers/<base>/``  — WAV samples of unresolved SPEAKER_* voices
  - ``reference_voices/<Name>/``     — enrolled voice samples + cached embeddings
  - ``input/`` / ``processed/``      — source media
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import config

logger = logging.getLogger("voice-server")

MEDIA_EXTENSIONS = {
    ".flac", ".m4a", ".mp3", ".wav", ".aac", ".ogg", ".wma",
    ".webm", ".mkv", ".mov", ".avi", ".mp4", ".wmv", ".flv", ".m4v",
}
AUDIO_SAMPLE_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac"}
REPORT_EXTENSIONS = {".md", ".html", ".pdf", ".docx", ".json"}
REPORT_NAME_RE = re.compile(r"_(report|protocol|transcript)\.", re.IGNORECASE)
SPEAKER_LABEL_RE = re.compile(r"^(?:P\d+_)?SPEAKER_(?:\d+|UNKNOWN)$", re.IGNORECASE)
_SAFE_NAME_RE = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def vv_root() -> Path:
    return Path(config.voicevideo_root)


def input_dir() -> Path:
    return vv_root() / "input"


def output_dir() -> Path:
    return vv_root() / "output"


def processed_dir() -> Path:
    return vv_root() / "processed"


def unassigned_dir() -> Path:
    return vv_root() / "unassigned_speakers"


def voices_dir() -> Path:
    return vv_root() / "reference_voices"


def archive_dir() -> Optional[Path]:
    """Warm storage for source media; None when the share is unreachable."""
    raw = getattr(config, "archive_dir", None)
    if raw is None:
        return None
    try:
        return Path(raw) if Path(raw).exists() else None
    except OSError:
        return None


def sanitize_name(name: str) -> str:
    """Strip path-hostile characters; returns '' when nothing usable remains."""
    cleaned = _SAFE_NAME_RE.sub("_", str(name or "")).strip().strip(".")
    return cleaned[:200]


def sanitize_base(value: str) -> str:
    """Sanitize a meeting base name for safe joins (no path separators)."""
    cleaned = _SAFE_NAME_RE.sub("_", str(value or "")).strip().strip(".")
    if not cleaned or cleaned in {".", ".."}:
        return ""
    return cleaned[:300]


def is_supported_media(filename: str) -> bool:
    return Path(filename).suffix.lower() in MEDIA_EXTENSIONS


def _inside(root: Path, candidate: Path) -> Optional[Path]:
    try:
        resolved = candidate.resolve()
        resolved.relative_to(root.resolve())
        return resolved
    except (ValueError, OSError):
        return None


def meeting_dir(base_filename: str) -> Optional[Path]:
    base = sanitize_base(base_filename)
    if not base:
        return None
    return _inside(output_dir(), output_dir() / base)


def transcript_path(base_filename: str) -> Optional[Path]:
    base = sanitize_base(base_filename)
    if not base:
        return None
    candidates = [
        output_dir() / base / f"{base}_transcript.json",
        output_dir() / f"{base}_transcript.json",
    ]
    for candidate in candidates:
        if _inside(output_dir(), candidate) and candidate.exists():
            return candidate
    return None


def load_transcript(base_filename: str) -> Optional[Dict[str, Any]]:
    path = transcript_path(base_filename)
    if not path:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("Cannot read transcript %s: %s", path, exc)
        return None


def load_report_json(base_filename: str) -> Optional[Dict[str, Any]]:
    """Read ``<base>_report.json`` from the meeting dir (or legacy flat layout)."""
    base = sanitize_base(base_filename)
    if not base:
        return None
    name = f"{base}_report.json"
    candidates: List[Path] = []
    mdir = meeting_dir(base)
    if mdir:
        candidates.append(mdir / name)
    candidates.append(output_dir() / name)
    for candidate in candidates:
        resolved = _inside(output_dir(), candidate)
        if not resolved or not resolved.is_file():
            continue
        try:
            return json.loads(resolved.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            logger.warning("Cannot read report %s: %s", resolved, exc)
            return None
    return None


def meeting_topics(base_filename: str) -> List[Dict[str, Any]]:
    """Lightweight topic timeline for the UI: title + start/end seconds."""
    data = load_report_json(base_filename) or {}
    topics = data.get("topics") or []
    items: List[Dict[str, Any]] = []
    for topic in topics:
        if not isinstance(topic, dict):
            continue
        try:
            start = float(topic.get("start_time") or 0)
            end = float(topic.get("end_time") or 0)
        except (TypeError, ValueError):
            continue
        title = str(topic.get("topic_title") or "").strip()
        if not title or end <= 0:
            continue
        items.append({"title": title, "start": max(0.0, start), "end": end})
    items.sort(key=lambda item: item["start"])
    return items


_ASSIGNMENT_LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)]*)\)")
_ASSIGNMENT_SEP_RE = re.compile(r"^[\s:\-]+$")
_ASSIGNMENT_SECTION_RE = re.compile(r"^#{2,3}\s+(.+)")


def meeting_assignments(base_filename: str) -> List[Dict[str, Any]]:
    """Parse the markdown ``action_registry`` table from the report JSON.

    Rows look like ``| 1 | [04:59](clips/clip_01.mp4) | text | Name | deadline |``.
    Sections (``### heading``) become ``section`` field; numbering is continuous.
    """
    data = load_report_json(base_filename) or {}
    registry = data.get("action_registry")
    if not isinstance(registry, str) or "|" not in registry:
        return []
    items: List[Dict[str, Any]] = []
    current_section = ""
    counter = 0
    for line in registry.splitlines():
        stripped = line.strip()
        sec_match = _ASSIGNMENT_SECTION_RE.match(stripped)
        if sec_match:
            current_section = sec_match.group(1).strip()
            continue
        if not (stripped.startswith("|") and stripped.endswith("|")):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if len(cells) < 5:
            continue
        if cells[0] in ("№", "#") or _ASSIGNMENT_SEP_RE.match(cells[0]):
            continue
        _orig_num, time_cell, task, assignee, deadline = cells[:5]
        counter += 1
        link = _ASSIGNMENT_LINK_RE.match(time_cell)
        items.append(
            {
                "num": str(counter),
                "section": current_section,
                "time": link.group(1) if link else time_cell,
                "clip": Path(link.group(2)).name if link else "",
                "task": task,
                "assignee": assignee,
                "deadline": deadline,
            }
        )
    return items


def list_report_files(base_filename: str) -> List[Dict[str, Any]]:
    """Report artifacts in output/<base>/ (md/html/pdf/docx/json/docx protocol)."""
    base = sanitize_base(base_filename)
    mdir = meeting_dir(base)
    files: List[Dict[str, Any]] = []
    roots: List[Path] = []
    if mdir and mdir.exists():
        roots.append(mdir)
    # Legacy flat layout: output/<base>_report.html etc.
    flat = output_dir()
    if flat.exists():
        roots.append(flat)
    seen = set()
    for root in roots:
        try:
            entries = root.iterdir() if root == mdir else root.glob(f"{base}_*")
        except OSError:
            continue
        for entry in entries:
            if not entry.is_file():
                continue
            if root == mdir:
                if not REPORT_NAME_RE.search(entry.name):
                    continue
            elif not REPORT_NAME_RE.search(entry.name):
                continue
            key = str(entry)
            if key in seen:
                continue
            seen.add(key)
            try:
                stat = entry.stat()
            except OSError:
                continue
            files.append(
                {
                    "name": entry.name,
                    "size": stat.st_size,
                    "ext": entry.suffix.lower().lstrip("."),
                    "modified_at": stat.st_mtime,
                    "kind": _report_kind(entry),
                }
            )
    files.sort(key=lambda item: item["name"])
    return files


def _report_kind(path: Path) -> str:
    name = path.name.lower()
    if "transcript" in name:
        return "transcript"
    if "protocol" in name:
        return "protocol"
    return "report"


def resolve_report_file(base_filename: str, name: str) -> Optional[Path]:
    """Resolve a report filename inside the meeting dir; path-traversal safe."""
    base = sanitize_base(base_filename)
    safe_name = Path(str(name or "")).name
    if not base or not safe_name or not REPORT_NAME_RE.search(safe_name):
        return None
    if safe_name.split(".")[-1].lower() not in {e.lstrip(".") for e in REPORT_EXTENSIONS}:
        return None
    candidates = []
    mdir = meeting_dir(base)
    if mdir:
        candidates.append(mdir / safe_name)
    candidates.append(output_dir() / safe_name)
    for candidate in candidates:
        resolved = _inside(output_dir(), candidate)
        if resolved and resolved.exists() and resolved.is_file():
            return resolved
    return None


def resolve_clip_file(base_filename: str, name: str) -> Optional[Path]:
    base = sanitize_base(base_filename)
    safe_name = Path(str(name or "")).name
    if not base or not safe_name:
        return None
    if not safe_name.lower().startswith("clip_"):
        return None
    if Path(safe_name).suffix.lower() not in {".mp4", ".m4a", ".mp3", ".wav"}:
        return None
    mdir = meeting_dir(base)
    if not mdir:
        return None
    resolved = _inside(mdir, mdir / "clips" / safe_name)
    if resolved and resolved.exists() and resolved.is_file():
        return resolved
    return None


def list_clips(base_filename: str) -> List[Dict[str, Any]]:
    mdir = meeting_dir(base_filename)
    clips: List[Dict[str, Any]] = []
    clips_dir = mdir / "clips" if mdir else None
    if not clips_dir or not clips_dir.exists():
        return clips
    try:
        for entry in sorted(clips_dir.iterdir()):
            if not entry.is_file():
                continue
            if entry.suffix.lower() not in {".mp4", ".m4a", ".mp3", ".wav"}:
                continue
            try:
                clips.append({"name": entry.name, "size": entry.stat().st_size})
            except OSError:
                continue
    except OSError:
        pass
    return clips


def speaker_samples_dir(base_filename: str) -> Optional[Path]:
    base = sanitize_base(base_filename)
    if not base:
        return None
    return _inside(unassigned_dir(), unassigned_dir() / base)


def _speaker_sample_in(samples_dir: Optional[Path], label: str) -> Optional[Path]:
    if not samples_dir or not samples_dir.exists():
        return None
    for ext in (".wav", ".mp3", ".m4a"):
        candidate = _inside(samples_dir, samples_dir / f"{label}{ext}")
        if candidate and candidate.exists():
            return candidate
    return None


_SPEAKER_PART_PREFIX_RE = re.compile(r"^P(\d+)_", re.IGNORECASE)


def merged_part_bases(
    base_filename: str,
    transcript: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """Part bases for merged meetings (metadata.merged_from), sanitized."""
    data = transcript if transcript is not None else (load_transcript(base_filename) or {})
    meta = data.get("metadata") or {}
    parts = meta.get("merged_from") or []
    result: List[str] = []
    for part in parts:
        safe = sanitize_base(str(part))
        if safe:
            result.append(safe)
    return result


def resolve_speaker_sample(
    base_filename: str,
    speaker: str,
    transcript: Optional[Dict[str, Any]] = None,
) -> Optional[Path]:
    base = sanitize_base(base_filename)
    safe_speaker = sanitize_base(speaker)
    if not base or not safe_speaker:
        return None
    found = _speaker_sample_in(speaker_samples_dir(base), safe_speaker)
    if found:
        return found
    # Merged meetings keep per-part samples in unassigned_speakers/<part>/.
    # 'P2_SPEAKER_07' is merged_from[1] with the local label 'SPEAKER_07'.
    parts = merged_part_bases(base, transcript)
    if not parts:
        return None
    prefix = _SPEAKER_PART_PREFIX_RE.match(safe_speaker)
    local_label = _SPEAKER_PART_PREFIX_RE.sub("", safe_speaker)
    ordered = list(parts)
    if prefix:
        idx = int(prefix.group(1)) - 1
        if 0 <= idx < len(ordered):
            ordered.insert(0, ordered.pop(idx))
    for part in ordered:
        part_dir = speaker_samples_dir(part)
        for label in (local_label, safe_speaker):
            found = _speaker_sample_in(part_dir, label)
            if found:
                return found
    return None


SOURCE_TTL_DAYS = 7  # источники хранятся локально 7 дней, затем уходят в архив (Фаза 5)


def _source_ttl_days() -> int:
    return int(getattr(config, "source_ttl_days", SOURCE_TTL_DAYS) or SOURCE_TTL_DAYS)


def find_source_media(base_filename: str) -> Optional[Path]:
    """Original media for playback: processed/, warm archive, or input/."""
    base = sanitize_base(base_filename)
    if not base:
        return None
    directories = [processed_dir(), input_dir()]
    arch = archive_dir()
    if arch is not None:
        directories.append(arch / "processed")
    for directory in directories:
        try:
            if not directory.exists():
                continue
        except OSError:
            continue
        for ext in MEDIA_EXTENSIONS:
            candidate = _inside(directory, directory / f"{base}{ext}")
            try:
                if candidate and candidate.exists():
                    return candidate
            except OSError:
                continue
    return None


def source_media_info(base_filename: str) -> Dict[str, Any]:
    """Source availability + expiry for the UI badge («исходник до <дата>»)."""
    path = find_source_media(base_filename)
    if not path:
        return {"has_media": False, "source_expires_at": None}
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return {"has_media": True, "source_expires_at": None}
    expires = datetime.fromtimestamp(mtime, tz=timezone.utc) + timedelta(days=_source_ttl_days())
    return {"has_media": True, "source_expires_at": expires.isoformat()}


def media_parts(base_filename: str) -> List[Dict[str, Any]]:
    """Per-part media info for merged meetings; empty for regular ones.

    Each item: {"base": part base, "offset": seconds in merged timeline,
    "has_media": whether the part file exists in processed/ or input/}.
    """
    data = load_transcript(base_filename) or {}
    meta = data.get("metadata") or {}
    parts = merged_part_bases(base_filename, data)
    if not parts:
        return []
    offsets: Dict[str, float] = {}
    for src in meta.get("source_parts") or []:
        stem = Path(str(src.get("path") or "")).stem
        try:
            offsets[stem] = float(src.get("offset") or 0.0)
        except (TypeError, ValueError):
            pass
    return [
        {
            "base": part,
            "offset": offsets.get(part, 0.0),
            "has_media": bool(find_source_media(part)),
        }
        for part in parts
    ]


def speaker_naming_from_transcript(data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not data:
        return {}
    meta = data.get("metadata") or {}
    naming = data.get("speaker_naming") or meta.get("speaker_naming") or {}
    return naming if isinstance(naming, dict) else {}


def meeting_speakers(base_filename: str) -> Dict[str, Any]:
    """Aggregate speaker state for one meeting from transcript + samples."""
    data = load_transcript(base_filename)
    if not data:
        return {}
    naming = speaker_naming_from_transcript(data)
    details = naming.get("identification_details") or {}
    segments = data.get("segments") or []
    transcript_labels = {
        str(segment.get("speaker") or "").strip() for segment in segments
    } - {""}
    unresolved = set(naming.get("remaining_unresolved_speakers") or [])
    if not unresolved:
        unresolved = {label for label in transcript_labels if SPEAKER_LABEL_RE.match(label)}
    samples_dir = speaker_samples_dir(base_filename)
    # Transcripts produced without speaker labels (or with naming already
    # applied) leave orphan samples on disk — surface them as unresolved so
    # they can still be played and named.
    if not unresolved and not transcript_labels and samples_dir and samples_dir.exists():
        try:
            for entry in samples_dir.iterdir():
                if entry.is_file() and SPEAKER_LABEL_RE.match(entry.stem):
                    unresolved.add(entry.stem)
        except OSError:
            pass
    first_seen: Dict[str, float] = {}
    for segment in data.get("segments") or []:
        label = str(segment.get("speaker") or "")
        if label not in unresolved or label in first_seen:
            continue
        start = segment.get("start", segment.get("start_time"))
        if start is not None:
            try:
                first_seen[label] = float(start)
            except (TypeError, ValueError):
                pass
    speakers: List[Dict[str, Any]] = []
    for label in sorted(unresolved):
        detail = details.get(label) or {}
        speakers.append(
            {
                "speaker": label,
                "suggested_name": detail.get("matched_name"),
                "confidence": detail.get("confidence"),
                "distance": detail.get("distance"),
                "has_sample": bool(resolve_speaker_sample(base_filename, label, data)),
                "first_segment_start": first_seen.get(label),
            }
        )
    resolved: List[Dict[str, Any]] = []
    seen_names = set()
    for segment in data.get("segments") or []:
        label = str(segment.get("speaker") or "").strip()
        if not label or SPEAKER_LABEL_RE.match(label) or label in seen_names:
            continue
        seen_names.add(label)
        start = segment.get("start", segment.get("start_time"))
        try:
            start_val = float(start) if start is not None else None
        except (TypeError, ValueError):
            start_val = None
        resolved.append({"name": label, "first_segment_start": start_val})
    hint = (naming or {}).get("speaker_map_hint") or ""
    samples = speaker_samples_dir(base_filename)
    if not hint and samples and (samples / "speaker_map_hint.txt").exists():
        try:
            hint = (samples / "speaker_map_hint.txt").read_text(encoding="utf-8").strip()
            hint = hint.replace("--speaker-map", "").strip().strip('"')
        except OSError:
            hint = ""
    return {
        "unresolved": speakers,
        "resolved": sorted(resolved, key=lambda item: item["name"]),
        "speaker_map_hint": hint,
        "segments_count": len(data.get("segments") or []),
    }


def _meeting_candidates(
    q: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Cheap scan: base name + mtime for every dir/flat transcript in output/."""
    root = output_dir()
    if not root.exists():
        return []
    needle = str(q or "").strip().lower()
    candidates: List[Dict[str, Any]] = []
    seen: set = set()
    try:
        entries = sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        return []
    for entry in entries:
        try:
            if entry.is_dir():
                base = entry.name
                if base in seen or not transcript_path(base):
                    continue
                seen.add(base)
                candidates.append({"base_filename": base, "modified_at": entry.stat().st_mtime})
            elif entry.is_file() and entry.name.endswith("_transcript.json"):
                base = entry.name[: -len("_transcript.json")]
                if base in seen:
                    continue
                seen.add(base)
                candidates.append(
                    {
                        "base_filename": base,
                        "modified_at": entry.stat().st_mtime,
                        "legacy_flat": True,
                    }
                )
        except OSError:
            continue
    if needle:
        candidates = [c for c in candidates if needle in c["base_filename"].lower()]
    return candidates


_WEB_META_NAME = "web_meta.json"


def meeting_web_meta(base_filename: str) -> Dict[str, Any]:
    """Web-side metadata sidecar (tags/project) stored inside the meeting dir."""
    mdir = meeting_dir(base_filename)
    if not mdir:
        return {}
    path = _inside(mdir, mdir / _WEB_META_NAME)
    if not path or not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("Cannot read %s: %s", path, exc)
        return {}
    return data if isinstance(data, dict) else {}


def save_meeting_web_meta(
    base_filename: str, *, tags: List[str], project: str
) -> Optional[Dict[str, Any]]:
    mdir = meeting_dir(base_filename)
    if not mdir or not mdir.exists():
        return None
    clean_tags = sorted({
        str(t or "").strip()[:64] for t in (tags or []) if str(t or "").strip()
    })[:20]
    meta = {
        "tags": clean_tags,
        "project": str(project or "").strip()[:120],
        "updated_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    target = mdir / _WEB_META_NAME
    tmp = mdir / f"{_WEB_META_NAME}.tmp"
    try:
        tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(target)
    except OSError as exc:
        logger.warning("Cannot write %s: %s", target, exc)
        tmp.unlink(missing_ok=True)
        return None
    return meta


def _meta_matches(candidate: Dict[str, Any], tag: str, project: str) -> bool:
    if not tag and not project:
        return True
    meta = meeting_web_meta(candidate["base_filename"])
    if tag:
        tags = {str(t).lower() for t in (meta.get("tags") or [])}
        if tag.lower() not in tags:
            return False
    if project and str(meta.get("project") or "").lower() != project.lower():
        return False
    return True


def _meeting_summary(candidate: Dict[str, Any]) -> Dict[str, Any]:
    base = candidate["base_filename"]
    speakers_info = meeting_speakers(base)
    meta = candidate["web_meta"] if "web_meta" in candidate else meeting_web_meta(base)
    return {
        "base_filename": base,
        "reports": list_report_files(base),
        "unresolved_speakers": speakers_info.get("unresolved") or [],
        "unresolved_count": len(speakers_info.get("unresolved") or []),
        "speaker_names": [s["name"] for s in (speakers_info.get("resolved") or [])],
        "segments_count": speakers_info.get("segments_count") or 0,
        "modified_at": candidate.get("modified_at") or 0,
        "tags": meta.get("tags") or [],
        "project": meta.get("project") or "",
        **({"legacy_flat": True} if candidate.get("legacy_flat") else {}),
    }


def list_meetings(
    q: Optional[str] = None,
    limit: Optional[int] = None,
    offset: int = 0,
    unresolved_only: bool = False,
    order: str = "desc",
    tag: Optional[str] = None,
    project: Optional[str] = None,
    participant: Optional[str] = None,
    date_from: Optional[float] = None,
    date_to: Optional[float] = None,
) -> Dict[str, Any]:
    """Paged meetings: dirs in output/ with a transcript, newest first."""
    candidates = _meeting_candidates(q)
    if date_from is not None or date_to is not None:
        candidates = [
            c for c in candidates
            if (date_from is None or (c.get("modified_at") or 0) >= date_from)
            and (date_to is None or (c.get("modified_at") or 0) <= date_to)
        ]
    tag = str(tag or "").strip()
    project = str(project or "").strip()
    participant = str(participant or "").strip().lower()
    if tag or project:
        candidates = [c for c in candidates if _meta_matches(c, tag, project)]
    if order == "asc":
        candidates = sorted(candidates, key=lambda c: c.get("modified_at") or 0)
    if unresolved_only or participant:
        # Needs the transcript parse per candidate — fine at current scale.
        items = []
        for c in candidates:
            s = _meeting_summary(c)
            if unresolved_only and not s["unresolved_count"]:
                continue
            if participant and not any(
                participant in str(n).lower() for n in s["speaker_names"]
            ) and not any(
                participant in str(sp.get("speaker") or "").lower()
                for sp in s["unresolved_speakers"]
            ):
                continue
            items.append(s)
        total = len(items)
        return {"items": items[offset : (offset + limit) if limit else None], "total": total}
    page = candidates[max(offset, 0) : (offset + limit) if limit else None]
    return {
        "items": [_meeting_summary(c) for c in page],
        "total": len(candidates),
    }


def list_reference_voices() -> List[Dict[str, Any]]:
    voices: List[Dict[str, Any]] = []
    root = voices_dir()
    if not root.exists():
        return voices
    try:
        entries = sorted(root.iterdir(), key=lambda p: p.name.lower())
    except OSError:
        return voices
    for entry in entries:
        if not entry.is_dir():
            continue
        samples: List[str] = []
        has_embedding = False
        try:
            for child in entry.iterdir():
                if child.is_file() and child.suffix.lower() in AUDIO_SAMPLE_EXTENSIONS:
                    samples.append(child.name)
                elif child.is_file() and child.name.endswith("_embedding.pkl"):
                    has_embedding = True
        except OSError:
            continue
        voices.append(
            {
                "name": entry.name,
                "samples": sorted(samples),
                "samples_count": len(samples),
                "has_embedding": has_embedding,
            }
        )
    return voices


def resolve_voice_sample(name: str, sample: Optional[str] = None) -> Optional[Path]:
    safe_name = sanitize_base(name)
    if not safe_name:
        return None
    speaker_dir = _inside(voices_dir(), voices_dir() / safe_name)
    if not speaker_dir or not speaker_dir.exists():
        return None
    if sample:
        safe_sample = Path(str(sample)).name
        candidate = _inside(speaker_dir, speaker_dir / safe_sample)
        if candidate and candidate.exists() and candidate.suffix.lower() in AUDIO_SAMPLE_EXTENSIONS:
            return candidate
        return None
    try:
        for child in sorted(speaker_dir.iterdir()):
            if child.is_file() and child.suffix.lower() in AUDIO_SAMPLE_EXTENSIONS:
                return _inside(speaker_dir, child)
    except OSError:
        return None
    return None


def voice_exists(name: str) -> bool:
    safe_name = sanitize_base(name)
    if not safe_name:
        return False
    speaker_dir = _inside(voices_dir(), voices_dir() / safe_name)
    return bool(speaker_dir and speaker_dir.exists())


# ---- Options for the upload form (mirrors VoiceVideo config.py constants) ----

STT_ENGINES = {
    "whisper": "Локальный WhisperX (GPU)",
    "gemini": "Gemini API (OpenRouter, ~$0.18/ч)",
    "grok": "Grok STT API (OpenRouter, ~$0.10/ч)",
    "mai": "MAI Transcribe API (OpenRouter, ~$0.10/ч)",
}
WHISPER_MODELS = [
    "tiny", "base", "small", "medium", "large", "large-v2", "large-v3",
    "bzikst/faster-whisper-large-v3-ru-podlodka",
]
SEPARATOR_ENGINES = {
    "kim": "Kim Vocal 2 (быстрый)",
    "melband": "MelBand Roformer (тяжёлый, точный)",
    "viperx": "BS-Roformer Viperx",
    "demucs": "Demucs classic",
    "none": "Без сепарации",
}
LANGUAGES = {
    "ru": "Русский", "en": "English", "de": "Deutsch", "fr": "Français",
    "es": "Español", "it": "Italiano", "pt": "Português", "pl": "Polski",
    "tr": "Türkçe", "uk": "Українська", "zh": "中文", "ja": "日本語",
    "ko": "한국어", "ar": "العربية",
}


# OpenRouter model ids offered in the upload form. Model ids are not secrets;
# defaults from voice_video/.env are merged in at runtime.
LLM_MODELS = [
    {"value": "openai/gpt-6-luna-pro", "label": "GPT-6 Luna Pro — максимальное качество"},
    {"value": "xiaomi/mimo-v2.6-pro", "label": "MiMo v2.6 Pro — баланс цена/качество"},
    {"value": "xiaomi/mimo-v2.6-pro-ultraspeed", "label": "MiMo v2.6 Pro Ultraspeed — самый быстрый"},
    {"value": "google/gemini-3.8-flash", "label": "Gemini 3.8 Flash — быстрый, новый"},
    {"value": "google/gemini-3.8-pro", "label": "Gemini 3.8 Pro — качественный"},
]


def llm_defaults() -> Dict[str, str]:
    """Current LLM model defaults from voice_video/.env (model ids only, no secrets)."""
    result: Dict[str, str] = {}
    env_path = vv_root() / ".env"
    wanted = {"DEFAULT_LLM_MODEL", "SEGMENTATION_MODEL", "TOPIC_ANALYSIS_MODEL", "JEV_MODEL"}
    try:
        for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key in wanted:
                result[key] = value.strip().strip('"').strip("'")
    except OSError:
        pass
    return result


def llm_model_options() -> List[Dict[str, str]]:
    """Dropdown options for LLM pickers; current .env defaults always included."""
    items = list(LLM_MODELS)
    known = {m["value"] for m in items}
    for value in llm_defaults().values():
        if value and value not in known:
            items.append({"value": value, "label": f"{value} (текущая)"})
            known.add(value)
    return items


def processing_options() -> Dict[str, Any]:
    return {
        "stt_engines": [{"value": k, "label": v} for k, v in STT_ENGINES.items()],
        "whisper_models": WHISPER_MODELS,
        "separator_engines": [{"value": k, "label": v} for k, v in SEPARATOR_ENGINES.items()],
        "languages": [{"value": k, "label": v} for k, v in LANGUAGES.items()],
        "supported_formats": sorted(MEDIA_EXTENSIONS),
        "upload_max_bytes": config.upload_max_bytes,
        "llm_defaults": llm_defaults(),
        "llm_models": llm_model_options(),
    }
