from __future__ import annotations

import base64
import json
import threading
from concurrent.futures.process import BrokenProcessPool
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import fitz

import scan_server.worker as scan_worker
from scan_server.config import ScanServerConfig
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
        scan_job_max_workers=4,
        retention_days=90,
    )
    worker._job_pool = None
    worker._job_futures = {}
    worker._ocr_pool = None
    worker._ocr_pool_lock = threading.Lock()
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


def test_collect_pdf_matches_uses_shared_loan_pattern_for_pdf_text_layer(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    pdf_bytes = _make_pdf_bytes("text layer")

    monkeypatch.setattr(scan_worker, "_extract_pdf_text", lambda pdf_bytes, max_pages=3: "Договор займа подписан")
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: (_ for _ in ()).throw(
            AssertionError("OCR should not run when text layer already matches")
        ),
    )

    result = worker._collect_pdf_matches(pdf_bytes)

    assert result["outcome"] == "text_layer_match"
    assert any(row.get("pattern") == "loan_keyword" for row in result["matches"])


def test_collect_pdf_matches_uses_shared_loan_pattern_for_pdf_ocr(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    pdf_bytes = _make_pdf_bytes("x y z")

    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: ("Сумма заёма указана", "ocr_text_ready"),
    )

    result = worker._collect_pdf_matches(pdf_bytes)

    assert result["outcome"] == "ocr_match"
    assert any(row.get("pattern") == "loan_keyword" for row in result["matches"])


def test_collect_pdf_matches_respects_allowed_pattern_filter_for_ocr(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    pdf_bytes = _make_pdf_bytes("x y z")

    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: ("Password: secret-token-123\nСумма заёма указана", "ocr_text_ready"),
    )

    result = worker._collect_pdf_matches(pdf_bytes, allowed_pattern_ids_filter={"loan_keyword"})

    assert result["outcome"] == "ocr_match"
    assert [row.get("pattern") for row in result["matches"]] == ["loan_keyword"]


def test_collect_pdf_matches_returns_clean_when_filter_allows_no_patterns(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    pdf_bytes = _make_pdf_bytes("x y z")

    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: ("Password: secret-token-123\nСумма заёма указана", "ocr_text_ready"),
    )

    result = worker._collect_pdf_matches(pdf_bytes, allowed_pattern_ids_filter=set())

    assert result["outcome"] == "ocr_clean_no_match"
    assert result["matches"] == []


def test_process_pdf_job_filters_local_hits_from_task_payload(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    calls: dict[str, object] = {}

    class _Store:
        def read_job_pdf_spool(self, *, job_id):
            return b""

        def delete_job_pdf_spool(self, *, job_id):
            return True

        def get_task_payload(self, task_id):
            assert task_id == "task-1"
            return {"server_pdf_pattern_ids": ["loan_keyword"]}

        def create_finding_and_incident(self, **kwargs):
            calls["incident"] = kwargs
            return {"finding_id": "f1", "incident_id": "i1"}

        def finalize_job(self, **kwargs):
            calls["finalize"] = kwargs

    worker.store = _Store()
    payload = {
        "text_excerpt": "",
        "local_pattern_hits": [
            {"pattern": "password_strict", "pattern_name": "Пароль", "value": "Password: secret-token-123"},
            {"pattern": "loan_keyword", "pattern_name": "Займ", "value": "займ"},
        ],
    }
    job = {
        "id": "job-1",
        "scan_task_id": "task-1",
        "source_kind": "pdf",
        "payload_json": json.dumps(payload),
    }

    worker._process_job(job)

    assert [row["pattern"] for row in calls["incident"]["matched_patterns"]] == ["loan_keyword"]
    assert calls["finalize"]["status"] == "done_with_incident"


def test_process_pdf_job_uses_all_patterns_when_task_filter_is_empty(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    calls: dict[str, object] = {}

    class _Store:
        def read_job_pdf_spool(self, *, job_id):
            return b""

        def delete_job_pdf_spool(self, *, job_id):
            return True

        def get_task_payload(self, task_id):
            return {"server_pdf_pattern_ids": []}

        def create_finding_and_incident(self, **kwargs):
            calls["incident"] = kwargs
            return {"finding_id": "f1", "incident_id": "i1"}

        def finalize_job(self, **kwargs):
            calls["finalize"] = kwargs

    worker.store = _Store()
    payload = {
        "text_excerpt": "",
        "local_pattern_hits": [
            {"pattern": "password_strict", "pattern_name": "Пароль", "value": "Password: secret-token-123"},
        ],
    }
    job = {
        "id": "job-1",
        "scan_task_id": "task-1",
        "source_kind": "pdf",
        "payload_json": json.dumps(payload),
    }

    worker._process_job(job)

    assert [row["pattern"] for row in calls["incident"]["matched_patterns"]] == ["password_strict"]
    assert calls["finalize"]["status"] == "done_with_incident"


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


def test_process_job_requeues_ocr_error_until_attempt_limit(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    calls: dict[str, object] = {}

    class _Store:
        def read_job_pdf_spool(self, *, job_id):
            return worker._test_spool_store.get(job_id, b"")

        def delete_job_pdf_spool(self, *, job_id):
            calls["deleted"] = job_id
            worker._test_spool_store.pop(job_id, None)
            return True

        def requeue_job_for_retry(self, **kwargs):
            calls["retry"] = kwargs

        def finalize_job(self, **kwargs):
            calls["finalize"] = kwargs

    worker.store = _Store()
    worker.config.scan_job_max_attempts = 3
    worker._test_spool_store["job-retry"] = _make_pdf_bytes("x y z")
    monkeypatch.setattr(
        worker,
        "_collect_pdf_matches",
        lambda *args, **kwargs: {"matches": [], "outcome": "ocr_error", "reason": "OCR execution error"},
    )
    job = {
        "id": "job-retry",
        "source_kind": "pdf_slice",
        "attempt_count": 1,
        "payload_json": json.dumps({"text_excerpt": "", "local_pattern_hits": []}),
    }

    worker._process_job(job)

    assert calls["retry"] == {
        "job_id": "job-retry",
        "error_text": "OCR timeout",
        "summary": "OCR retry scheduled (1/3)",
    }
    assert "finalize" not in calls
    assert "deleted" not in calls
    assert "job-retry" in worker._test_spool_store


def test_process_job_fails_ocr_error_after_attempt_limit(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    calls: dict[str, object] = {}

    class _Store:
        def read_job_pdf_spool(self, *, job_id):
            return worker._test_spool_store.get(job_id, b"")

        def delete_job_pdf_spool(self, *, job_id):
            calls["deleted"] = job_id
            worker._test_spool_store.pop(job_id, None)
            return True

        def requeue_job_for_retry(self, **kwargs):
            calls["retry"] = kwargs

        def finalize_job(self, **kwargs):
            calls["finalize"] = kwargs

    worker.store = _Store()
    worker.config.scan_job_max_attempts = 3
    worker._test_spool_store["job-final"] = _make_pdf_bytes("x y z")
    monkeypatch.setattr(
        worker,
        "_collect_pdf_matches",
        lambda *args, **kwargs: {"matches": [], "outcome": "ocr_error", "reason": "OCR execution error"},
    )
    job = {
        "id": "job-final",
        "source_kind": "pdf_slice",
        "attempt_count": 3,
        "payload_json": json.dumps({"text_excerpt": "", "local_pattern_hits": []}),
    }

    worker._process_job(job)

    assert "retry" not in calls
    assert calls["finalize"] == {
        "job_id": "job-final",
        "status": "failed",
        "summary": "No matches (ocr_error)",
        "error_text": "OCR timeout",
    }
    assert calls["deleted"] == "job-final"


def test_reconcile_transient_pdf_spool_runs_when_store_supports_it(temp_dir):
    worker = _make_worker(temp_dir)
    calls: dict[str, object] = {}

    worker.store = SimpleNamespace(
        reconcile_job_pdf_spool=lambda: calls.setdefault(
            "result",
            {"removed_orphan_files": 1, "removed_final_files": 0, "failed_jobs": 2},
        ),
    )

    worker._reconcile_transient_pdf_spool()

    assert calls["result"] == {
        "removed_orphan_files": 1,
        "removed_final_files": 0,
        "failed_jobs": 2,
    }


def test_tick_submits_queued_jobs_to_parallel_pool(temp_dir):
    worker = _make_worker(temp_dir)
    jobs = [{"id": "job-1"}, {"id": "job-2"}]
    processed: list[str] = []

    worker.store = SimpleNamespace(
        cleanup_retention=lambda retention_days: None,
        claim_next_jobs=lambda limit: [jobs.pop(0) for _ in range(min(limit, len(jobs)))],
    )
    worker._process_job = lambda job: processed.append(job["id"])

    assert worker._tick() is True
    worker._shutdown_job_pool()
    assert processed == ["job-1", "job-2"]


def test_tick_respects_parallel_job_limit(temp_dir):
    worker = _make_worker(temp_dir)
    worker.config.scan_job_max_workers = 4
    jobs = [{"id": f"job-{idx}"} for idx in range(6)]
    started: list[str] = []
    started_event = threading.Event()
    finish_event = threading.Event()

    def claim_next_jobs(limit):
        return [jobs.pop(0) for _ in range(min(limit, len(jobs)))]

    def process_job(job):
        started.append(job["id"])
        if len(started) == 4:
            started_event.set()
        finish_event.wait(timeout=2)

    worker.store = SimpleNamespace(
        cleanup_retention=lambda retention_days: None,
        claim_next_jobs=claim_next_jobs,
    )
    worker._process_job = process_job

    try:
        assert worker._tick() is True
        assert started_event.wait(timeout=1)
        assert sorted(started) == ["job-0", "job-1", "job-2", "job-3"]
        assert [job["id"] for job in jobs] == ["job-4", "job-5"]
    finally:
        finish_event.set()
        worker._shutdown_job_pool()


def test_scan_job_max_workers_allows_twelve_and_clamps_higher_values(
    monkeypatch,
    temp_dir,
):
    worker = _make_worker(temp_dir)

    worker.config.scan_job_max_workers = 12
    assert worker._job_max_workers() == 12

    worker.config.scan_job_max_workers = 13
    assert worker._job_max_workers() == 12

    monkeypatch.setenv("SCAN_JOB_MAX_WORKERS", "12")
    assert ScanServerConfig.from_env().scan_job_max_workers == 12

    monkeypatch.setenv("SCAN_JOB_MAX_WORKERS", "13")
    assert ScanServerConfig.from_env().scan_job_max_workers == 12


def test_scan_ocr_max_processes_defaults_to_twelve(monkeypatch):
    monkeypatch.delenv("SCAN_OCR_MAX_PROCESSES", raising=False)

    assert ScanServerConfig.from_env().ocr_max_processes == 12

    monkeypatch.setenv("SCAN_OCR_MAX_PROCESSES", "13")
    assert ScanServerConfig.from_env().ocr_max_processes == 12


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
