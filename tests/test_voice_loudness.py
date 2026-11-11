"""voice_video/modules/loudness.py: тихая запись доводится до −16 LUFS реальным ffmpeg; сбой возвращает False."""
from __future__ import annotations

import importlib.util
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = ROOT / "voice_video" / "ffmpeg" / "bin" / "ffmpeg.exe"
spec = importlib.util.spec_from_file_location("loudness_under_test", ROOT / "voice_video" / "modules" / "loudness.py")
loud = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loud)


def _integrated_lufs(path: Path) -> float:
    out = subprocess.run([str(FFMPEG), "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return float(re.findall(r"I:\s+(-?\d+\.\d+) LUFS", out)[-1])


@pytest.mark.skipif(not FFMPEG.exists(), reason="нужен voice_video/ffmpeg")
def test_quiet_recording_is_raised_to_target_loudness_as_mono_16k(tmp_path):
    quiet = tmp_path / "quiet.wav"
    subprocess.run([str(FFMPEG), "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=20,volume=-30dB",
                    "-ar", "44100", "-ac", "2", str(quiet)], check=True)
    before = _integrated_lufs(quiet)
    out = tmp_path / "loud.wav"
    assert loud.loudnorm_file(str(quiet), str(out), ffmpeg=str(FFMPEG))
    after = _integrated_lufs(out)
    # однопроходный loudnorm приближается к цели, но не обязан попасть точно: главное — тихая запись стала громкой
    assert before < -40 and after - before > 25 and -22.0 <= after <= -14.0
    info = subprocess.run([str(FFMPEG), "-hide_banner", "-i", str(out)], capture_output=True, text=True).stderr
    assert "16000 Hz" in info and "mono" in info


def test_failure_returns_false_instead_of_raising(tmp_path):
    assert loud.loudnorm_file(str(tmp_path / "нет.wav"), str(tmp_path / "out.wav"), ffmpeg="ffmpeg-которого-нет") is False
    assert not (tmp_path / "out.wav").exists()
