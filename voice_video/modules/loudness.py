"""Нормализация громкости записи по стандарту вещания (EBU R128) перед распознаванием речи.

Облачный STT (Gemini) теряет слова на тихом звуке: на записи со средним уровнем −29 дБFS сырой звук давал
на 3–9 % меньше слов и расходился со вторым распознавателем на 13 %, после доведения до −16 LUFS — 6.7 %.
Сепаратор вокала (Kim) помогал лишь тем, что заодно поднимал уровень.
"""
import subprocess
from pathlib import Path
from typing import Optional


def _ffmpeg() -> str:
    local = Path(__file__).resolve().parent.parent / "ffmpeg" / "bin" / "ffmpeg.exe"
    return str(local) if local.exists() else "ffmpeg"


def loudnorm_file(src: str, dst: str, *, target_lufs: float = -16.0, true_peak: float = -1.5,
                  lra: float = 11.0, ffmpeg: Optional[str] = None, timeout: int = 7200) -> bool:
    """Записывает в ``dst`` моно WAV 16 кГц с громкостью ``target_lufs``; False — не вышло (вызывающий откатится)."""
    cmd = [ffmpeg or _ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
           "-af", f"loudnorm=I={target_lufs}:TP={true_peak}:LRA={lra}", "-ar", "16000", "-ac", "1", str(dst)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.returncode == 0 and Path(dst).exists() and Path(dst).stat().st_size > 1024
