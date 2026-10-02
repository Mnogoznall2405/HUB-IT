"""Diarization labeling: pure helpers, draft builder, store (sqlite) and API."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event

os.environ.setdefault(
    "VOICE_DATABASE_URL", "postgresql+psycopg://test:test@127.0.0.1:5432/test_voice"
)

from voice_server import label_store, labeling, pipeline, runner, store  # noqa: E402
from voice_server.models import Base  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def _load_label_draft():
    spec = importlib.util.spec_from_file_location(
        "label_draft_under_test", ROOT / "voice_video" / "label_draft.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


label_draft = _load_label_draft()


# ---------------------------------------------------------------------------
# label_draft.py: pure functions
# ---------------------------------------------------------------------------

def test_merge_turns_joins_same_speaker_short_gap_and_sorts():
    turns = [
        {"start": 5.0, "end": 6.0, "speaker": "B"},
        {"start": 0.0, "end": 2.0, "speaker": "A"},
        {"start": 2.2, "end": 4.0, "speaker": "A"},  # gap 0.2 -> merged
        {"start": 4.0, "end": 3.0, "speaker": "A"},  # invalid -> dropped
        {"start": 6.5, "end": 7.0, "speaker": "B"},  # gap 0.5 -> separate
    ]
    merged = label_draft.merge_turns(turns)
    assert [(t["speaker"], t["start"], t["end"]) for t in merged] == [
        ("A", 0.0, 4.0),
        ("B", 5.0, 6.0),
        ("B", 6.5, 7.0),
    ]


def test_merge_turns_extends_own_overlapping_turn_across_interruption():
    turns = [
        {"start": 0.0, "end": 10.0, "speaker": "A"},
        {"start": 5.0, "end": 6.0, "speaker": "B"},
        {"start": 9.0, "end": 12.0, "speaker": "A"},
    ]
    merged = label_draft.merge_turns(turns)
    assert [(t["speaker"], t["start"], t["end"]) for t in merged] == [
        ("A", 0.0, 12.0),
        ("B", 5.0, 6.0),
    ]


def test_attach_words_by_midpoint_overlap_and_snap():
    turns = [
        {"start": 0.0, "end": 10.0, "speaker": "A"},
        {"start": 4.0, "end": 5.0, "speaker": "B"},  # interruption inside A
        {"start": 12.0, "end": 14.0, "speaker": "A"},
    ]
    words = [
        {"word": "привет", "start": 0.5, "end": 1.0},
        {"word": "да", "start": 4.2, "end": 4.6},  # inside both -> later-started B
        {"word": "итак", "start": 6.0, "end": 6.4},
        {"word": "рядом", "start": 10.3, "end": 10.5},  # 0.4s after A ends -> snapped
        {"word": "далеко", "start": 30.0, "end": 30.5},  # too far -> dropped
        {"word": "", "start": 1.0, "end": 1.2},
        {"word": "без-времени"},
    ]
    result = label_draft.attach_words(turns, words)
    assert [t["text"] for t in result] == ["привет итак рядом", "да", ""]


def test_build_draft_clamps_to_duration_and_lists_speakers():
    turns = [
        {"start": 0.0, "end": 3.0, "speaker": "SPEAKER_01"},
        {"start": 3.5, "end": 9.0, "speaker": "SPEAKER_00"},
    ]
    words = [{"word": "раз", "start": 0.1, "end": 0.3}]
    draft = label_draft.build_draft(turns, words, duration=8.0)
    assert draft["duration"] == 8.0
    assert draft["audio"] == "audio.mp3"
    assert draft["speakers"] == ["SPEAKER_00", "SPEAKER_01"]
    assert draft["segments"] == [
        {"id": "s1", "start": 0.0, "end": 3.0, "speaker": "SPEAKER_01", "text": "раз"},
        {"id": "s2", "start": 3.5, "end": 8.0, "speaker": "SPEAKER_00", "text": ""},
    ]


def test_words_from_transcription_falls_back_to_segments():
    assert label_draft.words_from_transcription(
        {"word_segments": [{"word": "a", "start": 1, "end": 2}]}
    ) == [{"word": "a", "start": 1, "end": 2}]
    assert label_draft.words_from_transcription(
        {"segments": [{"text": "фраза", "start": 1, "end": 3}]}
    ) == [{"word": "фраза", "start": 1, "end": 3}]
    assert label_draft.words_from_transcription({}) == []


# ---------------------------------------------------------------------------
# labeling.py: validation, RTTM, draft loading, playback
# ---------------------------------------------------------------------------

def test_normalize_settings_clamps_and_whitelists():
    s = labeling.normalize_settings(
        {
            "num_speakers": 99,
            "min_speakers": 6,
            "max_speakers": 3,
            "with_text": False,
            "stt_engine": "evil",
            "separator": "none",
            "language": "xx",
            "extra": "dropped",
        }
    )
    assert s == {
        "num_speakers": 20,
        "min_speakers": 3,
        "max_speakers": 6,
        "with_text": False,
        "separator": "none",
    }
    assert labeling.normalize_settings(None)["with_text"] is True


def test_validate_segments_sorts_and_dedupes_ids():
    clean = labeling.validate_segments(
        [
            {"id": "x", "start": 5, "end": 6.12345, "speaker": "SPEAKER_01", "text": "b"},
            {"id": "x", "start": 1, "end": 2, "speaker": "SPEAKER_00"},
            {"start": 3, "end": 4, "speaker": "NEW_1"},
        ],
        duration=10,
    )
    assert [s["start"] for s in clean] == [1, 3, 5]
    assert len({s["id"] for s in clean}) == 3
    assert clean[2]["end"] == 6.123
    assert clean[0]["text"] == ""


@pytest.mark.parametrize(
    "segments",
    [
        "nope",
        [{"start": 2, "end": 1, "speaker": "A"}],
        [{"start": -1, "end": 1, "speaker": "A"}],
        [{"start": 0, "end": float("nan"), "speaker": "A"}],
        [{"start": 0, "end": 1, "speaker": "../evil"}],
        [{"start": 0, "end": 1, "speaker": ""}],
        [{"start": 0, "end": 100, "speaker": "A"}],  # beyond duration + 5s
        [1],
    ],
)
def test_validate_segments_rejects_bad_input(segments):
    with pytest.raises(ValueError):
        labeling.validate_segments(segments, duration=10)


def test_validate_speakers_drops_empty_and_coerces_user_id():
    clean = labeling.validate_speakers(
        {
            "SPEAKER_00": {"name": " Иванов И.И. ", "user_id": "12"},
            "SPEAKER_01": {"name": ""},
            "SPEAKER_02": "Гость",
            "SPEAKER_03": {"name": "Петров", "user_id": "abc"},
        }
    )
    assert clean == {
        "SPEAKER_00": {"name": "Иванов И.И.", "user_id": 12},
        "SPEAKER_02": {"name": "Гость", "user_id": None},
        "SPEAKER_03": {"name": "Петров", "user_id": None},
    }
    with pytest.raises(ValueError):
        labeling.validate_speakers({"bad label": {"name": "x"}})


def test_segments_to_rttm_labels_and_names():
    segments = [
        {"start": 3.0, "end": 4.5, "speaker": "SPEAKER_01"},
        {"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00"},
        {"start": 5.0, "end": 5.0, "speaker": "SPEAKER_00"},  # zero length -> skipped
    ]
    speakers = {"SPEAKER_00": {"name": "Иванов И.И.", "user_id": 1}}
    assert labeling.segments_to_rttm("p1", segments, speakers).splitlines() == [
        "SPEAKER p1 1 0.000 2.000 <NA> <NA> SPEAKER_00 <NA> <NA>",
        "SPEAKER p1 1 3.000 1.500 <NA> <NA> SPEAKER_01 <NA> <NA>",
    ]
    named = labeling.segments_to_rttm("p1", segments, speakers, use_names=True)
    assert "Иванов_И.И." in named and "SPEAKER_01" in named
    assert labeling.segments_to_rttm("p1", [], {}) == ""


@pytest.fixture()
def vv_tree(tmp_path, monkeypatch):
    root = tmp_path / "voice_video"
    root.mkdir()
    fake = SimpleNamespace(voicevideo_root=root, upload_max_bytes=1024, data_dir=tmp_path / "data")
    monkeypatch.setattr(pipeline, "config", fake)
    monkeypatch.setattr(labeling, "config", fake)
    return root


def test_project_dir_rejects_traversal(vv_tree):
    assert labeling.project_dir("abc123") == (vv_tree / "labeling" / "abc123").resolve()
    assert labeling.project_dir("../x") is None
    assert labeling.project_dir("") is None


def test_load_draft_validates_and_confines_audio(vv_tree):
    out = vv_tree / "labeling" / "p1"
    out.mkdir(parents=True)
    (out / "audio.mp3").write_bytes(b"x")
    (out / "draft.json").write_text(
        json.dumps(
            {
                "duration": 20,
                "audio": "../../../etc/audio.mp3",  # only the file name is honoured
                "segments": [{"start": 1, "end": 2, "speaker": "SPEAKER_00", "text": "т"}],
            }
        ),
        encoding="utf-8",
    )
    draft = labeling.load_draft(out)
    assert draft["duration"] == 20.0
    assert Path(draft["audio_path"]) == (out / "audio.mp3").resolve()
    assert draft["segments"][0]["speaker"] == "SPEAKER_00"

    (out / "draft.json").write_text(
        json.dumps({"segments": [{"start": 2, "end": 1, "speaker": "A"}]}), encoding="utf-8"
    )
    with pytest.raises(ValueError):
        labeling.load_draft(out)


def test_playback_source_prefers_browser_video_then_mp3(vv_tree):
    pdir = vv_tree / "labeling" / "p1"
    pdir.mkdir(parents=True)
    video = pdir / "label_p1.mp4"
    video.write_bytes(b"v")
    mp3 = pdir / "audio.mp3"
    mp3.write_bytes(b"a")
    project = {"id": "p1", "media_path": str(video), "audio_path": str(mp3)}
    assert labeling.playback_source(project)["kind"] == "video"

    mkv = pdir / "label_p1.mkv"
    mkv.write_bytes(b"v")
    src = labeling.playback_source({**project, "media_path": str(mkv)})
    assert src["kind"] == "audio" and src["path"] == mp3.resolve()

    outside = vv_tree / "other.mp4"
    outside.write_bytes(b"v")
    src = labeling.playback_source({"id": "p1", "media_path": str(outside), "audio_path": ""})
    assert src is None


# ---------------------------------------------------------------------------
# runner: label job argv
# ---------------------------------------------------------------------------

def test_build_label_argv_with_text_and_speakers():
    argv = runner.build_label_argv(
        "C:/l/label_p1.mp4",
        "C:/l",
        {
            "num_speakers": 0,
            "min_speakers": 2,
            "max_speakers": 6,
            "with_text": True,
            "stt_engine": "gemini",
            "separator": "kim",
            "label_project_id": "p1",
        },
    )
    assert argv[1:5] == ["label_draft.py", "C:/l/label_p1.mp4", "--out", "C:/l"]
    joined = " ".join(argv)
    assert "--min-speakers 2" in joined and "--max-speakers 6" in joined
    assert "--num-speakers" not in joined
    assert "--with-text" in argv
    assert "--stt-engine gemini" in joined and "--separator kim" in joined


def test_build_label_argv_without_text_skips_stt_flags():
    argv = runner.build_label_argv("in.wav", "out", {"with_text": False, "stt_engine": "gemini"})
    assert "--with-text" not in argv
    assert "--stt-engine" not in argv


# ---------------------------------------------------------------------------
# label_store + API on sqlite (schema "voice" attached as a separate db file)
# ---------------------------------------------------------------------------

@pytest.fixture()
def voice_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'main.db'}")
    voice_file = tmp_path / "voice.db"

    @event.listens_for(engine, "connect")
    def _attach(dbapi_conn, _record):
        dbapi_conn.execute(f"ATTACH DATABASE '{voice_file}' AS voice")

    Base.metadata.create_all(engine)
    monkeypatch.setattr(label_store, "_engine", lambda: engine)
    monkeypatch.setattr(store, "_engine", lambda: engine)
    yield engine
    engine.dispose()


def _new_project(**over):
    params = dict(
        title="Совещание",
        created_by="tester",
        original_filename="m.mp4",
        media_path="/x/label_p.mp4",
        settings={"with_text": True},
    )
    params.update(over)
    return label_store.create_project(**params)


def test_store_draft_then_save_with_optimistic_lock(voice_db):
    project = _new_project()
    assert project["status"] == "queued"
    assert project["segments"] == [] and project["version"] == 0

    seg = [{"id": "s1", "start": 0.0, "end": 1.0, "speaker": "SPEAKER_00", "text": ""}]
    label_store.apply_draft(project["id"], segments=seg, duration=60.0, audio_path="/x/a.mp3")
    ready = label_store.get_project(project["id"])
    assert ready["status"] == "ready"
    assert ready["segments"] == seg and ready["auto_segments"] == seg
    assert ready["version"] == 1

    # An editor opened before the draft arrived (version 0) cannot overwrite it.
    assert label_store.save_labeling(
        project["id"], expected_version=0, segments=[], speakers={}, title=None, updated_by="u"
    ) is None

    edited = [dict(seg[0], speaker="SPEAKER_01")]
    saved = label_store.save_labeling(
        project["id"],
        expected_version=1,
        segments=edited,
        speakers={"SPEAKER_01": {"name": "Иванов", "user_id": 5}},
        title="Новое имя",
        updated_by="u",
    )
    assert saved["version"] == 2 and saved["title"] == "Новое имя"
    assert saved["segments"] == edited and saved["edited_at"]
    # Same stale version again -> conflict (lost update prevented).
    assert label_store.save_labeling(
        project["id"], expected_version=1, segments=seg, speakers={}, title=None, updated_by="v"
    ) is None

    # A re-run draft keeps human edits, refreshes only auto_segments.
    label_store.apply_draft(project["id"], segments=[], duration=60.0, audio_path=None)
    after = label_store.get_project(project["id"])
    assert after["segments"] == edited and after["auto_segments"] == []
    assert after["speakers"]["SPEAKER_01"]["name"] == "Иванов"


def test_store_list_omits_segments(voice_db):
    _new_project(title="A")
    _new_project(title="B")
    items = label_store.list_projects()
    assert {i["title"] for i in items} == {"A", "B"}
    assert all("segments" not in i for i in items)


@pytest.fixture()
def api(voice_db, vv_tree, monkeypatch):
    from fastapi.testclient import TestClient

    from voice_server import app as app_module, auth

    users = {"admin": {"id": 1, "role": "admin", "username": "boss"},
             "reader": {"id": 2, "role": "user", "username": "r", "permissions": ["voice.read"]}}
    current = {"user": users["admin"]}
    monkeypatch.setattr(auth, "_fetch_web_user", lambda *a, **k: current["user"])
    client = TestClient(app_module.app)
    client.headers["Authorization"] = "Bearer t"
    client.users = users
    client.current = current
    return client


def test_api_requires_manage_permission(api):
    api.current["user"] = api.users["reader"]
    assert api.get("/api/v1/voice/labeling/projects").status_code == 403


def test_api_upload_queues_label_job_and_save_flow(api, vv_tree):
    resp = api.post(
        "/api/v1/voice/labeling/projects",
        files={"file": ("Встреча.mp4", b"0" * 100, "video/mp4")},
        data={"title": "", "settings_json": json.dumps({"min_speakers": 2, "with_text": False})},
    )
    assert resp.status_code == 201, resp.text
    project = resp.json()
    pid = project["id"]
    assert project["title"] == "Встреча"
    assert project["job"]["status"] == "queued"
    media = vv_tree / "labeling" / pid / f"label_{pid}.mp4"
    assert media.exists()

    job = store.get_job(project["job"]["id"])
    assert job["kind"] == "label"
    assert job["settings"]["label_project_id"] == pid
    assert job["settings"]["min_speakers"] == 2

    # Not ready yet -> cannot save.
    assert api.put(
        f"/api/v1/voice/labeling/projects/{pid}", json={"version": 0, "segments": []}
    ).status_code == 409

    label_store.apply_draft(
        pid,
        segments=[{"id": "s1", "start": 0.0, "end": 2.0, "speaker": "SPEAKER_00", "text": "т"}],
        duration=50.0,
        audio_path=None,
    )
    detail = api.get(f"/api/v1/voice/labeling/projects/{pid}").json()
    assert detail["status"] == "ready" and detail["media_kind"] == "video"
    assert detail["segments"][0]["speaker"] == "SPEAKER_00"

    bad = api.put(
        f"/api/v1/voice/labeling/projects/{pid}",
        json={"version": detail["version"], "segments": [{"start": 3, "end": 1, "speaker": "A"}]},
    )
    assert bad.status_code == 422

    ok = api.put(
        f"/api/v1/voice/labeling/projects/{pid}",
        json={
            "version": detail["version"],
            "segments": [
                {"id": "s1", "start": 0, "end": 1, "speaker": "SPEAKER_00"},
                {"id": "s2", "start": 1, "end": 2, "speaker": "SPEAKER_02"},
            ],
            "speakers": {"SPEAKER_02": {"name": "Петров П.П.", "user_id": 7}},
        },
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["version"] == detail["version"] + 1
    stale = api.put(
        f"/api/v1/voice/labeling/projects/{pid}",
        json={"version": detail["version"], "segments": []},
    )
    assert stale.status_code == 409

    rttm = api.get(f"/api/v1/voice/labeling/projects/{pid}/rttm?names=1")
    assert rttm.status_code == 200
    assert "Петров_П.П." in rttm.text and "SPEAKER_00" in rttm.text
    auto = api.get(f"/api/v1/voice/labeling/projects/{pid}/rttm?source=auto")
    assert auto.text.count("SPEAKER ") == 1

    media_resp = api.get(f"/api/v1/voice/labeling/projects/{pid}/media")
    assert media_resp.status_code == 200 and media_resp.content == b"0" * 100

    # Active job blocks deletion; finished one allows it.
    assert api.delete(f"/api/v1/voice/labeling/projects/{pid}").status_code == 409
    store.update_job(project["job"]["id"], status="done")
    deleted = api.delete(f"/api/v1/voice/labeling/projects/{pid}")
    assert deleted.status_code == 200
    assert not (vv_tree / "labeling" / pid).exists()
    assert label_store.get_project(pid) is None


def test_api_rejects_unsupported_format_and_oversize(api, vv_tree):
    resp = api.post(
        "/api/v1/voice/labeling/projects",
        files={"file": ("x.exe", b"0", "application/octet-stream")},
    )
    assert resp.status_code == 422
    resp = api.post(
        "/api/v1/voice/labeling/projects",
        files={"file": ("big.mp3", b"0" * 2048, "audio/mpeg")},  # limit 1024 in vv_tree
    )
    assert resp.status_code == 413
    assert not any((vv_tree / "labeling").glob("*/*.mp3"))


def test_api_retry_only_after_failure(api, vv_tree):
    resp = api.post(
        "/api/v1/voice/labeling/projects",
        files={"file": ("a.wav", b"0" * 10, "audio/wav")},
    )
    pid = resp.json()["id"]
    first_job = resp.json()["job"]["id"]
    assert api.post(f"/api/v1/voice/labeling/projects/{pid}/retry").status_code == 409
    store.update_job(first_job, status="failed")
    label_store.set_status(pid, "failed", "boom")
    retried = api.post(f"/api/v1/voice/labeling/projects/{pid}/retry")
    assert retried.status_code == 201
    assert retried.json()["job"]["id"] != first_job
    assert retried.json()["status"] == "queued"


# ---------------------------------------------------------------------------
# runner: label job end-to-end with a fake label_draft.py subprocess
# ---------------------------------------------------------------------------

def _label_job(api, vv_tree, monkeypatch, fake_rc, write_draft=True):
    resp = api.post(
        "/api/v1/voice/labeling/projects",
        files={"file": ("m.wav", b"0" * 10, "audio/wav")},
        data={"settings_json": json.dumps({"with_text": False})},
    )
    pid = resp.json()["id"]
    job = store.get_job(resp.json()["job"]["id"])
    out_dir = vv_tree / "labeling" / pid
    seen = {}

    def fake_run(job_id, argv, log_file, env_extra=None):
        seen["argv"] = argv
        assert label_store.get_project(pid)["status"] == "processing"
        if write_draft:
            (out_dir / "audio.mp3").write_bytes(b"a")
            (out_dir / "draft.json").write_text(
                json.dumps(
                    {
                        "duration": 9,
                        "audio": "audio.mp3",
                        "segments": [{"id": "s1", "start": 0, "end": 2, "speaker": "SPEAKER_00"}],
                    }
                ),
                encoding="utf-8",
            )
        return fake_rc

    monkeypatch.setattr(runner, "_run_subprocess", fake_run)
    monkeypatch.setattr(runner, "config", SimpleNamespace(
        voicevideo_python="python", data_dir=vv_tree.parent / "data", log_tail_lines=50,
    ))
    runner.run_job(job)
    return pid, job["id"], seen


def test_runner_label_job_applies_draft(api, vv_tree, monkeypatch):
    pid, job_id, seen = _label_job(api, vv_tree, monkeypatch, fake_rc=0)
    assert seen["argv"][1] == "label_draft.py"
    project = label_store.get_project(pid)
    assert project["status"] == "ready"
    assert project["duration"] == 9.0
    assert project["segments"][0]["speaker"] == "SPEAKER_00"
    assert project["audio_path"].endswith("audio.mp3")
    assert store.get_job(job_id)["status"] == "done"


def test_runner_label_job_failure_marks_project(api, vv_tree, monkeypatch):
    pid, job_id, _ = _label_job(api, vv_tree, monkeypatch, fake_rc=1, write_draft=False)
    project = label_store.get_project(pid)
    assert project["status"] == "failed"
    assert "exited with code 1" in project["error"]
    assert store.get_job(job_id)["status"] == "failed"


def test_runner_label_job_missing_draft_marks_project(api, vv_tree, monkeypatch):
    pid, _, _ = _label_job(api, vv_tree, monkeypatch, fake_rc=0, write_draft=False)
    project = label_store.get_project(pid)
    assert project["status"] == "failed" and "Invalid draft" in project["error"]


def test_cancelled_in_queue_shows_failed_and_can_retry(api, vv_tree):
    resp = api.post(
        "/api/v1/voice/labeling/projects",
        files={"file": ("m.wav", b"0" * 10, "audio/wav")},
    )
    pid, job_id = resp.json()["id"], resp.json()["job"]["id"]
    store.update_job(job_id, status="cancelled")  # what /jobs/{id}/cancel does for queued jobs
    listed = api.get("/api/v1/voice/labeling/projects").json()["items"][0]
    assert listed["status"] == "failed" and listed["error"]
    assert api.post(f"/api/v1/voice/labeling/projects/{pid}/retry").status_code == 201


# ---------------------------------------------------------------------------
# DER, variants, voice enrollment
# ---------------------------------------------------------------------------

from voice_server import labeling_metrics  # noqa: E402


def _s(start, end, spk):
    return {"start": start, "end": end, "speaker": spk}


def test_hungarian_matches_bruteforce():
    import itertools
    import random

    rnd = random.Random(7)
    for _ in range(200):
        rows, cols = rnd.randint(1, 5), rnd.randint(1, 5)
        w = [[rnd.randint(0, 9) for _ in range(cols)] for _ in range(rows)]
        if rows <= cols:
            best = max(sum(w[i][p[i]] for i in range(rows)) for p in itertools.permutations(range(cols), rows))
        else:
            best = max(sum(w[p[j]][j] for j in range(cols)) for p in itertools.permutations(range(rows), cols))
        assert sum(w[r][c] for r, c in labeling_metrics.hungarian_max(w)) == best


def test_der_perfect_with_renamed_speakers():
    ref = [_s(0, 10, "A"), _s(10, 20, "B")]
    res = labeling_metrics.diarization_error(ref, [_s(0, 10, "x"), _s(10, 20, "y")], collar=0)
    assert res["der"] == 0.0 and res["mapping"] == {"x": "A", "y": "B"}


def test_der_components():
    ref = [_s(0, 10, "A"), _s(10, 20, "B")]
    merged = labeling_metrics.diarization_error(ref, [_s(0, 20, "x")], collar=0)
    assert merged["confusion"] == 0.5 and merged["miss"] == 0.0 and merged["der"] == 0.5
    missed = labeling_metrics.diarization_error(ref, [_s(0, 10, "x")], collar=0)
    assert missed["miss"] == 0.5 and missed["confusion"] == 0.0
    extra = labeling_metrics.diarization_error(ref, [_s(0, 20, "x"), _s(0, 5, "y")], collar=0)
    assert extra["false_alarm"] == 0.25
    # Overlap in the reference counts both speakers.
    both = labeling_metrics.diarization_error([_s(0, 10, "A"), _s(0, 10, "B")], [_s(0, 10, "x")], collar=0)
    assert both["reference_speech_sec"] == 20.0 and both["miss"] == 0.5
    empty = labeling_metrics.diarization_error([], [_s(0, 1, "x")])
    assert empty["der"] is None


def test_der_collar_forgives_boundary_shift():
    ref = [_s(0, 10, "A"), _s(10, 20, "B")]
    hyp = [_s(0, 10.2, "x"), _s(10.2, 20, "y")]
    assert labeling_metrics.diarization_error(ref, hyp, collar=0)["der"] > 0
    assert labeling_metrics.diarization_error(ref, hyp, collar=0.25)["der"] == 0.0


def test_enroll_spans_longest_first_then_sorted():
    segs = [_s(0, 1, "A"), _s(5, 10, "A"), _s(2, 4, "A"), _s(3, 9, "B")]
    assert labeling.enroll_spans(segs, "A", limit=2) == [[2.0, 4.0], [5.0, 10.0]]
    assert labeling.enroll_spans(segs, "C") == []


def test_pick_sample_spans_caps_total():
    picked = label_draft.pick_sample_spans([[0, 20], [30, 50], [60, 61], [70, 71]], max_total=30)
    assert picked == [[0.0, 20.0], [30.0, 40.0]]
    assert label_draft.pick_sample_spans([[0, 1]]) == []


def test_peaks_from_samples_scales_to_100():
    pytest.importorskip("numpy")
    peaks = label_draft.peaks_from_samples([0] * 800 + [1000] * 800, 8000, step=0.1)
    assert peaks == [0, 100]


def test_build_label_argv_modes():
    variant = runner.build_label_argv(
        "m.mp4", "out", {"variant_name": "kim", "audio": "processed", "separator": "kim", "with_text": True},
        mode="variant",
    )
    joined = " ".join(variant)
    assert "--mode variant --variant-name kim --audio processed" in joined
    assert "--separator kim" in joined and "--with-text" not in variant
    with pytest.raises(ValueError):
        runner.build_label_argv("m", "o", {"variant_name": "../x"}, mode="variant")
    samples = runner.build_label_argv("m", "o", {"separator": "kim"}, mode="samples", samples_spec="o/spec.json")
    assert "--samples-spec o/spec.json" in " ".join(samples) and "--audio processed" in " ".join(samples)


def _ready_project(api, vv_tree, segments, speakers=None):
    resp = api.post(
        "/api/v1/voice/labeling/projects",
        files={"file": ("m.mp4", b"0" * 10, "video/mp4")},
        data={"settings_json": json.dumps({"with_text": False, "separator": "kim"})},
    )
    pid = resp.json()["id"]
    store.update_job(resp.json()["job"]["id"], status="done")
    label_store.apply_draft(pid, segments=segments, duration=60.0, audio_path=None)
    if speakers is not None:
        version = label_store.get_project(pid)["version"]
        label_store.save_labeling(
            pid, expected_version=version, segments=segments, speakers=speakers, title=None, updated_by="t"
        )
    return pid


def _fake_runner(monkeypatch, vv_tree, on_run):
    calls = []

    def fake_run(job_id, argv, log_file, env_extra=None):
        calls.append(argv)
        return on_run(argv)

    monkeypatch.setattr(runner, "_run_subprocess", fake_run)
    monkeypatch.setattr(runner, "config", SimpleNamespace(
        voicevideo_python="python", data_dir=vv_tree.parent / "data", log_tail_lines=50,
    ))
    return calls


def test_variant_job_and_metrics(api, vv_tree, monkeypatch):
    segs = [
        {"id": "s1", "start": 0, "end": 10, "speaker": "SPEAKER_00", "text": ""},
        {"id": "s2", "start": 10, "end": 20, "speaker": "SPEAKER_01", "text": ""},
    ]
    pid = _ready_project(api, vv_tree, segs)
    out_dir = vv_tree / "labeling" / pid

    # Reference = human edit: second half is actually SPEAKER_00 too.
    version = label_store.get_project(pid)["version"]
    edited = [dict(segs[0]), dict(segs[1], speaker="SPEAKER_00")]
    label_store.save_labeling(pid, expected_version=version, segments=edited, speakers={}, title=None, updated_by="t")

    assert api.post(f"/api/v1/voice/labeling/projects/{pid}/variants", json={"separator": "none"}).status_code == 422
    resp = api.post(f"/api/v1/voice/labeling/projects/{pid}/variants", json={"separator": "kim"})
    assert resp.status_code == 201, resp.text
    aux = resp.json()["aux_job"]
    assert aux["action"] == "variant" and aux["status"] == "queued"
    assert resp.json()["status"] == "ready"  # labeling stays editable
    # Second aux job while the first is queued -> conflict.
    assert api.post(f"/api/v1/voice/labeling/projects/{pid}/variants", json={"separator": "kim"}).status_code == 409

    def on_run(argv):
        assert "--mode" in argv and "variant" in argv
        (out_dir / "variant_kim.json").write_text(json.dumps({
            "audio": "processed", "separator": "kim",
            "segments": [{"start": 0, "end": 20, "speaker": "SPEAKER_00"}],
        }), encoding="utf-8")
        return 0

    _fake_runner(monkeypatch, vv_tree, on_run)
    runner.run_job(store.get_job(aux["id"]))
    assert store.get_job(aux["id"])["status"] == "done"

    detail = api.get(f"/api/v1/voice/labeling/projects/{pid}").json()
    assert detail["variants"] == [{
        "name": "kim", "audio": "processed", "separator": "kim",
        "created_at": detail["variants"][0]["created_at"], "segments_count": 1, "speakers_count": 1,
    }]

    metrics = api.get(f"/api/v1/voice/labeling/projects/{pid}/metrics?collar=0").json()
    assert metrics["edited"] is True
    by_name = {m["name"]: m for m in metrics["items"]}
    assert by_name["auto"]["der"] == 0.5  # draft split one person into two
    assert by_name["kim"]["der"] == 0.0
    assert by_name["kim"]["title"] == "Очищенный звук (kim)"

    assert api.delete(f"/api/v1/voice/labeling/projects/{pid}/variants/kim").json()["variants"] == []
    assert api.delete(f"/api/v1/voice/labeling/projects/{pid}/variants/kim").status_code == 404


def test_enroll_job_cuts_samples_and_enrolls(api, vv_tree, monkeypatch):
    segs = [
        {"id": "s1", "start": 0, "end": 10, "speaker": "SPEAKER_00", "text": ""},
        {"id": "s2", "start": 10, "end": 20, "speaker": "SPEAKER_01", "text": ""},
        {"id": "s3", "start": 20, "end": 25, "speaker": "SPEAKER_02", "text": ""},
    ]
    speakers = {
        "SPEAKER_00": {"name": "Иванов И.И.", "user_id": 1},
        "SPEAKER_01": {"name": "Петров П.П.", "user_id": 2},
    }
    pid = _ready_project(api, vv_tree, segs, speakers)
    out_dir = vv_tree / "labeling" / pid
    # Voice dirs use pipeline.sanitize_base (no trailing dot — Windows paths).
    (vv_tree / "reference_voices" / "Петров П.П").mkdir(parents=True)  # already enrolled

    resp = api.post(f"/api/v1/voice/labeling/projects/{pid}/enroll", json={})
    assert resp.status_code == 201, resp.text
    job = store.get_job(resp.json()["aux_job"]["id"])
    labels = [i["label"] for i in job["settings"]["enroll"]]
    assert labels == ["SPEAKER_00", "SPEAKER_01"]  # unnamed SPEAKER_02 skipped

    def on_run(argv):
        if "--mode" in argv:
            spec = json.loads(Path(argv[argv.index("--samples-spec") + 1]).read_text(encoding="utf-8"))
            assert spec["SPEAKER_00"] == [[0.0, 10.0]]
            (out_dir / "samples").mkdir(exist_ok=True)
            for label in spec:
                (out_dir / "samples" / f"{label}.wav").write_bytes(b"w")
            return 0
        assert argv[argv.index("--speaker-name") + 1] == "Иванов И.И"
        return 0

    calls = _fake_runner(monkeypatch, vv_tree, on_run)
    runner.run_job(job)
    done = store.get_job(job["id"])
    assert done["status"] == "done", done
    assert [c for c in calls if "--enroll-voice" in c].__len__() == 1
    enroll = api.get(f"/api/v1/voice/labeling/projects/{pid}").json()["aux_job"]["enroll"]
    assert {e["name"]: e.get("skipped") for e in enroll} == {"Иванов И.И": None, "Петров П.П": "exists"}


def test_enroll_requires_named_speakers(api, vv_tree):
    pid = _ready_project(api, vv_tree, [{"id": "s1", "start": 0, "end": 5, "speaker": "SPEAKER_00", "text": ""}])
    resp = api.post(f"/api/v1/voice/labeling/projects/{pid}/enroll", json={"labels": ["SPEAKER_00"]})
    assert resp.status_code == 422


def test_peaks_endpoint(api, vv_tree):
    pid = _ready_project(api, vv_tree, [{"id": "s1", "start": 0, "end": 5, "speaker": "SPEAKER_00", "text": ""}])
    assert api.get(f"/api/v1/voice/labeling/projects/{pid}/peaks").status_code == 404
    (vv_tree / "labeling" / pid / "peaks.json").write_text('{"step":0.1,"peaks":[1,2]}', encoding="utf-8")
    assert api.get(f"/api/v1/voice/labeling/projects/{pid}").json()["has_peaks"] is True
    assert api.get(f"/api/v1/voice/labeling/projects/{pid}/peaks").json()["peaks"] == [1, 2]
