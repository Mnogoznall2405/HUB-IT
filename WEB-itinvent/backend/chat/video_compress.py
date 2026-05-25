"""Video compression via ffmpeg for chat attachments."""
from __future__ import annotations

import logging
import subprocess
import sys
import shutil
from pathlib import Path
from typing import Optional

# Hide console window on Windows
_SUBPROCESS_KWARGS: dict = {}
if sys.platform == "win32":
    _SUBPROCESS_KWARGS["creationflags"] = subprocess.CREATE_NO_WINDOW

logger = logging.getLogger("backend.chat.video_compress")

FFMPEG_BIN = "ffmpeg"
FFPROBE_BIN = "ffprobe"

# Compression settings
VIDEO_CRF = 28  # Quality: 18=visually lossless, 23=default, 28=good compression
VIDEO_PRESET = "fast"  # ultrafast, superfast, veryfast, faster, fast, medium
VIDEO_MAX_HEIGHT = 720  # Scale down to 720p max
VIDEO_AUDIO_BITRATE = "128k"
VIDEO_CODEC = "libx264"
AUDIO_CODEC = "aac"

# Only compress videos larger than this threshold
VIDEO_COMPRESS_THRESHOLD_BYTES = 5 * 1024 * 1024  # 5 MB


def _find_ffmpeg() -> Optional[str]:
    """Find ffmpeg binary path."""
    path = shutil.which(FFMPEG_BIN)
    if path:
        return path
    # Fallback to known location
    fallback = Path(r"C:\tools\ffmpeg\bin\ffmpeg.exe")
    if fallback.exists():
        return str(fallback)
    return None


def _find_ffprobe() -> Optional[str]:
    """Find ffprobe binary path."""
    path = shutil.which(FFPROBE_BIN)
    if path:
        return path
    fallback = Path(r"C:\tools\ffmpeg\bin\ffprobe.exe")
    if fallback.exists():
        return str(fallback)
    return None


def probe_video_info(source_path: Path) -> dict:
    """Get video dimensions and duration via ffprobe."""
    ffprobe = _find_ffprobe()
    if not ffprobe:
        return {}
    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v", "quiet",
                "-print_format", "json",
                "-show_streams",
                "-show_format",
                str(source_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            **_SUBPROCESS_KWARGS,
        )
        if result.returncode != 0:
            return {}
        import json
        data = json.loads(result.stdout)
        video_stream = None
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                video_stream = stream
                break
        if not video_stream:
            return {}
        width = int(video_stream.get("width", 0))
        height = int(video_stream.get("height", 0))
        duration = float(data.get("format", {}).get("duration", 0))
        return {
            "width": width,
            "height": height,
            "duration": duration,
        }
    except Exception as exc:
        logger.warning("ffprobe failed: %s", exc)
        return {}


def compress_video(source_path: Path, output_path: Path) -> Optional[Path]:
    """
    Compress video using ffmpeg.
    Returns output_path if successful, None if compression skipped or failed.
    """
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        logger.warning("ffmpeg not found, skipping video compression")
        return None

    source_size = source_path.stat().st_size
    if source_size < VIDEO_COMPRESS_THRESHOLD_BYTES:
        logger.info("Video %s is %d bytes, below threshold, skipping", source_path.name, source_size)
        return None

    # Get video info to determine scaling
    info = probe_video_info(source_path)
    height = info.get("height", 0)
    width = info.get("width", 0)

    # Build scale filter - maintain aspect ratio, scale down if > max height
    scale_filter = None
    if height > VIDEO_MAX_HEIGHT:
        # Scale to max height, maintain aspect ratio, ensure even dimensions
        scale_filter = f"scale=-2:{VIDEO_MAX_HEIGHT}"
    elif width > 0 and height > 0 and width > height and width > 1280:
        # Horizontal video wider than 1280 - scale width
        scale_filter = "scale=1280:-2"

    # Build ffmpeg command
    cmd = [
        ffmpeg,
        "-y",  # Overwrite output
        "-i", str(source_path),
        "-c:v", VIDEO_CODEC,
        "-preset", VIDEO_PRESET,
        "-crf", str(VIDEO_CRF),
        "-c:a", AUDIO_CODEC,
        "-b:a", VIDEO_AUDIO_BITRATE,
        "-movflags", "+faststart",  # Enable progressive download
        "-pix_fmt", "yuv420p",  # Maximum compatibility
    ]

    if scale_filter:
        cmd.extend(["-vf", scale_filter])

    cmd.append(str(output_path))

    logger.info(
        "Compressing video: %s (%d bytes, %dx%d) -> %s",
        source_path.name, source_size, width, height, output_path.name,
    )

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout
            **_SUBPROCESS_KWARGS,
        )
        if result.returncode != 0:
            logger.error("ffmpeg failed: %s", result.stderr[-500:] if result.stderr else "no stderr")
            if output_path.exists():
                output_path.unlink(missing_ok=True)
            return None

        output_size = output_path.stat().st_size
        if output_size <= 0:
            logger.error("ffmpeg produced empty file")
            output_path.unlink(missing_ok=True)
            return None

        # Only use compressed version if it's actually smaller
        if output_size >= source_size:
            logger.info(
                "Compressed file not smaller (%d >= %d), keeping original",
                output_size, source_size,
            )
            output_path.unlink(missing_ok=True)
            return None

        compression_ratio = (1 - output_size / source_size) * 100
        logger.info(
            "Video compressed: %d -> %d bytes (%.1f%% reduction)",
            source_size, output_size, compression_ratio,
        )
        return output_path

    except subprocess.TimeoutExpired:
        logger.error("ffmpeg timed out for %s", source_path.name)
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        return None
    except Exception as exc:
        logger.error("Video compression error: %s", exc)
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        return None


def extract_poster_frame(source_path: Path, output_path: Path) -> Optional[Path]:
    """Extract first frame of video as JPEG using ffmpeg."""
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        return None

    try:
        cmd = [
            ffmpeg,
            "-y",
            "-i", str(source_path),
            "-vframes", "1",
            "-q:v", "3",  # JPEG quality (2-5 is good)
            "-f", "image2",
            str(output_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, **_SUBPROCESS_KWARGS)
        if result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
            logger.info("Extracted poster frame: %s", output_path.name)
            return output_path
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        return None
    except Exception as exc:
        logger.warning("Poster extraction failed: %s", exc)
        if output_path.exists():
            output_path.unlink(missing_ok=True)
        return None
