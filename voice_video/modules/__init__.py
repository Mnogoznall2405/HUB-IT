"""Core VoiceVideo processing modules."""

import os
from pathlib import Path

# Локальная сборка FFmpeg (shared DLLs для torchcodec/pyannote) должна быть
# зарегистрирована ДО первого импорта pyannote.audio: io.py кэширует
# результат проверки torchcodec при импорте.
_ffmpeg_bin = Path(__file__).resolve().parent.parent / "ffmpeg" / "bin"
if _ffmpeg_bin.exists():
    if hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(str(_ffmpeg_bin))
        except OSError:
            pass
    os.environ["PATH"] = str(_ffmpeg_bin) + os.pathsep + os.environ.get("PATH", "")

# CUDA-DLL из nvidia-*-cu12 wheel-пакетов torch — нужны onnxruntime-gpu
# (audio-separator / Kim Vocal 2) до создания InferenceSession.
try:
    import site as _site
    for _sp in _site.getsitepackages() + [_site.getusersitepackages()]:
        for _d in Path(_sp).glob(r"nvidia/*/bin") :
            if hasattr(os, "add_dll_directory"):
                try:
                    os.add_dll_directory(str(_d))
                except OSError:
                    pass
            os.environ["PATH"] = str(_d) + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass
