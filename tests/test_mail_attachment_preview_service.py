from __future__ import annotations

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


def test_build_office_preview_artifact_rejects_disabled(monkeypatch):
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_ENABLED", "0")
    with pytest.raises(preview_service.MailAttachmentPreviewError, match="disabled"):
        preview_service.build_office_preview_artifact(
            filename="memo.docx",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            content=b"docx-bytes",
        )
