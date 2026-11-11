"""voice_video/cut_silence.py: планирование реза (чистая логика) и рез реальным ffmpeg на синтетическом видео."""
from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("cut_silence_under_test", ROOT / "voice_video" / "cut_silence.py")
cs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cs)

FFMPEG = ROOT / "voice_video" / "ffmpeg" / "bin" / "ffmpeg.exe"


def test_parse_silences_closes_trailing_silence_and_ignores_noise_lines():
    text = (
        "[silencedetect @ 0x1] silence_start: 0\n"
        "[silencedetect @ 0x1] silence_end: 12.5 | silence_duration: 12.5\n"
        "size=N/A time=00:00:30\n"
        "[silencedetect @ 0x1] silence_start: 50.25\n"
    )
    assert cs.parse_silences(text, 60.0) == [(0.0, 12.5), (50.25, 60.0)]


def test_short_silences_are_kept_and_speech_margin_is_preserved():
    removals = cs.plan_removals([(10.0, 25.0), (100.0, 160.0)], 200.0, min_silence=20.0, keep=2.0)
    assert removals == [(102.0, 158.0)]  # пауза 15 с короче порога; у речи остаётся по 2 с


def test_leading_and_trailing_silence_are_cut_up_to_the_margin():
    removals = cs.plan_removals([(0.0, 300.0), (900.0, 1000.0)], 1000.0, min_silence=20.0, keep=2.0)
    assert removals == [(0.0, 298.0), (902.0, 1000.0)]


def test_cuts_snap_inside_the_silence_to_keyframes():
    keyframes = [float(x) for x in range(0, 200, 10)]
    removals = cs.plan_removals([(33.0, 97.0)], 200.0, min_silence=20.0, keep=2.0, keyframes=keyframes)
    # (35, 95) -> первый кадр >=35 это 40, последний <=95 это 90: речь не задета, запись продолжится с ключевого кадра
    assert removals == [(40.0, 90.0)]
    # пауза 24 с: (35, 55) -> кадры 40 и 50; вырезано 10 с, запас у речи — 7 с и 5 с (≥ keep)
    assert cs.plan_removals([(33.0, 57.0)], 200.0, min_silence=20.0, keep=2.0, keyframes=keyframes) == [(40.0, 50.0)]
    # внутри паузы нет двух ключевых кадров с зазором >= min_cut — не режем
    assert cs.plan_removals([(33.0, 57.0)], 200.0, min_silence=20.0, keep=2.0, keyframes=[40.0, 50.0], min_cut=11.0) == []


def test_time_map_roundtrip_and_cut_silence_has_no_original_time():
    kept = cs.kept_segments([(10.0, 40.0), (100.0, 130.0)], 200.0)
    assert kept == [(0.0, 10.0), (40.0, 100.0), (130.0, 200.0)]
    time_map = cs.build_map(kept)
    assert [row["new_start"] for row in time_map] == [0.0, 10.0, 70.0]
    assert cs.to_original(time_map, 5.0) == 5.0
    assert cs.to_original(time_map, 12.0) == 42.0
    assert cs.to_original(time_map, 75.0) == 135.0
    assert cs.to_new(time_map, 42.0) == 12.0
    assert cs.to_new(time_map, 20.0) is None  # момент в вырезанной тишине
    for new_time in (0.0, 9.9, 10.0, 33.3, 70.0, 140.0):
        assert cs.to_new(time_map, cs.to_original(time_map, new_time)) == pytest.approx(new_time)


@pytest.mark.skipif(not FFMPEG.exists(), reason="нужен voice_video/ffmpeg")
def test_real_ffmpeg_cut_removes_silence_keeps_streams_in_sync_and_map_matches(tmp_path):
    src = tmp_path / "src.mp4"
    subprocess.run(
        [str(FFMPEG), "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25",
         "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000,volume='if(between(t,10,40),0,1)':eval=frame",
         "-t", "60", "-c:v", "mpeg4", "-g", "25", "-c:a", "aac", str(src)],
        check=True,
    )
    dst = tmp_path / "out.mp4"
    result = cs.cut_silence(src, dst, min_silence=10.0, keep=2.0, noise_db=-45.0)
    assert result["written"] and dst.exists()
    info = cs.probe(dst)
    # вырезано ~26 с из паузы 30 с (по 2 с остаётся у речи, границы — ключевые кадры раз в секунду)
    assert result["removed_seconds"] == pytest.approx(26.0, abs=2.1)
    assert info["duration"] == pytest.approx(result["result_seconds"], abs=0.7)
    # в результате остаётся только запас у речи: 2×keep + до секунды на ключевой кадр с каждой стороны
    leftover = [b - a for a, b in cs.detect_silences(dst, info["duration"], -45.0, 4.0)]
    assert leftover and max(leftover) <= 2 * 2.0 + 2 * 1.0 + 0.5
    # карта времён: начало второй речи в оригинале (40 с) — в новой записи на new_start второго куска + остаток
    time_map = json.loads(Path(str(dst) + ".silence_map.json").read_text(encoding="utf-8"))["time_map"]
    assert len(time_map) == 2 and time_map[0]["orig_start"] == 0.0 and time_map[1]["orig_end"] == pytest.approx(60.0)
    resume = cs.to_new(time_map, 40.0)
    assert 0 < resume < 20.0
    # звук после склейки в этом месте действительно «громкий» (речь продолжилась там, где говорит карта)
    probe = subprocess.run(
        [str(FFMPEG), "-hide_banner", "-nostats", "-ss", f"{resume + 0.5:.2f}", "-t", "3", "-i", str(dst),
         "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True, check=True,
    ).stderr
    mean = float(probe.split("mean_volume:")[1].split("dB")[0])
    assert mean > -30.0
