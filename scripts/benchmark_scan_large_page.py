from __future__ import annotations

import argparse
import json
import sys
import time
from io import BytesIO
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import fitz  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from agent_version import SCAN_ANALYSIS_VERSION  # noqa: E402
from scan_server import ocr as scan_ocr  # noqa: E402
from scan_server.config import ScanServerConfig  # noqa: E402
from scan_server.patterns import scan_text  # noqa: E402


def _font(size: int) -> ImageFont.FreeTypeFont:
    candidates = (
        Path(r"C:\Windows\Fonts\arialbd.ttf"),
        Path(r"C:\Windows\Fonts\arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    )
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    raise RuntimeError("A Cyrillic TrueType font was not found")


def _make_a0_fixture() -> bytes:
    stamp = Image.new("RGB", (2200, 620), "white")
    draw = ImageDraw.Draw(stamp)
    draw.multiline_text(
        (32, 32),
        "ДЛЯ СЛУЖЕБНОГО ПОЛЬЗОВАНИЯ\nЭкз. № 2",
        font=_font(30),
        fill=(75, 110, 165),
        spacing=12,
    )
    stamp_bytes = BytesIO()
    stamp.save(stamp_bytes, format="PNG")

    document = fitz.open()
    page = document.new_page(width=2384.0, height=3370.0)
    page.insert_text((760, 1660), "TECHNICAL DOCUMENTATION", fontsize=48)
    page.insert_image(
        fitz.Rect(1944.0, 30.0, 2344.0, 143.0),
        stream=stamp_bytes.getvalue(),
    )
    payload = document.tobytes(deflate=True)
    document.close()
    return payload


def _run(pdf_bytes: bytes, config: ScanServerConfig, *, focused: bool) -> dict[str, Any]:
    original_focus_renderer = scan_ocr._iter_rendered_pdf_focus_regions
    if not focused:
        scan_ocr._iter_rendered_pdf_focus_regions = lambda *_args, **_kwargs: iter(())
    started = time.perf_counter()
    try:
        result = scan_ocr.ocr_pdf_bytes_detailed(
            pdf_bytes,
            lang=config.ocr_lang,
            tesseract_cmd=config.ocr_tesseract_cmd,
            timeout_sec=config.ocr_timeout_sec,
            dpi=config.ocr_dpi,
            max_pages=1,
        )
    finally:
        scan_ocr._iter_rendered_pdf_focus_regions = original_focus_renderer
    patterns = sorted(
        {str(item.get("pattern") or "") for item in scan_text(str(result.get("text") or "")) if item.get("pattern")}
    )
    return {
        "focused_regions": focused,
        "complete": bool(result.get("complete")),
        "patterns": patterns,
        "dsp_detected": any(pattern.startswith("dsp_") for pattern in patterns),
        "total_ms": round((time.perf_counter() - started) * 1000.0, 1),
        "ocr": result.get("metrics") if isinstance(result.get("metrics"), dict) else {},
        "pages": result.get("pages") if isinstance(result.get("pages"), list) else [],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare full-page and focused OCR on a synthetic A0 DSP mark.")
    parser.add_argument("--json-output", type=Path)
    parser.add_argument("--fixture-output", type=Path)
    args = parser.parse_args()

    config = ScanServerConfig.from_env()
    fixture = _make_a0_fixture()
    if args.fixture_output:
        args.fixture_output.parent.mkdir(parents=True, exist_ok=True)
        args.fixture_output.write_bytes(fixture)

    report = {
        "analysis_version": SCAN_ANALYSIS_VERSION,
        "page": "A0 2384x3370 pt",
        "full_page_only": _run(fixture, config, focused=False),
        "with_focused_regions": _run(fixture, config, focused=True),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"JSON report: {args.json_output}")
    focused = report["with_focused_regions"]
    return 0 if focused["complete"] and focused["dsp_detected"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
