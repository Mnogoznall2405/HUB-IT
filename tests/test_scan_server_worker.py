from __future__ import annotations

import base64
import json
from pathlib import Path
from types import SimpleNamespace

import fitz

from scan_server.worker import ScanWorker


def _make_worker(temp_dir: str) -> ScanWorker:
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
    )
    worker._ocr_pool = None
    worker._ocr_available = True
    worker.store = SimpleNamespace()
    return worker


def _make_pdf_bytes(text: str) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    data = doc.tobytes()
    doc.close()
    return data


def test_collect_pdf_matches_uses_short_text_layer_before_ocr(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    pdf_path = Path(temp_dir) / "short_text.pdf"
    pdf_path.write_bytes(_make_pdf_bytes("Password: secret-token-123"))

    monkeypatch.setattr(
        "scan_server.worker.scan_text",
        lambda text: [{"pattern": "password_strict", "value": "Password: secret"}] if "Password:" in text else [],
    )
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: (_ for _ in ()).throw(AssertionError("OCR should not run when text layer already matches")),
    )

    matches = worker._collect_pdf_matches(pdf_path)

    assert matches == [{"pattern": "password_strict", "value": "Password: secret"}]


def test_collect_pdf_matches_falls_back_to_ocr_for_gibberish_text_layer(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    pdf_path = Path(temp_dir) / "ocr_fallback.pdf"
    pdf_path.write_bytes(_make_pdf_bytes("x y z"))

    monkeypatch.setattr(
        "scan_server.worker.scan_text",
        lambda text: [{"pattern": "password_strict", "value": "Пароль: secret123"}] if "Пароль:" in text else [],
    )
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: "Пароль: secret123",
    )

    matches = worker._collect_pdf_matches(pdf_path)

    assert matches == [{"pattern": "password_strict", "value": "Пароль: secret123"}]


def test_process_job_creates_incident_for_short_text_pdf_without_ocr(monkeypatch, temp_dir):
    worker = _make_worker(temp_dir)
    calls: dict[str, object] = {}

    class _Store:
        def add_artifact(self, **kwargs):
            calls["artifact"] = kwargs

        def create_finding_and_incident(self, **kwargs):
            calls["incident"] = kwargs
            return {"finding_id": "f1", "incident_id": "i1"}

        def finalize_job(self, **kwargs):
            calls["finalize"] = kwargs

    worker.store = _Store()
    worker.config.archive_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(
        "scan_server.worker.scan_text",
        lambda text: [{"pattern": "password_strict", "value": "Password: secret"}] if "Password:" in text else [],
    )
    monkeypatch.setattr(
        worker,
        "_ocr_text_from_pdf_bytes",
        lambda pdf_bytes, artifact_path=None: (_ for _ in ()).throw(AssertionError("OCR should not run for matching text layer")),
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
        "payload_json": json.dumps(payload),
    }

    worker._process_job(job)

    assert "incident" in calls
    assert calls["finalize"] == {
        "job_id": "job-1",
        "status": "done_with_incident",
        "summary": "Matches found: 1",
    }
