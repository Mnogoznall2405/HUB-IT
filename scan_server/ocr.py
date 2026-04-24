from __future__ import annotations

import logging
import math
from io import BytesIO
from pathlib import Path
from typing import List

logger = logging.getLogger(__name__)

MAX_RENDERED_PAGE_PIXELS = 40_000_000

try:
    import fitz  # type: ignore
except Exception:  # pragma: no cover
    fitz = None

try:
    import pytesseract  # type: ignore
except Exception:  # pragma: no cover
    pytesseract = None

try:
    from PIL import Image  # type: ignore
except Exception:  # pragma: no cover
    Image = None


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


def _render_pdf_pages(pdf_bytes: bytes, max_pages: int, dpi: int) -> List[bytes]:
    if not pdf_bytes:
        logger.warning("PDF render skipped: pdf_bytes is empty")
        return []
    if fitz is None:
        logger.warning("PDF render skipped: PyMuPDF (fitz) is not installed or failed to import")
        return []

    out: List[bytes] = []
    zoom = max(1.0, float(dpi) / 72.0)
    matrix = fitz.Matrix(zoom, zoom)
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            total = min(max(1, int(max_pages)), len(doc))
            for idx in range(total):
                page = doc.load_page(idx)
                rect = page.rect
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
                out.append(pix.tobytes("png"))
            logger.debug("PDF rendered successfully: %d pages at %d DPI", total, dpi)
    except Exception as exc:
        logger.error("PDF render failed (fitz): %s", exc)
        return []
    return out


def ocr_pdf_bytes(
    pdf_bytes: bytes,
    *,
    lang: str,
    tesseract_cmd: str,
    timeout_sec: int = 60,
    dpi: int = 300,
    max_pages: int = 3,
) -> str:
    if not pdf_bytes:
        return ""

    if pytesseract is None:
        logger.error("OCR aborted: pytesseract is not installed")
        return ""
    if Image is None:
        logger.error("OCR aborted: Pillow (Image) is not installed")
        return ""

    cmd = str(tesseract_cmd or "").strip()
    if cmd:
        if not Path(cmd).exists():
            logger.error("OCR aborted: tesseract.exe not found at path: %s", cmd)
            return ""
        pytesseract.pytesseract.tesseract_cmd = cmd

    page_images = _render_pdf_pages(pdf_bytes, max_pages=max_pages, dpi=dpi)
    if not page_images:
        logger.warning("OCR skipped: no page images rendered from PDF")
        return ""

    text_parts: List[str] = []
    current_lang = str(lang or "rus")
    for idx, raw in enumerate(page_images):
        try:
            with Image.open(BytesIO(raw)) as image:
                rgb_image = image.convert("RGB")
                try:
                    text = pytesseract.image_to_string(
                        rgb_image,
                        lang=current_lang,
                        timeout=max(1, int(timeout_sec)),
                    )
                except TypeError:
                    # Older pytesseract versions don't support timeout
                    text = pytesseract.image_to_string(
                        rgb_image,
                        lang=current_lang,
                    )
                if text:
                    text_parts.append(str(text))
                    logger.debug("OCR page %d: extracted %d chars", idx, len(text))
                else:
                    logger.debug("OCR page %d: no text found (lang=%s)", idx, current_lang)
        except Exception as exc:
            logger.error("OCR failed for page %d (lang=%s): %s", idx, current_lang, exc)
            continue

    result = "\n".join(text_parts).strip()
    if not result:
        logger.info("OCR completed but no text was extracted from %d pages", len(page_images))
    return result
