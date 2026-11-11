"""voice_video/suggest_fragments.py: оценка трудности по минутам и выбор окон (чистая логика)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("suggest_fragments_under_test", ROOT / "voice_video" / "suggest_fragments.py")
sf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sf)


def seg(start, end, speaker):
    return {"start": start, "end": end, "speaker": speaker}


def test_best_mapping_is_one_to_one_and_ignores_label_names():
    reference = [seg(0, 100, "A"), seg(100, 150, "B")]
    hypothesis = [seg(0, 98, "X"), seg(100, 150, "Y"), seg(98, 100, "Z")]
    assert sf.best_mapping(reference, hypothesis) == {"X": "A", "Y": "B"}


def test_disagreement_counts_only_real_conflicts_after_relabeling():
    shift = 60.0
    # первый прогон: A говорит 60–180, второй (сдвинут на 60 с) называет того же человека «Q»,
    # но в минуте 120–180 приписывает его реплики другому голосу «W» — это расхождение
    first = [seg(0, 180, "A")]
    second = [seg(0, 60, "Q"), seg(60, 120, "W")]
    per_minute = sf.disagreement_per_minute(first, second, shift)
    assert per_minute[0] == 0  # до shift не сравниваем
    assert per_minute[1] == pytest.approx(0, abs=1.0)    # 60–120: Q<->A, совпало
    assert per_minute[2] == pytest.approx(60, abs=2.0)   # 120–180: W против A — конфликт


def test_speech_in_only_one_run_counts_half():
    per_minute = sf.disagreement_per_minute([seg(0, 180, "A")], [seg(0, 60, "A")], 60.0)
    assert per_minute[2] == pytest.approx(30.0, abs=1.5)  # 120–180: речь у первого, у второго нет


def test_minute_features_find_interruptions_changes_and_rare_voices():
    final = [seg(0, 50, "A"), seg(50, 60, "B"), seg(60, 70, "A"), seg(70, 75, "C")]
    overlap = final + [seg(55, 58, "A")]
    features = sf.minute_features(final, overlap, 2, rare_threshold=20.0)
    assert features["overlap"][0] == pytest.approx(4, abs=1)    # 55–58 — двое одновременно
    assert features["changes"] == [1, 2]
    assert features["rare"][0] == pytest.approx(10.0)           # B короче 20 с в целом — редкий голос
    assert features["rare"][1] == pytest.approx(5.0)            # C — тоже


def test_pick_windows_takes_best_non_overlapping_with_enough_speakers():
    scores = [0, 0, 5, 9, 9, 5, 0, 0, 0, 7, 8, 6, 0, 0]
    crowded = {"A": 30.0, "B": 30.0, "C": 30.0, "D": 30.0}
    speakers = [crowded for _ in scores]
    picks = sf.pick_windows(scores, speakers, window_minutes=4, count=2, min_speakers=4)
    assert picks[0][0] == 2 and picks[1][0] >= 6  # окна не пересекаются
    assert picks[0][1] == 28

    sparse = [{"A": 30.0, "B": 30.0} for _ in scores]
    assert sf.pick_windows(scores, sparse, window_minutes=4, count=2, min_speakers=4) == []
