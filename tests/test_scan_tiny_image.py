"""Tiny-image gate: skip OCR for images too small to hold readable text."""

from __future__ import annotations

import io
import json
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image as PILImage

import scan_server.worker as scan_worker
from scan_server.worker import ScanWorker


def _png_bytes(width: int, height: int) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", (width, height), (255, 255, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _make_worker(temp_dir, *, dry_run=True, min_pixels=500000):
    worker = object.__new__(ScanWorker)
    worker.config = SimpleNamespace(
        archive_dir=Path(temp_dir) / "archive",
        ocr_enabled=True,
        ocr_lang="rus",
        ocr_tesseract_cmd="",
        ocr_timeout_sec=45,
        ocr_dpi=250,
        ocr_cache_enabled=False,
        ocr_tiny_image_min_pixels=min_pixels,
        ocr_tiny_image_dry_run=dry_run,
        ocr_max_processes=1,
        scan_job_max_workers=2,
        scan_job_max_attempts=3,
        pdf_max_bytes=25 * 1024 * 1024,
    )
    worker._job_pool = None
    worker._job_futures = {}
    worker._ocr_pool = None
    worker._ocr_pool_lock = threading.Lock()
    worker._ocr_available = True
    worker.stop_event = SimpleNamespace(is_set=lambda: False)
    worker._last_cleanup_ts = 0
    return worker


class _Store:
    def __init__(self):
        self.calls: dict[str, object] = {}
        self.spool: dict[str, bytes] = {}

    def read_job_pdf_spool(self, *, job_id):
        return self.spool.get(job_id, b"")

    def delete_job_pdf_spool(self, *, job_id):
        self.spool.pop(job_id, None)
        return True

    def finalize_job(self, **kwargs):
        self.calls["finalize"] = kwargs

    def record_job_metrics(self, *, job_id, metrics):
        self.calls["metrics"] = dict(metrics)


def _image_job(job_id="job-tiny"):
    return {
        "id": job_id,
        "file_name": "icon.png",
        "source_kind": "image",
        "payload_json": "{}",
    }


def test_tiny_image_size_reads_dimensions():
    assert ScanWorker._tiny_image_size(_png_bytes(10, 20)) == (10, 20)


def test_tiny_image_size_fails_open_to_none():
    assert ScanWorker._tiny_image_size(b"not-an-image") is None
    assert ScanWorker._tiny_image_size(b"") is None


def test_enforce_mode_skips_ocr_for_tiny_image(temp_dir, monkeypatch):
    worker = _make_worker(temp_dir, dry_run=False)
    store = _Store()
    store.spool["job-tiny"] = _png_bytes(10, 10)
    worker.store = store
    monkeypatch.setattr(
        scan_worker, "convert_document_to_pdf", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not convert"))
    )
    monkeypatch.setattr(
        worker, "_collect_pdf_matches", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not OCR"))
    )

    worker._process_job(_image_job())

    assert store.calls["finalize"]["status"] == "done_clean"
    assert "меньше" in store.calls["finalize"]["summary"]
    assert store.calls["metrics"]["tiny_image"]["skipped"] is True
    assert store.calls["metrics"]["tiny_image"]["pixels"] == 100


def test_dry_run_continues_normal_path_and_marks_metric(temp_dir, monkeypatch):
    worker = _make_worker(temp_dir, dry_run=True)
    store = _Store()
    store.spool["job-tiny"] = _png_bytes(10, 10)
    worker.store = store
    converted = {"called": False}

    def _convert(data, name):
        converted["called"] = True
        return b"%PDF-converted"

    monkeypatch.setattr(scan_worker, "convert_document_to_pdf", _convert)
    monkeypatch.setattr(
        worker,
        "_collect_pdf_matches",
        lambda *a, **k: {"matches": [], "outcome": "ocr_clean_no_match", "reason": "x", "metrics": {}},
    )

    worker._process_job(_image_job())

    assert converted["called"] is True
    assert store.calls["finalize"]["status"] == "done_clean"
    assert store.calls["metrics"]["tiny_image"]["would_skip"] is True
    assert store.calls["metrics"]["tiny_image"]["pixels"] == 100


def test_kill_switch_disables_gate(temp_dir, monkeypatch):
    worker = _make_worker(temp_dir, dry_run=False, min_pixels=0)
    store = _Store()
    store.spool["job-tiny"] = _png_bytes(10, 10)
    worker.store = store
    monkeypatch.setattr(scan_worker, "convert_document_to_pdf", lambda data, name: b"%PDF-converted")
    monkeypatch.setattr(
        worker,
        "_collect_pdf_matches",
        lambda *a, **k: {"matches": [], "outcome": "ocr_clean_no_match", "reason": "x", "metrics": {}},
    )

    worker._process_job(_image_job())

    assert "tiny_image" not in store.calls["metrics"]


def test_large_image_passes_gate(temp_dir, monkeypatch):
    worker = _make_worker(temp_dir, dry_run=False)
    store = _Store()
    store.spool["job-big"] = _png_bytes(1000, 1000)
    worker.store = store
    monkeypatch.setattr(scan_worker, "convert_document_to_pdf", lambda data, name: b"%PDF-converted")
    monkeypatch.setattr(
        worker,
        "_collect_pdf_matches",
        lambda *a, **k: {"matches": [], "outcome": "ocr_clean_no_match", "reason": "x", "metrics": {}},
    )

    worker._process_job({**_image_job("job-big"), "id": "job-big"})

    assert "tiny_image" not in store.calls["metrics"]
    assert store.calls["finalize"]["status"] == "done_clean"


def test_corrupt_image_fails_open_to_normal_path(temp_dir, monkeypatch):
    worker = _make_worker(temp_dir, dry_run=False)
    store = _Store()
    store.spool["job-bad"] = b"corrupt-bytes-not-an-image"
    worker.store = store
    monkeypatch.setattr(scan_worker, "convert_document_to_pdf", lambda data, name: b"%PDF-converted")
    monkeypatch.setattr(
        worker,
        "_collect_pdf_matches",
        lambda *a, **k: {"matches": [], "outcome": "ocr_clean_no_match", "reason": "x", "metrics": {}},
    )

    worker._process_job({**_image_job("job-bad"), "id": "job-bad"})

    assert "tiny_image" not in store.calls["metrics"]
    assert store.calls["finalize"]["status"] == "done_clean"
