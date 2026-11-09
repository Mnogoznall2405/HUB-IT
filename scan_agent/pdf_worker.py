"""Prepare a PDF in a short-lived process with a memory budget."""

from __future__ import annotations

import base64
import hashlib
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
import subprocess
import sys


PDF_WORKER_EXECUTABLE_NAME = "ITInventPdfWorker.exe"
MAX_PDF_INPUT_BYTES = 256 * 1024 * 1024
MAX_PDF_SLICE_BYTES = 16 * 1024 * 1024
MAX_PDF_TEXT_CHARS = 256_000
PDF_MEMORY_BYTES = 256 * 1024 * 1024
PDF_TIMEOUT_SECONDS = 20


@dataclass(frozen=True)
class PdfAnalysis:
    file_hash: str = ""
    text: str = ""
    slice_b64: str = ""
    pages: int = 0
    reason: str = ""


def _worker_command(path: Path) -> list[str]:
    if getattr(sys, "frozen", False):
        executable = Path(sys.executable).with_name(PDF_WORKER_EXECUTABLE_NAME)
        if not executable.is_file():
            executable = executable.parent / executable.stem / executable.name
        return [str(executable), str(path)]
    return [sys.executable, "-m", "scan_agent.pdf_worker", str(path)]


def analyze_pdf(path: Path, *, timeout_seconds: float = PDF_TIMEOUT_SECONDS) -> PdfAnalysis:
    try:
        response = subprocess.run(
            _worker_command(path.absolute()),
            cwd=None if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout_seconds,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if response.returncode == 0:
            return PdfAnalysis(**json.loads(response.stdout))
    except subprocess.TimeoutExpired:
        return PdfAnalysis(reason="pdf_timeout")
    except (OSError, ValueError, TypeError):
        pass
    return PdfAnalysis(reason="pdf_worker_failed")


def _limit_worker_memory():
    if os.name == "nt":
        import win32api
        import win32job

        job = win32job.CreateJobObject(None, "")
        try:
            kind = win32job.JobObjectExtendedLimitInformation
            limits = win32job.QueryInformationJobObject(job, kind)
            limits["BasicLimitInformation"]["LimitFlags"] = win32job.JOB_OBJECT_LIMIT_PROCESS_MEMORY
            limits["ProcessMemoryLimit"] = PDF_MEMORY_BYTES
            win32job.SetInformationJobObject(job, kind, limits)
            win32job.AssignProcessToJobObject(job, win32api.GetCurrentProcess())
        except Exception:
            job.Close()
            raise
        return job

    import resource

    soft, hard = resource.getrlimit(resource.RLIMIT_AS)
    limit = min([PDF_MEMORY_BYTES] + [value for value in (soft, hard) if value != resource.RLIM_INFINITY])
    resource.setrlimit(resource.RLIMIT_AS, (limit, hard))
    return None


def _pdf_hash(path: Path) -> str:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(block)
            if size > MAX_PDF_INPUT_BYTES:
                return ""
            digest.update(block)
    return digest.hexdigest()


def _extract_pdf(path: Path) -> PdfAnalysis:
    # Import MuPDF after the worker has been placed under its memory limit.
    import fitz
    from agent_version import SCAN_OCR_PAGE_LIMIT, SCAN_TEXT_PAGE_LIMIT

    fitz.TOOLS.mupdf_display_errors(False)
    fitz.TOOLS.mupdf_display_warnings(False)
    try:
        if path.stat().st_size > MAX_PDF_INPUT_BYTES:
            return PdfAnalysis(reason="pdf_input_too_large")
        file_hash = _pdf_hash(path)
        if not file_hash or path.stat().st_size > MAX_PDF_INPUT_BYTES:
            return PdfAnalysis(reason="pdf_input_too_large")
    except OSError:
        return PdfAnalysis(reason="pdf_read_failed")

    text_parts: list[str] = []
    reason = "pdf_slice_creation_failed"
    try:
        with fitz.open(path) as source:
            chars_left = MAX_PDF_TEXT_CHARS
            try:
                for index in range(min(SCAN_TEXT_PAGE_LIMIT, len(source))):
                    page_text = source.load_page(index).get_text("text") or ""
                    if len(page_text) > chars_left:
                        text_parts.append(page_text[:chars_left])
                        return PdfAnalysis(
                            file_hash=file_hash, text="\n".join(text_parts).strip(), reason="pdf_text_too_large",
                        )
                    text_parts.append(page_text)
                    chars_left -= len(page_text)
            except MemoryError:
                raise
            except Exception:
                # Keep OCR available if only the text layer could not be read.
                pass
            pages = min(SCAN_OCR_PAGE_LIMIT, len(source))
            if pages:
                with fitz.open() as sliced:
                    sliced.insert_pdf(source, from_page=0, to_page=pages - 1)
                    data = sliced.tobytes()
                if len(data) <= MAX_PDF_SLICE_BYTES:
                    return PdfAnalysis(
                        file_hash=file_hash,
                        text="\n".join(text_parts).strip(),
                        slice_b64=base64.b64encode(data).decode("ascii"),
                        pages=pages,
                    )
                reason = "pdf_slice_too_large"
    except MemoryError:
        reason = "pdf_memory_limit"
    except Exception:
        pass
    return PdfAnalysis(file_hash=file_hash, text="\n".join(text_parts).strip(), reason=reason)


def main() -> int:
    try:
        job = _limit_worker_memory()
    except Exception:
        job = None
        result = PdfAnalysis(reason="pdf_memory_limit_unavailable")
    else:
        try:
            result = _extract_pdf(Path(sys.argv[1]))
        except MemoryError:
            result = PdfAnalysis(reason="pdf_memory_limit")
        except Exception:
            result = PdfAnalysis(reason="pdf_worker_failed")
    try:
        sys.stdout.buffer.write(json.dumps(asdict(result), separators=(",", ":")).encode("ascii"))
        sys.stdout.buffer.flush()
    finally:
        if job is not None:
            job.Close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
