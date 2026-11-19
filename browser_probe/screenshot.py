"""Capture screenshot of browser window only."""

from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageGrab, ImageStat

logger = logging.getLogger("browser_probe.screenshot")

_FORMAT_EXT = {"jpeg": "jpg", "png": "png", "webp": "webp"}


def _shot_format() -> str:
    fmt = str(os.getenv("ITINV_BROWSER_PROBE_SHOT_FORMAT", "jpeg") or "jpeg").strip().lower()
    return fmt if fmt in _FORMAT_EXT else "jpeg"


def _shot_quality() -> int:
    try:
        return max(10, min(100, int(os.getenv("ITINV_BROWSER_PROBE_SHOT_QUALITY", "75") or "75")))
    except ValueError:
        return 75


def _shot_max_width() -> int:
    try:
        return max(0, int(os.getenv("ITINV_BROWSER_PROBE_SHOT_MAX_WIDTH", "1600") or "1600"))
    except ValueError:
        return 1600


def _looks_blank(image: Image.Image) -> bool:
    """Near-uniform frame: a still-loading page (white body or a lone spinner,
    stddev ~0-5), or a black captured window. Real pages carry chrome, text and
    coloured blocks and land far above (measured 40+ on synthetic layouts)."""
    try:
        thumb = image.convert("L").resize((64, 64))
        return float(ImageStat.Stat(thumb).stddev[0]) < 10.0
    except Exception:  # noqa: BLE001
        return False


def _downscale(image: Image.Image) -> Image.Image:
    limit = _shot_max_width()
    if limit and image.width > limit:
        height = max(1, round(image.height * (limit / image.width)))
        return image.resize((limit, height), Image.Resampling.LANCZOS)
    return image


def window_rect(hwnd: int) -> tuple[int, int, int, int] | None:
    return _rect_from_handle(hwnd)


def _rect_from_handle(hwnd: int) -> tuple[int, int, int, int] | None:
    try:
        import win32gui

        if not win32gui.IsWindow(hwnd) or not win32gui.IsWindowVisible(hwnd):
            return None
        left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        if right <= left or bottom <= top:
            return None
        return left, top, right, bottom
    except Exception as exc:  # noqa: BLE001
        logger.debug("GetWindowRect failed: %s", exc)
        return None


def capture_window(
    hwnd: int,
    screenshots_dir: Path,
    prefix: str,
) -> tuple[str | None, str | None]:
    """Save the screenshot and return its relative path or an error."""
    rect = _rect_from_handle(hwnd)
    if rect is None:
        return None, "window_rect_unavailable"

    left, top, right, bottom = rect
    # A minimizing/animating or mostly-covered window yields useless strips
    # (observed: 400x48 address-bar slivers, 190x32 black frames).
    if (right - left) < 240 or (bottom - top) < 160:
        return None, "window_too_small"
    try:
        image = ImageGrab.grab(bbox=(left, top, right, bottom), all_screens=True)
    except TypeError:
        try:
            image = ImageGrab.grab(bbox=(left, top, right, bottom))
        except Exception as exc:  # noqa: BLE001
            logger.warning("screenshot failed: %s", exc)
            return None, f"screenshot_failed: {exc}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("screenshot failed: %s", exc)
        return None, f"screenshot_failed: {exc}"

    if _looks_blank(image):
        return None, "blank_frame"

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    shot_format = _shot_format()
    filename = f"{prefix}_{stamp}.{_FORMAT_EXT[shot_format]}"
    path = screenshots_dir / filename
    try:
        with image:
            screenshots_dir.mkdir(parents=True, exist_ok=True)
            with _downscale(image) as scaled:
                if shot_format == "png":
                    scaled.save(path, format="PNG", optimize=True)
                else:
                    # JPEG/WebP have no alpha channel.
                    frame = scaled if scaled.mode == "RGB" else scaled.convert("RGB")
                    with frame:
                        frame.save(path, format=shot_format.upper(), quality=_shot_quality())
        rel = str(Path("screenshots") / filename).replace("\\", "/")
        return rel, None
    except Exception as exc:  # noqa: BLE001
        logger.warning("save screenshot failed: %s", exc)
        return None, f"save_failed: {exc}"


def window_info(hwnd: int) -> dict[str, Any]:
    info: dict[str, Any] = {"hwnd": hwnd}
    try:
        import win32gui
        import win32process

        info["title"] = win32gui.GetWindowText(hwnd) or ""
        info["visible"] = bool(win32gui.IsWindowVisible(hwnd))
        _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
        info["pid"] = int(pid)
        rect = _rect_from_handle(hwnd)
        if rect:
            info["rect"] = {
                "left": rect[0],
                "top": rect[1],
                "right": rect[2],
                "bottom": rect[3],
            }
    except Exception as exc:  # noqa: BLE001
        info["error"] = str(exc)
    return info
