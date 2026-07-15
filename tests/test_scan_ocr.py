from __future__ import annotations

import pytest

import scan_server.ocr as scan_ocr
from scan_server.ocr import (
    FOCUSED_REGION_DPI,
    MAX_FOCUSED_REGION_PIXELS,
    MAX_PAGE_DIMENSION_POINTS,
    MAX_RENDERED_PAGE_PIXELS,
    OcrNonRetryableError,
    _cap_zoom_for_max_pixels,
    _iter_rendered_pdf_pages,
    ocr_pdf_bytes_detailed,
)


def test_cap_zoom_for_max_pixels_keeps_normal_page_unchanged():
    zoom = _cap_zoom_for_max_pixels(
        width_points=595.0,
        height_points=842.0,
        zoom=300.0 / 72.0,
    )
    assert zoom == 300.0 / 72.0


def test_cap_zoom_for_max_pixels_scales_down_large_page():
    requested_zoom = 300.0 / 72.0
    zoom = _cap_zoom_for_max_pixels(
        width_points=10000.0,
        height_points=10000.0,
        zoom=requested_zoom,
    )
    assert 0.0 < zoom < requested_zoom
    pixels = (10000.0 * zoom) * (10000.0 * zoom)
    assert pixels <= MAX_RENDERED_PAGE_PIXELS * 1.001


def test_max_page_dimension_constant_is_sane():
    assert MAX_PAGE_DIMENSION_POINTS > 1000.0


def test_iter_rendered_pdf_pages_rejects_oversized_page_box(monkeypatch):
    class _Rect:
        width = MAX_PAGE_DIMENSION_POINTS + 1
        height = 100.0

    class _Page:
        rect = _Rect()

        def get_pixmap(self, *args, **kwargs):
            raise AssertionError("oversized page must not be rendered")

    class _Doc:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __len__(self):
            return 1

        def load_page(self, _idx):
            return _Page()

    class _Fitz:
        @staticmethod
        def open(*_args, **_kwargs):
            return _Doc()

        @staticmethod
        def Matrix(*args):
            return args

    monkeypatch.setattr(scan_ocr, "fitz", _Fitz)

    with pytest.raises(OcrNonRetryableError):
        list(_iter_rendered_pdf_pages(b"%PDF-1.4", max_pages=1, dpi=300))


def test_nonblank_page_without_ocr_text_is_incomplete(monkeypatch):
    configs = []

    class _ImageValue:
        size = (1200, 1800)

        def convert(self, _mode):
            return self

        def crop(self, _box):
            return self

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def getextrema(self):
            return ((0, 255), (0, 255), (0, 255))

    class _ImageModule:
        @staticmethod
        def open(_stream):
            return _ImageValue()

    class _Tesseract:
        class pytesseract:
            tesseract_cmd = ""

        @staticmethod
        def image_to_string(*_args, **_kwargs):
            configs.append(str(_kwargs.get("config") or ""))
            return ""

    monkeypatch.setattr(scan_ocr, "Image", _ImageModule)
    monkeypatch.setattr(scan_ocr, "pytesseract", _Tesseract)
    monkeypatch.setattr(scan_ocr, "_iter_rendered_pdf_pages", lambda *_args, **_kwargs: iter([(0, b"png")]))
    monkeypatch.setattr(
        scan_ocr,
        "_pdf_page_full_render_metrics",
        lambda *_args, **_kwargs: {"effective_dpi": 300.0, "downscaled": False},
    )
    monkeypatch.setattr(
        scan_ocr,
        "_iter_rendered_pdf_focus_regions",
        lambda *_args, **_kwargs: iter(
            (
                (f"region-{index}", b"png", {
                    "requested_dpi": 400,
                    "effective_dpi": 400.0,
                    "rendered_pixels": 100,
                    "full_effective_dpi": 300.0,
                })
                for index in range(4)
            )
        ),
    )

    result = ocr_pdf_bytes_detailed(
        b"%PDF-1.4",
        lang="rus",
        tesseract_cmd="",
        max_pages=3,
    )

    assert result["complete"] is False
    assert result["pages"][0]["outcome"] == "nonblank_no_text"
    assert configs[0] == "--psm 6"
    assert configs.count("--psm 11") == 4


def test_focused_render_keeps_more_detail_than_full_a0_page():
    page_width = 2384.0
    page_height = 3370.0
    full_zoom = _cap_zoom_for_max_pixels(
        width_points=page_width,
        height_points=page_height,
        zoom=300.0 / 72.0,
    )
    focused_zoom = _cap_zoom_for_max_pixels(
        width_points=page_width * 0.55,
        height_points=page_height * 0.25,
        zoom=FOCUSED_REGION_DPI / 72.0,
        max_pixels=MAX_FOCUSED_REGION_PIXELS,
    )

    assert focused_zoom > full_zoom * 2
