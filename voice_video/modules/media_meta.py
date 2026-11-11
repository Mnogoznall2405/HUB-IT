"""Дата записи из метаданных медиафайла (ffprobe ``creation_time``)."""

import json
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def parse_creation_date(ffprobe_json: str, today: Optional[datetime] = None) -> Optional[str]:
    """``creation_time`` из вывода ffprobe -> 'ДД.ММ.ГГГГ'; мусор и даты из будущего отбрасываются."""
    try:
        data = json.loads(ffprobe_json or "{}")
    except ValueError:
        return None
    candidates = [((data.get("format") or {}).get("tags") or {}).get("creation_time")]
    for stream in data.get("streams") or []:
        candidates.append((stream.get("tags") or {}).get("creation_time"))
    now = today or datetime.now(timezone.utc)
    for raw in candidates:
        if not raw:
            continue
        try:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        # 1970/2000-е — частый «нулевой» тег кодировщиков; будущее — сбитые часы
        if dt.year < 2010 or dt > now:
            continue
        return dt.strftime("%d.%m.%Y")
    return None


def media_recording_date(path: Path, timeout: int = 20) -> Optional[str]:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=timeout, check=False,
        )
    except (OSError, subprocess.SubprocessError) as e:
        logger.debug(f"ffprobe недоступен: {e}")
        return None
    return parse_creation_date(out.stdout)
