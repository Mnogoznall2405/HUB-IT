#!/usr/bin/env python3
"""Generate minimal HUB-IT launcher icons for Expo prebuild."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "assets"
PRIMARY = (25, 118, 210)  # #1976d2
WHITE = (255, 255, 255)


def make_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), PRIMARY + (255,))
    draw = ImageDraw.Draw(img)
    margin = size // 6
    draw.rounded_rectangle(
        (margin, margin, size - margin, size - margin),
        radius=size // 5,
        fill=WHITE,
    )
    font_size = size // 2
    try:
        from PIL import ImageFont

        font = ImageFont.truetype("arial.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()
    text = "H"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2 - size * 0.05), text, fill=PRIMARY, font=font)
    return img


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    make_icon(1024).save(ROOT / "icon.png")
    make_icon(1024).save(ROOT / "adaptive-icon.png")
    splash = Image.new("RGBA", (1284, 2778), (245, 247, 250, 255))
    icon = make_icon(512)
    splash.paste(icon, ((1284 - 512) // 2, (2778 - 512) // 2), icon)
    splash.save(ROOT / "splash.png")
    print(f"Wrote icons to {ROOT}")


if __name__ == "__main__":
    main()
