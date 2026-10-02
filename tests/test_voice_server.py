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
    assert set(first) == {"num", "key", "section", "time", "clip", "task", "assignee", "deadline"}
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
