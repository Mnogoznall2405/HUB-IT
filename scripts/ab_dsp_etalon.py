"""Offline A/B on the real DSP etalon (no prod touch, read-only files).

Usage:
    python scripts\\ab_dsp_etalon.py C:\\Project\\Image_scan\\data\\etalon_dsp [--candidate-dpi 300]

Compares current module settings (baseline) vs a candidate focused-DPI override
on every manifest case: GT markers hit/miss + wall timing. Exit code 1 when the
candidate loses any marker the baseline found.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("SCAN_OCR_FOCUSED_DPI", "250")  # mirror prod before import

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import scan_server.ocr as scan_ocr  # noqa: E402

TESSERACT_CMD = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}


def _norm(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def _to_pdf_bytes(path: Path) -> bytes:
    raw = path.read_bytes()
    if path.suffix.lower() == ".pdf":
        return raw
    try:
        import fitz
    except Exception as exc:
        raise RuntimeError("PyMuPDF (fitz) is required for image etalons") from exc

    doc = fitz.open()
    try:
        with fitz.open(stream=raw) as img_doc:
            pix = img_doc.load_page(0).get_pixmap(alpha=False)
            page = doc.new_page(width=pix.width, height=pix.height)
            page.insert_image(page.rect, pixmap=pix)
        return doc.tobytes()
    finally:
        doc.close()


def _run(pdf_bytes: bytes, timeout_sec: int = 120):
    started = time.perf_counter()
    result = scan_ocr.ocr_pdf_bytes_detailed(
        pdf_bytes, lang="rus", tesseract_cmd=TESSERACT_CMD, timeout_sec=timeout_sec, max_pages=3,
    )
    return result, (time.perf_counter() - started) * 1000.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--candidate-dpi", type=int, default=300)
    parser.add_argument("--show-text-on-miss", action="store_true", default=True)
    args = parser.parse_args()

    manifest = json.loads((args.folder / "etalon.json").read_text(encoding="utf-8"))
    baseline_dpi = int(scan_ocr.FOCUSED_REGION_DPI)
    print(f"baseline focused_dpi={baseline_dpi} vs candidate focused_dpi={args.candidate_dpi}")

    regressions: list[str] = []
    total_base = 0.0
    total_var = 0.0
    print("file | base_ms | cand_ms | base_must_hit | cand_must_hit | lost")
    for case in manifest["cases"]:
        path = args.folder / case["file"]
        if not path.exists():
            print(f"{case['file']} | MISSING - skipped ({case.get('note', '')})")
            continue
        pdf_bytes = _to_pdf_bytes(path)
        base, base_ms = _run(pdf_bytes)
        scan_ocr.FOCUSED_REGION_DPI = int(args.candidate_dpi)
        try:
            variant, var_ms = _run(pdf_bytes)
        finally:
            scan_ocr.FOCUSED_REGION_DPI = baseline_dpi
        total_base += base_ms
        total_var += var_ms
        base_text = _norm(base.get("text"))
        var_text = _norm(variant.get("text"))
        must = [str(m).lower() for m in case.get("must", [])]
        base_hit = sum(1 for m in must if m in base_text)
        var_hit = sum(1 for m in must if m in var_text)
        lost = [m for m in must if m in base_text and m not in var_text]
        if lost:
            regressions.append(f"{case['file']}: lost {lost}")
            if args.show_text_on_miss:
                print(f"  candidate text: {var_text[:300]!r}")
        print(f"{case['file']} | {base_ms:.0f} | {var_ms:.0f} | {base_hit}/{len(must)} | {var_hit}/{len(must)} | {lost}")
    print(f"TOTAL | {total_base:.0f} | {total_var:.0f} |")
    if regressions:
        print("REGRESSIONS:\n" + "\n".join(regressions))
        return 1
    print("no candidate regressions vs baseline")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
