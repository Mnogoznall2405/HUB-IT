from __future__ import annotations

from scan_server.ocr import MAX_RENDERED_PAGE_PIXELS, _cap_zoom_for_max_pixels


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
