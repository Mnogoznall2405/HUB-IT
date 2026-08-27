#!/usr/bin/env python3
"""Rasterize the MAX brand SVG into a PNG for React Native Image.

Telegram uses the FontAwesome glyph shipped with @expo/vector-icons — no PNG needed.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parents[1] / "assets" / "icons"
SIZE = 128


def max_png(path: Path, size: int = SIZE) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * 0.25)

    for i in range(size):
        t = i / max(size - 1, 1)
        if t < 0.66:
            u = t / 0.66
            r = int(68 + (85 - 68) * u)
            g = int(204 + (51 - 204) * u)
            b = int(255 + (238 - 255) * u)
        else:
            u = (t - 0.66) / 0.34
            r = int(85 + (153 - 85) * u)
            g = 51
            b = int(238 + (221 - 238) * u)
        draw.line([(0, i), (size, i)], fill=(r, g, b, 255))

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    rounded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rounded.paste(img, (0, 0))
    rounded.putalpha(mask)

    draw = ImageDraw.Draw(rounded)
    pad = int(size * 0.22)
    ring = [pad, pad, size - pad, size - pad]
    draw.ellipse(ring, outline=(255, 255, 255, 255), width=max(6, size // 14))
    inner = [pad + size * 0.08, pad + size * 0.02, size - pad - size * 0.02, size - pad - size * 0.12]
    draw.arc(inner, start=200, end=20, fill=(255, 255, 255, 255), width=max(5, size // 16))
    rounded.save(path)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    max_png(ASSETS / "max.png")
    print(f"Wrote {ASSETS / 'max.png'}")


if __name__ == "__main__":
    main()
