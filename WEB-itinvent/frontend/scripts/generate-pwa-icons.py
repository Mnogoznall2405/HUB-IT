#!/usr/bin/env python3
"""Regenerate PWA / favicon assets with transparent background and maskable safe zone."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ARCHIVE_SOURCE = ROOT / "scripts" / "icon-source.png"
LEGACY_SOURCE = PUBLIC / "pwa-512.png"
BLACK_THRESHOLD = 28
ANY_SCALE = 0.92
MASKABLE_SCALE = 0.68


def ensure_source() -> Path:
    if ARCHIVE_SOURCE.exists():
        return ARCHIVE_SOURCE
    if not LEGACY_SOURCE.exists():
        raise SystemExit(f"Source icon not found: {LEGACY_SOURCE}")
    Image.open(LEGACY_SOURCE).save(ARCHIVE_SOURCE)
    return ARCHIVE_SOURCE


def remove_near_black_background(image: Image.Image, threshold: int = BLACK_THRESHOLD) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            if r <= threshold and g <= threshold and b <= threshold:
                pixels[x, y] = (0, 0, 0, 0)
    return rgba


def fit_on_canvas(image: Image.Image, size: int, scale: float) -> Image.Image:
    rgba = image.convert("RGBA")
    target = int(round(size * scale))
    resized = rgba.resize((target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = (size - target) // 2
    canvas.paste(resized, (offset, offset), resized)
    return canvas


def save_png(image: Image.Image, path: Path) -> None:
    image.save(path, format="PNG", optimize=True)


def main() -> None:
    source_path = ensure_source()
    master = remove_near_black_background(Image.open(source_path))

    outputs = {
        "pwa-512.png": fit_on_canvas(master, 512, ANY_SCALE),
        "pwa-512-maskable.png": fit_on_canvas(master, 512, MASKABLE_SCALE),
        "pwa-192.png": fit_on_canvas(master, 192, ANY_SCALE),
        "apple-touch-icon.png": fit_on_canvas(master, 180, ANY_SCALE),
        "favicon.png": fit_on_canvas(master, 192, ANY_SCALE),
    }
    for name, image in outputs.items():
        save_png(image, PUBLIC / name)
        print(f"wrote {PUBLIC / name}")


if __name__ == "__main__":
    main()
