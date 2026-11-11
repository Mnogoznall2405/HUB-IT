"""Perceptual average-hash helpers for matching cache images to on-screen bubbles."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from PIL import Image


def average_hash(image: Image.Image, hash_size: int = 16) -> str:
    gray = image.convert("L").resize((hash_size, hash_size), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    avg = sum(pixels) / max(len(pixels), 1)
    return "".join("1" if p >= avg else "0" for p in pixels)


def average_hash_bytes(data: bytes, hash_size: int = 16) -> str | None:
    try:
        with Image.open(io.BytesIO(data)) as im:
            return average_hash(im, hash_size=hash_size)
    except Exception:  # noqa: BLE001
        return None


def average_hash_file(path: Path, hash_size: int = 16) -> str | None:
    try:
        with Image.open(path) as im:
            return average_hash(im, hash_size=hash_size)
    except Exception:  # noqa: BLE001
        return None


def hamming_distance(a: str, b: str) -> int:
    if not a or not b:
        return 10**9
    n = min(len(a), len(b))
    return sum(1 for i in range(n) if a[i] != b[i]) + abs(len(a) - len(b))


def crop_screen_region(
    window_png: bytes,
    window_rect: tuple[int, int, int, int],
    item_rect: tuple[int, int, int, int],
    *,
    pad: int = 4,
) -> Image.Image | None:
    """Crop ListItem rect (screen coords) out of a window screenshot."""
    wl, wt, wr, wb = window_rect
    il, it, ir, ib = item_rect
    left = max(0, il - wl - pad)
    top = max(0, it - wt - pad)
    right = min(wr - wl, ir - wl + pad)
    bottom = min(wb - wt, ib - wt + pad)
    if right - left < 16 or bottom - top < 16:
        return None
    try:
        with Image.open(io.BytesIO(window_png)) as im:
            return im.crop((left, top, right, bottom)).convert("RGB")
    except Exception:  # noqa: BLE001
        return None


def best_hash_match(
    probe_hash: str,
    candidates: list[tuple[Any, str]],
    *,
    max_distance: int = 28,
) -> tuple[Any, int] | None:
    """candidates: (item, ahash). Return best item under threshold."""
    best: tuple[Any, int] | None = None
    for item, ah in candidates:
        dist = hamming_distance(probe_hash, ah)
        if dist > max_distance:
            continue
        if best is None or dist < best[1]:
            best = (item, dist)
    return best
