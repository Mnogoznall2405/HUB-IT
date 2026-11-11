from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

try:
    import fitz  # type: ignore
except Exception:  # pragma: no cover
    fitz = None

try:
    from PIL import Image, ImageOps  # type: ignore
except Exception:  # pragma: no cover
    Image = None
    ImageOps = None

DEFAULT_MAX_PAGES = max(1, int(os.environ.get("DOC_CONVERT_MAX_PAGES", "10")))
DEFAULT_RENDER_ZOOM = float(os.environ.get("DOC_CONVERT_RENDER_ZOOM", "3.0"))
MIN_TEXT_CHARS_PER_PAGE = max(20, int(os.environ.get("DOC_CONVERT_MIN_TEXT_CHARS", "80")))

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".gif"}
IMAGE_MIME_PREFIXES = ("image/",)


@dataclass(slots=True)
class RenderedPage:
    page_index: int
    png_bytes: bytes
    text_layer: str
    source_name: str


def _normalize_name(value: object) -> str:
    return str(value or "").strip() or "document"


def _extension(file_name: str) -> str:
    name = _normalize_name(file_name).lower()
    dot = name.rfind(".")
    return name[dot:] if dot >= 0 else ""


def is_image_source(*, file_name: str, mime_type: str = "") -> bool:
    ext = _extension(file_name)
    mime = str(mime_type or "").strip().lower()
    if ext in IMAGE_EXTENSIONS:
        return True
    return any(mime.startswith(prefix) for prefix in IMAGE_MIME_PREFIXES)


def is_pdf_source(*, file_name: str, mime_type: str = "") -> bool:
    ext = _extension(file_name)
    mime = str(mime_type or "").strip().lower()
    return ext == ".pdf" or mime == "application/pdf"


def _image_to_png_bytes(data: bytes) -> bytes:
    if Image is None:
        raise RuntimeError("Pillow is not installed")
    with Image.open(io.BytesIO(data)) as image:
        if ImageOps is not None:
            image = ImageOps.exif_transpose(image)
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()


def render_pdf_pages(
    data: bytes,
    *,
    source_name: str,
    max_pages: int = DEFAULT_MAX_PAGES,
    zoom: float = DEFAULT_RENDER_ZOOM,
) -> list[RenderedPage]:
    if fitz is None:
        raise RuntimeError("PyMuPDF is not installed")
    document = fitz.open(stream=data, filetype="pdf")
    try:
        page_count = min(int(document.page_count or 0), max(1, int(max_pages)))
        if int(document.page_count or 0) > page_count:
            logger.info(
                "doc_convert: truncating PDF pages source=%s total=%s keep=%s",
                source_name,
                document.page_count,
                page_count,
            )
        matrix = fitz.Matrix(zoom, zoom)
        pages: list[RenderedPage] = []
        for index in range(page_count):
            page = document.load_page(index)
            text_layer = str(page.get_text("text") or "").strip()
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            pages.append(
                RenderedPage(
                    page_index=index + 1,
                    png_bytes=pixmap.tobytes("png"),
                    text_layer=text_layer,
                    source_name=source_name,
                )
            )
        return pages
    finally:
        document.close()


def render_image_page(data: bytes, *, source_name: str, page_index: int = 1) -> RenderedPage:
    return RenderedPage(
        page_index=page_index,
        png_bytes=_image_to_png_bytes(data),
        text_layer="",
        source_name=source_name,
    )


def render_source(
    *,
    file_name: str,
    data: bytes,
    mime_type: str = "",
    max_pages: int = DEFAULT_MAX_PAGES,
    zoom: float = DEFAULT_RENDER_ZOOM,
    page_index_offset: int = 0,
) -> list[RenderedPage]:
    name = _normalize_name(file_name)
    if is_pdf_source(file_name=name, mime_type=mime_type):
        pages = render_pdf_pages(data, source_name=name, max_pages=max_pages, zoom=zoom)
        if page_index_offset:
            return [
                RenderedPage(
                    page_index=page.page_index + page_index_offset,
                    png_bytes=page.png_bytes,
                    text_layer=page.text_layer,
                    source_name=page.source_name,
                )
                for page in pages
            ]
        return pages
    if is_image_source(file_name=name, mime_type=mime_type):
        return [render_image_page(data, source_name=name, page_index=1 + page_index_offset)]
    # Fallback: try image decode, then PDF.
    try:
        return [render_image_page(data, source_name=name, page_index=1 + page_index_offset)]
    except Exception:
        return render_pdf_pages(data, source_name=name, max_pages=max_pages, zoom=zoom)


def page_has_usable_text(text: str, *, min_chars: int = MIN_TEXT_CHARS_PER_PAGE) -> bool:
    """Return True only for coherent digital text layers.

    Many office PDFs expose a fragmented text layer (one word per line). That
    looks "long enough" by char count but destroys tables/forms — reject it and
    fall back to vision.
    """
    raw = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.strip() for line in raw.split("\n") if line.strip()]
    cleaned = " ".join(lines)
    if len(cleaned) < min_chars:
        return False
    alnum = sum(1 for char in cleaned if char.isalnum())
    if alnum < max(12, min_chars // 3):
        return False
    if not lines:
        return False

    line_count = len(lines)
    avg_len = sum(len(line) for line in lines) / line_count
    short_lines = sum(1 for line in lines if len(line) <= 24)
    tiny_token_lines = sum(1 for line in lines if len(line.split()) <= 2)

    # Classic broken PDF extraction: "Наименование\nподразделения\n..."
    if line_count >= 8 and (short_lines / line_count) >= 0.55:
        return False
    if line_count >= 8 and (tiny_token_lines / line_count) >= 0.50:
        return False
    if line_count >= 6 and avg_len < 28:
        return False
    return True


def text_layer_to_markdown(text: str) -> str:
    lines = [line.rstrip() for line in str(text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines).strip()
