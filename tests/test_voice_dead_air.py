"""voice_video/modules/dead_air.py: пропуск мёртвых участков не должен сдвигать время — длина и положение звука прежние."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("dead_air_under_test", ROOT / "voice_video" / "modules" / "dead_air.py")
da = importlib.util.module_from_spec(spec)
spec.loader.exec_module(da)


def test_only_long_silences_are_cut_and_each_keeps_a_margin_around_speech():
    alive = [False] * 3 + [True] * 2 + [False] * 12 + [True] * 1 + [False] * 5 + [True] * 2 + [False] * 15
    total = len(alive) * 60
    # 3 мин с начала — коротко, 12 мин — режем (по минуте запаса с краёв), 5 мин — коротко, хвост 15 мин — режем до конца файла
    assert da.dead_ranges(alive, total) == [(5 * 60 + 60, 17 * 60 - 60), (25 * 60 + 60, total)]
    assert da.dead_ranges([False] * 30, 1800) == [(0, 1800)]          # вся запись пустая: запас у файла не нужен
    assert da.dead_ranges([True] * 30, 1800) == []


def test_compacted_audio_returns_to_the_same_length_and_speech_stays_at_its_time(tmp_path):
    rate = 16000
    audio = np.zeros(rate * 60 * 30, dtype="float32")                       # 30 минут тишины
    audio[rate * 60 * 2: rate * 60 * 2 + rate * 5] = 0.3                    # речь на 2-й минуте
    audio[rate * 60 * 26: rate * 60 * 26 + rate * 5] = 0.2                  # и на 26-й
    src, active, back = tmp_path / "raw.wav", tmp_path / "active.wav", tmp_path / "back.wav"
    sf.write(src, audio, rate, subtype="PCM_16")
    flags, total, _ = da.scan_minutes(str(src))
    ranges = da.dead_ranges(flags, total)
    assert ranges and ranges[0][0] > 0
    da.compact(str(src), str(active), ranges)
    assert sf.info(active).frames == len(audio) - sum(e - b for b, e in ranges) * rate
    sf.write(back, sf.read(active, dtype="float32")[0], rate, subtype="PCM_16")   # нормализация вернула бы файл той же длины
    da.expand(str(back), ranges)
    restored, _ = sf.read(back, dtype="float32")
    assert len(restored) == len(audio)
    assert np.allclose(restored[rate * 120: rate * 125], 0.3, atol=1e-3) and np.allclose(restored[rate * 26 * 60: rate * 26 * 60 + rate * 5], 0.2, atol=1e-3)
    assert float(np.abs(restored[rate * 600: rate * 1200]).max()) == 0.0   # вырезанное место снова тишина
