"""voice_video/modules/speaker_utils.py and media_meta.py: pure helpers (no torch)."""
from __future__ import annotations

import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load(name):
    spec = importlib.util.spec_from_file_location(
        f"{name}_under_test", ROOT / "voice_video" / "modules" / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


su = _load("speaker_utils")
mm = _load("media_meta")


def t(start, end, spk):
    return {"start": start, "end": end, "speaker": spk}


def test_overlap_picks_speaker_with_largest_intersection():
    idx = su.TurnIndex([t(0, 10, "A"), t(9, 12, "B")])
    assert idx.speaker_for_span(9.0, 9.3) == "B"  # equal overlap -> shorter (interrupting) turn
    assert idx.speaker_for_span(8.5, 9.6) == "A"  # 1.1 s with A vs 0.6 s with B
    assert idx.speaker_for_span(9.5, 11.0) == "B"
    assert idx.speaker_for_span(1.0, 2.0) == "A"


def test_overlap_result_is_independent_of_input_order():
    turns = [t(0, 10, "A"), t(4, 5, "B"), t(4.5, 6, "C")]
    for order in (turns, list(reversed(turns))):
        idx = su.TurnIndex(order)
        assert idx.speaker_for_span(4.6, 4.9) == "B"  # B and C overlap equally, B shorter
        assert idx.speaker_for_span(5.2, 5.8) == "C"


def test_long_turn_found_behind_many_interruptions():
    turns = [t(0, 100, "A")] + [t(1 + i, 1.5 + i, f"S{i}") for i in range(400)]
    idx = su.TurnIndex(turns)
    assert idx.speaker_for_span(60.6, 60.9) == "A"  # only the long turn is active here
    assert idx.speaker_for_span(60.0, 60.3) == "S59"  # equal overlap -> the interruption


def test_matches_bruteforce_on_random_turns():
    import random

    rnd = random.Random(3)
    for _ in range(300):
        turns = []
        for i in range(rnd.randint(1, 30)):
            s0 = rnd.uniform(0, 60)
            turns.append(t(s0, s0 + rnd.uniform(0.2, 15), f"S{rnd.randint(0, 4)}"))
        a = rnd.uniform(0, 70)
        b = a + rnd.uniform(0.05, 2)
        overlap, shortest = {}, {}
        for x in turns:
            ov = min(b, x["end"]) - max(a, x["start"])
            if ov > 0:
                overlap[x["speaker"]] = overlap.get(x["speaker"], 0) + ov
                shortest[x["speaker"]] = min(shortest.get(x["speaker"], 1e9), x["end"] - x["start"])
        got = su.TurnIndex(turns).speaker_for_span(a, b)
        if overlap:
            assert got == min(overlap, key=lambda s: (-overlap[s], shortest[s], s))


def test_snap_to_nearest_turn_and_none_when_far():
    idx = su.TurnIndex([t(0, 2, "A"), t(5, 6, "B")])
    assert idx.speaker_for_span(2.1, 2.2) == "A"
    assert idx.speaker_for_span(4.8, 4.9) == "B"
    assert idx.speaker_for_span(3.0, 3.5) is None
    assert not su.TurnIndex([])


def test_assign_words_falls_back_to_previous_word():
    idx = su.TurnIndex([t(0, 1, "A"), t(3, 4, "B")])
    words = [
        {"word": "a", "start": 0.1, "end": 0.4},
        {"word": "gap", "start": 1.8, "end": 2.0},
        {"word": "b", "start": 3.1, "end": 3.3},
    ]
    assert su.assign_words_by_overlap(words, idx, "X") == ["A", "A", "B"]
    assert su.assign_words_by_overlap([{"start": 9, "end": 9.5}], idx, "X") == ["X"]


def test_pick_embedding_spans_longest_and_centered():
    segs = [
        {"start": 0, "end": 1},  # too short
        {"start": 10, "end": 30},  # 20 s -> centre 8 s
        {"start_time": 40, "end_time": 43},  # legacy keys
        {"start": 50, "end": 52.5},
    ]
    spans = su.pick_embedding_spans(segs, max_spans=2, min_duration=2.0, max_duration=8.0)
    assert spans == [(16.0, 24.0), (40.0, 43.0)]
    assert su.pick_embedding_spans(segs, min_duration=100) == []


def test_mean_normalized_is_unit_and_scale_invariant():
    np = pytest.importorskip("numpy")
    a = su.mean_normalized([[3, 0], [0, 100]])
    assert np.isclose(np.linalg.norm(a), 1.0)
    assert np.allclose(a, [2 ** -0.5, 2 ** -0.5])
    assert su.mean_normalized([]) is None


def test_parse_creation_date():
    now = datetime(2026, 10, 2, tzinfo=timezone.utc)
    payload = {"format": {"tags": {"creation_time": "2026-09-25T08:30:00.000000Z"}}}
    assert mm.parse_creation_date(json.dumps(payload), now) == "25.09.2026"
    stream_only = {"format": {}, "streams": [{"tags": {"creation_time": "2026-09-30T10:00:00Z"}}]}
    assert mm.parse_creation_date(json.dumps(stream_only), now) == "30.09.2026"
    for bad in ("1970-01-01T00:00:00Z", "2027-01-01T00:00:00Z", "garbage"):
        assert mm.parse_creation_date(json.dumps({"format": {"tags": {"creation_time": bad}}}), now) is None
    assert mm.parse_creation_date("not json", now) is None


ar = _load("action_registry")


def test_registry_json_rendered_as_safe_table():
    text = json.dumps({"groups": [
        {"title": "Объект А", "items": [
            {"time": "12:05", "task": "Сверить A | B\nитоги", "assignee": "Иванов И.И.", "deadline": ""},
            {"time": "", "task": "  ", "assignee": "x"},  # empty task dropped
        ]},
        {"title": "", "items": [{"time": "1:02:10", "task": "Доложить ГД", "assignee": None, "deadline": "25.09"}]},
        {"title": "Пусто", "items": []},
    ]}, ensure_ascii=False)
    md = ar.registry_markdown_from_llm("```json\n" + text + "\n```")
    assert "### Объект А" in md and "### Общие поручения" in md and "Пусто" not in md
    assert "| 1 | 12:05 | Сверить A / B итоги | Иванов И.И. | — |" in md
    assert "| 1 | 1:02:10 | Доложить ГД | — | 25.09 |" in md


def test_registry_fallbacks():
    assert ar.registry_markdown_from_llm('{"groups": []}') is None
    legacy = "| № | Время | Поручение | Ответственный | Срок |\n| 1 | 01:00 | A | B | — |"
    assert ar.registry_markdown_from_llm(legacy) == legacy
    assert ar.registry_markdown_from_llm("просто текст") is None
    assert ar.registry_markdown_from_llm('Вот JSON: {"groups": [{"title": "X", "items": [{"task": "T"}]}]} конец')


def test_rendered_registry_parses_in_voice_server(tmp_path, monkeypatch):
    """Contract: the table we render is exactly what voice_server parses."""
    import os
    from types import SimpleNamespace

    os.environ.setdefault("VOICE_DATABASE_URL", "postgresql+psycopg://t:t@127.0.0.1:5432/t")
    from voice_server import pipeline

    md = ar.render_registry_markdown([
        {"title": "Объект А", "items": [
            {"time": "12:05", "task": "Сверить | итоги", "assignee": "Иванов", "deadline": "01.10"},
            {"time": "13:00", "task": "Доложить ГД", "assignee": "", "deadline": ""},
        ]},
    ])
    root = tmp_path / "vv"
    mdir = root / "output" / "m"
    mdir.mkdir(parents=True)
    (mdir / "m_report.json").write_text(json.dumps({"action_registry": md}, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(pipeline, "config", SimpleNamespace(voicevideo_root=root))
    items = pipeline.meeting_assignments("m")
    assert [(i["section"], i["task"], i["assignee"], i["deadline"]) for i in items] == [
        ("Объект А", "Сверить / итоги", "Иванов", "01.10"),
        ("Объект А", "Доложить ГД", "—", "—"),
    ]
