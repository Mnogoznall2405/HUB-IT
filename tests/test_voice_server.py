"""Unit tests for voice_server helpers (no DB / no subprocess)."""
from __future__ import annotations

import io
import json
import os
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

# voice_server.config requires a DB URL at import time; engine creation is lazy.
os.environ.setdefault(
    "VOICE_DATABASE_URL", "postgresql+psycopg://test:test@127.0.0.1:5432/test_voice"
)

from voice_server import pipeline, runner  # noqa: E402
from voice_server.config import config  # noqa: E402


# ---------------------------------------------------------------------------
# runner: argv construction
# ---------------------------------------------------------------------------

def test_build_process_argv_defaults():
    argv = runner.build_process_argv("C:/x/in.mp4", {})
    assert argv[1] == "run.py"
    assert argv[2] == "C:/x/in.mp4"
    assert "--no-manual-speakers" in argv
    assert "--no-diarization" not in argv  # enabled by default
    assert "--no-alignment" not in argv
    assert "--no-ai-analysis" not in argv
    assert "--no-speaker-identification" not in argv
    assert "--fresh" not in argv


def test_build_process_argv_flags_and_values():
    argv = runner.build_process_argv(
        "in.mp3",
        {
            "whisper_model": "large-v3",
            "language": "en",
            "stt_engine": "gemini",
            "separator": "melband",
            "num_speakers": 4,
            "chunk_duration": 600,
            "batch_size": 8,
            "meeting_date": "01.02.2026",
            "enable_diarization": False,
            "enable_ai_analysis": False,
            "fresh": True,
        },
    )
    joined = " ".join(argv)
    assert "--model large-v3" in joined
    assert "--language en" in joined
    assert "--stt-engine gemini" in joined
    assert "--separator melband" in joined
    assert "--num-speakers 4" in joined
    assert "--chunk-duration 600" in joined
    assert "--batch-size 8" in joined
    assert "--meeting-date 01.02.2026" in joined
    assert "--no-diarization" in argv
    assert "--no-ai-analysis" in argv
    assert "--fresh" in argv


def test_build_process_argv_separator_none_maps_to_no_demucs():
    argv = runner.build_process_argv("in.mp3", {"separator": "none"})
    assert "--no-demucs" in argv
    assert "--separator" not in argv


def test_build_resume_argv_never_disables_diarization():
    argv = runner.build_resume_argv("meeting1", {"SPEAKER_00": "Ivanov", "SPEAKER_01": "Petrov"})
    assert "--resume-speakers" in argv
    assert "--no-manual-speakers" in argv
    assert "--no-diarization" not in argv
    idx = argv.index("--speaker-map")
    assert argv[idx + 1] == "SPEAKER_00=Ivanov;SPEAKER_01=Petrov"


def test_build_resume_argv_without_map():
    argv = runner.build_resume_argv("meeting1", {})
    assert "--speaker-map" not in argv


def test_build_enroll_argv():
    argv = runner.build_enroll_argv("C:/tmp/s.wav", "Ivanov")
    assert "--enroll-voice" in argv
    assert "--speaker-name" in argv
    assert argv[argv.index("--speaker-name") + 1] == "Ivanov"
    assert "--enroll-merge" not in argv
    argv_merge = runner.build_enroll_argv("C:/tmp/s.wav", "Ivanov", merge=True)
    assert "--enroll-merge" in argv_merge


def test_llm_env_overrides_main_model_fans_out():
    env = runner._llm_env_overrides({"llm_model": "openai/gpt-6-luna-pro"})
    for key in ("DEFAULT_LLM_MODEL", "OPENAI_MODEL", "SEGMENTATION_MODEL", "TOPIC_ANALYSIS_MODEL"):
        assert env[key] == "openai/gpt-6-luna-pro"


def test_llm_env_overrides_granular_and_sanitized():
    env = runner._llm_env_overrides(
        {
            "segmentation_model": "xiaomi/mimo-v2.6-pro",
            "topic_model": " bad model; rm -rf / ",
            "jev_model": "typesafe/jev-1.13",
        }
    )
    assert env["SEGMENTATION_MODEL"] == "xiaomi/mimo-v2.6-pro"
    assert env["TOPIC_ANALYSIS_MODEL"] == "badmodelrm-rf/"
    assert env["JEV_MODEL"] == "typesafe/jev-1.13"
    assert "DEFAULT_LLM_MODEL" not in env


def test_llm_env_overrides_empty():
    assert runner._llm_env_overrides({}) == {}
    assert runner._llm_env_overrides(None) == {}


# ---------------------------------------------------------------------------
# pipeline: sanitizing + path safety
# ---------------------------------------------------------------------------

@pytest.fixture()
def vv_tree(tmp_path, monkeypatch):
    """Fake VoiceVideo tree wired into pipeline.config."""
    root = tmp_path / "voice_video"
    for d in ("input", "output", "processed", "unassigned_speakers", "reference_voices"):
        (root / d).mkdir(parents=True)
    fake = SimpleNamespace(
        voicevideo_root=root,
        upload_max_bytes=1024,
        data_dir=tmp_path / "data",
    )
    monkeypatch.setattr(pipeline, "config", fake)
    return root


def test_sanitize_base_strips_path_chars():
    cleaned = pipeline.sanitize_base("../../etc/passwd")
    assert "/" not in cleaned and "\\" not in cleaned
    assert cleaned not in {".", ".."}
    assert pipeline.sanitize_base("a/b\\c:d") == "a_b_c_d"
    assert pipeline.sanitize_base("") == ""
    assert pipeline.sanitize_base("..") == ""


def test_is_supported_media():
    assert pipeline.is_supported_media("a.mp4")
    assert pipeline.is_supported_media("a.WAV")
    assert not pipeline.is_supported_media("a.exe")
    assert not pipeline.is_supported_media("a.txt")


def test_resolve_report_file_blocks_traversal(vv_tree):
    base = "meeting1"
    mdir = vv_tree / "output" / base
    mdir.mkdir()
    (mdir / f"{base}_report.html").write_text("x", encoding="utf-8")
    (mdir / f"{base}_transcript.json").write_text("{}", encoding="utf-8")

    assert pipeline.resolve_report_file(base, f"{base}_report.html") is not None
    assert pipeline.resolve_report_file(base, "../evil.html") is None
    assert pipeline.resolve_report_file(base, "..\\..\\secret.md") is None
    assert pipeline.resolve_report_file(base, f"{base}_report.exe") is None
    assert pipeline.resolve_report_file("../escape", f"{base}_report.html") is None


def test_resolve_clip_file_blocks_traversal(vv_tree):
    base = "meeting1"
    clips = vv_tree / "output" / base / "clips"
    clips.mkdir(parents=True)
    (clips / "clip_1.mp4").write_bytes(b"x")

    found = pipeline.resolve_clip_file(base, "clip_1.mp4")
    assert found is not None
    # Traversal is neutralized to basename: still resolves inside the clips dir.
    traversed = pipeline.resolve_clip_file(base, "../../clip_1.mp4")
    assert traversed is not None and traversed.parent.name == "clips"
    assert pipeline.resolve_clip_file(base, "notaclip.mp4") is None
    assert pipeline.resolve_clip_file(base, "clip_evil.exe") is None


def test_resolve_speaker_sample_blocks_traversal(vv_tree):
    base = "meeting1"
    samples = vv_tree / "unassigned_speakers" / base
    samples.mkdir(parents=True)
    (samples / "SPEAKER_00.wav").write_bytes(b"RIFF")

    assert pipeline.resolve_speaker_sample(base, "SPEAKER_00") is not None
    assert pipeline.resolve_speaker_sample(base, "../SPEAKER_00") is None
    assert pipeline.resolve_speaker_sample(base, "..\\SPEAKER_00") is None


def test_find_source_media_only_media_ext(vv_tree):
    base = "meeting1"
    (vv_tree / "processed" / f"{base}.mp4").write_bytes(b"x")
    (vv_tree / "processed" / f"{base}.txt").write_text("x", encoding="utf-8")
    found = pipeline.find_source_media(base)
    assert found is not None and found.suffix == ".mp4"
    assert pipeline.find_source_media("../escape") is None


def test_meeting_speakers_aggregates(vv_tree):
    base = "meeting1"
    mdir = vv_tree / "output" / base
    mdir.mkdir()
    transcript = {
        "segments": [
            {"speaker": "SPEAKER_00", "text": "a"},
            {"speaker": "Ivanov", "text": "b"},
            {"speaker": "SPEAKER_01", "text": "c"},
        ],
        "speaker_naming": {
            "remaining_unresolved_speakers": ["SPEAKER_00", "SPEAKER_01"],
            "identification_details": {
                "SPEAKER_00": {"matched_name": "Petrov", "confidence": "medium"},
            },
        },
    }
    (mdir / f"{base}_transcript.json").write_text(
        json.dumps(transcript), encoding="utf-8"
    )
    samples = vv_tree / "unassigned_speakers" / base
    samples.mkdir()
    (samples / "SPEAKER_00.wav").write_bytes(b"RIFF")

    info = pipeline.meeting_speakers(base)
    unresolved = {s["speaker"]: s for s in info["unresolved"]}
    assert set(unresolved) == {"SPEAKER_00", "SPEAKER_01"}
    assert unresolved["SPEAKER_00"]["suggested_name"] == "Petrov"
    assert unresolved["SPEAKER_00"]["has_sample"] is True
    assert unresolved["SPEAKER_01"]["has_sample"] is False
    assert [s["name"] for s in info["resolved"]] == ["Ivanov"]
    assert info["segments_count"] == 3


def test_meeting_assignments_contract(vv_tree):
    """Frontend VoiceAssignmentsTab depends on this exact field set."""
    base = "meeting1"
    mdir = vv_tree / "output" / base
    mdir.mkdir()
    registry = (
        "| № | Время | Поручение | Ответственный | Срок |\n"
        "|---|---|---|---|---|\n"
        "| 1 | [04:59](clips/clip_01.mp4) | Подготовить акт | Иванов | 01.10.2026 |\n"
        "| 2 | [10:11](clips/clip_02.mp4) | Составить отчёт | — | — |\n"
    )
    (mdir / f"{base}_report.json").write_text(
        json.dumps({"action_registry": registry}, ensure_ascii=False),
        encoding="utf-8",
    )

    items = pipeline.meeting_assignments(base)
    assert len(items) == 2
    first = items[0]
    assert set(first) == {"num", "key", "section", "time", "clip", "task", "assignee", "deadline", "review"}
    assert len(first["key"]) == 16 and first["key"] != items[1]["key"]
    assert first["num"] == "1"
    assert first["time"] == "04:59"
    assert first["clip"] == "clip_01.mp4"
    assert first["task"] == "Подготовить акт"
    assert first["assignee"] == "Иванов"
    assert first["deadline"] == "01.10.2026"
    # No registry in report → empty list, not an error.
    mdir2 = vv_tree / "output" / "empty1"
    mdir2.mkdir()
    (mdir2 / "empty1_report.json").write_text("{}", encoding="utf-8")
    assert pipeline.meeting_assignments("empty1") == []


def test_meeting_assignments_continuous_numbering_and_sections(vv_tree):
    """Sections are captured; numbering is continuous across sections."""
    base = "meeting2"
    mdir = vv_tree / "output" / base
    mdir.mkdir()
    registry = (
        "## \u0420\u0435\u0435\u0441\u0442\u0440\n"
        "### \u041e\u0445\u0440\u0430\u043d\u0430\n"
        "\n"
        "| \u2116 | \u0412\u0440\u0435\u043c\u044f | \u041f\u043e\u0440\u0443\u0447\u0435\u043d\u0438\u0435 | \u041e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439 | \u0421\u0440\u043e\u043a |\n"
        "|---|---|---|---|---|\n"
        "| 1 | [04:59](clips/clip_01.mp4) | \u041f\u0440\u043e\u0432\u0435\u0441\u0442\u0438 \u0438\u043d\u0441\u0442\u0440\u0443\u043a\u0442\u0430\u0436 | \u0418\u0432\u0430\u043d\u043e\u0432 | 01.10.2026 |\n"
        "\n"
        "### \u0420\u0430\u0431\u043e\u0442\u044b\n"
        "\n"
        "| \u2116 | \u0412\u0440\u0435\u043c\u044f | \u041f\u043e\u0440\u0443\u0447\u0435\u043d\u0438\u0435 | \u041e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u044b\u0439 | \u0421\u0440\u043e\u043a |\n"
        "|---|---|---|---|---|\n"
        "| 1 | [10:11](clips/clip_02.mp4) | \u0421\u0434\u0430\u0442\u044c \u043e\u0442\u0447\u0451\u0442 | \u041f\u0435\u0442\u0440\u043e\u0432 | \u2014 |\n"
        "| 2 | [15:20](clips/clip_03.mp4) | \u0423\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u0433\u0440\u0430\u0444\u0438\u043a | \u0421\u0438\u0434\u043e\u0440\u043e\u0432 | 05.10.2026 |\n"
    )
    (mdir / f"{base}_report.json").write_text(
        json.dumps({"action_registry": registry}, ensure_ascii=False),
        encoding="utf-8",
    )

    items = pipeline.meeting_assignments(base)
    assert len(items) == 3
    # Continuous numbering: 1, 2, 3 (not 1, 1, 2)
    assert items[0]["num"] == "1"
    assert items[1]["num"] == "2"
    assert items[2]["num"] == "3"
    # Sections captured
    assert items[0]["section"] == "\u041e\u0445\u0440\u0430\u043d\u0430"
    assert items[1]["section"] == "\u0420\u0430\u0431\u043e\u0442\u044b"
    assert items[2]["section"] == "\u0420\u0430\u0431\u043e\u0442\u044b"


def test_meeting_topics_timeline(vv_tree):
    """Topics endpoint contract: title + start/end, sorted by start."""
    base = "meeting3"
    mdir = vv_tree / "output" / base
    mdir.mkdir()
    (mdir / f"{base}_report.json").write_text(
        json.dumps(
            {
                "topics": [
                    {"topic_title": "Second", "start_time": 120, "end_time": 300},
                    {"topic_title": "", "start_time": 10, "end_time": 20},
                    {"topic_title": "First", "start_time": 0, "end_time": 100},
                    {"topic_title": "No time", "start_time": 0, "end_time": 0},
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    items = pipeline.meeting_topics(base)
    assert [item["title"] for item in items] == ["First", "Second"]
    assert items[0]["start"] == 0
    assert items[0]["end"] == 100
    assert items[1]["start"] == 120
    assert pipeline.meeting_topics("nope") == []


# ---------------------------------------------------------------------------
# pipeline: upload fragment trim
# ---------------------------------------------------------------------------

def test_normalize_trim_range_none_without_keys():
    assert pipeline.normalize_trim_range({}, 600.0) is None
    assert pipeline.normalize_trim_range({"trim_start": "", "trim_end": ""}, 600.0) is None


def test_normalize_trim_range_valid_and_clamped():
    assert pipeline.normalize_trim_range(
        {"trim_start": 60, "trim_end": 120}, 600.0
    ) == (60.0, 120.0)
    # End beyond duration -> clamped to the media length.
    assert pipeline.normalize_trim_range(
        {"trim_start": 60, "trim_end": 9999}, 600.0
    ) == (60.0, 600.0)
    # Open end -> to the end of file; numeric strings accepted.
    assert pipeline.normalize_trim_range({"trim_start": "30"}, 600.0) == (30.0, 600.0)
    # Only end -> from the beginning.
    assert pipeline.normalize_trim_range({"trim_end": 45}, 600.0) == (0.0, 45.0)


def test_normalize_trim_range_full_file_is_noop():
    assert pipeline.normalize_trim_range({"trim_start": 0, "trim_end": 600}, 600.0) is None


def test_normalize_trim_range_errors():
    with pytest.raises(ValueError):
        pipeline.normalize_trim_range({"trim_start": 120, "trim_end": 60}, 600.0)
    with pytest.raises(ValueError):
        pipeline.normalize_trim_range({"trim_start": 700}, 600.0)
    with pytest.raises(ValueError):
        pipeline.normalize_trim_range({"trim_start": "abc", "trim_end": 90}, 600.0)
    with pytest.raises(ValueError):
        pipeline.normalize_trim_range({"trim_start": 10, "trim_end": 10.4}, 600.0)
    with pytest.raises(ValueError):
        pipeline.normalize_trim_range({"trim_start": 5}, None)


def test_build_trim_argv(vv_tree):
    argv = pipeline.build_trim_argv(Path("in.mp4"), Path("out.wav"), 30.0, 90.0)
    joined = " ".join(str(a) for a in argv)
    assert "-ss 30.000" in joined and "-t 60.000" in joined
    assert "-vn" in argv and "16000" in argv
    assert argv[-1] == "out.wav"


def test_build_trim_argv_mixes_multiple_audio_tracks(vv_tree):
    argv = pipeline.build_trim_argv(
        Path("in.mp4"), Path("out.wav"), 0.0, 10.0, audio_streams=2
    )
    joined = " ".join(str(a) for a in argv)
    assert "amix=inputs=2" in joined


def test_cut_media_range_runs_ffmpeg_and_cleans_on_failure(vv_tree, tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(pipeline, "audio_stream_count", lambda p: 1)
    monkeypatch.setattr(pipeline, "_mean_volume_db", lambda p: -25.0)

    def fake_run(argv, **kw):
        calls.append(argv)
        Path(argv[-1]).write_bytes(b"RIFF" + b"0" * 4096)
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(pipeline.subprocess, "run", fake_run)
    dst = tmp_path / "out.wav"
    pipeline.cut_media_range(tmp_path / "in.mp4", dst, 0.0, 10.0)
    assert dst.exists() and len(calls) == 1

    monkeypatch.setattr(
        pipeline.subprocess, "run",
        lambda argv, **kw: SimpleNamespace(returncode=1, stderr="boom"),
    )
    with pytest.raises(RuntimeError):
        pipeline.cut_media_range(tmp_path / "in.mp4", tmp_path / "out2.wav", 0.0, 10.0)
    assert not (tmp_path / "out2.wav").exists()


def test_cut_media_range_rejects_silent_fragment(vv_tree, tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "audio_stream_count", lambda p: 1)
    monkeypatch.setattr(pipeline, "_mean_volume_db", lambda p: -91.0)
    def fake_run(argv, **kw):
        Path(argv[-1]).write_bytes(b"RIFF" + b"0" * 4096)
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(pipeline.subprocess, "run", fake_run)
    with pytest.raises(RuntimeError, match="без звука"):
        pipeline.cut_media_range(tmp_path / "in.mp4", tmp_path / "out.wav", 0.0, 10.0)
    assert not (tmp_path / "out.wav").exists()


def test_cleanup_temp_removes_only_job_files(vv_tree):
    base = "meeting1"
    temp = vv_tree / "temp"
    (temp / "sep_out").mkdir(parents=True)
    (temp / f"{base}_raw.wav").write_bytes(b"x")
    (temp / f"{base}_demucs.wav").write_bytes(b"x")
    (temp / f"{base}_processed.wav").write_bytes(b"x")
    (temp / "other_raw.wav").write_bytes(b"x")
    (temp / "sep_out" / f"{base}_(Vocals)_model.wav").write_bytes(b"x")
    (temp / "sep_out" / "other_(Vocals)_model.wav").write_bytes(b"x")

    runner._cleanup_temp(base, io.StringIO())

    assert not (temp / f"{base}_raw.wav").exists()
    assert not (temp / f"{base}_demucs.wav").exists()
    assert not (temp / f"{base}_processed.wav").exists()
    assert not (temp / "sep_out" / f"{base}_(Vocals)_model.wav").exists()
    assert (temp / "other_raw.wav").exists()
    assert (temp / "sep_out" / "other_(Vocals)_model.wav").exists()


def test_worker_loop_skips_cancelled_before_start(monkeypatch):
    from voice_server import worker_main

    stop = threading.Event()
    claims = {"n": 0}
    ran: list = []
    updates: list = []

    def claim():
        claims["n"] += 1
        if claims["n"] > 1:
            stop.set()
            return None
        return {"id": "job1", "kind": "process"}

    monkeypatch.setattr(worker_main.store, "claim_next_job", claim)
    monkeypatch.setattr(worker_main.store, "is_cancel_requested", lambda _jid: True)
    monkeypatch.setattr(
        worker_main.store, "update_job", lambda _jid, **kw: updates.append(kw)
    )
    monkeypatch.setattr(worker_main.runner, "run_job", lambda job: ran.append(job))

    worker_main._worker_loop(stop, 0)

    assert ran == []
    assert any(u.get("status") == "cancelled" for u in updates)


# ---------------------------------------------------------------------------
# auth helpers (no network)
# ---------------------------------------------------------------------------

def test_user_has_permission_admin_bypass():
    from voice_server import auth

    assert auth.user_has_permission({"role": "admin"}, "voice.manage") is True
    assert auth.user_has_permission({"role": "user", "permissions": ["voice.read"]}, "voice.read") is True
    assert auth.user_has_permission({"role": "user", "permissions": ["voice.read"]}, "voice.manage") is False
    assert auth.user_has_permission({"role": "user"}, "voice.read") is False


def test_web_actor_prefers_username():
    from voice_server import auth

    assert auth.web_actor({"username": "ivan"}) == "ivan"
    assert auth.web_actor({"email": "a@b.c"}) == "a@b.c"
    assert auth.web_actor({}) == "authenticated-user"


def test_config_defaults():
    assert config.port == int(os.getenv("VOICE_SERVER_PORT", "8013"))
    assert config.worker_concurrency >= 1
    assert config.upload_max_bytes >= 64 * 1024 * 1024


# ---------------------------------------------------------------------------
# archiver: warm storage mover
# ---------------------------------------------------------------------------

def _arch_stats():
    return {"copied": 0, "bytes": 0, "expired_deleted": 0, "errors": 0, "dry_run": 0}


def _arch_job(base, **extra):
    from datetime import datetime, timezone

    job = {
        "id": f"job_{base}",
        "base_filename": base,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    job.update(extra)
    return job


def _arch_config(monkeypatch, **over):
    ns = SimpleNamespace(
        source_ttl_days=7,
        archive_enabled=True,
        archive_dry_run=True,
        archive_dir=None,
    )
    for k, v in over.items():
        setattr(ns, k, v)
    from voice_server import archiver

    monkeypatch.setattr(archiver, "config", ns)
    return archiver


def test_archiver_dry_run_leaves_files(vv_tree, tmp_path, monkeypatch):
    from voice_server import archiver as arch

    _arch_config(monkeypatch)
    base = "meeting1"
    hot = vv_tree / "processed" / f"{base}.mp4"
    hot.write_bytes(b"data123")
    arch_dir = tmp_path / "archive"
    (arch_dir / "processed").mkdir(parents=True)
    stats = _arch_stats()

    out = arch._archive_one(_arch_job(base), arch_dir, dry_run=True, stats=stats)

    assert out == "dry"
    assert hot.exists() and not (arch_dir / "processed" / hot.name).exists()
    assert stats["dry_run"] == 1 and stats["copied"] == 0


def test_archiver_moves_verifies_and_marks(vv_tree, tmp_path, monkeypatch):
    from voice_server import archiver as arch

    _arch_config(monkeypatch, archive_dry_run=False)
    marked = []
    monkeypatch.setattr(arch.store, "mark_archived", lambda jid, p: marked.append((jid, p)))
    base = "meeting1"
    hot = vv_tree / "processed" / f"{base}.mp4"
    hot.write_bytes(b"data123")
    arch_dir = tmp_path / "archive"
    stats = _arch_stats()

    out = arch._archive_one(_arch_job(base), arch_dir, dry_run=False, stats=stats)

    dest = arch_dir / "processed" / f"{base}.mp4"
    assert out == "archived"
    assert not hot.exists() and dest.read_bytes() == b"data123"
    assert stats["copied"] == 1 and stats["bytes"] == 7
    assert marked == [(f"job_{base}", str(dest))]


def test_archiver_idempotent_rerun_removes_only_hot(vv_tree, tmp_path, monkeypatch):
    from voice_server import archiver as arch

    _arch_config(monkeypatch, archive_dry_run=False)
    base = "meeting1"
    hot = vv_tree / "processed" / f"{base}.mp4"
    hot.write_bytes(b"data123")
    arch_dir = tmp_path / "archive"
    dest = arch_dir / "processed" / f"{base}.mp4"
    dest.parent.mkdir(parents=True)
    dest.write_bytes(b"data123")
    job = _arch_job(base, archive_path=str(dest))
    stats = _arch_stats()

    out = arch._archive_one(job, arch_dir, dry_run=False, stats=stats)

    assert out == "already"
    assert not hot.exists() and dest.exists()
    assert stats["copied"] == 0


def test_archiver_ttl_expired_deletes_hot_and_warm(vv_tree, tmp_path, monkeypatch):
    from datetime import datetime, timedelta, timezone

    from voice_server import archiver as arch

    _arch_config(monkeypatch, source_ttl_days=7, archive_dry_run=False)
    base = "meeting1"
    hot = vv_tree / "processed" / f"{base}.mp4"
    hot.write_bytes(b"data123")
    arch_dir = tmp_path / "archive"
    dest = arch_dir / "processed" / f"{base}.mp4"
    dest.parent.mkdir(parents=True)
    dest.write_bytes(b"data123")
    job = _arch_job(
        base,
        finished_at=(datetime.now(timezone.utc) - timedelta(days=8)).isoformat(),
        archive_path=str(dest),
    )
    stats = _arch_stats()

    out = arch._archive_one(job, arch_dir, dry_run=False, stats=stats)

    assert out == "expired"
    assert not hot.exists() and not dest.exists()
    assert stats["expired_deleted"] == 2


def test_archiver_cycle_disabled_is_noop(monkeypatch):
    arch = _arch_config(monkeypatch, archive_enabled=False)
    called = []
    monkeypatch.setattr(arch.store, "list_done_jobs", lambda **kw: called.append(kw) or [])

    stats = arch.archive_cycle()

    assert stats == _arch_stats()
    assert called == []  # never touched the DB


def test_archiver_cycle_missing_archive_dir_warns(vv_tree, tmp_path, monkeypatch):
    arch = _arch_config(monkeypatch, archive_enabled=True, archive_dir=tmp_path / "nope")
    monkeypatch.setattr(arch.store, "list_done_jobs", lambda **kw: [_arch_job("x")])

    stats = arch.archive_cycle()

    assert stats == _arch_stats()


def _write_registry(vv_tree, base, registry):
    mdir = vv_tree / "output" / base
    mdir.mkdir()
    (mdir / f"{base}_report.json").write_text(
        json.dumps({"action_registry": registry}, ensure_ascii=False), encoding="utf-8"
    )


def test_assignment_key_survives_reordering_and_renumbering(vv_tree):
    """Statuses are keyed by wording: regeneration must not move them to other rows."""
    head = "| № | Время | Поручение | Ответственный | Срок |\n|---|---|---|---|---|\n"
    _write_registry(vv_tree, "m_a", head + (
        "| 1 | 01:00 | Подписать ДС | Иванов | 01.10 |\n"
        "| 2 | 02:00 | Направить отчёт | Петров | — |\n"
    ))
    _write_registry(vv_tree, "m_b", "### Объект\n\n" + head + (
        "| 1 | 02:05 | Направить  отчёт. | Петров П.П. | 03.10 |\n"
        "| 2 | 01:10 | Подписать ДС | Иванов | — |\n"
    ))
    a = {i["task"]: i["key"] for i in pipeline.meeting_assignments("m_a")}
    b = pipeline.meeting_assignments("m_b")
    # Section is part of the key; same section + same wording (modulo punctuation/spaces) -> same key.
    assert pipeline.assignment_key("", "Направить отчёт") == pipeline.assignment_key("", "направить  ОТЧЁТ.")
    assert a["Подписать ДС"] == pipeline.assignment_key("", "Подписать ДС")
    assert b[1]["key"] == pipeline.assignment_key("Объект", "Подписать ДС")
    assert b[1]["num"] == "2"


def test_guard_mark_is_split_from_task_and_does_not_change_status_key(vv_tree):
    head = "| № | Время | Поручение | Ответственный | Срок |\n|---|---|---|---|---|\n"
    _write_registry(vv_tree, "m_plain", head + "| 1 | 01:00 | Подписать ДС | Иванов | 01.10 |\n")
    _write_registry(vv_tree, "m_flag", head + (
        "| 1 | 01:00 | Подписать ДС ⚠ проверить: нет в обсуждении; нет ответственного | Иванов | 01.10 |\n"
        "| 2 | 02:00 | ⚠ проверить: пустая формулировка | Петров | — |\n"
    ))
    plain = pipeline.meeting_assignments("m_plain")[0]
    flagged = pipeline.meeting_assignments("m_flag")
    assert len(flagged) == 1  # строка из одной пометки без текста поручения отбрасывается как битая
    assert flagged[0]["task"] == "Подписать ДС"
    assert flagged[0]["review"] == "нет в обсуждении; нет ответственного"
    assert plain["review"] == ""
    assert flagged[0]["key"] == plain["key"]  # статус поручения не пропадает от появления/исчезновения пометки


def test_assignment_duplicates_get_distinct_keys_and_tolerant_rows(vv_tree):
    head = "| № | Время | Поручение | Ответственный | Срок |\n|---|---|---|---|---|\n"
    _write_registry(vv_tree, "m_c", head + (
        "| 1 | 01:00 | Доложить ГД | Иванов | — |\n"
        "| 2 | 02:00 | Доложить ГД | Иванов | — |\n"
        "| 3 | 03:00 | Сверить A | B итоги | Петров | 05.10 |\n"  # stray pipe inside the task
        "| 4 | 04:00 | Без срока | Сидоров |\n"  # missing deadline column
        "| 5 | 05:00 |\n"  # garbage
    ))
    items = pipeline.meeting_assignments("m_c")
    assert [i["num"] for i in items] == ["1", "2", "3", "4"]
    assert items[0]["key"] != items[1]["key"]
    assert items[2]["task"] == "Сверить A / B итоги" and items[2]["assignee"] == "Петров"
    assert items[3]["assignee"] == "Сидоров" and items[3]["deadline"] == ""


def test_build_process_argv_speaker_range():
    argv = " ".join(runner.build_process_argv("in.mp4", {"min_speakers": 3, "max_speakers": 8}))
    assert "--min-speakers 3" in argv and "--max-speakers 8" in argv
    exact = runner.build_process_argv("in.mp4", {"num_speakers": 5, "min_speakers": 3})
    assert "--num-speakers" in exact and "--min-speakers" not in exact  # exact number wins
    junk = runner.build_process_argv("in.mp4", {"min_speakers": "abc", "max_speakers": 99})
    assert "--min-speakers" not in junk and "--max-speakers" not in junk


def test_meeting_speakers_recurring_only_existing_meetings(vv_tree):
    for base in ("m_now", "m_old"):
        mdir = vv_tree / "output" / base
        mdir.mkdir()
    (vv_tree / "output" / "m_old" / "m_old_transcript.json").write_text("{}", encoding="utf-8")
    (vv_tree / "output" / "m_now" / "m_now_transcript.json").write_text(json.dumps({
        "segments": [{"start": 1, "end": 2, "speaker": "SPEAKER_00", "text": "x"}],
        "speaker_naming": {
            "remaining_unresolved_speakers": ["SPEAKER_00"],
            "recurring": {"SPEAKER_00": {"id": "R007", "meetings": ["m_old", "m_deleted"], "count": 3}},
        },
    }), encoding="utf-8")
    speaker = pipeline.meeting_speakers("m_now")["unresolved"][0]
    assert speaker["recurring"] == {"id": "R007", "meetings": ["m_old"]}


def test_meeting_summary_flattens_decisions_and_survives_junk(vv_tree):
    mdir = vv_tree / "output" / "m_sum"
    mdir.mkdir()
    (mdir / "m_sum_report.json").write_text(json.dumps({
        "metadata": {"total_duration": "15:25"},
        "summary": "## Итоги\nДоговорились по смете.",
        "protocol": "# Протокол",
        "topics": [
            {"topic_title": "ГПР", "start_time": 420, "end_time": 640, "summary": "s2",
             "key_decisions": ["Сдать ГПР к 25.09"], "open_questions": [], "sentiment": "нейтральный"},
            {"topic_title": "Смета", "start_time": 0, "end_time": 160,
             "key_decisions": ["Подписать ДС", "", None], "open_questions": ["Сумма?"]},
            "garbage",
            {"topic_title": "Битое время", "start_time": "abc", "key_decisions": "не список"},
        ],
        "participants": [
            {"name": "Петрова", "participation_percentage": 30.5, "segments_count": 10},
            {"name": "Иванов", "participation_percentage": 55, "segments_count": "x"},
            {"name": ""},
        ],
        "keywords": ["смета", "ГПР"],
    }, ensure_ascii=False), encoding="utf-8")
    res = pipeline.meeting_summary("m_sum")
    assert res["available"] is True and res["duration"] == "15:25"
    assert [t["title"] for t in res["topics"]] == ["Смета", "ГПР", "Битое время"]
    assert res["topics"][2]["start"] is None
    assert res["topics"][0]["domain"] == "" and res["topics"][0]["domain_label"] == ""  # Jev не размечал
    assert res["decisions"] == [
        {"text": "Сдать ГПР к 25.09", "topic": "ГПР", "start": 420.0},
        {"text": "Подписать ДС", "topic": "Смета", "start": 0.0},
    ]
    assert res["open_questions"] == [{"text": "Сумма?", "topic": "Смета", "start": 0.0}]
    assert [p["name"] for p in res["participants"]] == ["Иванов", "Петрова"]
    assert res["participants"][0]["segments"] == 0
    assert pipeline.meeting_summary("missing")["available"] is False


@pytest.mark.parametrize("report", [
    [1, 2],
    {"topics": 5, "participants": 5, "summary": ["x"], "keywords": "abc", "metadata": []},
    {"topics": {"a": 1}, "participants": "x"},
    {"topics": [{"start_time": float("inf"), "end_time": float("nan"), "key_decisions": ["d"]}],
     "participants": [{"name": "A", "segments_count": 3.0, "participation_percentage": float("inf")}]},
])
def test_meeting_summary_survives_structurally_broken_report(vv_tree, report):
    # Corrupt reports must give a JSON-serialisable (not 500) answer: inf/NaN are not valid JSON.
    mdir = vv_tree / "output" / "m_broken"
    mdir.mkdir()
    (mdir / "m_broken_report.json").write_text(json.dumps(report), encoding="utf-8")
    res = pipeline.meeting_summary("m_broken")
    json.dumps(res, allow_nan=False)
    assert isinstance(res["topics"], list) and isinstance(res["participants"], list)


def test_trim_timeout_grows_with_video_fragment_but_is_capped():
    # A fixed 10 min cap made the re-encode of a long video fragment fail (~5x realtime).
    assert pipeline.trim_timeout_sec(30, True) == 600
    assert pipeline.trim_timeout_sec(3600, True) > 600
    assert pipeline.trim_timeout_sec(10 * 3600, True) == 2 * 3600
    assert pipeline.trim_timeout_sec(3600, False) == 600


@pytest.mark.parametrize("encoder", ["libx264", "libopenh264"])
def test_build_trim_argv_preserves_video_and_maps_mixed_audio(vv_tree, encoder):
    argv = pipeline.build_trim_argv(
        Path("in.mkv"), Path("out.mp4"), 1.35, 4.35,
        audio_streams=2, video_encoder=encoder,
    )
    assert "-vn" not in argv
    assert argv[argv.index("-c:v") + 1] == encoder
    assert argv[argv.index("-c:a") + 1] == "aac"
    assert argv[argv.index("-pix_fmt") + 1] == "yuv420p"
    assert argv[argv.index("-filter_complex") + 1] == (
        "[0:a:0][0:a:1]amix=inputs=2:duration=longest:normalize=0[mixed]"
    )
    assert [argv[i + 1] for i, arg in enumerate(argv) if arg == "-map"] == [
        "0:V:0", "[mixed]",
    ]
    assert argv[argv.index("-movflags") + 1] == "+faststart"


@pytest.fixture()
def trim_api(vv_tree, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine, event
    from voice_server import app as app_module, auth, store
    from voice_server.models import Base

    engine = create_engine(f"sqlite:///{(tmp_path / 'jobs.db').as_posix()}")
    voice_file = tmp_path / "voice.db"

    @event.listens_for(engine, "connect")
    def attach(dbapi_connection, _record):
        dbapi_connection.execute("ATTACH DATABASE ? AS voice", (str(voice_file),))

    Base.metadata.create_all(engine)
    monkeypatch.setattr(store, "_engine", lambda: engine)
    monkeypatch.setattr(
        app_module, "config",
        SimpleNamespace(upload_max_bytes=10 * 1024 * 1024),
    )
    current = {"user": {"id": 1, "role": "admin", "username": "trim-test"}}
    monkeypatch.setattr(auth, "_fetch_web_user", lambda *args, **kwargs: current["user"])
    with TestClient(app_module.app) as client:
        client.headers["Authorization"] = "Bearer isolated-test"
        client.current = current
        yield client
    engine.dispose()


@pytest.fixture()
def trim_media_tools(monkeypatch):
    import shutil

    directory = Path(__file__).resolve().parents[1] / "voice_video" / "ffmpeg" / "bin"
    ffmpeg = str(directory / "ffmpeg.exe") if (directory / "ffmpeg.exe").exists() else shutil.which("ffmpeg")
    ffprobe = str(directory / "ffprobe.exe") if (directory / "ffprobe.exe").exists() else shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        pytest.skip("FFmpeg and ffprobe are required for media integration tests")
    monkeypatch.setattr(pipeline, "ffmpeg_bin", lambda: ffmpeg)
    monkeypatch.setattr(pipeline, "ffprobe_bin", lambda: ffprobe)
    return ffmpeg, ffprobe


def _probe_trim_media(path, ffprobe):
    import subprocess

    proc = subprocess.run(
        [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        capture_output=True, text=True, check=True, timeout=30,
    )
    return json.loads(proc.stdout)


@pytest.mark.parametrize("video", [True, False])
def test_upload_trim_preserves_real_media_and_serves_it(trim_api, vv_tree, tmp_path, trim_media_tools, video):
    import subprocess
    from voice_server import store

    ffmpeg, ffprobe = trim_media_tools
    source = tmp_path / ("source.mkv" if video else "audio-only.mp4")
    argv = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    if video:
        argv += ["-f", "lavfi", "-i", "testsrc=size=160x90:rate=10:duration=6"]
        argv += ["-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono"]
        argv += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=6"]
        argv += ["-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0", "-c:v", "ffv1", "-c:a", "pcm_s16le"]
    else:
        argv += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=6", "-c:a", "aac"]
    argv += ["-t", "6", "-threads", "2", str(source)]
    subprocess.run(argv, capture_output=True, text=True, check=True, timeout=30)

    response = trim_api.post(
        "/api/v1/voice/jobs",
        files={"file": (source.name, source.read_bytes(), "application/octet-stream")},
        data={"settings_json": json.dumps({"trim_start": 1.35, "trim_end": 4.35})},
    )
    assert response.status_code == 201, response.text
    job = store.get_job(response.json()["id"])
    artifact = Path(job["stored_path"])
    assert artifact.suffix == (".mp4" if video else ".wav")
    assert job["status"] == "queued" and job["file_size"] == artifact.stat().st_size
    assert list((vv_tree / "input").iterdir()) == [artifact]
    media = _probe_trim_media(artifact, ffprobe)
    audio_streams = [stream for stream in media["streams"] if stream["codec_type"] == "audio"]
    video_streams = [stream for stream in media["streams"] if stream["codec_type"] == "video"]
    assert len(audio_streams) == 1
    assert audio_streams[0]["codec_name"] == ("aac" if video else "pcm_s16le")
    assert audio_streams[0]["channels"] == 1 and audio_streams[0]["sample_rate"] == "16000"
    assert abs(float(media["format"]["duration"]) - 3.0) <= 0.2
    assert len(video_streams) == int(video)
    if video:
        assert video_streams[0]["codec_name"] == "h264"
        assert (video_streams[0]["width"], video_streams[0]["height"]) == (160, 90)
    assert pipeline._mean_volume_db(artifact) > -70

    base = job["base_filename"]
    destination = vv_tree / "processed" / artifact.name
    artifact.rename(destination)
    meeting_dir = vv_tree / "output" / base
    meeting_dir.mkdir()
    (meeting_dir / f"{base}_transcript.json").write_text('{"segments": []}', encoding="utf-8")
    playback = trim_api.get(f"/api/v1/voice/meetings/{base}/media")
    assert playback.status_code == 200
    assert playback.headers["content-type"] in (("video/mp4",) if video else ("audio/wav", "audio/x-wav"))
    assert playback.content == destination.read_bytes()
    partial = trim_api.get(f"/api/v1/voice/meetings/{base}/media", headers={"Range": "bytes=0-31"})
    assert partial.status_code == 206 and partial.content == playback.content[:32]
    assert partial.headers["content-range"] == f"bytes 0-31/{destination.stat().st_size}"


@pytest.mark.parametrize("failure", ["probe", "encoder"])
def test_upload_video_trim_failure_does_not_queue_or_leave_files(trim_api, vv_tree, monkeypatch, failure):
    from voice_server import store

    monkeypatch.setattr(pipeline, "media_duration_sec", lambda path: 6.0)
    if failure == "probe":
        def fail(path):
            raise RuntimeError("media probe failed")
        monkeypatch.setattr(pipeline, "trim_media_suffix", fail)
    else:
        monkeypatch.setattr(pipeline, "trim_media_suffix", lambda path: ".mp4")
        def fail(src, dst, start, end):
            dst.write_bytes(b"partial mp4")
            raise RuntimeError("video encoder failed")
        monkeypatch.setattr(pipeline, "cut_media_range", fail)
    response = trim_api.post(
        "/api/v1/voice/jobs",
        files={"file": ("recording.mp4", b"source", "video/mp4")},
        data={"settings_json": json.dumps({"trim_start": 1, "trim_end": 4})},
    )
    assert response.status_code == 422
    assert store.list_jobs() == []
    assert list((vv_tree / "input").iterdir()) == []


def test_video_trim_upload_requires_permission(trim_api, vv_tree, monkeypatch):
    from voice_server import store

    def unexpected(*args, **kwargs):
        pytest.fail("unauthorized upload must not inspect media")
    monkeypatch.setattr(pipeline, "media_duration_sec", unexpected)
    trim_api.headers.pop("Authorization")
    assert trim_api.post(
        "/api/v1/voice/jobs", files={"file": ("a.mp4", b"media", "video/mp4")},
    ).status_code == 401
    trim_api.headers["Authorization"] = "Bearer isolated-test"
    trim_api.current["user"] = {"id": 2, "role": "user", "permissions": ["voice.read"]}
    assert trim_api.post(
        "/api/v1/voice/jobs", files={"file": ("a.mp4", b"media", "video/mp4")},
    ).status_code == 403
    assert store.list_jobs() == [] and list((vv_tree / "input").iterdir()) == []


@pytest.mark.parametrize("encoders,expected", [
    (" V....D libopenh264 H.264\n V....D libx264 H.264\n", "libx264"),
    (" V....D libopenh264 H.264\n", "libopenh264"),
    (" V....D mpeg4 MPEG-4\n", None),
])
def test_video_encoder_uses_available_software_codec(monkeypatch, encoders, expected):
    monkeypatch.setattr(
        pipeline.subprocess, "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout=encoders),
    )
    pipeline._video_encoder.cache_clear()
    if expected is None:
        with pytest.raises(RuntimeError, match="H.264"):
            pipeline._video_encoder("isolated-ffmpeg")
    else:
        assert pipeline._video_encoder("isolated-ffmpeg") == expected
    pipeline._video_encoder.cache_clear()


@pytest.mark.parametrize("suffix", [".wav", ".mp4"])
@pytest.mark.parametrize("failure", ["trim_timeout", "volume_timeout", "silence"])
def test_cut_media_range_removes_incomplete_output_on_validation_failure(tmp_path, monkeypatch, suffix, failure):
    import subprocess

    src, dst = tmp_path / "source.mkv", tmp_path / f"fragment{suffix}"
    src.write_bytes(b"unchanged source")
    monkeypatch.setattr(pipeline, "audio_stream_count", lambda path: 1)
    monkeypatch.setattr(pipeline, "_video_encoder", lambda executable: "libopenh264")

    def run(argv, **kwargs):
        dst.write_bytes(b"partial" + b"0" * 4096)
        if failure == "trim_timeout":
            raise subprocess.TimeoutExpired(argv, 600)
        return SimpleNamespace(returncode=0, stderr="")

    def volume(path):
        if failure == "volume_timeout":
            raise subprocess.TimeoutExpired("volumedetect", 120)
        return -91.0

    monkeypatch.setattr(pipeline.subprocess, "run", run)
    monkeypatch.setattr(pipeline, "_mean_volume_db", volume)
    with pytest.raises((RuntimeError, subprocess.TimeoutExpired)):
        pipeline.cut_media_range(src, dst, 1, 4)
    assert not dst.exists() and src.read_bytes() == b"unchanged source"


# ---------------------------------------------------------------------------
# runner: supervisor deadline/cancel independent of child output (DINT-01)
# ---------------------------------------------------------------------------


def _supervise(monkeypatch, tmp_path, code, *, timeout=30.0, cancel_after=None):
    import time as _time

    started = _time.monotonic()
    tail = []
    monkeypatch.setattr(
        runner,
        "config",
        SimpleNamespace(voicevideo_root=tmp_path, job_timeout_sec=timeout, log_tail_lines=50),
    )
    monkeypatch.setattr(runner.store, "append_log_tail", lambda job_id, line, n: tail.append(line))
    monkeypatch.setattr(runner.store, "update_job", lambda *a, **k: None)
    monkeypatch.setattr(
        runner.store,
        "is_cancel_requested",
        lambda job_id: cancel_after is not None and _time.monotonic() - started >= cancel_after,
    )
    with open(tmp_path / "job.log", "w", encoding="utf-8") as log:
        rc = runner._run_subprocess("job12345", [sys.executable, "-u", "-c", code], log)
    return rc, _time.monotonic() - started, tail


def test_silent_child_is_stopped_at_the_deadline_not_when_it_finally_speaks(monkeypatch, tmp_path):
    rc, elapsed, _ = _supervise(monkeypatch, tmp_path, "import time; time.sleep(30)", timeout=0.5)
    assert rc == -9
    assert elapsed < 10


def test_partial_line_without_newline_does_not_block_cancel(monkeypatch, tmp_path):
    code = "import sys,time; sys.stdout.write('no newline yet'); sys.stdout.flush(); time.sleep(30)"
    rc, elapsed, _ = _supervise(monkeypatch, tmp_path, code, cancel_after=0.5)
    assert rc == -15
    assert elapsed < 10


def test_stdout_flood_is_bounded_and_child_still_finishes(monkeypatch, tmp_path):
    code = "for i in range(20000): print('line', i)"
    rc, _, tail = _supervise(monkeypatch, tmp_path, code)
    assert rc == 0
    assert 0 < len(tail) <= 20000
    assert (tmp_path / "job.log").read_text(encoding="utf-8").strip()


def test_parallel_meeting_meta_saves_do_not_share_a_staging_file(monkeypatch, tmp_path):
    """DINT-05: every writer gets its own temp file, so parallel edits neither fail nor leave junk."""
    meeting = tmp_path / "m1"
    meeting.mkdir()
    monkeypatch.setattr(pipeline, "meeting_dir", lambda base: meeting)
    results = []

    def worker(index):
        results.append(pipeline.save_meeting_web_meta("m1", tags=[f"t{index}"], project=f"p{index}"))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert all(result is not None for result in results)
    assert not list(meeting.glob("*.tmp"))
    saved = json.loads((meeting / pipeline._WEB_META_NAME).read_text(encoding="utf-8"))
    assert saved["project"].startswith("p") and len(saved["tags"]) == 1
