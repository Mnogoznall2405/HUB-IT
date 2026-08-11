"""Crop on-screen messenger photo/video previews into output/media (MAX)."""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from .image_match import crop_screen_region
from .media_cache import message_wants_media
from .screenshot import window_rect

logger = logging.getLogger(__name__)


def attach_screen_crops(
    messages: list[dict[str, Any]],
    *,
    hwnd: int,
    png_bytes: bytes,
    media_dir: Path,
    pad: int = 2,
) -> int:
    """
    For messages with photo/video markers, crop PreviewCell (or bubble) from the
    window screenshot and set media_path. Returns number of attached files.
    """
    if not png_bytes or not messages:
        return 0
    win = window_rect(hwnd)
    if not win:
        return 0
    media_dir.mkdir(parents=True, exist_ok=True)

    attached = 0
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if msg.get("media_path"):
            continue
        if not message_wants_media(msg):
            continue
        box = msg.get("media_bbox") or msg.get("bbox")
        if not box or len(box) != 4:
            continue
        try:
            item_rect = (int(box[0]), int(box[1]), int(box[2]), int(box[3]))
        except (TypeError, ValueError):
            continue
        crop = crop_screen_region(png_bytes, win, item_rect, pad=pad)
        if crop is None:
            continue
        # Skip tiny chrome leftovers.
        if crop.width < 24 or crop.height < 24:
            continue
        try:
            digest = hashlib.sha1(crop.tobytes()).hexdigest()[:12]
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            kind = str(msg.get("media") or "photo").strip().lower() or "photo"
            if kind not in {"photo", "video", "gif"}:
                kind = "photo"
            rel_name = f"screen_{kind}_{stamp}_{digest}.jpg"
            abs_path = media_dir / rel_name
            crop.convert("RGB").save(abs_path, format="JPEG", quality=88, optimize=True)
            msg["media_path"] = f"media/{rel_name}"
            msg["media_kind"] = "jpeg"
            msg["media_match"] = f"screen_crop:{kind}:{digest}"
            if not str(msg.get("media") or "").strip():
                msg["media"] = kind
            attached += 1
        except Exception as exc:  # noqa: BLE001
            logger.debug("screen crop failed: %s", exc)
            continue

    if attached:
        logger.info("Attached %d on-screen media crop(s)", attached)
    return attached
