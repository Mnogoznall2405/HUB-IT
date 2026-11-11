"""voice_video/eval_labels.py: сравнение с базой — единственная нетривиальная логика (остальное — запуск моделей)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("eval_labels_under_test", ROOT / "voice_video" / "eval_labels.py")
el = importlib.util.module_from_spec(spec)
spec.loader.exec_module(el)


def test_regression_only_when_worse_than_tolerance_and_missing_mode_is_skipped():
    baseline = {"single": {"der": 0.099, "confusion": 0.021}, "chunked": {"der": 0.106, "confusion": 0.028}}
    same = {"single": {"der": 0.101, "confusion": 0.020}, "chunked": {"der": 0.104, "confusion": 0.030}}
    assert el.compare_to_baseline(same, baseline, tolerance=0.005) == []
    worse = {"single": {"der": 0.099, "confusion": 0.021}, "chunked": {"der": 0.120, "confusion": 0.040}}
    problems = el.compare_to_baseline(worse, baseline, tolerance=0.005)
    assert [(p["mode"], p["metric"]) for p in problems] == [("chunked", "der"), ("chunked", "confusion")]
    assert problems[0]["delta"] == 0.014
    assert el.compare_to_baseline({"new_mode": {"der": 0.9}}, baseline) == []


def test_weighted_metric_follows_reference_speech_not_project_count():
    rows = [{"der": 0.10, "speech": 900.0}, {"der": 0.20, "speech": 100.0}]
    assert round(el.weighted(rows, "der"), 3) == 0.11
