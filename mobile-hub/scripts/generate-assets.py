#!/usr/bin/env python3
"""Generate Expo assets from the existing HUB-IT brand mark."""
from pathlib import Path

from PIL import Image

MOBILE_ROOT = Path(__file__).resolve().parents[1]
ASSETS_ROOT = MOBILE_ROOT / "assets"
SOURCE = MOBILE_ROOT.parent / "WEB-itinvent" / "frontend" / "scripts" / "icon-source.png"
NAVY = (7, 29, 48, 255)
TRANSPARENT = (0, 0, 0, 0)


def load_mark() -> Image.Image:
    if not SOURCE.exists():
        raise FileNotFoundError(f"HUB-IT brand source was not found: {SOURCE}")
    mark = Image.open(SOURCE).convert("RGBA")
    alpha_box = mark.getchannel("A").getbbox()
    return mark.crop(alpha_box) if alpha_box else mark


def compose(mark: Image.Image, size: int, fraction: float, background: tuple[int, ...]) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), background)
    target = int(size * fraction)
    logo = mark.copy()
    logo.thumbnail((target, target), Image.Resampling.LANCZOS)
    origin = ((size - logo.width) // 2, (size - logo.height) // 2)
    canvas.alpha_composite(logo, origin)
    return canvas


def main() -> None:
    ASSETS_ROOT.mkdir(parents=True, exist_ok=True)
    mark = load_mark()
    compose(mark, 1024, 0.68, NAVY).save(ASSETS_ROOT / "icon.png")
    compose(mark, 1024, 0.56, TRANSPARENT).save(ASSETS_ROOT / "adaptive-icon.png")
    compose(mark, 1024, 0.62, TRANSPARENT).save(ASSETS_ROOT / "splash.png")
    print(f"Wrote HUB-IT assets to {ASSETS_ROOT}")


if __name__ == "__main__":
    main()
