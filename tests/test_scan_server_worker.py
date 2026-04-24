from __future__ import annotations

import base64
import json
from concurrent.futures.process import BrokenProcessPool
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import fitz

import scan_server.worker as scan_worker
from scan_server.worker import ScanWorker


def _make_worker(temp_dir: str) -> ScanWorker:
    spool_store: dict[str, bytes] = {}
    worker = object.__new__(ScanWorker)
    worker.config = SimpleNamespace(
        archive_dir=Path(temp_dir) / "archive",
        ocr_enabled=True,
        ocr_only_if_no_text=True,
        ocr_lang="rus",
        ocr_tesseract_cmd=r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        ocr_timeout_sec=45,
        ocr_dpi=300,
        ocr_max_processes=1,
        retention_days=90,
    )
    worker._ocr_pool = None
    worker._ocr_available = True
    worker.stop_event = SimpleNamespace(is_set=lambda: False)
    worker._last_cleanup_ts = 0
    worker.store = SimpleNamespace(
        read_job_pdf_spool=lambda job_id: spool_store.get(job_id, b""),
        delete_job_pdf_spool=lambda job_id: spool_store.pop(job_id, None) is not None,
        cleanup_retention=lambda retention_days: None,
        claim_next_job=lambda: None,
    )
    worker._test_spool_store = spool_store
    return worker


def _make_pdf_bytes(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


def _make_blank_tiny_pdf_bytes() -> bytes:
    doc = fitz.open()
    doc.new_page(width=72, height=72)
    data = doc.tobytes()
    doc.close()
    return data


def test_collect_pdf_matches_uses_short_text_layer_before_ocr(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    pdf_bytes = _make_pdf_bytes("Password: secret-token-123")

    monkeypatch.setattr(
        "scan_server.worker.scan_text",
        lambda text: [{"pattern": "password_strict", "value": "Password: secret"}] if "Password:" in text else [],
    )
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: (_ for _ in ()).throw(
            AssertionError("OCR should not run when text layer already matches")
        ),
    )

    result = worker._collect_pdf_matches(pdf_bytes)

    assert result["matches"] == [{"pattern": "password_strict", "value": "Password: secret"}]
    assert result["outcome"] == "text_layer_match"


def test_collect_pdf_matches_falls_back_to_ocr_for_gibberish_text_layer(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    pdf_bytes = _make_pdf_bytes("x y z")

    monkeypatch.setattr(
        "scan_server.worker.scan_text",
        lambda text: [{"pattern": "password_strict", "value": "РџР°СЂРѕР»СЊ: secret123"}] if "РџР°СЂРѕР»СЊ:" in text else [],
    )
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: ("РџР°СЂРѕР»СЊ: secret123", "ocr_text_ready"),
    )

    result = worker._collect_pdf_matches(pdf_bytes)

    assert result["matches"] == [{"pattern": "password_strict", "value": "РџР°СЂРѕР»СЊ: secret123"}]
    assert result["outcome"] == "ocr_match"


def test_collect_pdf_matches_skips_blank_tiny_pdf_without_ocr(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    pdf_bytes = _make_blank_tiny_pdf_bytes()

    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: (_ for _ in ()).throw(
            AssertionError("OCR should not run for blank/tiny PDF")
        ),
    )

    result = worker._collect_pdf_matches(pdf_bytes)

    assert result["matches"] == []
    assert result["outcome"] == "ocr_skipped_blank_pdf"
    assert result["reason"] == "Skipped OCR: blank/tiny PDF"


def test_process_job_creates_incident_for_short_text_pdf_without_ocr(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    calls: dict[str, object] = {}

    class _Store:
        def read_job_pdf_spool(self, *, job_id):
            return worker._test_spool_store.get(job_id, b"")

        def delete_job_pdf_spool(self, *, job_id):
            worker._test_spool_store.pop(job_id, None)
            return True

        def create_finding_and_incident(self, **kwargs):
            calls["incident"] = kwargs
            return {"finding_id": "f1", "incident_id": "i1"}

        def finalize_job(self, **kwargs):
            calls["finalize"] = kwargs

    worker.store = _Store()
    worker._test_spool_store["job-1"] = _make_pdf_bytes("Password: secret-token-123")

    monkeypatch.setattr(
        "scan_server.worker.scan_text",
        lambda text: [{"pattern": "password_strict", "value": "Password: secret"}] if "Password:" in text else [],
    )
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: (_ for _ in ()).throw(
            AssertionError("OCR should not run for matching text layer")
        ),
    )

    payload = {
        "pdf_slice_b64": base64.b64encode(_make_pdf_bytes("Password: secret-token-123")).decode("ascii"),
        "text_excerpt": "",
        "local_pattern_hits": [],
    }
    job = {
        "id": "job-1",
        "agent_id": "agent-1",
        "hostname": "host-1",
        "branch": "branch-1",
        "user_login": "user-1",
        "user_full_name": "User One",
        "file_path": r"C:\Users\user-1\Documents\short_text.pdf",
        "source_kind": "pdf_slice",
        "payload_json": json.dumps(payload),
    }

    worker._process_job(job)

    assert "incident" in calls
    assert not any(worker.config.archive_dir.rglob("*"))
    assert calls["finalize"] == {
        "job_id": "job-1",
        "status": "done_with_incident",
        "summary": "Matches found: 1 (text_layer_match)",
    }


def test_process_job_skips_blank_tiny_pdf_with_explicit_summary(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    calls: dict[str, object] = {}

    class _Store:
        def read_job_pdf_spool(self, *, job_id):
            return worker._test_spool_store.get(job_id, b"")

        def delete_job_pdf_spool(self, *, job_id):
            worker._test_spool_store.pop(job_id, None)
            return True

        def create_finding_and_incident(self, **kwargs):
            calls["incident"] = kwargs
            return {"finding_id": "f1", "incident_id": "i1"}

        def finalize_job(self, **kwargs):
            calls["finalize"] = kwargs

    worker.store = _Store()
    worker._test_spool_store["job-blank"] = _make_blank_tiny_pdf_bytes()

    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: (_ for _ in ()).throw(
            AssertionError("OCR should not run for blank/tiny PDF")
        ),
    )

    payload = {
        "pdf_slice_b64": base64.b64encode(_make_blank_tiny_pdf_bytes()).decode("ascii"),
        "text_excerpt": "",
        "local_pattern_hits": [],
    }
    job = {
        "id": "job-blank",
        "agent_id": "agent-1",
        "hostname": "host-1",
        "branch": "branch-1",
        "user_login": "user-1",
        "user_full_name": "User One",
        "file_path": r"C:\Users\user-1\Documents\forward.pdf",
        "file_name": "forward.pdf",
        "source_kind": "pdf_slice",
        "payload_json": json.dumps(payload),
    }

    worker._process_job(job)

    assert "incident" not in calls
    assert not any(worker.config.archive_dir.rglob("*"))
    assert calls["finalize"] == {
        "job_id": "job-blank",
        "status": "done_clean",
        "summary": "Skipped OCR: blank/tiny PDF (ocr_skipped_blank_pdf)",
    }


def test_process_job_processes_pdf_in_memory_and_ocr_finds_match(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    calls: dict[str, object] = {}

    class _Store:
        def read_job_pdf_spool(self, *, job_id):
            return worker._test_spool_store.get(job_id, b"")

        def delete_job_pdf_spool(self, *, job_id):
            worker._test_spool_store.pop(job_id, None)
            return True

        def create_finding_and_incident(self, **kwargs):
            calls["incident"] = kwargs
            return {"finding_id": "f1", "incident_id": "i1"}

        def finalize_job(self, **kwargs):
            calls["finalize"] = kwargs

    worker.store = _Store()
    worker._test_spool_store["job-archive-fail"] = _make_pdf_bytes("x y z")

    monkeypatch.setattr(
        "scan_server.worker.scan_text",
        lambda text: [{"pattern": "password_strict", "value": "Password: secret"}] if "Password:" in text else [],
    )
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: ("Password: secret-token-123", "ocr_text_ready"),
    )

    payload = {
        "pdf_slice_b64": base64.b64encode(_make_pdf_bytes("x y z")).decode("ascii"),
        "text_excerpt": "",
        "local_pattern_hits": [],
    }
    job = {
        "id": "job-archive-fail",
        "agent_id": "agent-1",
        "hostname": "host-1",
        "branch": "branch-1",
        "user_login": "user-1",
        "user_full_name": "User One",
        "file_path": r"C:\Users\user-1\Documents\fallback.pdf",
        "file_name": "fallback.pdf",
        "source_kind": "pdf_slice",
        "payload_json": json.dumps(payload),
    }

    worker._process_job(job)

    assert "incident" in calls
    assert not any(worker.config.archive_dir.rglob("*"))
    assert calls["finalize"]["job_id"] == "job-archive-fail"
    assert calls["finalize"]["status"] == "done_with_incident"
    assert calls["finalize"]["summary"] == "Matches found: 1 (ocr_match)"
    assert "job-archive-fail" not in worker._test_spool_store


def test_process_job_fails_when_transient_pdf_payload_is_missing(temp_dir):
    worker = _make_worker(temp_dir)
    calls: dict[str, object] = {}

    class _Store:
        def read_job_pdf_spool(self, *, job_id):
            return b""

        def delete_job_pdf_spool(self, *, job_id):
            calls["deleted"] = job_id
            return True

        def create_finding_and_incident(self, **kwargs):
            calls["incident"] = kwargs
            return {"finding_id": "f1", "incident_id": "i1"}

        def finalize_job(self, **kwargs):
            calls["finalize"] = kwargs

    worker.store = _Store()
    job = {
        "id": "job-missing",
        "agent_id": "agent-1",
        "hostname": "host-1",
        "branch": "branch-1",
        "user_login": "user-1",
        "user_full_name": "User One",
        "file_path": r"C:\Users\user-1\Documents\missing.pdf",
        "file_name": "missing.pdf",
        "source_kind": "pdf_slice",
        "payload_json": json.dumps({"text_excerpt": "", "local_pattern_hits": []}),
    }

    worker._process_job(job)

    assert "incident" not in calls
    assert calls["finalize"] == {
        "job_id": "job-missing",
        "status": "failed",
        "error_text": "Missing transient PDF payload",
    }
    assert calls["deleted"] == "job-missing"


def test_tick_drains_all_queued_jobs_without_waiting(temp_dir):
    worker = _make_worker(temp_dir)
    jobs = [{"id": "job-1"}, {"id": "job-2"}]
    processed: list[str] = []

    worker.store = SimpleNamespace(
        cleanup_retention=lambda retention_days: None,
        claim_next_job=lambda: jobs.pop(0) if jobs else None,
    )
    worker._process_job = lambda job: processed.append(job["id"])

    assert worker._tick() is True
    assert processed == ["job-1", "job-2"]


def test_ocr_text_recycles_broken_process_pool_and_retries_inline(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)

    class BrokenPool:
        def submit(self, *_args, **_kwargs):
            raise BrokenProcessPool("child process terminated abruptly")

    worker._ocr_pool = BrokenPool()

    shutdown_calls = {"count": 0}

    def fake_shutdown():
        shutdown_calls["count"] += 1
        worker._ocr_pool = None

    monkeypatch.setattr(worker, "_shutdown_ocr_pool", fake_shutdown)
    monkeypatch.setattr(
        worker,
        "_run_inline_ocr_job",
        lambda pdf_bytes, artifact_path=None: ("Password: secret-token-123", "ocr_text_ready"),
    )

    text, outcome = worker._ocr_text_from_pdf_bytes(b"%PDF-1.4", artifact_path=Path("broken.pdf"))

    assert outcome == "ocr_text_ready"
    assert text == "Password: secret-token-123"
    assert shutdown_calls["count"] == 1


def test_get_ocr_pool_uses_threads_on_windows(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    monkeypatch.setattr(scan_worker, "IS_WINDOWS", True)

    pool = worker._get_ocr_pool()

    try:
        assert isinstance(pool, ThreadPoolExecutor)
    finally:
        worker._shutdown_ocr_pool()
