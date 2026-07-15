"""LibreOffice-based preview conversion for mail Office attachments."""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
import xml.etree.ElementTree as ET
from collections import OrderedDict
from concurrent.futures import Future
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_CONVERT_LOCK = threading.Lock()
_PREVIEW_CACHE_LOCK = threading.RLock()
_PREVIEW_CACHE: OrderedDict[str, tuple[float, "PreviewArtifact"]] = OrderedDict()
_PREVIEW_INFLIGHT: dict[str, Future["PreviewArtifact"]] = {}
_PREVIEW_CACHE_TTL_SEC = 600

_DEFAULT_WINDOWS_SOFFICE = Path(r"C:\Program Files\LibreOffice\program\soffice.exe")
_DEFAULT_LINUX_SOFFICE = Path("/usr/bin/soffice")


@dataclass(frozen=True)
class PreviewArtifact:
    pdf_bytes: bytes
    pdf_filename: str
    source_kind: str
    page_count: int
    sheets: list[dict[str, Any]]


class MailAttachmentPreviewError(RuntimeError):
    """Raised when Office preview conversion cannot be produced."""


def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(str(os.getenv(name, default) or default))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def _bool_env(name: str, default: bool) -> bool:
    raw = str(os.getenv(name, "1" if default else "0") or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _file_extension(filename: str) -> str:
    normalized = str(filename or "").strip().lower()
    dot_index = normalized.rfind(".")
    return normalized[dot_index + 1:] if dot_index >= 0 else ""


def resolve_soffice_path() -> Path:
    configured = str(os.getenv("LIBREOFFICE_SOFFICE_PATH", "") or os.getenv("SOFFICE_PATH", "") or "").strip()
    if configured:
        path = Path(configured)
        if path.is_file():
            return path
        raise MailAttachmentPreviewError(f"LibreOffice executable not found: {configured}")
    if _DEFAULT_WINDOWS_SOFFICE.is_file():
        return _DEFAULT_WINDOWS_SOFFICE
    if _DEFAULT_LINUX_SOFFICE.is_file():
        return _DEFAULT_LINUX_SOFFICE
    raise MailAttachmentPreviewError(
        "LibreOffice (soffice) is not configured. Set LIBREOFFICE_SOFFICE_PATH in .env."
    )


def classify_office_source(*, filename: str, content_type: str) -> str:
    extension = _file_extension(filename)
    normalized_type = str(content_type or "").strip().lower()
    if (
        "spreadsheetml" in normalized_type
        or "ms-excel" in normalized_type
        or "opendocument.spreadsheet" in normalized_type
        or extension in {"xls", "xlsx", "xlsm", "xlt", "xltx", "xltm", "ods"}
    ):
        return "excel"
    if (
        "wordprocessingml" in normalized_type
        or "msword" in normalized_type
        or "opendocument.text" in normalized_type
        or "rtf" in normalized_type
        or extension in {"doc", "docx", "docm", "dot", "dotx", "rtf", "odt"}
    ):
        return "word"
    return ""


def is_office_preview_enabled() -> bool:
    return _bool_env("MAIL_OFFICE_PREVIEW_ENABLED", True)


def office_preview_max_bytes() -> int:
    return _positive_int_env("MAIL_OFFICE_PREVIEW_MAX_BYTES", 25 * 1024 * 1024)


def office_preview_timeout_sec() -> int:
    return _positive_int_env("MAIL_OFFICE_PREVIEW_TIMEOUT_SEC", 120)


def office_preview_cache_max_entries() -> int:
    return _positive_int_env("MAIL_OFFICE_PREVIEW_CACHE_MAX_ENTRIES", 8)


def office_preview_cache_max_bytes() -> int:
    return _positive_int_env("MAIL_OFFICE_PREVIEW_CACHE_MAX_BYTES", 64 * 1024 * 1024)


def _pdf_page_count(pdf_path: Path) -> int:
    from pypdf import PdfReader

    with pdf_path.open("rb") as handle:
        reader = PdfReader(handle)
        return max(0, len(reader.pages))


def _merge_pdf_paths(paths: list[Path], output_path: Path) -> None:
    from pypdf import PdfWriter

    writer = PdfWriter()
    for path in paths:
        if not path.is_file():
            continue
        with path.open("rb") as handle:
            writer.append(handle)
    with output_path.open("wb") as handle:
        writer.write(handle)


def _run_soffice_convert(*, soffice: Path, source_path: Path, output_dir: Path, timeout_sec: int) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    profile_dir = (output_dir / ".lo-profile").resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    command = [
        str(soffice),
        f"-env:UserInstallation={profile_dir.as_uri()}",
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        str(output_dir),
        str(source_path),
    ]
    with _CONVERT_LOCK:
        completed = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_sec,
            check=False,
            text=True,
        )
    if completed.returncode != 0:
        stderr = (completed.stderr or completed.stdout or "").strip()
        raise MailAttachmentPreviewError(
            f"LibreOffice conversion failed (rc={completed.returncode}): {stderr[:500]}"
        )
    expected = output_dir / f"{source_path.stem}.pdf"
    if expected.is_file():
        return expected
    generated = sorted(output_dir.glob("*.pdf"), key=lambda item: item.stat().st_mtime, reverse=True)
    if generated:
        return generated[0]
    raise MailAttachmentPreviewError("LibreOffice conversion produced no PDF output.")


_EXCEL_WORKBOOK_XML = "xl/workbook.xml"
_EXCEL_MAIN_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def _excel_sheet_descriptors(source_path: Path) -> list[dict[str, Any]]:
    try:
        with zipfile.ZipFile(source_path) as archive:
            workbook_xml = archive.read(_EXCEL_WORKBOOK_XML)
    except (KeyError, OSError, zipfile.BadZipFile) as exc:
        raise MailAttachmentPreviewError("Excel workbook structure is invalid.") from exc

    try:
        root = ET.fromstring(workbook_xml)
    except ET.ParseError as exc:
        raise MailAttachmentPreviewError("Excel workbook metadata is invalid.") from exc

    sheets = root.find(f"{{{_EXCEL_MAIN_NAMESPACE}}}sheets")
    if sheets is None:
        sheets = next((node for node in root if node.tag.rsplit("}", 1)[-1] == "sheets"), None)
    if sheets is None:
        return []

    result: list[dict[str, Any]] = []
    for index, sheet in enumerate(sheets):
        if sheet.tag.rsplit("}", 1)[-1] != "sheet":
            continue
        state = str(sheet.attrib.get("state") or "visible").lower()
        result.append(
            {
                "index": index,
                "name": str(sheet.attrib.get("name") or f"Лист {index + 1}"),
                "hidden": state in {"hidden", "veryhidden"},
            }
        )
    return result


def _patch_excel_sheet_visibility(workbook_xml: bytes, *, sheet_index: int) -> bytes:
    try:
        root = ET.fromstring(workbook_xml)
    except ET.ParseError as exc:
        raise MailAttachmentPreviewError("Excel workbook metadata is invalid.") from exc

    sheets = root.find(f"{{{_EXCEL_MAIN_NAMESPACE}}}sheets")
    if sheets is None:
        sheets = next((node for node in root if node.tag.rsplit("}", 1)[-1] == "sheets"), None)
    sheet_nodes = [
        node for node in list(sheets or [])
        if node.tag.rsplit("}", 1)[-1] == "sheet"
    ]
    if sheet_index < 0 or sheet_index >= len(sheet_nodes):
        raise MailAttachmentPreviewError(f"Excel sheet index out of range: {sheet_index}")

    for index, sheet in enumerate(sheet_nodes):
        if index == sheet_index:
            sheet.attrib.pop("state", None)
        else:
            sheet.set("state", "hidden")

    workbook_namespace = root.tag.split("}", 1)[0].lstrip("{") if "}" in root.tag else _EXCEL_MAIN_NAMESPACE
    book_views = root.find(f"{{{workbook_namespace}}}bookViews")
    if book_views is None:
        book_views = next(
            (node for node in root if node.tag.rsplit("}", 1)[-1] == "bookViews"),
            None,
        )
    if book_views is None:
        book_views = ET.Element(f"{{{workbook_namespace}}}bookViews")
        root.insert(max(0, list(root).index(sheets)), book_views)
    workbook_view = next(
        (node for node in book_views if node.tag.rsplit("}", 1)[-1] == "workbookView"),
        None,
    )
    if workbook_view is None:
        workbook_view = ET.SubElement(book_views, f"{{{workbook_namespace}}}workbookView")
    workbook_view.set("activeTab", str(sheet_index))
    workbook_view.set("firstSheet", str(sheet_index))

    ET.register_namespace("", workbook_namespace)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _write_single_sheet_workbook(source_path: Path, *, sheet_index: int, target_path: Path) -> None:
    """Copy an OOXML workbook while exposing only one sheet.

    XLSX is a ZIP container. Rewriting only ``xl/workbook.xml`` preserves cell
    formulas, styles, print settings, images, charts, shapes and macros without
    materialising the whole workbook in Python memory.
    """

    target_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(source_path, "r") as source_archive:
            with zipfile.ZipFile(target_path, "w") as target_archive:
                found_workbook = False
                for info in source_archive.infolist():
                    with source_archive.open(info, "r") as source_entry:
                        if info.filename == _EXCEL_WORKBOOK_XML:
                            found_workbook = True
                            payload = _patch_excel_sheet_visibility(
                                source_entry.read(),
                                sheet_index=sheet_index,
                            )
                            target_archive.writestr(info, payload)
                            continue
                        with target_archive.open(info, "w") as target_entry:
                            shutil.copyfileobj(source_entry, target_entry, length=1024 * 1024)
                if not found_workbook:
                    raise MailAttachmentPreviewError("Excel workbook metadata is missing.")
    except (OSError, zipfile.BadZipFile) as exc:
        raise MailAttachmentPreviewError("Excel workbook cannot be prepared for preview.") from exc


def _excel_sheet_metadata(*, source_path: Path, work_dir: Path, soffice: Path, timeout_sec: int) -> tuple[list[dict[str, Any]], bytes]:
    worksheets = _excel_sheet_descriptors(source_path)

    sheets_meta: list[dict[str, Any]] = []
    pdf_paths: list[Path] = []
    current_page = 1

    for worksheet in worksheets:
        index = int(worksheet["index"])
        hidden = bool(worksheet["hidden"])
        if hidden:
            sheets_meta.append(
                {
                    "index": index,
                    "name": str(worksheet["name"] or f"Лист {index + 1}"),
                    "page": None,
                    "hidden": True,
                }
            )
            continue

        sheet_source = work_dir / f"sheet_{index}{source_path.suffix or '.xlsx'}"
        _write_single_sheet_workbook(source_path, sheet_index=index, target_path=sheet_source)
        sheet_pdf = _run_soffice_convert(
            soffice=soffice,
            source_path=sheet_source,
            output_dir=work_dir / f"sheet_{index}_pdf",
            timeout_sec=timeout_sec,
        )
        page_count = max(1, _pdf_page_count(sheet_pdf))
        page_end = current_page + page_count - 1
        sheets_meta.append(
            {
                "index": index,
                "name": str(worksheet["name"] or f"Лист {index + 1}"),
                "page": current_page,
                "page_end": page_end,
                "page_count": page_count,
                "hidden": False,
            }
        )
        pdf_paths.append(sheet_pdf)
        current_page += page_count

    if not pdf_paths:
        raise MailAttachmentPreviewError("Excel workbook has no visible sheets for preview.")

    merged_pdf = work_dir / "workbook.pdf"
    if len(pdf_paths) == 1:
        shutil.copyfile(pdf_paths[0], merged_pdf)
    else:
        _merge_pdf_paths(pdf_paths, merged_pdf)
    return sheets_meta, merged_pdf.read_bytes()


def _cache_key(*, filename: str, content: bytes) -> str:
    digest = hashlib.sha256(content).hexdigest()
    return f"{_file_extension(filename)}:{digest}"


def _prune_cache_locked(*, now: float) -> None:
    expired_keys = [
        key
        for key, (created_at, _artifact) in _PREVIEW_CACHE.items()
        if now - created_at > _PREVIEW_CACHE_TTL_SEC
    ]
    for key in expired_keys:
        _PREVIEW_CACHE.pop(key, None)


def _cache_get_locked(key: str, *, now: float) -> PreviewArtifact | None:
    _prune_cache_locked(now=now)
    entry = _PREVIEW_CACHE.get(key)
    if not entry:
        return None
    _created_at, artifact = entry
    _PREVIEW_CACHE.move_to_end(key)
    return artifact


def _cache_get(key: str) -> PreviewArtifact | None:
    with _PREVIEW_CACHE_LOCK:
        return _cache_get_locked(key, now=time.monotonic())


def _cache_put(key: str, artifact: PreviewArtifact) -> None:
    artifact_size = len(artifact.pdf_bytes or b"")
    max_bytes = office_preview_cache_max_bytes()
    if artifact_size > max_bytes:
        return

    now = time.monotonic()
    with _PREVIEW_CACHE_LOCK:
        _prune_cache_locked(now=now)
        _PREVIEW_CACHE.pop(key, None)
        _PREVIEW_CACHE[key] = (now, artifact)
        total_bytes = sum(len(entry.pdf_bytes or b"") for _created_at, entry in _PREVIEW_CACHE.values())
        max_entries = office_preview_cache_max_entries()
        while len(_PREVIEW_CACHE) > max_entries or total_bytes > max_bytes:
            _removed_key, (_created_at, removed) = _PREVIEW_CACHE.popitem(last=False)
            total_bytes -= len(removed.pdf_bytes or b"")


def _build_office_preview_artifact_uncached(
    *,
    filename: str,
    content_type: str,
    content: bytes,
    source_kind: str,
) -> PreviewArtifact:
    soffice = resolve_soffice_path()
    timeout_sec = office_preview_timeout_sec()
    extension = _file_extension(filename) or ("xlsx" if source_kind == "excel" else "docx")
    stem = Path(str(filename or "attachment.bin")).stem or "attachment"
    pdf_filename = f"{stem}.pdf"

    with tempfile.TemporaryDirectory(prefix="itinvent-mail-preview-", ignore_cleanup_errors=True) as temp_dir:
        work_dir = Path(temp_dir)
        source_path = work_dir / f"source.{extension}"
        source_path.write_bytes(content)

        if source_kind == "excel" and extension in {"xlsx", "xlsm", "xltx", "xltm"}:
            try:
                sheets, pdf_bytes = _excel_sheet_metadata(
                    source_path=source_path,
                    work_dir=work_dir,
                    soffice=soffice,
                    timeout_sec=timeout_sec,
                )
            except Exception:
                logger.exception("Excel sheet preview failed; falling back to workbook PDF conversion")
                pdf_path = _run_soffice_convert(
                    soffice=soffice,
                    source_path=source_path,
                    output_dir=work_dir / "pdf",
                    timeout_sec=timeout_sec,
                )
                pdf_bytes = pdf_path.read_bytes()
                sheets = []
        else:
            pdf_path = _run_soffice_convert(
                soffice=soffice,
                source_path=source_path,
                output_dir=work_dir / "pdf",
                timeout_sec=timeout_sec,
            )
            pdf_bytes = pdf_path.read_bytes()
            sheets = []

        page_count = max(1, _pdf_page_count_from_bytes(pdf_bytes))
        artifact = PreviewArtifact(
            pdf_bytes=pdf_bytes,
            pdf_filename=pdf_filename,
            source_kind=source_kind,
            page_count=page_count,
            sheets=sheets,
        )
        return artifact


def build_office_preview_artifact(*, filename: str, content_type: str, content: bytes) -> PreviewArtifact:
    if not is_office_preview_enabled():
        raise MailAttachmentPreviewError("Office attachment preview is disabled.")
    if not content:
        raise MailAttachmentPreviewError("Attachment is empty.")
    if len(content) > office_preview_max_bytes():
        raise MailAttachmentPreviewError("Attachment is too large for Office preview.")

    source_kind = classify_office_source(filename=filename, content_type=content_type)
    if not source_kind:
        raise MailAttachmentPreviewError("Attachment type is not supported for Office preview.")

    cache_key = _cache_key(filename=filename, content=content)
    with _PREVIEW_CACHE_LOCK:
        cached = _cache_get_locked(cache_key, now=time.monotonic())
        if cached is not None:
            return cached
        future = _PREVIEW_INFLIGHT.get(cache_key)
        if future is None:
            future = Future()
            _PREVIEW_INFLIGHT[cache_key] = future
            is_leader = True
        else:
            is_leader = False

    if not is_leader:
        return future.result()

    try:
        artifact = _build_office_preview_artifact_uncached(
            filename=filename,
            content_type=content_type,
            content=content,
            source_kind=source_kind,
        )
        _cache_put(cache_key, artifact)
        future.set_result(artifact)
        return artifact
    except Exception as exc:
        future.set_exception(exc)
        raise
    finally:
        with _PREVIEW_CACHE_LOCK:
            if _PREVIEW_INFLIGHT.get(cache_key) is future:
                _PREVIEW_INFLIGHT.pop(cache_key, None)


def _pdf_page_count_from_bytes(pdf_bytes: bytes) -> int:
    from io import BytesIO
    from pypdf import PdfReader

    with PdfReader(BytesIO(pdf_bytes)) as reader:
        return len(reader.pages)


def build_preview_metadata(
    *,
    filename: str,
    content_type: str,
    artifact: PreviewArtifact,
    preview_pdf_path: str,
) -> dict[str, Any]:
    return {
        "preview_kind": "office_pdf",
        "source_kind": artifact.source_kind,
        "source_filename": str(filename or "attachment.bin"),
        "pdf_filename": artifact.pdf_filename,
        "page_count": int(artifact.page_count or 0),
        "sheets": list(artifact.sheets or []),
        "preview_url": str(preview_pdf_path or ""),
    }


def describe_preview_runtime() -> dict[str, Any]:
    enabled = is_office_preview_enabled()
    soffice = ""
    soffice_ready = False
    error = ""
    try:
        soffice = str(resolve_soffice_path())
        soffice_ready = True
    except MailAttachmentPreviewError as exc:
        error = str(exc)
    with _PREVIEW_CACHE_LOCK:
        _prune_cache_locked(now=time.monotonic())
        cache_entries = len(_PREVIEW_CACHE)
        cache_bytes = sum(len(artifact.pdf_bytes or b"") for _created_at, artifact in _PREVIEW_CACHE.values())
        inflight = len(_PREVIEW_INFLIGHT)
    return {
        "enabled": enabled,
        "soffice_path": soffice,
        "soffice_ready": soffice_ready,
        "max_bytes": office_preview_max_bytes(),
        "timeout_sec": office_preview_timeout_sec(),
        "cache_entries": cache_entries,
        "cache_bytes": cache_bytes,
        "cache_max_entries": office_preview_cache_max_entries(),
        "cache_max_bytes": office_preview_cache_max_bytes(),
        "inflight": inflight,
        "error": error,
        "python": sys.version.split()[0],
    }
