"""OCR dedup cache: store roundtrip, retention cleanup, worker hit/miss wiring."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from types import SimpleNamespace

import fitz
import pytest

import scan_server.worker as scan_worker
from scan_server.database import ScanStore
from scan_server.worker import OcrTextResult, ScanWorker


def _make_store(temp_dir) -> ScanStore:
    root = Path(temp_dir)
    return ScanStore(
        db_path=root / "scan-server.db",
        archive_dir=root / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=300,
    )


def _make_worker(temp_dir, store: ScanStore, *, cache_enabled: bool = True) -> ScanWorker:
    worker = object.__new__(ScanWorker)
    worker.config = SimpleNamespace(
        archive_dir=Path(temp_dir) / "archive",
        ocr_enabled=True,
        ocr_lang="rus",
        ocr_tesseract_cmd="",
        ocr_timeout_sec=45,
        ocr_dpi=250,
        ocr_cache_enabled=cache_enabled,
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


def _make_pdf_bytes(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


def _fake_ocr(calls: list, text: str, outcome: str, page_outcomes=None):
    def fake(pdf_bytes, artifact_path=None):
        calls.append(len(pdf_bytes))
        return OcrTextResult(
            text,
            outcome,
            {"page_outcomes": page_outcomes if page_outcomes is not None else ["text"]},
        )

    return fake


def test_ocr_cache_store_roundtrip_first_writer_wins(temp_dir):
    store = _make_store(temp_dir)
    store.put_ocr_cache_entry(
        content_hash="hash-1",
        analysis_version="v1",
        ocr_profile="rus|250|300|3",
        ocr_text="Секретный текст",
        page_outcomes=["text", "blank"],
        ocr_metrics={"pages_processed": 2},
    )

    entry = store.get_ocr_cache_entry("hash-1", "v1", "rus|250|300|3")
    assert entry is not None
    assert entry["ocr_text"] == "Секретный текст"
    assert entry["page_outcomes"] == ["text", "blank"]
    assert entry["ocr_metrics"]["pages_processed"] == 2
    assert entry["hit_count"] == 0

    store.put_ocr_cache_entry(
        content_hash="hash-1",
        analysis_version="v1",
        ocr_profile="rus|250|300|3",
        ocr_text="Другой текст",
        page_outcomes=["text"],
        ocr_metrics={},
    )
    assert store.get_ocr_cache_entry("hash-1", "v1", "rus|250|300|3")["ocr_text"] == "Секретный текст"
    assert store.get_ocr_cache_entry("hash-1", "v1", "other-profile") is None
    assert store.get_ocr_cache_entry("missing", "v1", "rus|250|300|3") is None


def test_ocr_cache_hit_counter(temp_dir):
    store = _make_store(temp_dir)
    store.put_ocr_cache_entry(
        content_hash="h",
        analysis_version="v",
        ocr_profile="p",
        ocr_text="t",
        page_outcomes=["text"],
        ocr_metrics={},
    )

    store.note_ocr_cache_hit("h", "v", "p")
    store.note_ocr_cache_hit("h", "v", "p")

    assert store.get_ocr_cache_entry("h", "v", "p")["hit_count"] == 2


def test_ocr_cache_cleanup_retention_dry_run_and_delete(temp_dir):
    store = _make_store(temp_dir)
    store.put_ocr_cache_entry(
        content_hash="old",
        analysis_version="v",
        ocr_profile="p",
        ocr_text="old",
        page_outcomes=["text"],
        ocr_metrics={},
    )
    old_ts = int(time.time()) - 10 * 24 * 60 * 60
    with store._lock, store._connect() as conn:
        conn.execute("UPDATE scan_ocr_cache SET created_at=? WHERE content_hash='old'", (old_ts,))
        conn.commit()

    dry = store.cleanup_retention(retention_days=90, ocr_cache_retention_days=1, dry_run=True)
    assert dry["ocr_cache"] == 1
    assert store.get_ocr_cache_entry("old", "v", "p") is not None

    result = store.cleanup_retention(retention_days=90, ocr_cache_retention_days=1)
    assert result["ocr_cache"] == 1
    assert store.get_ocr_cache_entry("old", "v", "p") is None


def test_worker_ocr_cache_miss_then_hit(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    worker = _make_worker(temp_dir, store)
    calls: list[int] = []
    monkeypatch.setattr(
        worker, "_ocr_text_from_pdf_bytes", _fake_ocr(calls, "Договор займа", "ocr_text_ready")
    )

    pdf_bytes = b"%PDF-1.7 cache-me"
    first = worker._ocr_text_cached_or_run(pdf_bytes)
    assert first[0] == "Договор займа"
    assert getattr(first, "metrics", {}).get("cache_hit") is not True
    assert len(calls) == 1

    second = worker._ocr_text_cached_or_run(pdf_bytes)
    assert second[0] == "Договор займа"
    assert getattr(second, "metrics", {}).get("cache_hit") is True
    assert getattr(second, "metrics", {}).get("page_outcomes") == ["text"]
    assert len(calls) == 1, "cache hit must not re-run OCR"

    entry = store.get_ocr_cache_entry(*worker._ocr_cache_key(pdf_bytes))
    assert entry is not None
    assert entry["hit_count"] == 1


def test_worker_ocr_cache_blank_document_roundtrip(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    worker = _make_worker(temp_dir, store)
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: OcrTextResult("", "ocr_blank", {"page_outcomes": ["blank"]}),
    )

    pdf_bytes = b"blank-doc-bytes"
    worker._ocr_text_cached_or_run(pdf_bytes)

    hit = worker._ocr_text_cached_or_run(pdf_bytes)
    assert hit[1] == "ocr_blank"
    assert getattr(hit, "metrics", {}).get("cache_hit") is True


@pytest.mark.parametrize(
    "text,outcome",
    [
        ("", "ocr_error"),
        ("", "ocr_attempted_no_text"),
        ("partial text", "ocr_incomplete"),
        ("", "ocr_text_ready"),
    ],
)
def test_worker_ocr_cache_skips_non_complete_results(temp_dir, monkeypatch, text, outcome):
    store = _make_store(temp_dir)
    worker = _make_worker(temp_dir, store)
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: OcrTextResult(text, outcome, {"page_outcomes": []}),
    )

    pdf_bytes = f"payload-{outcome}-{text}".encode()
    worker._ocr_text_cached_or_run(pdf_bytes)

    assert store.get_ocr_cache_entry(*worker._ocr_cache_key(pdf_bytes)) is None


def test_worker_ocr_cache_skips_oversized_text(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    worker = _make_worker(temp_dir, store)
    huge_text = "x" * (worker.OCR_CACHE_MAX_TEXT_CHARS + 1)
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: OcrTextResult(huge_text, "ocr_text_ready", {"page_outcomes": ["text"]}),
    )

    pdf_bytes = b"oversized-text"
    worker._ocr_text_cached_or_run(pdf_bytes)

    assert store.get_ocr_cache_entry(*worker._ocr_cache_key(pdf_bytes)) is None


def test_worker_ocr_cache_disabled_kill_switch(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    worker = _make_worker(temp_dir, store, cache_enabled=False)
    calls: list[int] = []
    monkeypatch.setattr(
        worker, "_ocr_text_from_pdf_bytes", _fake_ocr(calls, "Договор займа", "ocr_text_ready")
    )

    pdf_bytes = b"kill-switch-bytes"
    worker._ocr_text_cached_or_run(pdf_bytes)
    worker._ocr_text_cached_or_run(pdf_bytes)

    assert len(calls) == 2
    assert worker._ocr_cache_key(pdf_bytes) is None


def test_worker_ocr_cache_profile_reflects_ocr_settings(temp_dir):
    store = _make_store(temp_dir)
    worker = _make_worker(temp_dir, store)

    key_before = worker._ocr_cache_key(b"same-bytes")
    worker.config.ocr_dpi = 300
    key_after = worker._ocr_cache_key(b"same-bytes")

    assert key_before[0] == key_after[0]
    assert key_before[1] == key_after[1]
    assert key_before[2] != key_after[2]


def test_collect_pdf_matches_reports_cache_metric(temp_dir, monkeypatch):
    store = _make_store(temp_dir)
    worker = _make_worker(temp_dir, store)
    calls: list[int] = []
    monkeypatch.setattr(
        worker, "_ocr_text_from_pdf_bytes", _fake_ocr(calls, "ordinary OCR text", "ocr_text_ready")
    )
    monkeypatch.setattr(scan_worker, "_extract_pdf_text", lambda pdf_bytes, max_pages=3: "x y z")

    pdf_bytes = _make_pdf_bytes("cover page")

    first = worker._collect_pdf_matches(pdf_bytes)
    assert first["metrics"]["ocr_cache"] == "miss"

    second = worker._collect_pdf_matches(pdf_bytes)
    assert second["metrics"]["ocr_cache"] == "hit"
    assert first["outcome"] == second["outcome"]
    assert len(calls) == 1
