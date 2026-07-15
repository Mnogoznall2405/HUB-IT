from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile

try:
    import fitz  # type: ignore
except Exception:  # pragma: no cover
    fitz = None


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
OFFICE_EXTENSIONS = {
    ".doc", ".docx", ".odt",
    ".xls", ".xlsx", ".ods",
    ".ppt", ".pptx", ".odp",
}


class DocumentConversionError(RuntimeError):
    pass


def _image_to_pdf(document_bytes: bytes, extension: str) -> bytes:
    if fitz is None:
        raise DocumentConversionError("PyMuPDF is unavailable for image conversion")
    filetype = "jpeg" if extension in {".jpg", ".jpeg"} else extension.lstrip(".")
    try:
        with fitz.open(stream=document_bytes, filetype=filetype) as image_doc:
            pdf_bytes = image_doc.convert_to_pdf()
    except Exception as exc:
        raise DocumentConversionError(f"Image conversion failed: {exc}") from exc
    if not pdf_bytes:
        raise DocumentConversionError("Image conversion returned an empty PDF")
    return bytes(pdf_bytes)


def _libreoffice_path() -> Path:
    configured = str(os.getenv("SCAN_LIBREOFFICE_CMD", "")).strip()
    candidates = [
        Path(configured) if configured else None,
        Path(r"C:\Program Files\LibreOffice\program\soffice.exe"),
        Path(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
    ]
    for candidate in candidates:
        if candidate is not None and candidate.exists():
            return candidate
    raise DocumentConversionError("LibreOffice is not installed or SCAN_LIBREOFFICE_CMD is invalid")


def _office_to_pdf(document_bytes: bytes, file_name: str, extension: str) -> bytes:
    soffice = _libreoffice_path()
    timeout_sec = max(30, int(os.getenv("SCAN_OFFICE_CONVERT_TIMEOUT_SEC", "180") or 180))
    with tempfile.TemporaryDirectory(prefix="scan-office-") as raw_temp:
        temp_dir = Path(raw_temp)
        source_name = Path(file_name).name or f"document{extension}"
        if Path(source_name).suffix.lower() != extension:
            source_name = f"document{extension}"
        source_path = temp_dir / source_name
        source_path.write_bytes(document_bytes)
        profile_dir = temp_dir / "lo-profile"
        profile_dir.mkdir(parents=True, exist_ok=True)
        command = [
            str(soffice),
            "--headless",
            "--nologo",
            "--nodefault",
            "--nolockcheck",
            f"-env:UserInstallation={profile_dir.resolve().as_uri()}",
            "--convert-to",
            "pdf",
            "--outdir",
            str(temp_dir),
            str(source_path),
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except subprocess.TimeoutExpired as exc:
            raise DocumentConversionError("LibreOffice conversion timed out") from exc
        output_path = temp_dir / f"{source_path.stem}.pdf"
        if completed.returncode != 0 or not output_path.exists():
            detail = (completed.stderr or completed.stdout or "conversion failed").strip()[-500:]
            raise DocumentConversionError(f"LibreOffice conversion failed: {detail}")
        pdf_bytes = output_path.read_bytes()
    if not pdf_bytes:
        raise DocumentConversionError("LibreOffice returned an empty PDF")
    return pdf_bytes


def convert_document_to_pdf(document_bytes: bytes, file_name: str) -> bytes:
    if not document_bytes:
        raise DocumentConversionError("Document payload is empty")
    extension = Path(str(file_name or "")).suffix.lower()
    if extension in IMAGE_EXTENSIONS:
        return _image_to_pdf(document_bytes, extension)
    if extension in OFFICE_EXTENSIONS:
        return _office_to_pdf(document_bytes, file_name, extension)
    raise DocumentConversionError(f"Unsupported document extension: {extension or '<none>'}")
