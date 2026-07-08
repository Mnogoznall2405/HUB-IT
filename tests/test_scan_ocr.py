from __future__ import annotations

import pytest

import scan_server.ocr as scan_ocr
from scan_server.ocr import (
    MAX_PAGE_DIMENSION_POINTS,
    MAX_RENDERED_PAGE_PIXELS,
    OcrNonRetryableError,
    _cap_zoom_for_max_pixels,
    _iter_rendered_pdf_pages,
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
