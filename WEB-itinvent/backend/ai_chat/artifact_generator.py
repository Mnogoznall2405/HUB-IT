from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import UploadFile

try:
    from docx import Document  # type: ignore
except Exception:  # pragma: no cover
    Document = None

try:
    from openpyxl import Workbook  # type: ignore
except Exception:  # pragma: no cover
    Workbook = None

try:
    from reportlab.lib.pagesizes import A4  # type: ignore
    from reportlab.pdfgen import canvas  # type: ignore
except Exception:  # pragma: no cover
    A4 = None
    canvas = None


def _normalize_file_name(kind: str, index: int, suggested_name: str = "") -> str:
    name = str(suggested_name or "").strip()
    if name:
        return name
    return f"artifact-{index}.{kind}"


def _to_upload_file(file_name: str, payload: bytes, content_type: str) -> UploadFile:
    file_obj = io.BytesIO(bytes(payload or b""))
    return UploadFile(filename=file_name, file=file_obj, headers={"content-type": content_type})


def _csv_artifact_payload(item: dict[str, Any]) -> tuple[bytes, str]:
    output = io.StringIO()
    writer = csv.writer(output)
    rows = item.get("rows")
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, list):
                writer.writerow([str(cell or "") for cell in row])
            else:
                writer.writerow([str(row or "")])
    else:
        output.write(str(item.get("content") or ""))
    return output.getvalue().encode("utf-8"), "text/csv"


def _xlsx_artifact_payload(item: dict[str, Any]) -> tuple[bytes, str]:
    if Workbook is None:
        raise ValueError("openpyxl is not installed")
    workbook = Workbook()
    workbook.remove(workbook.active)
    sheets = item.get("sheets")
    if isinstance(sheets, list) and sheets:
        for index, sheet_payload in enumerate(sheets, start=1):
            title = str((sheet_payload or {}).get("title") or f"Sheet {index}")[:31]
            sheet = workbook.create_sheet(title=title or f"Sheet {index}")
            for row in list((sheet_payload or {}).get("rows") or []):
                if isinstance(row, list):
                    sheet.append([str(cell or "") for cell in row])
    else:
        sheet = workbook.create_sheet(title="Sheet 1")
        rows = item.get("rows")
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, list):
                    sheet.append([str(cell or "") for cell in row])
                else:
                    sheet.append([str(row or "")])
        else:
            sheet.append([str(item.get("content") or "")])
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _docx_artifact_payload(item: dict[str, Any]) -> tuple[bytes, str]:
    if Document is None:
        raise ValueError("python-docx is not installed")
    document = Document()
    for line in str(item.get("content") or "").splitlines() or [""]:
        document.add_paragraph(line)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _pdf_artifact_payload(item: dict[str, Any]) -> tuple[bytes, str]:
    if canvas is None or A4 is None:
        raise ValueError("reportlab is not installed")
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    y = height - 48
    for line in str(item.get("content") or "").splitlines() or [""]:
        pdf.drawString(40, y, line[:120])
        y -= 16
        if y < 40:
            pdf.showPage()
            y = height - 48
    pdf.save()
    return buffer.getvalue(), "application/pdf"


def build_generated_uploads(artifacts: list[dict[str, Any]] | None) -> list[UploadFile]:
    uploads: list[UploadFile] = []
    for index, item in enumerate(list(artifacts or []), start=1):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip().lower()
        if kind not in {"csv", "xlsx", "docx", "pdf"}:
            continue
        file_name = _normalize_file_name(kind, index, str(item.get("file_name") or "").strip())
        if kind == "csv":
            payload, content_type = _csv_artifact_payload(item)
        elif kind == "xlsx":
            payload, content_type = _xlsx_artifact_payload(item)
        elif kind == "docx":
            payload, content_type = _docx_artifact_payload(item)
        else:
            payload, content_type = _pdf_artifact_payload(item)
        uploads.append(_to_upload_file(file_name, payload, content_type))
    return uploads
