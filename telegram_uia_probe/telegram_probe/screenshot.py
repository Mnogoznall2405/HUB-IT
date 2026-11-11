"""Capture screenshot of messenger window only (no clicks, no restore/focus)."""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageGrab

logger = logging.getLogger(__name__)


def window_rect(hwnd: int) -> tuple[int, int, int, int] | None:
    """Public alias for window screen rectangle (left, top, right, bottom)."""
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


def _is_minimized(hwnd: int) -> bool:
    try:
        import win32gui

        return bool(win32gui.IsIconic(hwnd))
    except Exception:  # noqa: BLE001
        return False


def capture_window(
    hwnd: int,
    screenshots_dir: Path,
    prefix: str,
) -> tuple[str | None, bytes | None, str | None]:
    """
    Capture only the messenger window rectangle.

    Never restores/focuses the window — minimizing must stay under user control.
    Returns (relative_path, png_bytes, error_note).
    """
    if _is_minimized(hwnd):
        return None, None, "window_minimized_skip"
    rect = _rect_from_handle(hwnd)
    if rect is None:
        return None, None, "window_rect_unavailable"
    left, top, right, bottom = rect
    # Guard against iconic / off-screen rects (do not ShowWindow/SW_RESTORE).
    if left <= -10000 or top <= -10000:
        return None, None, "window_still_minimized"
    try:
        # Pillow uses screen coordinates; works with multi-monitor offsets.
        image = ImageGrab.grab(bbox=(left, top, right, bottom), all_screens=True)
    except TypeError:
        # Older Pillow without all_screens
        try:
            image = ImageGrab.grab(bbox=(left, top, right, bottom))
        except Exception as exc:  # noqa: BLE001
            logger.warning("screenshot failed: %s", exc)
            return None, None, f"screenshot_failed: {exc}"
    except Exception as exc:  # noqa: BLE001
        logger.warning("screenshot failed: %s", exc)
        return None, None, f"screenshot_failed: {exc}"

    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"{prefix}_{stamp}.png"
    path = screenshots_dir / filename
    try:
        image.save(path, format="PNG", optimize=True)
        png_bytes = path.read_bytes()
        rel = str(Path("screenshots") / filename).replace("\\", "/")
        return rel, png_bytes, None
    except Exception as exc:  # noqa: BLE001
        logger.warning("save screenshot failed: %s", exc)
        return None, None, f"save_failed: {exc}"


def image_fingerprint(png_bytes: bytes) -> str:
    """Cheap perceptual-ish fingerprint via downscaled grayscale hash."""
    import hashlib
    import io

    try:
        img = Image.open(io.BytesIO(png_bytes)).convert("L").resize((32, 32))
        raw = img.tobytes()
        return hashlib.sha256(raw).hexdigest()
    except Exception:  # noqa: BLE001
        return hashlib.sha256(png_bytes).hexdigest()


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
