from __future__ import annotations

import logging
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Shared pool for overlapping OSD rotation detection with full-page OCR.
# Threads are cheap here: each one waits on a single tesseract OSD call.
_osd_pool_instance: Optional[ThreadPoolExecutor] = None
_osd_pool_lock = threading.Lock()


def _osd_pool() -> ThreadPoolExecutor:
    global _osd_pool_instance
    if _osd_pool_instance is None:
        with _osd_pool_lock:
            if _osd_pool_instance is None:
                _osd_pool_instance = ThreadPoolExecutor(max_workers=16, thread_name_prefix="scan-osd")
    return _osd_pool_instance

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
# Lower bound 250: A/B on the DSP etalon proved focused regions recall-neutral
# at 250 DPI and ~15% faster (see tests/test_scan_ocr_ab.py, SCAN_PERFORMANCE_PLAN).
FOCUSED_REGION_DPI = _bounded_env_int("SCAN_OCR_FOCUSED_DPI", 400, 250, 600)
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


def _iter_rendered_pdf_pages(pdf_bytes: bytes, max_pages: int, dpi: int) -> Iterator[Tuple[int, Any]]:
    """Yield (page_index, fitz Pixmap) for the first pages of a PDF.

    Pixmaps are yielded (not PNG bytes): the consumer builds the PIL image via
    `_pil_image_from_pixmap`, skipping PNG encode/decode with bit-identical
    pixels. Ownership transfers to the consumer (it must release the pixmap).
    """
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
                yield idx, pix
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
) -> Iterator[Tuple[str, Any, Dict[str, Any]]]:
    """Render overlapping header/footer halves directly from PDF at high detail.

    Cropping an already downscaled A0/A1 raster cannot recover a small DSP mark.
    Direct clipped rendering preserves materially more DPI without allocating a
    100M+ pixel full-page bitmap.

    Yields (name, fitz Pixmap, region_metrics); pixmap ownership transfers to
    the consumer (see `_iter_rendered_pdf_pages`).
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
                pixels = int(pix.width) * int(pix.height)
                yield name, pix, {
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


def _detect_osd_angle(image: Any, *, timeout_sec: int) -> int:
    """Return the deskew angle from Tesseract OSD (0 when unknown/failed).

    Pure detection: never modifies or rotates the image. Safe to run
    concurrently with the full-page OCR of the same image.
    """
    if pytesseract is None or not hasattr(pytesseract, "image_to_osd"):
        return 0
    try:
        osd = str(pytesseract.image_to_osd(image, timeout=max(3, min(10, int(timeout_sec)))))
        for line in osd.splitlines():
            if line.lower().startswith("rotate:"):
                return int(line.split(":", 1)[1].strip() or 0) % 360
    except Exception:
        pass
    return 0


def _rotate_from_osd(image: Any, *, timeout_sec: int) -> Any:
    angle = _detect_osd_angle(image, timeout_sec=timeout_sec)
    if not angle:
        return image
    try:
        return image.rotate(-angle, expand=True, fillcolor=255)
    except Exception:
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


def _pil_image_from_pixmap(pix: Any) -> Any:
    """Build a PIL RGB image from a fitz Pixmap without a PNG roundtrip.

    Bit-identical pixels to `Image.open(BytesIO(pix.tobytes("png")))` at a
    fraction of the cost (~150ms saved per 6MP page). Callers must render with
    `alpha=False` (RGB samples, tightly packed rows).
    """
    return Image.frombytes("RGB", (int(pix.width), int(pix.height)), pix.samples)


def _timed_render_pages(
    pdf_bytes: bytes, max_pages: int, dpi: int
) -> Iterator[Tuple[float, int, Any]]:
    """Yield (render_ms, idx, raw); render_ms covers rasterization of that page.

    Timing lives in the wrapper so consumer work (OCR) is excluded: the mark
    resets each time the consumer asks for the next item. Generator-level
    errors propagate unchanged (no item, no timing recorded).
    """
    mark = time.perf_counter()
    for idx, raw in _iter_rendered_pdf_pages(pdf_bytes, max_pages=max_pages, dpi=dpi):
        now = time.perf_counter()
        yield (now - mark) * 1000.0, idx, raw
        mark = time.perf_counter()


def _timed_render_regions(
    pdf_bytes: bytes, *, page_index: int, dpi: int, full_page_dpi: int
) -> Iterator[Tuple[float, str, Any, Dict[str, Any]]]:
    """Yield (render_ms, name, raw, region_metrics) for focused regions."""
    mark = time.perf_counter()
    for name, pix, region_metrics in _iter_rendered_pdf_focus_regions(
        pdf_bytes, page_index=page_index, dpi=dpi, full_page_dpi=full_page_dpi
    ):
        now = time.perf_counter()
        yield (now - mark) * 1000.0, name, pix, region_metrics
        mark = time.perf_counter()


def ocr_pdf_bytes_detailed(
    pdf_bytes: bytes,
    *,
    lang: str,
    tesseract_cmd: str,
    timeout_sec: int = 60,
    dpi: int = 300,
    max_pages: int = 3,
    focused_psm: int = 11,
) -> Dict[str, Any]:
    """Detailed OCR with per-page outcomes and stage timings.

    `focused_psm` selects the Tesseract page-segmentation mode for the four
    header/footer focused regions (default 11 = sparse text, current behavior).
    Exposed for offline A/B experiments; production always uses the default
    until an A/B proves a variant recall-neutral.
    """
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
    # Diagnostic stage timers (additive metrics only, no behavior change):
    # render_ms = fitz rasterization; recognize_ms = all _tesseract_text calls;
    # focused_ms = whole focused-region loop (overlaps the two above);
    # osd_wait_ms = blocked on the OSD future (overlapped with full OCR).
    render_ms = 0.0
    recognize_ms = 0.0
    focused_ms = 0.0
    osd_wait_ms = 0.0
    min_full_effective_dpi = float(dpi)
    min_focused_effective_dpi = float(FOCUSED_REGION_DPI)
    focused_region_count = 0
    for page_render_ms, idx, pix in _timed_render_pages(pdf_bytes, max_pages=max_pages, dpi=dpi):
        rendered_pages += 1
        render_ms += page_render_ms
        try:
            with _pil_image_from_pixmap(pix) as image:
                del pix
                rgb_image = image.convert("RGB")
                is_blank = _is_blank_image(rgb_image)
                try:
                    prepared = _prepare_ocr_image(rgb_image)
                    # OSD runs concurrently with the full-page OCR on the same
                    # image: identical inputs and decisions as the sequential
                    # version, but the ~1.3s OSD cost hides behind OCR time.
                    osd_future = _osd_pool().submit(
                        _detect_osd_angle, prepared, timeout_sec=timeout_sec
                    )
                    recog_started = time.perf_counter()
                    text_candidates = [
                        _tesseract_text(prepared, lang=current_lang, timeout_sec=timeout_sec, psm=6)
                    ]
                    recognize_ms += (time.perf_counter() - recog_started) * 1000.0
                    osd_wait_started = time.perf_counter()
                    try:
                        angle = int(
                            osd_future.result(timeout=max(3, min(10, int(timeout_sec)))) or 0
                        ) % 360
                    except Exception:
                        angle = 0
                    osd_wait_ms += (time.perf_counter() - osd_wait_started) * 1000.0
                    if angle:
                        try:
                            prepared = prepared.rotate(-angle, expand=True, fillcolor=255)
                        except Exception:
                            angle = 0
                        if angle:
                            recog_started = time.perf_counter()
                            text_candidates = [
                                _tesseract_text(prepared, lang=current_lang, timeout_sec=timeout_sec, psm=6)
                            ]
                            recognize_ms += (time.perf_counter() - recog_started) * 1000.0
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
                    focused_started = time.perf_counter()
                    try:
                        for (
                            region_render_ms,
                            region_name,
                            region_pix,
                            region_metrics,
                        ) in _timed_render_regions(
                            pdf_bytes,
                            page_index=idx,
                            dpi=FOCUSED_REGION_DPI,
                            full_page_dpi=dpi,
                        ):
                            render_ms += region_render_ms
                            with _pil_image_from_pixmap(region_pix) as region_image:
                                del region_pix
                                region_prepared = _prepare_ocr_image(region_image.convert("RGB"))
                                recog_started = time.perf_counter()
                                text_candidates.append(
                                    _tesseract_text(
                                        region_prepared,
                                        lang=current_lang,
                                        timeout_sec=timeout_sec,
                                        psm=focused_psm,
                                    )
                                )
                                recognize_ms += (time.perf_counter() - recog_started) * 1000.0
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
                    finally:
                        focused_ms += (time.perf_counter() - focused_started) * 1000.0
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
            "metrics": {
                "duration_ms": round((time.perf_counter() - started_at) * 1000.0, 1),
                "render_ms": 0.0,
                "recognize_ms": 0.0,
                "focused_ms": 0.0,
                "osd_wait_ms": 0.0,
            },
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
            "render_ms": round(render_ms, 1),
            "recognize_ms": round(recognize_ms, 1),
            "focused_ms": round(focused_ms, 1),
            "osd_wait_ms": round(osd_wait_ms, 1),
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
