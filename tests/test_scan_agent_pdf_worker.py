import base64
import hashlib
import os
from pathlib import Path
import subprocess
import sys

import pytest

from scan_agent import pdf_worker


def test_pdf_worker_returns_text_and_a_three_page_slice(tmp_path):
    fitz = pytest.importorskip("fitz")
    source = tmp_path / "document with spaces.pdf"
    with fitz.open() as document:
        for index in range(4):
            page = document.new_page()
            page.insert_text((70, 70), f"Document page {index + 1}")
        document.save(source)

    result = pdf_worker.analyze_pdf(source)

    assert result.reason == ""
    assert result.file_hash == hashlib.sha256(source.read_bytes()).hexdigest()
    assert "Document page 4" in result.text
    with fitz.open(stream=base64.b64decode(result.slice_b64), filetype="pdf") as sliced:
        assert len(sliced) == result.pages == 3


def test_pdf_worker_timeout_returns_incomplete_and_allows_another_request(tmp_path, monkeypatch):
    source = tmp_path / "document.pdf"
    source.write_bytes(b"%PDF-invalid")
    with monkeypatch.context() as patch:
        patch.setattr(pdf_worker, "_worker_command", lambda path: [sys.executable, "-c", "import time; time.sleep(60)"])
        result = pdf_worker.analyze_pdf(source, timeout_seconds=0.2)
    assert result.reason == "pdf_timeout"
    assert not result.slice_b64
    assert pdf_worker.analyze_pdf(source).reason == "pdf_slice_creation_failed"


def test_oversized_pdf_slice_keeps_extracted_text_and_returns_incomplete(tmp_path, monkeypatch):
    fitz = pytest.importorskip("fitz")
    source = tmp_path / "document.pdf"
    with fitz.open() as document:
        page = document.new_page()
        page.insert_text((70, 70), "Text to retain")
        document.save(source)
    monkeypatch.setattr(pdf_worker, "MAX_PDF_SLICE_BYTES", 1)

    result = pdf_worker._extract_pdf(source)

    assert result.reason == "pdf_slice_too_large"
    assert "Text to retain" in result.text
    assert not result.slice_b64


@pytest.mark.skipif(os.name != "nt", reason="checks the Windows Job Object limit")
def test_windows_pdf_worker_cannot_allocate_more_than_its_memory_budget():
    result = subprocess.run(
        [sys.executable, "-c", """
from scan_agent import pdf_worker
pdf_worker.PDF_MEMORY_BYTES = 128 * 1024 * 1024
job = pdf_worker._limit_worker_memory()
try:
    bytearray(pdf_worker.PDF_MEMORY_BYTES)
except MemoryError:
    raise SystemExit(0)
raise SystemExit(1)
"""],
        cwd=Path(pdf_worker.__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
