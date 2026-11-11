#!/usr/bin/env python3
"""Public package interface for VoiceVideo."""

from importlib import import_module
import importlib.util
import os
from pathlib import Path
from typing import Any, Dict
import platform
import sys

__version__ = "1.0.1"
__author__ = "VoiceVideo Team"
__email__ = "contact@voicevideo.dev"
__description__ = "Audio and video meeting processing with transcription, diarization, and reporting"


def _bootstrap_local_site_packages():
    if sys.prefix != getattr(sys, "base_prefix", sys.prefix):
        return

    if importlib.util.find_spec("whisperx") is not None:
        return

    repo_root = Path(__file__).resolve().parent.parent
    for env_name in (".venv", "venv"):
        repo_site_packages = repo_root / env_name / "Lib" / "site-packages"
        repo_site_packages_str = str(repo_site_packages)
        if repo_site_packages.exists() and repo_site_packages_str not in sys.path:
            sys.path.insert(0, repo_site_packages_str)
            break


_bootstrap_local_site_packages()


def _bootstrap_local_ffmpeg():
    repo_root = Path(__file__).resolve().parent.parent
    ffmpeg_bin = repo_root / "ffmpeg" / "bin"
    ffmpeg_bin_str = str(ffmpeg_bin)
    if ffmpeg_bin.exists() and ffmpeg_bin_str not in os.environ.get("PATH", ""):
        os.environ["PATH"] = ffmpeg_bin_str + os.pathsep + os.environ.get("PATH", "")


_bootstrap_local_ffmpeg()


def _bootstrap_local_model_cache():
    repo_root = Path(__file__).resolve().parent.parent
    models_dir = repo_root / "models"
    hf_home = models_dir / ".hf-home"
    torch_home = models_dir / ".torch"
    pyannote_cache = models_dir / ".pyannote"

    for directory in (models_dir, hf_home, torch_home, pyannote_cache):
        directory.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(models_dir))
    os.environ.setdefault("HF_HOME", str(hf_home))
    os.environ.setdefault("TORCH_HOME", str(torch_home))
    os.environ.setdefault("PYANNOTE_CACHE", str(pyannote_cache))


_bootstrap_local_model_cache()


def _bootstrap_torch_compat():
    os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")


_bootstrap_torch_compat()

SUPPORTED_AUDIO_FORMATS = {
    ".mp3",
    ".wav",
    ".flac",
    ".m4a",
    ".ogg",
    ".aac",
    ".wma",
}
SUPPORTED_VIDEO_FORMATS = {
    ".mp4",
    ".avi",
    ".mov",
    ".mkv",
    ".webm",
    ".flv",
    ".wmv",
}
SUPPORTED_FORMATS = SUPPORTED_AUDIO_FORMATS | SUPPORTED_VIDEO_FORMATS

SUPPORTED_LANGUAGES = {
    "ru": "Russian",
    "en": "English",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "auto": "Auto-detect",
}

_LAZY_EXPORTS = {
    "MainProcessor": ("modules.main_processor", "MainProcessor"),
    "ProcessingConfig": ("modules.audio_processor", "ProcessingConfig"),
    "AudioProcessor": ("modules.audio_processor", "AudioProcessor"),
    "TranscriptionProcessor": ("modules.transcription", "TranscriptionProcessor"),
    "SpeakerDiarization": ("modules.diarization", "SpeakerDiarization"),
    "MeetingAnalyzer": ("modules.analyzer", "MeetingAnalyzer"),
    "MeetingSegmentation": ("modules.segmentation", "MeetingSegmentation"),
    "ReportGenerator": ("modules.report_generator", "ReportGenerator"),
}

__all__ = [
    "__version__",
    "__author__",
    "__email__",
    "__description__",
    "SUPPORTED_AUDIO_FORMATS",
    "SUPPORTED_VIDEO_FORMATS",
    "SUPPORTED_FORMATS",
    "SUPPORTED_LANGUAGES",
    "MainProcessor",
    "ProcessingConfig",
    "AudioProcessor",
    "TranscriptionProcessor",
    "SpeakerDiarization",
    "MeetingAnalyzer",
    "MeetingSegmentation",
    "ReportGenerator",
    "create_processor",
    "process_file",
    "process_directory",
    "get_default_config",
    "get_system_info",
]


def __getattr__(name: str) -> Any:
    if name not in _LAZY_EXPORTS:
        raise AttributeError(f"module 'voicevideo' has no attribute {name!r}")

    module_name, attribute_name = _LAZY_EXPORTS[name]
    module = import_module(module_name)
    value = getattr(module, attribute_name)
    globals()[name] = value
    return value


def __dir__():
    return sorted(set(globals()) | set(__all__) | set(_LAZY_EXPORTS))


def create_processor(config=None):
    """Create a configured processor instance."""
    main_processor_cls = __getattr__("MainProcessor")
    config_cls = __getattr__("ProcessingConfig")

    if config is None:
        config = config_cls()

    return main_processor_cls(config)


def process_file(file_path, config=None):
    """Process a single media file."""
    return create_processor(config).process_file(file_path)


def process_directory(directory_path, config=None):
    """Process all supported media files in a directory."""
    return create_processor(config).process_directory(directory_path)


def get_default_config():
    """Return the default processing configuration."""
    return __getattr__("ProcessingConfig")()


def get_system_info() -> Dict[str, Any]:
    """Return a lightweight runtime summary."""
    info: Dict[str, Any] = {
        "version": __version__,
        "python_version": sys.version,
        "platform": platform.platform(),
        "dependencies": {},
    }

    try:
        import torch

        info["torch_version"] = torch.__version__
        info["cuda_available"] = torch.cuda.is_available()
        if torch.cuda.is_available():
            info["cuda_version"] = torch.version.cuda
            info["gpu_count"] = torch.cuda.device_count()
            info["gpu_names"] = [
                torch.cuda.get_device_name(index)
                for index in range(torch.cuda.device_count())
            ]
    except Exception as exc:
        info["torch_error"] = str(exc)

    for dependency in ("whisperx", "pyannote.audio", "librosa", "pydub"):
        try:
            module = import_module(dependency)
            info["dependencies"][dependency] = getattr(module, "__version__", "unknown")
        except Exception as exc:
            info["dependencies"][dependency] = f"unavailable: {exc}"

    return info


if sys.version_info < (3, 8):
    raise RuntimeError("VoiceVideo requires Python 3.8 or newer.")
