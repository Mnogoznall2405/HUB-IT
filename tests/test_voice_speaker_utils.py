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
    assert "### Объект А" in md and "### Разное" in md and "Пусто" not in md
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


def test_subtract_intervals_and_solo_segments():
    assert su.subtract_intervals((0, 10), [(2, 3), (5, 12)]) == [(0, 2), (3, 5)]
    assert su.subtract_intervals((0, 10), []) == [(0, 10)]
    segs = [{"start": 0, "end": 10, "speaker": "A"}, {"start": 20, "end": 25, "speaker": "B"}]
    turns = [{"start": 0, "end": 10, "speaker": "A"}, {"start": 4, "end": 5, "speaker": "B"}]
    solo = su.solo_segments(segs, "A", turns, pad=0.2)
    assert [(round(s["start"], 1), round(s["end"], 1)) for s in solo] == [(0.0, 3.8), (5.2, 10.0)]
    assert su.solo_segments(segs, "A", None) == [segs[0]]


def test_recurring_registry_matches_updates_and_dedupes():
    pytest.importorskip("numpy")
    entries = []
    a = su.register_recurring(entries, [1, 0, 0], "m1", "SPEAKER_01", threshold=0.6)
    assert a["id"] == "R001" and len(entries) == 1
    same = su.register_recurring(entries, [0.9, 0.1, 0], "m2", "SPEAKER_00", threshold=0.6)
    assert same is a and [o["base"] for o in a["occurrences"]] == ["m1", "m2"]
    su.register_recurring(entries, [0.9, 0.1, 0], "m2", "SPEAKER_00", threshold=0.6)  # resume: no dup
    assert len(a["occurrences"]) == 2
    other = su.register_recurring(entries, [0, 1, 0], "m2", "SPEAKER_02", threshold=0.6)
    assert other["id"] == "R002" and len(entries) == 2
    # Different embedding size never matches.
    found, sim = su.match_recurring(entries, [1, 0, 0, 0], 0.1)
    assert found is None and sim == -1.0


def test_recurring_registry_file_roundtrip(tmp_path, monkeypatch):
    pytest.importorskip("numpy")
    import sys
    import types

    # recurring.py uses a relative import of speaker_utils: load both as a tiny package.
    pkg = types.ModuleType("vvmods")
    pkg.__path__ = [str(ROOT / "voice_video" / "modules")]
    monkeypatch.setitem(sys.modules, "vvmods", pkg)
    spec = importlib.util.spec_from_file_location("vvmods.recurring", ROOT / "voice_video" / "modules" / "recurring.py")
    rec = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "vvmods.recurring", rec)
    spec.loader.exec_module(rec)

    path = rec.registry_path(tmp_path)
    assert rec.load_registry(path) == []
    first = rec.register_meeting_voices(path, "m1", {"SPEAKER_01": [1, 0, 0]}, threshold=0.6)
    assert first == {"SPEAKER_01": {"id": "R001", "meetings": [], "count": 1}}
    second = rec.register_meeting_voices(
        path, "m2", {"SPEAKER_00": [0.95, 0.05, 0], "SPEAKER_03": [0, 0, 1]}, threshold=0.6,
    )
    assert second["SPEAKER_00"] == {"id": "R001", "meetings": ["m1"], "count": 2}
    assert second["SPEAKER_03"]["id"] == "R002"
    path.write_text("broken", encoding="utf-8")
    assert rec.load_registry(path) == []  # corrupt file -> start over, no crash


def test_diarization_windows_partition_timeline_without_overlap_or_gaps():
    windows = list(su.diarization_windows(25, 1, 10, 2))
    assert windows == [(0, 10, 0, 9), (8, 18, 9, 17), (16, 25, 17, 25)]
    assert list(su.diarization_windows(4, 1, 10, 2)) == [(0, 4, 0, 4)]
    assert list(su.diarization_windows(0, 1, 10, 2)) == []
    for size, overlap in [(0, 0), (10, 10), (10, -1), (float('nan'), 2)]:
        with pytest.raises(ValueError):
            list(su.diarization_windows(25, 1, size, overlap))


def test_global_registry_supports_more_than_ten_and_return_after_absence():
    np = pytest.importorskip('numpy')
    registry = su.SpeakerChunkRegistry()
    labels = []
    for idx in range(12):
        local = f'L{idx}'
        mapping = registry.assign([t(0, 8, local)], {local: np.eye(12)[idx]}, idx * 20, idx * 20 + 10)
        labels.append(mapping[local])
    returned = registry.assign([t(0, 8, 'renumbered')], {'renumbered': np.eye(12)[0]}, 300, 310)
    assert len(set(labels)) == 12 and returned['renumbered'] == labels[0]


def test_stitching_rejects_ambiguous_similar_voices_and_preserves_prototypes():
    np = pytest.importorskip('numpy')
    registry = su.SpeakerChunkRegistry()
    mapping = registry.assign([t(0, 8, 'A'), t(10, 18, 'B')], {'A': [1, 0], 'B': [.85, .527]}, 0, 20)
    initial = {key: entry['embedding'].copy() for key, entry in registry.entries.items()}
    changed = registry.assign([t(0, 8, 'X')], {'X': [.96, .28]}, 30, 40)
    assert changed['X'] not in mapping.values()
    assert registry.decisions[-1]['reason'] == 'ambiguous'
    assert all(np.allclose(registry.entries[key]['embedding'], vector) for key, vector in initial.items())


def test_two_local_voices_cannot_claim_one_global_identity():
    registry = su.SpeakerChunkRegistry()
    initial = registry.assign([t(0, 8, 'A')], {'A': [1, 0]}, 0, 10)['A']
    mapping = registry.assign([t(0, 8, 'X'), t(10, 18, 'Y')], {'X': [1, 0], 'Y': [1, 0]}, 20, 40)
    assert mapping['X'] != mapping['Y']
    assert initial not in mapping.values()


def test_boundary_anchor_keeps_short_voice_without_contaminating_embedding():
    registry = su.SpeakerChunkRegistry()
    first = registry.assign([t(6, 10, 'A')], {'A': [1, 0]}, 0, 10)['A']
    second = registry.assign([t(0, 4, 'B')], {'B': [1, 0]}, 8, 18)['B']
    assert first == second
    assert registry.entries[first]['embedding'] is None


def test_boundary_embedding_conflict_is_quarantined():
    registry = su.SpeakerChunkRegistry()
    first = registry.assign([t(0, 20, 'A')], {'A': [1, 0]}, 0, 20)['A']
    second = registry.assign([t(0, 8, 'B')], {'B': [0, 1]}, 18, 28)['B']
    assert second != first
    assert registry.entries[second]['embedding'] is None
    assert registry.decisions[-1]['reason'] == 'boundary_conflict'
    assert registry.absorb_islands() == {}


def test_quarantined_island_is_absorbed_when_prototype_matches():
    np = pytest.importorskip('numpy')
    registry = su.SpeakerChunkRegistry()
    first = registry.assign([t(0, 20, 'A')], {'A': [1, 0]}, 0, 20)['A']
    second = registry.assign([t(0, 20, 'C')], {'C': [0, 1]}, 20, 40)['C']
    island = registry.assign([t(0, 8, 'B')], {'B': [.9, .3]}, 38, 46)['B']
    assert island not in (first, second)
    assert registry.decisions[-1]['reason'] == 'boundary_conflict'
    assert registry.absorb_islands() == {island: first}
    assert registry.entries[first]['embedding'] is not None


def test_overlapped_only_speech_and_invalid_vectors_do_not_merge():
    registry = su.SpeakerChunkRegistry()
    mapping = registry.assign([t(0, 10, 'A'), t(0, 10, 'B')], {'A': [1, 0], 'B': [1, 0]}, 0, 10)
    assert len(set(mapping.values())) == 2
    assert all(entry['embedding'] is None for entry in registry.entries.values())
    invalid = registry.assign([t(0, 8, 'X')], {'X': [float('nan'), 0]}, 20, 30)
    assert invalid['X'] not in mapping.values()
    registry.assign([t(0, 8, 'valid')], {'valid': [1, 0]}, 40, 50)
    with pytest.raises(su.DiarizationChunkError, match='размерност'):
        registry.assign([t(0, 8, 'other_model')], {'other_model': [1, 0, 0]}, 60, 70)


def test_chunked_diarization_stitches_relabelled_windows_and_keeps_overlap_turns():
    np = pytest.importorskip('numpy')
    calls = []

    def diarize(window, **kwargs):
        offset = int(window[0])
        calls.append(kwargs)
        label = 'A' if offset == 0 else 'renumbered'
        regular = [t(0, len(window), label)]
        if offset == 0:
            regular.append(t(2, 4, 'overlapping'))
        return {'segments': [t(0, len(window), label)], 'overlap_segments': regular,
                'embeddings': {label: [1, 0], 'overlapping': [0, 1]}}

    result = su.run_chunked_diarization(
        np.arange(25), diarize, sample_rate=1, chunk_seconds=10, overlap_seconds=2,
        min_speech=2,
    )
    assert result == [t(0, 25, 'SPEAKER_00')]
    assert [segment for segment in result.overlap_segments if segment['speaker'] != 'SPEAKER_00'] == [
        t(2, 4, 'SPEAKER_01'),
    ]
    assert len(calls) == 3
    assert all(call == {'num_speakers': None, 'min_speakers': 1, 'max_speakers': 20} for call in calls)
    assert result.metadata['speakers_count'] == 2


def test_chunked_diarization_absorbed_island_relabels_its_turns():
    np = pytest.importorskip('numpy')

    def diarize(window, **kwargs):
        offset = int(window[0])
        label = {0: 'A', 8: 'B'}.get(offset, 'C')
        start = 0 if offset < 16 else 2
        return {'segments': [t(start, 10, label)], 'overlap_segments': [t(start, 10, label)],
                'embeddings': {label: [1, 0] if label == 'A' else [0, 1]}}

    result = su.run_chunked_diarization(
        np.arange(26), diarize, sample_rate=1, chunk_seconds=10, overlap_seconds=2,
        min_speech=2,
    )
    assert result == [t(0, 9, 'SPEAKER_00'), t(9, 17, 'SPEAKER_02'), t(18, 26, 'SPEAKER_02')]
    assert result.metadata['absorbed'] == {'SPEAKER_01': 'SPEAKER_02'}
    assert result.metadata['speakers_count'] == 2
    assert result.metadata['review_speakers'] == []


def test_chunk_caches_resume_after_failure_and_invalidate_changed_model_and_audio(tmp_path):
    np = pytest.importorskip('numpy')
    prefix = tmp_path / 'audio_diar_window'
    calls = []
    fail = {'enabled': True}

    def diarize(window, **kwargs):
        offset = int(window[0])
        calls.append(offset)
        if offset == 8 and fail['enabled']:
            raise RuntimeError('model failure')
        return {'segments': [t(0, len(window), 'A')],
                'overlap_segments': [t(0, len(window), 'A')], 'embeddings': {'A': [1, 0]}}

    settings = dict(sample_rate=1, chunk_seconds=10, overlap_seconds=2,
                    cache_prefix=prefix, cache_identity={'model': 'revision-1'})
    with pytest.raises(su.DiarizationChunkError, match='2/3'):
        su.run_chunked_diarization(np.arange(25), diarize, **settings)
    assert calls == [0, 8]
    calls.clear()
    fail['enabled'] = False
    result = su.run_chunked_diarization(np.arange(25), diarize, **settings)
    assert calls == [8, 16] and result == [t(0, 25, 'SPEAKER_00')]
    assert result.metadata['windows'][0]['cached']
    calls.clear()
    settings['cache_identity'] = {'model': 'revision-2'}
    su.run_chunked_diarization(np.arange(25), diarize, **settings)
    assert calls == [0, 8, 16]
    calls.clear()
    su.run_chunked_diarization(np.arange(25) + 100, diarize, **settings)
    assert calls == [100, 108, 116]


def test_chunked_diarization_empty_windows_are_valid_and_bad_turns_fail():
    np = pytest.importorskip('numpy')
    empty = su.run_chunked_diarization(
        np.zeros(25), lambda window, **kw: {'segments': [], 'overlap_segments': [], 'embeddings': {}},
        sample_rate=1, chunk_seconds=10, overlap_seconds=2,
    )
    assert empty == [] and empty.metadata['speakers_count'] == 0
    with pytest.raises(su.DiarizationChunkError):
        su.run_chunked_diarization(
            np.zeros(25), lambda window, **kw: {'segments': [t(float('nan'), 5, 'A')],
                                             'overlap_segments': [], 'embeddings': {}},
            sample_rate=1, chunk_seconds=10, overlap_seconds=2,
        )


def _assign_each(registry, vectors, step=20):
    """Каждый вектор — отдельное окно без речи в зоне перекрытия (якорей нет)."""
    labels = []
    for idx, vector in enumerate(vectors):
        offset = idx * step
        labels.append(registry.assign([t(0, 8, 'L')], {'L': vector}, offset, offset + 10)['L'])
    return labels


def test_duplicate_prototypes_of_one_voice_do_not_spawn_a_label_per_window():
    # Прототипы A и B звучали в разных окнах и похожи (cos .75): вектор между ними —
    # скорее всего тот же человек. Раньше каждое такое окно давало новую метку и новый прототип.
    registry = su.SpeakerChunkRegistry()
    a, b = [1.0, 0.0, 0.0], [.75, .661438, 0.0]
    between = [.935, .353, 0.0]
    labels = _assign_each(registry, [a, b] + [between] * 5)
    assert len(registry.entries) == 2
    assert len(set(labels[2:])) == 1
    assert [d['reason'] for d in registry.decisions[2:]] == ['embedding'] * 5


def test_ambiguity_between_clearly_different_voices_still_makes_new_label():
    registry = su.SpeakerChunkRegistry()
    a, b = [1.0, 0.0], [.6, .8]  # cos .6: заметно разные голоса
    labels = _assign_each(registry, [a, b, [.894, .447]])
    assert len(set(labels)) == 3
    assert registry.decisions[-1]['reason'] == 'ambiguous'


def test_voices_seen_together_in_one_window_are_never_treated_as_duplicates():
    registry = su.SpeakerChunkRegistry()
    # A и B звучали в одном окне (cos .85 > similarity − margin): разные люди, даже если похожи
    registry.assign([t(0, 8, 'A'), t(10, 18, 'B')], {'A': [1, 0], 'B': [.85, .527]}, 0, 20)
    registry.assign([t(0, 8, 'X')], {'X': [.96, .28]}, 30, 40)
    assert registry.decisions[-1]['reason'] == 'ambiguous'


def test_ambiguous_voices_are_reported_for_review():
    np = pytest.importorskip('numpy')
    vectors = {0: [1, 0], 8: [.5, .866], 16: [.866, .5]}  # третье окно — между первыми двумя

    def diarize(window, **kwargs):
        offset = int(window[0])
        turn = t(0, 7, 'L') if offset == 0 else t(3, 9, 'L')
        return {'segments': [turn], 'overlap_segments': [turn], 'embeddings': {'L': vectors[offset]}}

    result = su.run_chunked_diarization(
        np.arange(26), diarize, sample_rate=1, chunk_seconds=10, overlap_seconds=2, min_speech=2,
    )
    reasons = [d['reason'] for d in result.metadata['decisions']]
    assert reasons == ['new_voice', 'new_voice', 'ambiguous']
    assert result.metadata['review_speakers'] == ['SPEAKER_02']


def test_reference_samples_are_naturally_ordered_and_keep_original_and_newest(tmp_path):
    for name in ['Ivan.wav', 'Ivan_2.wav', 'Ivan_10.wav', 'Ivan_3.wav']:
        (tmp_path / name).write_bytes(b'x')
    assert [p.name for p in su.reference_sample_files(tmp_path)] == [
        'Ivan.wav', 'Ivan_2.wav', 'Ivan_3.wav', 'Ivan_10.wav']
    for idx in range(4, 10):
        (tmp_path / f'Ivan_{idx}.wav').write_bytes(b'x')
    for idx in range(11, 14):
        (tmp_path / f'Ivan_{idx}.wav').write_bytes(b'x')
    picked = [p.name for p in su.reference_sample_files(tmp_path)]
    assert len(picked) == su.REFERENCE_SAMPLES_LIMIT
    assert picked[0] == 'Ivan.wav' and picked[-1] == 'Ivan_13.wav'  # свежий merge-сэмпл не отсекается


def test_wav_duration_reads_header_and_rejects_garbage(tmp_path):
    import wave

    good = tmp_path / 'a.wav'
    with wave.open(str(good), 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(8000)
        handle.writeframes(b'\x00\x00' * 16000)
    bad = tmp_path / 'b.wav'
    bad.write_bytes(b'not a wav')
    assert su.wav_duration_seconds(good) == 2.0
    assert su.wav_duration_seconds(bad) is None
    assert su.wav_duration_seconds(tmp_path / 'missing.wav') is None


def _load_retry_decorator():
    """retry_on_failure из audio_processor.py без импорта torch: вырезаем функцию из AST."""
    import ast
    import logging
    from functools import wraps
    from types import SimpleNamespace

    source = (ROOT / 'voice_video' / 'modules' / 'audio_processor.py').read_text(encoding='utf-8-sig')
    node = next(n for n in ast.parse(source).body
                if isinstance(n, ast.FunctionDef) and n.name == 'retry_on_failure')
    namespace = {'wraps': wraps, 'logger': logging.getLogger('retry-test'),
                 'time': SimpleNamespace(sleep=lambda *_: None)}
    exec(compile(ast.Module([node], []), 'audio_processor.py', 'exec'), namespace)
    return namespace['retry_on_failure']


def test_retry_does_not_repeat_fatal_errors_but_retries_others():
    retry = _load_retry_decorator()
    calls = {'fatal': 0, 'flaky': 0}

    @retry(max_retries=2, fatal=(su.DiarizationChunkError,))
    def fatal():
        calls['fatal'] += 1
        raise su.DiarizationChunkError('окно 3/9')

    @retry(max_retries=2, fatal=(su.DiarizationChunkError,))
    def flaky():
        calls['flaky'] += 1
        if calls['flaky'] < 3:
            raise RuntimeError('transient')
        return 'ok'

    with pytest.raises(su.DiarizationChunkError):
        fatal()
    assert flaky() == 'ok'
    assert calls == {'fatal': 1, 'flaky': 3}


def _two_voice_registry(cos_between, together=False):
    registry = su.SpeakerChunkRegistry()
    a, b = [1.0, 0.0, 0.0], [cos_between, (1 - cos_between ** 2) ** .5, 0.0]
    if together:
        registry.assign([t(0, 8, 'A'), t(10, 18, 'B')], {'A': a, 'B': b}, 0, 20)
    else:
        _assign_each(registry, [a, b])
    return registry


def test_duplicate_labels_of_one_person_are_merged_into_the_longer_one():
    registry = _two_voice_registry(.77)  # <.8: окна дали две метки, но голоса не «заметно разные»
    assert sorted(registry.entries) == ['SPEAKER_00', 'SPEAKER_01']
    merged = registry.merge_duplicates({'SPEAKER_00': 100.0, 'SPEAKER_01': 40.0}, lambda a, b: 0.0)
    assert merged == {'SPEAKER_01': 'SPEAKER_00'}
    assert registry.decisions[-1]['reason'] == 'merged'


@pytest.mark.parametrize('cos_between, together, shared', [
    (.50, False, 0.0),   # заметно разные голоса
    (.77, True, 0.0),    # звучали в одном окне — pyannote их разделил
    (.77, False, 10.0),  # говорят одновременно — не один человек
])
def test_distinct_labels_are_not_merged(cos_between, together, shared):
    registry = _two_voice_registry(cos_between, together)
    assert registry.merge_duplicates({'SPEAKER_00': 100.0, 'SPEAKER_01': 40.0}, lambda a, b: shared) == {}


def test_merge_does_not_chain_through_a_middle_voice():
    import math

    registry = su.SpeakerChunkRegistry()
    angles = [0, 40, 80]  # соседи cos .77, крайние cos .17
    _assign_each(registry, [[math.cos(math.radians(g)), math.sin(math.radians(g)), 0.0] for g in angles])
    assert len(registry.entries) == 3
    merged = registry.merge_duplicates(
        {'SPEAKER_00': 100.0, 'SPEAKER_01': 100.0, 'SPEAKER_02': 100.0}, lambda a, b: 0.0)
    assert len(merged) == 1 and 'SPEAKER_02' not in merged.values()


def test_chunked_diarization_merges_duplicate_labels_and_relabels_turns():
    np = pytest.importorskip('numpy')
    vectors = {0: [1.0, 0.0, 0.0], 8: [.77, .638, 0.0]}

    def diarize(window, **kwargs):
        offset = int(window[0])
        if offset not in vectors:
            return {'segments': [], 'overlap_segments': [], 'embeddings': {}}
        turn = t(0, 7, 'L') if offset == 0 else t(3, 9, 'L')
        return {'segments': [turn], 'overlap_segments': [turn], 'embeddings': {'L': vectors[offset]}}

    result = su.run_chunked_diarization(
        np.arange(26), diarize, sample_rate=1, chunk_seconds=10, overlap_seconds=2, min_speech=2,
    )
    assert {turn['speaker'] for turn in result} == {'SPEAKER_00'}
    assert {turn['speaker'] for turn in result.overlap_segments} == {'SPEAKER_00'}
    assert result.metadata['merged'] == {'SPEAKER_01': 'SPEAKER_00'}
    assert result.metadata['speakers_count'] == 1


def test_merge_uses_recomputed_vectors_when_window_prototypes_are_noisy():
    # Оконные прототипы малоговорящего человека шумят (cos .5), а вектор по чистым репликам всей записи ясен.
    registry = _two_voice_registry(.50)
    speech, shared = {'SPEAKER_00': 100.0, 'SPEAKER_01': 20.0}, (lambda a, b: 0.0)
    assert registry.merge_duplicates(speech, shared) == {}
    vectors = {'SPEAKER_00': [1.0, 0.0, 0.0], 'SPEAKER_01': [.9, .436, 0.0]}
    assert registry.merge_duplicates(speech, shared, vectors=vectors) == {'SPEAKER_01': 'SPEAKER_00'}
    different = {'SPEAKER_00': [1.0, 0.0, 0.0], 'SPEAKER_01': [.3, .954, 0.0]}
    assert _two_voice_registry(.50).merge_duplicates(speech, shared, vectors=different) == {}


def _two_window_diarizer():
    vectors = {0: [1.0, 0.0, 0.0], 8: [.5, .866, 0.0]}  # окна не похожи (cos .5)

    def diarize(window, **kwargs):
        offset = int(window[0])
        if offset not in vectors:
            return {'segments': [], 'overlap_segments': [], 'embeddings': {}}
        turn = t(0, 7, 'L') if offset == 0 else t(3, 9, 'L')
        return {'segments': [turn], 'overlap_segments': [turn], 'embeddings': {'L': vectors[offset]}}
    return diarize


def test_chunked_diarization_merges_by_final_label_vectors_and_survives_embedder_failure():
    np = pytest.importorskip('numpy')
    run = lambda embedder: su.run_chunked_diarization(
        np.arange(26), _two_window_diarizer(), sample_rate=1, chunk_seconds=10, overlap_seconds=2,
        min_speech=2, label_embedder=embedder)
    plain = run(None)
    assert plain.metadata['merged'] == {} and plain.metadata['merge_vectors'] == 'prototype'

    seen = {}

    def embedder(selected, ordinary):
        seen['labels'] = sorted({turn['speaker'] for turn in selected})
        return {'SPEAKER_00': [1.0, 0.0, 0.0], 'SPEAKER_01': [.95, .31, 0.0]}

    merged = run(embedder)
    assert seen['labels'] == ['SPEAKER_00', 'SPEAKER_01']
    assert merged.metadata['merged'] == {'SPEAKER_01': 'SPEAKER_00'}
    assert merged.metadata['merge_vectors'] == 'final'
    assert {turn['speaker'] for turn in merged} == {'SPEAKER_00'}

    def broken(selected, ordinary):
        raise RuntimeError('embedder crashed')

    fallback = run(broken)  # улучшение слияния не должно ронять диаризацию
    assert fallback.metadata['merge_vectors'] == 'prototype' and fallback.metadata['merged'] == {}


def test_registry_marks_flagged_items_and_annotator_failure_keeps_registry():
    text = json.dumps({"groups": [{"title": "Объект", "items": [
        {"time": "10:00", "task": "Подписать ДС", "assignee": "Иванов", "deadline": ""},
        {"time": "11:00", "task": "Вернуть аванс", "assignee": "", "deadline": ""},
    ]}]}, ensure_ascii=False)

    def annotate(groups):
        groups[0]["items"][1]["flags"] = ["нет в обсуждении", "нет ответственного"]

    md = ar.registry_markdown_from_llm(text, annotate=annotate)
    assert "| 1 | 10:00 | Подписать ДС | Иванов | — |" in md          # без флагов строка прежняя
    assert "| 2 | 11:00 | Вернуть аванс ⚠ проверить: нет в обсуждении; нет ответственного | — | — |" in md

    def broken(groups):
        raise RuntimeError("Jev упал")

    assert "Подписать ДС" in ar.registry_markdown_from_llm(text, annotate=broken)  # сбой сторожа не теряет реестр
