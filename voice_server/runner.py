"""Runs VoiceVideo pipeline jobs as subprocesses of ``run.py``.

The pipeline lives in ``config.voicevideo_root`` (moved into the monorepo as
``voice_video/``). Each job is a separate OS process: a crash in torch/ffmpeg
never takes the API or worker down, and GPU memory is fully released on exit.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import config
from .notify import notify_protocol_ready
from . import label_store, labeling, pipeline, store

logger = logging.getLogger("voice-worker")

RUN_PY = "run.py"
LABEL_DRAFT_PY = "label_draft.py"

# run.py logs stage markers to stdout; map them to (stage key, progress %).
_STAGE_MARKERS = [
    (re.compile(r"Этап 1[: ]|Извлечение и обработка аудио"), ("audio", 10)),
    (re.compile(r"Этап 2[: ]|Транскрипция"), ("stt", 30)),
    (re.compile(r"Этап 3[:.]|диаризаци", re.IGNORECASE), ("diarization", 55)),
    (re.compile(r"Этап 3\.5|Идентификация и уточнение"), ("speakers", 65)),
    (re.compile(r"Этап 4-5|Сегментация"), ("analysis", 75)),
    (re.compile(r"Этап 6[: ]|Базовый анализ"), ("analysis", 85)),
    (re.compile(r"Этап 7[: ]|инсайт", re.IGNORECASE), ("insights", 90)),
    (re.compile(r"Этап 8[: ]|Генерация отчетов"), ("reports", 95)),
    (re.compile(r"Обработка завершена|✅"), ("done", 100)),
]

# Flag -> settings key -> render rule for run.py CLI of a "process" job.
_BOOL_FLAGS = [
    ("enable_diarization", "--no-diarization", True),
    ("enable_alignment", "--no-alignment", True),
    ("enable_ai_analysis", "--no-ai-analysis", True),
    ("enable_speaker_identification", "--no-speaker-identification", True),
    ("fresh", "--fresh", False),
]


def build_process_argv(stored_path: str, settings: Dict[str, Any]) -> List[str]:
    argv = [config.voicevideo_python, RUN_PY, stored_path]
    s = settings or {}

    if s.get("whisper_model"):
        argv += ["--model", str(s["whisper_model"])]
    if s.get("language"):
        argv += ["--language", str(s["language"])]
    if s.get("stt_engine") and s["stt_engine"] != "default":
        argv += ["--stt-engine", str(s["stt_engine"])]
    if s.get("separator") and s["separator"] != "default":
        if s["separator"] == "none":
            argv.append("--no-demucs")
        else:
            argv += ["--separator", str(s["separator"])]
    num_speakers = int(s.get("num_speakers") or 0)
    if num_speakers > 0:
        argv += ["--num-speakers", str(num_speakers)]
    else:
        for key, flag in (("min_speakers", "--min-speakers"), ("max_speakers", "--max-speakers")):
            try:
                value = int(s.get(key) or 0)
            except (TypeError, ValueError):
                value = 0
            if 0 < value <= 20:
                argv += [flag, str(value)]
    if s.get("custom_vocabulary"):
        argv += ["--custom-vocabulary", str(s["custom_vocabulary"])]
    if s.get("chunk_duration"):
        argv += ["--chunk-duration", str(int(s["chunk_duration"]))]
    if s.get("batch_size"):
        argv += ["--batch-size", str(int(s["batch_size"]))]
    if s.get("meeting_date"):
        argv += ["--meeting-date", str(s["meeting_date"])]
    for key, flag, positive in _BOOL_FLAGS:
        value = bool(s.get(key, positive))
        if value != positive:
            argv.append(flag)
    # A web job must never block on stdin prompts for unknown speakers.
    argv.append("--no-manual-speakers")
    argv += ["--log-level", "INFO"]
    return argv


def build_resume_argv(base_filename: str, speaker_map: Dict[str, str]) -> List[str]:
    mapped = ";".join(
        f"{key}={value}" for key, value in sorted(speaker_map.items()) if key and value
    )
    argv = [
        config.voicevideo_python, RUN_PY,
        "--resume-speakers", base_filename,
        "--no-manual-speakers",
        "--log-level", "INFO",
    ]
    if mapped:
        argv += ["--speaker-map", mapped]
    return argv


def build_enroll_argv(sample_path: str, speaker_name: str) -> List[str]:
    return [
        config.voicevideo_python, RUN_PY,
        "--enroll-voice", sample_path,
        "--speaker-name", speaker_name,
        "--log-level", "INFO",
    ]


def build_label_argv(
    stored_path: str,
    out_dir: str,
    settings: Dict[str, Any],
    *,
    mode: str = "draft",
    samples_spec: Optional[str] = None,
) -> List[str]:
    """label_draft.py: draft (no LLM, optional STT text) / variant / voice samples."""
    raw = settings or {}
    s = labeling.normalize_settings(raw)
    argv = [config.voicevideo_python, LABEL_DRAFT_PY, stored_path, "--out", out_dir]
    if mode == "variant":
        name = str(raw.get("variant_name") or "")
        if not labeling.VARIANT_NAME_RE.match(name):
            raise ValueError(f"invalid variant name: {name!r}")
        audio = "processed" if raw.get("audio") == "processed" else "raw"
        argv += ["--mode", "variant", "--variant-name", name, "--audio", audio]
        if raw.get("exclusive"):
            argv.append("--exclusive")
        if audio == "processed" and s.get("separator"):
            argv += ["--separator", str(s["separator"])]
        s["with_text"] = False
    elif mode in ("samples", "calibrate"):
        argv += ["--mode", mode, "--audio", "processed", "--samples-spec", str(samples_spec)]
        if s.get("separator"):
            argv += ["--separator", str(s["separator"])]
        argv += ["--log-level", "INFO"]
        return argv
    for key, flag in (
        ("num_speakers", "--num-speakers"),
        ("min_speakers", "--min-speakers"),
        ("max_speakers", "--max-speakers"),
    ):
        if s.get(key):
            argv += [flag, str(int(s[key]))]
    if s.get("with_text"):
        argv.append("--with-text")
        if s.get("stt_engine"):
            argv += ["--stt-engine", str(s["stt_engine"])]
        if s.get("separator"):
            argv += ["--separator", str(s["separator"])]
    if s.get("language"):
        argv += ["--language", str(s["language"])]
    argv += ["--log-level", "INFO"]
    return argv


_LLM_ENV_KEYS = {
    "llm_model": ("DEFAULT_LLM_MODEL", "OPENAI_MODEL", "SEGMENTATION_MODEL", "TOPIC_ANALYSIS_MODEL"),
    "segmentation_model": ("SEGMENTATION_MODEL",),
    "topic_model": ("TOPIC_ANALYSIS_MODEL",),
    "jev_model": ("JEV_MODEL",),
}
_ENV_VALUE_RE = re.compile(r"[^\w./:+-]")


def _llm_env_overrides(settings: Dict[str, Any]) -> Dict[str, str]:
    """Map user-picked LLM model names to the env vars run.py reads at import."""
    env: Dict[str, str] = {}
    for key, targets in _LLM_ENV_KEYS.items():
        value = _ENV_VALUE_RE.sub("", str((settings or {}).get(key) or "").strip())[:200]
        if not value:
            continue
        for target in targets:
            env[target] = value
    return env


def _kill_process_tree(proc: subprocess.Popen) -> None:
    try:
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30,
        )
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _run_subprocess(
    job_id: str,
    argv: List[str],
    log_file,
    env_extra: Optional[Dict[str, str]] = None,
) -> int:
    """Spawn run.py, stream output to the job log + DB tail, honor cancel/timeout."""
    env = dict(os.environ)
    env.setdefault("PYTHONUNBUFFERED", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    if env_extra:
        env.update(env_extra)
    proc = subprocess.Popen(
        argv,
        cwd=str(config.voicevideo_root),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    started = time.monotonic()
    while True:
        if proc.stdout is not None:
            line = proc.stdout.readline()
            if line:
                try:
                    log_file.write(line)
                    log_file.flush()
                except Exception:
                    pass
                store.append_log_tail(job_id, line, config.log_tail_lines)
                for marker, (stage, progress) in _STAGE_MARKERS:
                    if marker.search(line):
                        store.update_job(job_id, stage=stage, progress=progress)
                        break

        rc = proc.poll()
        if rc is not None:
            return int(rc)

        if store.is_cancel_requested(job_id):
            logger.info("Job %s: cancel requested -> killing pid %s", job_id, proc.pid)
            _kill_process_tree(proc)
            return -15

        if time.monotonic() - started > config.job_timeout_sec:
            logger.error("Job %s: timeout after %ss -> killing pid %s", job_id, config.job_timeout_sec, proc.pid)
            _kill_process_tree(proc)
            return -9

        if proc.stdout is None:
            time.sleep(0.5)
        else:
            time.sleep(0.05)


def _purge_voice_reference(name: str, log_file) -> None:
    """Remove an existing voice's wav+embedding so enroll replaces it cleanly."""
    safe = pipeline.sanitize_base(name)
    speaker_dir = pipeline.voices_dir() / safe if safe else None
    if not speaker_dir or not speaker_dir.exists():
        return
    for pattern in (f"{safe}.wav", f"{safe}_embedding.pkl"):
        target = speaker_dir / pattern
        try:
            target.unlink(missing_ok=True)
            log_file.write(f"replace: removed {target.name}\n")
        except OSError as exc:
            log_file.write(f"replace: cannot remove {target.name}: {exc}\n")


def _job_log_path(job_id: str) -> Path:
    logs_dir = config.data_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    return logs_dir / f"job_{job_id}.log"


def _cleanup_temp(base: str, log_file) -> None:
    """Drop finished job's temp artifacts: temp/<base>* and temp/sep_out/<base>*."""
    temp_dir = pipeline.vv_root() / "temp"
    removed = 0
    for folder in (temp_dir, temp_dir / "sep_out"):
        try:
            entries = list(folder.iterdir()) if folder.is_dir() else []
        except OSError:
            continue
        for entry in entries:
            if not entry.is_file() or not entry.name.startswith(base):
                continue
            try:
                entry.unlink()
                removed += 1
            except OSError as exc:
                logger.warning("temp cleanup: cannot remove %s: %s", entry.name, exc)
    if removed:
        log_file.write(f"temp cleanup: removed {removed} file(s) for {base}\n")


def run_job(job: Dict[str, Any]) -> None:
    """Execute one claimed job row to completion."""
    job_id = job["id"]
    kind = job.get("kind") or "process"
    log_path = _job_log_path(job_id)
    result: Dict[str, Any] = {"log_file": str(log_path)}

    with open(log_path, "a", encoding="utf-8") as log_file:
        log_file.write(f"\n=== job {job_id} kind={kind} started {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")

        def _finish(status: str, error: Optional[str] = None) -> None:
            store.update_job(
                job_id,
                status=status,
                finished_at=datetime.now(timezone.utc),
                progress=100 if status == "done" else job.get("progress") or 0,
                error=error,
                result=result,
            )

        try:
            if kind == "process":
                stored_path = str(job.get("stored_path") or "")
                if not stored_path or not Path(stored_path).exists():
                    _finish("failed", "Stored file not found")
                    return
                settings = job.get("settings") or {}
                argv = build_process_argv(stored_path, settings)
                log_file.write("$ " + " ".join(argv) + "\n")
                env_extra = _llm_env_overrides(settings)
                if env_extra:
                    log_file.write("env overrides: " + ", ".join(sorted(env_extra)) + "\n")
                rc = _run_subprocess(job_id, argv, log_file, env_extra=env_extra)
                result["returncode"] = rc
                base = pipeline.sanitize_base(job.get("base_filename") or "")
                result["reports"] = pipeline.list_report_files(base) if base else []
                if rc == -15:
                    _finish("cancelled")
                elif rc == -9:
                    _finish("failed", "Job timeout exceeded")
                elif rc != 0:
                    _finish("failed", f"run.py exited with code {rc}")
                else:
                    _finish("done")
                    notify_protocol_ready(job)
                    _cleanup_temp(base, log_file)

            elif kind == "resume":
                base = str(job.get("base_filename") or "")
                # Regeneration renumbers the registry: pin legacy statuses to keys first.
                try:
                    pinned = store.backfill_assignment_keys(base, pipeline.meeting_assignments(base))
                    if pinned:
                        log_file.write(f"assignment statuses pinned to keys: {pinned}\n")
                except Exception as exc:
                    logger.warning("Job %s: assignment key backfill failed: %s", job_id, exc)
                speaker_map = dict(job.get("speaker_map") or {})
                enrollments = list(job.get("enroll") or [])
                enroll_results: List[Dict[str, Any]] = []
                for item in enrollments:
                    name = str(item.get("name") or "").strip()
                    sample = str(item.get("sample") or "").strip()
                    if not name or not sample or not Path(sample).exists():
                        enroll_results.append({"ok": False, "name": name, "error": "no sample"})
                        continue
                    if pipeline.voice_exists(name):
                        enroll_results.append({"ok": True, "name": name, "skipped": "exists"})
                        continue
                    rc = _run_subprocess(job_id, build_enroll_argv(sample, name), log_file)
                    enroll_results.append({"ok": rc == 0, "name": name, "rc": rc})
                result["enroll"] = enroll_results
                rc = _run_subprocess(job_id, build_resume_argv(base, speaker_map), log_file)
                result["returncode"] = rc
                result["reports"] = pipeline.list_report_files(base)
                if rc == -15:
                    _finish("cancelled")
                elif rc == -9:
                    _finish("failed", "Job timeout exceeded")
                elif rc != 0:
                    _finish("failed", f"run.py exited with code {rc}")
                else:
                    _finish("done")
                    notify_protocol_ready(job)

            elif kind == "enroll":
                enrollments = list(job.get("enroll") or [])
                enroll_results = []
                for item in enrollments:
                    name = str(item.get("name") or "").strip()
                    sample = str(item.get("sample") or "").strip()
                    if not name or not sample or not Path(sample).exists():
                        enroll_results.append({"ok": False, "name": name, "error": "no sample"})
                        continue
                    if item.get("replace"):
                        _purge_voice_reference(name, log_file)
                    rc = _run_subprocess(job_id, build_enroll_argv(sample, name), log_file)
                    enroll_results.append({"ok": rc == 0, "name": name, "rc": rc})
                result["enroll"] = enroll_results
                ok = all(item.get("ok") for item in enroll_results) if enroll_results else False
                _finish("done" if ok else "failed", None if ok else "enroll failed")

            elif kind == "label":
                _run_label_job(job, log_file, result, _finish)

            else:
                _finish("failed", f"Unknown job kind: {kind}")

        except Exception as exc:
            logger.exception("Job %s crashed", job_id)
            _finish("failed", str(exc))


def _run_label_job(job: Dict[str, Any], log_file, result: Dict[str, Any], finish) -> None:
    """Build the automatic diarization draft and hand it to the labeling project."""
    settings = job.get("settings") or {}
    project_id = str(settings.get("label_project_id") or "")
    out_dir = labeling.project_dir(project_id)
    stored_path = str(job.get("stored_path") or "")
    if not out_dir or not stored_path or not Path(stored_path).exists():
        if project_id:
            label_store.set_status(project_id, "failed", "Stored file not found")
        finish("failed", "Stored file not found")
        return

    action = settings.get("action") or labeling.ACTION_DRAFT
    if action == labeling.ACTION_VARIANT:
        _build_label_variant(job, project_id, out_dir, stored_path, settings, log_file, result, finish)
        return
    if action == labeling.ACTION_ENROLL:
        _enroll_label_voices(job, out_dir, stored_path, settings, log_file, result, finish)
        return
    if action == labeling.ACTION_CALIBRATE:
        _calibrate_label_voices(job, project_id, out_dir, stored_path, settings, log_file, result, finish)
        return

    label_store.set_status(project_id, "processing")
    try:
        _build_label_draft(job, project_id, out_dir, stored_path, settings, log_file, result, finish)
    except Exception as exc:
        label_store.set_status(project_id, "failed", str(exc)[:500])
        raise


def _build_label_draft(job, project_id, out_dir, stored_path, settings, log_file, result, finish) -> None:
    job_id = job["id"]
    argv = build_label_argv(stored_path, str(out_dir), settings)
    log_file.write("$ " + " ".join(argv) + "\n")
    rc = _run_subprocess(job_id, argv, log_file)
    result["returncode"] = rc
    _cleanup_temp(Path(stored_path).stem, log_file)

    if rc != 0:
        error = {-15: "Отменено", -9: "Job timeout exceeded"}.get(rc, f"label_draft.py exited with code {rc}")
        label_store.set_status(project_id, "failed", error)
        finish("cancelled" if rc == -15 else "failed", None if rc == -15 else error)
        return
    try:
        draft = labeling.load_draft(out_dir)
    except Exception as exc:
        logger.exception("Job %s: invalid labeling draft", job_id)
        label_store.set_status(project_id, "failed", f"Invalid draft: {exc}")
        finish("failed", f"Invalid draft: {exc}")
        return
    label_store.apply_draft(
        project_id,
        segments=draft["segments"],
        duration=draft["duration"],
        audio_path=draft["audio_path"],
    )
    result["segments"] = len(draft["segments"])
    finish("done")


def _finish_rc(rc: int, finish, what: str) -> bool:
    """Common non-zero exit handling for auxiliary label jobs; True when rc == 0."""
    if rc == 0:
        return True
    if rc == -15:
        finish("cancelled")
    elif rc == -9:
        finish("failed", "Job timeout exceeded")
    else:
        finish("failed", f"{what} exited with code {rc}")
    return False


def _build_label_variant(job, project_id, out_dir, stored_path, settings, log_file, result, finish) -> None:
    """Extra diarization variant (e.g. on separator-cleaned audio) for DER comparison."""
    name = str(settings.get("variant_name") or "")
    argv = build_label_argv(stored_path, str(out_dir), settings, mode="variant")
    log_file.write("$ " + " ".join(argv) + "\n")
    rc = _run_subprocess(job["id"], argv, log_file)
    result["returncode"] = rc
    _cleanup_temp(Path(stored_path).stem, log_file)
    if not _finish_rc(rc, finish, LABEL_DRAFT_PY):
        return
    project = label_store.get_project(project_id) or {}
    try:
        variant = labeling.load_variant(out_dir, name, project.get("duration"))
    except Exception as exc:
        finish("failed", f"Invalid variant: {exc}")
        return
    variant["created_at"] = datetime.now(timezone.utc).isoformat()
    label_store.set_variant(project_id, name, variant)
    result["segments"] = len(variant["segments"])
    finish("done")


def _enroll_label_voices(job, out_dir, stored_path, settings, log_file, result, finish) -> None:
    """Cut voice samples from labeled spans and enroll them into reference_voices."""
    items = [i for i in (settings.get("enroll") or []) if isinstance(i, dict)]
    spec = {
        str(i.get("label")): i.get("spans") or []
        for i in items
        if labeling.SPEAKER_LABEL_RE.match(str(i.get("label") or ""))
    }
    spec_path = Path(out_dir) / "samples_spec.json"
    spec_path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    argv = build_label_argv(stored_path, str(out_dir), settings, mode="samples", samples_spec=str(spec_path))
    log_file.write("$ " + " ".join(argv) + "\n")
    rc = _run_subprocess(job["id"], argv, log_file)
    result["returncode"] = rc
    _cleanup_temp(Path(stored_path).stem, log_file)
    if not _finish_rc(rc, finish, LABEL_DRAFT_PY):
        return

    enroll_results: List[Dict[str, Any]] = []
    for item in items:
        label = str(item.get("label") or "")
        name = pipeline.sanitize_base(str(item.get("name") or ""))
        sample = Path(out_dir) / labeling.SAMPLES_DIR / f"{label}.wav"
        if not name or not sample.exists():
            enroll_results.append({"ok": False, "label": label, "name": name, "error": "no sample"})
            continue
        if pipeline.voice_exists(name) and not item.get("replace"):
            enroll_results.append({"ok": True, "label": label, "name": name, "skipped": "exists"})
            continue
        if item.get("replace"):
            _purge_voice_reference(name, log_file)
        rc = _run_subprocess(job["id"], build_enroll_argv(str(sample), name), log_file)
        enroll_results.append({"ok": rc == 0, "label": label, "name": name, "rc": rc})
        if rc in (-15, -9):
            break
    result["enroll"] = enroll_results
    ok = bool(enroll_results) and all(r.get("ok") for r in enroll_results)
    finish("done" if ok else "failed", None if ok else "Не все голоса записаны в эталоны")


def _calibrate_label_voices(job, project_id, out_dir, stored_path, settings, log_file, result, finish) -> None:
    """Similarity of labeled named voices with every reference voice (threshold tuning)."""
    spec = {
        str(label): item
        for label, item in (settings.get("calibrate") or {}).items()
        if labeling.SPEAKER_LABEL_RE.match(str(label)) and isinstance(item, dict)
    }
    spec_path = Path(out_dir) / "calibrate_spec.json"
    spec_path.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    calibration = Path(out_dir) / labeling.CALIBRATION_FILE
    previous = calibration.stat().st_mtime if calibration.exists() else None
    argv = build_label_argv(stored_path, str(out_dir), settings, mode="calibrate", samples_spec=str(spec_path))
    log_file.write("$ " + " ".join(argv) + "\n")
    rc = _run_subprocess(job["id"], argv, log_file)
    result["returncode"] = rc
    _cleanup_temp(Path(stored_path).stem, log_file)
    if not _finish_rc(rc, finish, LABEL_DRAFT_PY):
        return
    fresh = calibration.exists() and calibration.stat().st_mtime != previous
    if not fresh or labeling.load_calibration(project_id) is None:
        finish("failed", "calibration.json не получен")
        return
    finish("done")
