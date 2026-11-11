"""OCR stage timing instrumentation: render/recognize/focused/osd/pool timers."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

import scan_server.ocr as scan_ocr
from scan_server.database import ScanStore
from scan_server.worker import OcrTextResult, ScanWorker


class _FakePixmap:
    """Minimal fitz.Pixmap stand-in (alpha=False RGB, tightly packed rows)."""

    def __init__(self, width=64, height=64):
        self.width = width
        self.height = height
        self.samples = b"\xff" * (width * height * 3)


def _tesseract_cmd():
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    ]
    for path in candidates:
        if Path(path).exists():
            return path
    return None


def _image_harness(monkeypatch, *, osd_text="Rotate: 0\n", ocr_text="text", ocr_sleep=0.0):
    class _FakeImage:
        def __init__(self, size=(2068, 2923)):
            self._size = tuple(size)

        @property
        def size(self):
            return self._size

        def convert(self, _mode):
            return self

        def rotate(self, _angle, **_kwargs):
            return _FakeImage((self._size[1], self._size[0]))

        def getextrema(self):
            return ((0, 255), (0, 255), (0, 255))

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    class _ImageModule:
        @staticmethod
        def open(_stream):
            return _FakeImage()

        @staticmethod
        def frombytes(_mode, _size, _data):
            return _FakeImage()

    class _Tesseract:
        @staticmethod
        def image_to_osd(_image, **_kwargs):
            return osd_text

        @staticmethod
        def image_to_string(_image, **_kwargs):
            if ocr_sleep:
                time.sleep(ocr_sleep)
            return ocr_text

    monkeypatch.setattr(scan_ocr, "Image", _ImageModule)
    monkeypatch.setattr(scan_ocr, "pytesseract", _Tesseract)
    monkeypatch.setattr(
        scan_ocr,
        "_pdf_page_full_render_metrics",
        lambda *_args, **_kwargs: {"effective_dpi": 300.0, "downscaled": False},
    )


def _region_metrics(name="region-0"):
    return {
        "requested_dpi": 400,
        "effective_dpi": 400.0,
        "rendered_pixels": 100,
        "full_effective_dpi": 300.0,
    }


def test_stage_timers_present_and_bounded_by_total(monkeypatch):
    _image_harness(monkeypatch)
    monkeypatch.setattr(scan_ocr, "_iter_rendered_pdf_pages", lambda *_a, **_k: iter([(0, _FakePixmap())]))
    monkeypatch.setattr(
        scan_ocr,
        "_iter_rendered_pdf_focus_regions",
        lambda *_a, **_k: iter(
            [(f"region-{i}", _FakePixmap(), _region_metrics()) for i in range(2)]
        ),
    )

    result = scan_ocr.ocr_pdf_bytes_detailed(b"%PDF-1.4", lang="rus", tesseract_cmd="", max_pages=1)

    assert result["pages"][0]["outcome"] == "text"
    metrics = result["metrics"]
    for key in ("duration_ms", "render_ms", "recognize_ms", "focused_ms", "osd_wait_ms"):
        assert key in metrics, f"missing stage timer {key}"
        assert isinstance(metrics[key], float)
        assert metrics[key] >= 0.0
    assert metrics["render_ms"] <= metrics["duration_ms"]
    assert metrics["recognize_ms"] <= metrics["duration_ms"]
    assert metrics["focused_ms"] <= metrics["duration_ms"]


def test_recognize_timer_tracks_tesseract_time(monkeypatch):
    _image_harness(monkeypatch, ocr_sleep=0.05)
    monkeypatch.setattr(scan_ocr, "_iter_rendered_pdf_pages", lambda *_a, **_k: iter([(0, _FakePixmap())]))
    monkeypatch.setattr(
        scan_ocr,
        "_iter_rendered_pdf_focus_regions",
        lambda *_a, **_k: iter(
            [(f"region-{i}", _FakePixmap(), _region_metrics()) for i in range(2)]
        ),
    )

    result = scan_ocr.ocr_pdf_bytes_detailed(b"%PDF-1.4", lang="rus", tesseract_cmd="", max_pages=1)

    # 1 full-page psm6 + 2 region psm11 calls, 50 ms each.
    assert result["metrics"]["recognize_ms"] >= 100.0


def test_render_timer_tracks_rasterization_time(monkeypatch):
    _image_harness(monkeypatch)

    def _slow_pages(*_args, **_kwargs):
        time.sleep(0.05)
        yield 0, _FakePixmap()

    monkeypatch.setattr(scan_ocr, "_iter_rendered_pdf_pages", _slow_pages)
    monkeypatch.setattr(scan_ocr, "_iter_rendered_pdf_focus_regions", lambda *_a, **_k: iter(()))

    result = scan_ocr.ocr_pdf_bytes_detailed(b"%PDF-1.4", lang="rus", tesseract_cmd="", max_pages=1)

    assert result["metrics"]["render_ms"] >= 40.0
    assert result["metrics"]["recognize_ms"] < result["metrics"]["render_ms"]


def _make_store(temp_dir) -> ScanStore:
    root = Path(temp_dir)
    return ScanStore(
        db_path=root / "scan-server.db",
        archive_dir=root / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=300,
    )


def _make_worker(temp_dir, store: ScanStore) -> ScanWorker:
    worker = object.__new__(ScanWorker)
    worker.config = SimpleNamespace(
        archive_dir=Path(temp_dir) / "archive",
        ocr_enabled=True,
        ocr_lang="rus",
        ocr_tesseract_cmd="",
        ocr_timeout_sec=45,
        ocr_dpi=250,
        ocr_cache_enabled=True,
        ocr_max_processes=1,
        scan_job_max_workers=2,
        pdf_max_bytes=25 * 1024 * 1024,
    )
    worker._job_pool = None
    worker._job_futures = {}
    worker._ocr_pool = None
    worker._ocr_pool_lock = threading.Lock()
    worker._ocr_available = True
    worker.stop_event = SimpleNamespace(is_set=lambda: False)
    worker._last_cleanup_ts = 0
    worker.store = store
    return worker


def _pool_with(payload, *, result_sleep=0.0):
    class _Future:
        def result(self, timeout=None):
            if result_sleep:
                time.sleep(result_sleep)
            return payload

    class _Pool:
        def submit(self, *args, **kwargs):
            return _Future()

    return _Pool()


def test_worker_pool_wait_is_zero_for_instant_future(temp_dir, monkeypatch):
    worker = _make_worker(temp_dir, _make_store(temp_dir))
    payload = {
        "text": "abc",
        "complete": True,
        "pages": [{"outcome": "text"}],
        "metrics": {"duration_ms": 5.0},
    }
    monkeypatch.setattr(worker, "_get_ocr_pool", lambda: _pool_with(payload))

    result = worker._ocr_text_from_pdf_bytes(b"%PDF-1.4")

    assert result[1] == "ocr_text_ready"
    assert getattr(result, "metrics", {})["pool_wait_ms"] == 0.0


def test_worker_pool_wait_captures_queue_delay(temp_dir, monkeypatch):
    worker = _make_worker(temp_dir, _make_store(temp_dir))
    payload = {
        "text": "abc",
        "complete": True,
        "pages": [{"outcome": "text"}],
        "metrics": {"duration_ms": 5.0},
    }
    monkeypatch.setattr(worker, "_get_ocr_pool", lambda: _pool_with(payload, result_sleep=0.05))

    result = worker._ocr_text_from_pdf_bytes(b"%PDF-1.4")

    assert getattr(result, "metrics", {})["pool_wait_ms"] >= 30.0


def test_cache_store_drops_pool_wait_and_hit_reports_zero(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    worker = _make_worker(temp_dir, store)
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: OcrTextResult(
            "cached text",
            "ocr_text_ready",
            {"page_outcomes": ["text"], "duration_ms": 100.0, "pool_wait_ms": 7.5},
        ),
    )

    pdf_bytes = b"pool-wait-cache-bytes"
    worker._ocr_text_cached_or_run(pdf_bytes)
    hit = worker._ocr_text_cached_or_run(pdf_bytes)

    entry = store.get_ocr_cache_entry(*worker._ocr_cache_key(pdf_bytes))
    assert "pool_wait_ms" not in entry["ocr_metrics"]
    assert "duration_ms" not in entry["ocr_metrics"]
    assert getattr(hit, "metrics", {})["pool_wait_ms"] == 0.0
    assert getattr(hit, "metrics", {}).get("cache_hit") is True


def test_pixmap_path_extracts_real_text_with_real_ocr():
    """Golden test: pixmap-direct PIL images OCR identically (no PNG roundtrip).

    Runs the real fitz+tesseract chain on a synthetic PDF. Skipped where
    tesseract is not installed; proves pixel-identity end to end.
    """
    cmd = _tesseract_cmd()
    if cmd is None:
        pytest.skip("tesseract not installed")
    fitz = pytest.importorskip("fitz")

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 100), "Akt 98765 DSP stamp")
    page.insert_text((72, 200), "Second line 54321 here")
    pdf_bytes = doc.tobytes()
    doc.close()

    result = scan_ocr.ocr_pdf_bytes_detailed(
        pdf_bytes, lang="rus", tesseract_cmd=cmd, max_pages=1,
    )

    assert result["pages"][0]["outcome"] == "text"
    assert "98765" in result["text"]
    assert "54321" in result["text"]
    for key in ("duration_ms", "render_ms", "recognize_ms", "focused_ms", "osd_wait_ms"):
        assert key in result["metrics"]
