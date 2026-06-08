from __future__ import annotations

import sys
from pathlib import Path

import pytest

from backend.services import mail_attachment_preview_service as preview_service


def test_classify_office_source_detects_word_and_excel():
    assert preview_service.classify_office_source(
        filename="report.docx",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ) == "word"
    assert preview_service.classify_office_source(
        filename="table.xlsx",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ) == "excel"
    assert preview_service.classify_office_source(
        filename="notes.txt",
        content_type="text/plain",
    ) == ""


def test_build_preview_metadata_includes_sheet_page_end():
    artifact = preview_service.PreviewArtifact(
        pdf_bytes=b"%PDF-1.4",
        pdf_filename="table.pdf",
        source_kind="excel",
        page_count=4,
        sheets=[
            {
                "index": 0,
                "name": "Лист1",
                "page": 1,
                "page_end": 2,
                "page_count": 2,
                "hidden": False,
            },
            {
                "index": 1,
                "name": "Лист2",
                "page": 3,
                "page_end": 4,
                "page_count": 2,
                "hidden": False,
            },
        ],
    )
    payload = preview_service.build_preview_metadata(
        filename="table.xlsx",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        artifact=artifact,
        preview_pdf_path="/api/v1/mail/messages/msg/attachments/ref/preview/pdf",
    )
    assert payload["sheets"][0]["page_end"] == 2
    assert payload["sheets"][0]["page_count"] == 2
    assert payload["sheets"][1]["page"] == 3
    assert payload["sheets"][1]["page_end"] == 4


def test_excel_sheet_metadata_sets_page_end_per_sheet(monkeypatch, tmp_path: Path):
    import shutil
    import types

    source_path = tmp_path / "source.xlsx"
    source_path.write_bytes(b"xlsx")
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    soffice = tmp_path / "soffice.exe"
    soffice.write_text("stub", encoding="utf-8")

    class FakeWorksheet:
        def __init__(self, title: str, sheet_state: str = "visible"):
            self.title = title
            self.sheet_state = sheet_state

        def iter_rows(self, values_only=False):
            yield ("A", 1)

    class FakeWorkbook:
        worksheets = [FakeWorksheet("Лист1"), FakeWorksheet("Лист2")]

        def close(self):
            return None

    def fake_load_workbook(*_args, **_kwargs):
        return FakeWorkbook()

    def fake_write_single_sheet_workbook(_source_path, *, sheet_index: int, target_path: Path):
        target_path.write_bytes(b"xlsx")

    def fake_run_soffice_convert(*, soffice, source_path, output_dir, timeout_sec):
        output_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = output_dir / f"{source_path.stem}.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n%%EOF")
        return pdf_path

    monkeypatch.setitem(
        sys.modules,
        "openpyxl",
        types.SimpleNamespace(load_workbook=fake_load_workbook, Workbook=object),
    )
    monkeypatch.setattr(preview_service, "_write_single_sheet_workbook", fake_write_single_sheet_workbook)
    monkeypatch.setattr(preview_service, "_run_soffice_convert", fake_run_soffice_convert)
    monkeypatch.setattr(preview_service, "_pdf_page_count", lambda _path: 2)
    monkeypatch.setattr(
        preview_service,
        "_merge_pdf_paths",
        lambda paths, target: shutil.copyfile(paths[0], target),
    )

    sheets, _pdf_bytes = preview_service._excel_sheet_metadata(
        source_path=source_path,
        work_dir=work_dir,
        soffice=soffice,
        timeout_sec=30,
    )

    assert len(sheets) == 2
    assert sheets[0]["page"] == 1
    assert sheets[0]["page_end"] == 2
    assert sheets[0]["page_count"] == 2
    assert sheets[1]["page"] == 3
    assert sheets[1]["page_end"] == 4
    assert sheets[1]["page_count"] == 2


def test_build_preview_metadata_shape():
    artifact = preview_service.PreviewArtifact(
        pdf_bytes=b"%PDF-1.4",
        pdf_filename="report.pdf",
        source_kind="word",
        page_count=3,
        sheets=[],
    )
    payload = preview_service.build_preview_metadata(
        filename="report.docx",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        artifact=artifact,
        preview_pdf_path="/api/v1/mail/messages/msg/attachments/ref/preview/pdf",
    )
    assert payload["preview_kind"] == "office_pdf"
    assert payload["source_kind"] == "word"
    assert payload["source_filename"] == "report.docx"
    assert payload["pdf_filename"] == "report.pdf"
    assert payload["page_count"] == 3
    assert payload["preview_url"].endswith("/preview/pdf")


def test_build_office_preview_artifact_uses_soffice(monkeypatch, tmp_path: Path):
    preview_service._PREVIEW_CACHE.clear()
    soffice = tmp_path / "soffice.exe"
    soffice.write_text("stub", encoding="utf-8")

    def fake_run(command, stdout, stderr, timeout, check, text):
        outdir = Path(command[command.index("--outdir") + 1])
        source = Path(command[-1])
        pdf_path = outdir / f"{source.stem}.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF")
        class Result:
            returncode = 0
            stdout = ""
            stderr = ""
        return Result()

    monkeypatch.setenv("LIBREOFFICE_SOFFICE_PATH", str(soffice))
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_ENABLED", "1")
    monkeypatch.setattr(preview_service.subprocess, "run", fake_run)
    monkeypatch.setattr(preview_service, "_pdf_page_count", lambda _path: 1)
    monkeypatch.setattr(preview_service, "_pdf_page_count_from_bytes", lambda _data: 1)

    artifact = preview_service.build_office_preview_artifact(
        filename="memo.docx",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        content=b"docx-bytes",
    )
    assert artifact.source_kind == "word"
    assert artifact.pdf_filename == "memo.pdf"
    assert artifact.pdf_bytes.startswith(b"%PDF")


def test_build_office_preview_artifact_falls_back_when_excel_sheet_metadata_fails(monkeypatch, tmp_path: Path):
    preview_service._PREVIEW_CACHE.clear()
    soffice = tmp_path / "soffice.exe"
    soffice.write_text("stub", encoding="utf-8")

    def fake_run(command, stdout, stderr, timeout, check, text):
        outdir = Path(command[command.index("--outdir") + 1])
        source = Path(command[-1])
        pdf_path = outdir / f"{source.stem}.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n%%EOF")

        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        return Result()

    monkeypatch.setenv("LIBREOFFICE_SOFFICE_PATH", str(soffice))
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_ENABLED", "1")
    monkeypatch.setattr(preview_service.subprocess, "run", fake_run)
    monkeypatch.setattr(preview_service, "_excel_sheet_metadata", lambda **_kwargs: (_ for _ in ()).throw(ValueError("bad workbook")))
    monkeypatch.setattr(preview_service, "_pdf_page_count", lambda _path: 1)
    monkeypatch.setattr(preview_service, "_pdf_page_count_from_bytes", lambda _data: 1)

    artifact = preview_service.build_office_preview_artifact(
        filename="table.xlsx",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content=b"xlsx-bytes",
    )

    assert artifact.source_kind == "excel"
    assert artifact.pdf_filename == "table.pdf"
    assert artifact.sheets == []
    assert artifact.pdf_bytes.startswith(b"%PDF")


def test_build_office_preview_artifact_rejects_disabled(monkeypatch):
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_ENABLED", "0")
    with pytest.raises(preview_service.MailAttachmentPreviewError, match="disabled"):
        preview_service.build_office_preview_artifact(
            filename="memo.docx",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            content=b"docx-bytes",
        )
