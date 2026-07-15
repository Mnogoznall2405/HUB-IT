from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
import zipfile
from pathlib import Path

import pytest

from backend.services import mail_attachment_preview_service as preview_service


def _artifact(payload: bytes, *, filename: str = "preview.pdf") -> preview_service.PreviewArtifact:
    return preview_service.PreviewArtifact(
        pdf_bytes=payload,
        pdf_filename=filename,
        source_kind="word",
        page_count=1,
        sheets=[],
    )


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

    source_path = tmp_path / "source.xlsx"
    source_path.write_bytes(b"xlsx")
    work_dir = tmp_path / "work"
    work_dir.mkdir()
    soffice = tmp_path / "soffice.exe"
    soffice.write_text("stub", encoding="utf-8")

    def fake_write_single_sheet_workbook(_source_path, *, sheet_index: int, target_path: Path):
        target_path.write_bytes(b"xlsx")

    def fake_run_soffice_convert(*, soffice, source_path, output_dir, timeout_sec):
        output_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = output_dir / f"{source_path.stem}.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n%%EOF")
        return pdf_path

    monkeypatch.setattr(
        preview_service,
        "_excel_sheet_descriptors",
        lambda _path: [
            {"index": 0, "name": "Лист1", "hidden": False},
            {"index": 1, "name": "Лист2", "hidden": False},
        ],
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


def test_write_single_sheet_workbook_preserves_rich_xlsx_parts(tmp_path: Path):
    source_path = tmp_path / "source.xlsx"
    target_path = tmp_path / "sheet.xlsx"
    workbook_xml = b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView activeTab="0" firstSheet="0"/></bookViews>
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
    <sheet name="Charts" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>'''
    preserved_parts = {
        "xl/worksheets/sheet1.xml": b"sheet-one-formulas-and-styles",
        "xl/worksheets/sheet2.xml": b"sheet-two-formulas-and-styles",
        "xl/drawings/drawing1.xml": b"drawing-and-chart-links",
        "xl/media/image1.png": b"\x89PNG-rich-image",
        "xl/styles.xml": b"rich-styles",
    }
    with zipfile.ZipFile(source_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("xl/workbook.xml", workbook_xml)
        for name, payload in preserved_parts.items():
            archive.writestr(name, payload)

    preview_service._write_single_sheet_workbook(
        source_path,
        sheet_index=1,
        target_path=target_path,
    )

    with zipfile.ZipFile(target_path) as archive:
        for name, payload in preserved_parts.items():
            assert archive.read(name) == payload
        patched_workbook = archive.read("xl/workbook.xml")

    assert b'name="Data"' in patched_workbook
    assert b'name="Charts"' in patched_workbook
    assert patched_workbook.count(b'state="hidden"') == 1
    assert b'activeTab="1"' in patched_workbook
    assert b'firstSheet="1"' in patched_workbook


def test_preview_cache_enforces_total_size_and_entry_limits(monkeypatch):
    preview_service._PREVIEW_CACHE.clear()
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_CACHE_MAX_ENTRIES", "2")
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_CACHE_MAX_BYTES", "10")

    preview_service._cache_put("first", _artifact(b"123456", filename="first.pdf"))
    preview_service._cache_put("second", _artifact(b"abcdef", filename="second.pdf"))

    assert preview_service._cache_get("first") is None
    assert preview_service._cache_get("second") is not None
    assert len(preview_service._PREVIEW_CACHE) == 1


def test_same_preview_build_is_singleflight(monkeypatch):
    preview_service._PREVIEW_CACHE.clear()
    if hasattr(preview_service, "_PREVIEW_INFLIGHT"):
        preview_service._PREVIEW_INFLIGHT.clear()

    started = threading.Event()
    release = threading.Event()
    call_count = 0
    call_lock = threading.Lock()
    expected = _artifact(b"%PDF-singleflight")

    def fake_build(**_kwargs):
        nonlocal call_count
        with call_lock:
            call_count += 1
        started.set()
        assert release.wait(timeout=2)
        return expected

    monkeypatch.setattr(
        preview_service,
        "_build_office_preview_artifact_uncached",
        fake_build,
        raising=False,
    )
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_ENABLED", "1")

    def build():
        return preview_service.build_office_preview_artifact(
            filename="memo.docx",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            content=b"same-content",
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(build)
        assert started.wait(timeout=2)
        second = executor.submit(build)
        release.set()
        results = [first.result(timeout=2), second.result(timeout=2)]

    assert call_count == 1
    assert results == [expected, expected]


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


def test_soffice_conversion_uses_isolated_user_profile(monkeypatch, tmp_path: Path):
    soffice = tmp_path / "soffice.exe"
    soffice.write_text("stub", encoding="utf-8")
    source = tmp_path / "book.xlsx"
    source.write_bytes(b"xlsx")
    output_dir = tmp_path / "pdf"
    captured: dict[str, object] = {}

    def fake_run(command, **_kwargs):
        captured["command"] = command
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "book.pdf").write_bytes(b"%PDF")

        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        return Result()

    monkeypatch.setattr(preview_service.subprocess, "run", fake_run)

    result = preview_service._run_soffice_convert(
        soffice=soffice,
        source_path=source,
        output_dir=output_dir,
        timeout_sec=30,
    )

    profile_args = [
        value for value in captured["command"]
        if str(value).startswith("-env:UserInstallation=file:")
    ]
    assert result == output_dir / "book.pdf"
    assert len(profile_args) == 1
    assert ".lo-profile" in profile_args[0]


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
