from __future__ import annotations

import logging
import math
import os
import time
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterator, List, Tuple

logger = logging.getLogger(__name__)

def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(str(os.getenv(name, str(default)) or default).strip())
    except Exception:
        value = default
    return max(minimum, min(maximum, value))


# 20M keeps A3 at a real 300 DPI while remaining bounded for six concurrent jobs.
# Large drawings use separate focused region renders below instead of inflating the
# whole page into memory.
MAX_RENDERED_PAGE_PIXELS = _bounded_env_int(
    "SCAN_OCR_FULL_PAGE_MAX_PIXELS", 20_000_000, 8_000_000, 40_000_000
)
MAX_FOCUSED_REGION_PIXELS = _bounded_env_int(
    "SCAN_OCR_FOCUSED_REGION_MAX_PIXELS", 12_000_000, 4_000_000, 24_000_000
)
FOCUSED_REGION_DPI = _bounded_env_int("SCAN_OCR_FOCUSED_DPI", 400, 300, 600)
# Skip OCR for absurd page boxes (malformed PDFs can report thousands of cm).
MAX_PAGE_DIMENSION_POINTS = 5_000.0


class OcrNonRetryableError(RuntimeError):
    """Raised for malformed or oversized PDFs where retrying wastes resources."""

try:
    import fitz  # type: ignore
except Exception:  # pragma: no cover
    fitz = None

try:
    import pytesseract  # type: ignore
except Exception:  # pragma: no cover
    pytesseract = None

try:
    from PIL import Image, ImageOps  # type: ignore
except Exception:  # pragma: no cover
    Image = None
    ImageOps = None


def is_tesseract_available(tesseract_cmd: str) -> bool:
    if pytesseract is None:
        return False
    cmd = str(tesseract_cmd or "").strip()
    if cmd:
        if not Path(cmd).exists():
            return False
        pytesseract.pytesseract.tesseract_cmd = cmd
    try:
        _ = pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _cap_zoom_for_max_pixels(
    *,
    width_points: float,
    height_points: float,
    zoom: float,
    max_pixels: int = MAX_RENDERED_PAGE_PIXELS,
) -> float:
    safe_zoom = max(float(zoom or 0.0), 0.01)
    width_px = max(float(width_points or 0.0) * safe_zoom, 1.0)
    height_px = max(float(height_points or 0.0) * safe_zoom, 1.0)
    pixel_count = width_px * height_px
    if pixel_count <= max(1, int(max_pixels)):
        return safe_zoom
    scale = math.sqrt(max(1, int(max_pixels)) / pixel_count)
    return max(0.01, safe_zoom * scale)


def _iter_rendered_pdf_pages(pdf_bytes: bytes, max_pages: int, dpi: int) -> Iterator[Tuple[int, bytes]]:
    if not pdf_bytes:
        logger.warning("PDF render skipped: pdf_bytes is empty")
        return
    if fitz is None:
        logger.warning("PDF render skipped: PyMuPDF (fitz) is not installed or failed to import")
        return

    zoom = max(1.0, float(dpi) / 72.0)
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            total = min(max(1, int(max_pages)), len(doc))
            for idx in range(total):
                page = doc.load_page(idx)
                rect = page.rect
                if (
                    float(rect.width) > MAX_PAGE_DIMENSION_POINTS
                    or float(rect.height) > MAX_PAGE_DIMENSION_POINTS
                ):
                    logger.warning(
                        "PDF page %d skipped for OCR: page box too large (%.1f x %.1f pt)",
                        idx,
                        float(rect.width),
                        float(rect.height),
                    )
                    raise OcrNonRetryableError(
                        f"PDF page box too large for OCR: {float(rect.width):.1f}x{float(rect.height):.1f} pt"
                    )
                effective_zoom = _cap_zoom_for_max_pixels(
                    width_points=float(rect.width),
                    height_points=float(rect.height),
                    zoom=zoom,
                )
                if effective_zoom < zoom:
                    original_pixels = max(int(rect.width * zoom), 1) * max(int(rect.height * zoom), 1)
                    capped_pixels = max(int(rect.width * effective_zoom), 1) * max(int(rect.height * effective_zoom), 1)
                    logger.info(
                        "PDF page %d render scaled down for OCR: pixels=%d -> %d dpi=%.1f -> %.1f",
                        idx,
                        original_pixels,
                        capped_pixels,
                        72.0 * zoom,
                        72.0 * effective_zoom,
                    )
                page_matrix = fitz.Matrix(effective_zoom, effective_zoom)
                pix = page.get_pixmap(matrix=page_matrix, alpha=False)
                raw = pix.tobytes("png")
                del pix
                yield idx, raw
            logger.debug("PDF rendered successfully: %d pages at %d DPI", total, dpi)
    except OcrNonRetryableError:
        raise
    except Exception as exc:
        logger.error("PDF render failed (fitz): %s", exc)
        raise OcrNonRetryableError(f"PDF render failed: {exc}") from exc


def _iter_rendered_pdf_focus_regions(
    pdf_bytes: bytes,
    *,
    page_index: int,
    dpi: int = FOCUSED_REGION_DPI,
    full_page_dpi: int = 300,
) -> Iterator[Tuple[str, bytes, Dict[str, Any]]]:
    """Render overlapping header/footer halves directly from PDF at high detail.

    Cropping an already downscaled A0/A1 raster cannot recover a small DSP mark.
    Direct clipped rendering preserves materially more DPI without allocating a
    100M+ pixel full-page bitmap.
    """
    if not pdf_bytes or fitz is None:
        return
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            if page_index < 0 or page_index >= len(doc):
                return
            page = doc.load_page(page_index)
            rect = page.rect
            if (
                float(rect.width) > MAX_PAGE_DIMENSION_POINTS
                or float(rect.height) > MAX_PAGE_DIMENSION_POINTS
            ):
                raise OcrNonRetryableError(
                    f"PDF page box too large for focused OCR: {float(rect.width):.1f}x{float(rect.height):.1f} pt"
                )
            requested_zoom = max(1.0, float(dpi) / 72.0)
            full_zoom = _cap_zoom_for_max_pixels(
                width_points=float(rect.width),
                height_points=float(rect.height),
                zoom=max(1.0, float(full_page_dpi) / 72.0),
                max_pixels=MAX_RENDERED_PAGE_PIXELS,
            )
            regions = (
                ("header_left", 0.00, 0.00, 0.55, 0.25),
                ("header_right", 0.45, 0.00, 1.00, 0.25),
                ("footer_left", 0.00, 0.75, 0.55, 1.00),
                ("footer_right", 0.45, 0.75, 1.00, 1.00),
            )
            for name, x0, y0, x1, y1 in regions:
                clip = fitz.Rect(
                    float(rect.x0) + float(rect.width) * x0,
                    float(rect.y0) + float(rect.height) * y0,
                    float(rect.x0) + float(rect.width) * x1,
                    float(rect.y0) + float(rect.height) * y1,
                )
                effective_zoom = _cap_zoom_for_max_pixels(
                    width_points=float(clip.width),
                    height_points=float(clip.height),
                    zoom=requested_zoom,
                    max_pixels=MAX_FOCUSED_REGION_PIXELS,
                )
                pix = page.get_pixmap(
                    matrix=fitz.Matrix(effective_zoom, effective_zoom),
                    clip=clip,
                    alpha=False,
                )
                raw = pix.tobytes("png")
                pixels = int(pix.width) * int(pix.height)
                del pix
                yield name, raw, {
                    "requested_dpi": int(dpi),
                    "effective_dpi": round(72.0 * effective_zoom, 1),
                    "rendered_pixels": pixels,
                    "full_effective_dpi": round(72.0 * full_zoom, 1),
                }
    except OcrNonRetryableError:
        raise
    except Exception as exc:
        raise OcrNonRetryableError(f"Focused PDF render failed: {exc}") from exc


def _pdf_page_full_render_metrics(pdf_bytes: bytes, *, page_index: int, dpi: int) -> Dict[str, Any]:
    if not pdf_bytes or fitz is None:
        return {}
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            if page_index < 0 or page_index >= len(doc):
                return {}
            rect = doc.load_page(page_index).rect
            zoom = _cap_zoom_for_max_pixels(
                width_points=float(rect.width),
                height_points=float(rect.height),
                zoom=max(1.0, float(dpi) / 72.0),
                max_pixels=MAX_RENDERED_PAGE_PIXELS,
            )
            return {
                "requested_dpi": int(dpi),
                "effective_dpi": round(72.0 * zoom, 1),
                "downscaled": zoom + 0.0001 < max(1.0, float(dpi) / 72.0),
            }
    except Exception:
        return {}


def _is_blank_image(image: Any) -> bool:
    try:
        extrema = image.convert("L").getextrema()
        if isinstance(extrema, tuple) and len(extrema) == 2 and all(isinstance(row, (int, float)) for row in extrema):
            return int(extrema[0]) >= 248
        if isinstance(extrema, tuple):
            minima = [int(row[0]) for row in extrema if isinstance(row, tuple) and len(row) >= 2]
            return bool(minima) and min(minima) >= 248
    except Exception:
        pass
    return False


def _prepare_ocr_image(image: Any) -> Any:
    prepared = image.convert("L")
    if ImageOps is not None:
        try:
            prepared = ImageOps.autocontrast(prepared, cutoff=1)
        except Exception:
            pass
    return prepared


def _rotate_from_osd(image: Any, *, timeout_sec: int) -> Any:
    if pytesseract is None or not hasattr(pytesseract, "image_to_osd"):
        return image
    try:
        osd = str(pytesseract.image_to_osd(image, timeout=max(3, min(10, int(timeout_sec)))))
        for line in osd.splitlines():
            if line.lower().startswith("rotate:"):
                angle = int(line.split(":", 1)[1].strip() or 0) % 360
                if angle:
                    return image.rotate(-angle, expand=True, fillcolor=255)
                break
    except Exception:
        pass
    return image


def _tesseract_text(image: Any, *, lang: str, timeout_sec: int, psm: int = 6) -> str:
    config = f"--psm {max(3, min(13, int(psm)))}"
    try:
        return str(
            pytesseract.image_to_string(
                image,
                lang=lang,
                timeout=max(1, int(timeout_sec)),
                config=config,
            )
            or ""
        )
    except TypeError:
        return str(pytesseract.image_to_string(image, lang=lang, config=config) or "")


def ocr_pdf_bytes_detailed(
    pdf_bytes: bytes,
    *,
    lang: str,
    tesseract_cmd: str,
    timeout_sec: int = 60,
    dpi: int = 300,
    max_pages: int = 3,
) -> Dict[str, Any]:
    started_at = time.perf_counter()
    if not pdf_bytes:
        return {"text": "", "complete": False, "pages": [], "reason": "empty_payload"}

    if pytesseract is None:
        logger.error("OCR aborted: pytesseract is not installed")
        return {"text": "", "complete": False, "pages": [], "reason": "pytesseract_unavailable"}
    if Image is None:
        logger.error("OCR aborted: Pillow (Image) is not installed")
        return {"text": "", "complete": False, "pages": [], "reason": "pillow_unavailable"}

    cmd = str(tesseract_cmd or "").strip()
    if cmd:
        if not Path(cmd).exists():
            logger.error("OCR aborted: tesseract.exe not found at path: %s", cmd)
            return {"text": "", "complete": False, "pages": [], "reason": "tesseract_unavailable"}
        pytesseract.pytesseract.tesseract_cmd = cmd

    text_parts: List[str] = []
    page_outcomes: List[Dict[str, Any]] = []
    current_lang = str(lang or "rus")
    rendered_pages = 0
    total_rendered_pixels = 0
    min_full_effective_dpi = float(dpi)
    min_focused_effective_dpi = float(FOCUSED_REGION_DPI)
    focused_region_count = 0
    for idx, raw in _iter_rendered_pdf_pages(pdf_bytes, max_pages=max_pages, dpi=dpi):
        rendered_pages += 1
        try:
            with Image.open(BytesIO(raw)) as image:
                rgb_image = image.convert("RGB")
                is_blank = _is_blank_image(rgb_image)
                try:
                    prepared = _rotate_from_osd(_prepare_ocr_image(rgb_image), timeout_sec=timeout_sec)
                    text_candidates = [
                        _tesseract_text(prepared, lang=current_lang, timeout_sec=timeout_sec, psm=6)
                    ]
                    width, height = prepared.size
                    total_rendered_pixels += int(width) * int(height)
                    full_render_metrics = _pdf_page_full_render_metrics(
                        pdf_bytes,
                        page_index=idx,
                        dpi=dpi,
                    )
                    min_full_effective_dpi = min(
                        min_full_effective_dpi,
                        float(full_render_metrics.get("effective_dpi") or dpi),
                    )
                    page_render_metrics: List[Dict[str, Any]] = []
                    for region_name, region_raw, region_metrics in _iter_rendered_pdf_focus_regions(
                        pdf_bytes,
                        page_index=idx,
                        dpi=FOCUSED_REGION_DPI,
                        full_page_dpi=dpi,
                    ):
                        with Image.open(BytesIO(region_raw)) as region_image:
                            region_prepared = _prepare_ocr_image(region_image.convert("RGB"))
                            text_candidates.append(
                                _tesseract_text(
                                    region_prepared,
                                    lang=current_lang,
                                    timeout_sec=timeout_sec,
                                    psm=11,
                                )
                            )
                        focused_region_count += 1
                        total_rendered_pixels += int(region_metrics.get("rendered_pixels") or 0)
                        min_full_effective_dpi = min(
                            min_full_effective_dpi,
                            float(region_metrics.get("full_effective_dpi") or dpi),
                        )
                        min_focused_effective_dpi = min(
                            min_focused_effective_dpi,
                            float(region_metrics.get("effective_dpi") or FOCUSED_REGION_DPI),
                        )
                        page_render_metrics.append({"region": region_name, **region_metrics})
                    text = "\n".join(row.strip() for row in text_candidates if row and row.strip()).strip()
                except Exception as exc:
                    page_outcomes.append({"page": idx + 1, "outcome": "ocr_error", "reason": f"{type(exc).__name__}: {exc}"})
                    logger.error("OCR failed for page %d (lang=%s): %s", idx, current_lang, exc)
                    continue
                if text:
                    text_parts.append(str(text))
                    page_outcomes.append({
                        "page": idx + 1,
                        "outcome": "text",
                        "chars": len(text),
                        "render": page_render_metrics,
                    })
                    logger.debug("OCR page %d: extracted %d chars", idx, len(text))
                elif is_blank:
                    page_outcomes.append({"page": idx + 1, "outcome": "blank", "render": page_render_metrics})
                else:
                    page_outcomes.append({"page": idx + 1, "outcome": "nonblank_no_text", "render": page_render_metrics})
                    logger.debug("OCR page %d: no text found (lang=%s)", idx, current_lang)
        except Exception as exc:
            page_outcomes.append({"page": idx + 1, "outcome": "ocr_error", "reason": f"{type(exc).__name__}: {exc}"})
            logger.error("OCR failed for page %d (lang=%s): %s", idx, current_lang, exc)

    if rendered_pages <= 0:
        logger.warning("OCR skipped: no page images rendered from PDF")
        return {
            "text": "",
            "complete": False,
            "pages": page_outcomes,
            "reason": "no_pages_rendered",
            "metrics": {"duration_ms": round((time.perf_counter() - started_at) * 1000.0, 1)},
        }

    result = "\n".join(text_parts).strip()
    if not result:
        logger.info("OCR completed but no text was extracted from %d pages", rendered_pages)
    complete = len(page_outcomes) == rendered_pages and all(
        str(row.get("outcome") or "") in {"text", "blank"}
        for row in page_outcomes
    )
    reason = "" if complete else "one_or_more_pages_incomplete"
    return {
        "text": result,
        "complete": complete,
        "pages": page_outcomes,
        "reason": reason,
        "metrics": {
            "duration_ms": round((time.perf_counter() - started_at) * 1000.0, 1),
            "pages": rendered_pages,
            "focused_regions": focused_region_count,
            "rendered_pixels": total_rendered_pixels,
            "full_effective_dpi_min": round(min_full_effective_dpi, 1),
            "focused_effective_dpi_min": round(min_focused_effective_dpi, 1),
            "full_page_pixel_limit": MAX_RENDERED_PAGE_PIXELS,
            "focused_region_pixel_limit": MAX_FOCUSED_REGION_PIXELS,
        },
    }


def ocr_pdf_bytes(
    pdf_bytes: bytes,
    *,
    lang: str,
    tesseract_cmd: str,
    timeout_sec: int = 60,
    dpi: int = 300,
    max_pages: int = 3,
) -> str:
    """Backward-compatible text-only wrapper."""
    result = ocr_pdf_bytes_detailed(
        pdf_bytes,
        lang=lang,
        tesseract_cmd=tesseract_cmd,
        timeout_sec=timeout_sec,
        dpi=dpi,
        max_pages=max_pages,
    )
    return str(result.get("text") or "")
