from __future__ import annotations

from pathlib import Path

import pytest

from backend.appdb.db import get_app_engine
from backend.appdb.models import AppDocumentPreviewJob
from backend.services.document_preview_job_service import (
    PREVIEW_SCOPE_DOCFLOW,
    PREVIEW_SCOPE_MAIL,
    PREVIEW_STATUS_FAILED,
    PREVIEW_STATUS_QUEUED,
    PREVIEW_STATUS_READY,
    DocumentPreviewJobService,
)
from backend.services.mail_attachment_preview_service import PreviewArtifact


@pytest.fixture()
def preview_service(tmp_path: Path) -> DocumentPreviewJobService:
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'preview.db').as_posix()}"
    engine = get_app_engine(database_url)
    AppDocumentPreviewJob.__table__.create(bind=engine, checkfirst=True)
    return DocumentPreviewJobService(
        database_url=database_url,
        artifacts_root=tmp_path / "artifacts",
    )


def test_mail_preview_is_queued_before_worker_conversion(monkeypatch, preview_service):
    converter_calls = []
    monkeypatch.setattr(
        preview_service,
        "_load_source",
        lambda _job: (
            "memo.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            b"office-source",
        ),
    )

    from backend.services import mail_attachment_preview_service as converter

    def fake_convert(**_kwargs):
        converter_calls.append(True)
        return PreviewArtifact(
            pdf_bytes=b"%PDF-preview",
            pdf_filename="memo.pdf",
            source_kind="word",
            page_count=2,
            sheets=[],
        )

    monkeypatch.setattr(converter, "build_office_preview_artifact", fake_convert)

    context = {
        "scope": PREVIEW_SCOPE_MAIL,
        "owner_user_id": 7,
        "source_payload": {
            "message_id": "message-1",
            "attachment_ref": "attachment-1",
            "mailbox_id": "mailbox-1",
        },
        "preview_url": "/preview.pdf",
    }
    queued = preview_service.get_state(**context)

    assert queued["status"] == PREVIEW_STATUS_QUEUED
    assert converter_calls == []

    job = preview_service.claim_next_job(worker_id="preview-worker-1")
    assert job is not None
    assert preview_service.process_job(job) == PREVIEW_STATUS_READY
    assert converter_calls == [True]

    ready = preview_service.get_ready_artifact(**context)
    assert ready["status"] == PREVIEW_STATUS_READY
    assert ready["source_kind"] == "word"
    assert ready["page_count"] == 2
    assert Path(ready["path"]).read_bytes() == b"%PDF-preview"


def test_docflow_pdf_is_copied_by_worker_without_libreoffice(monkeypatch, preview_service):
    monkeypatch.setattr(
        preview_service,
        "_load_source",
        lambda _job: ("contract.pdf", "application/pdf", b"%PDF-source"),
    )

    from backend.services import mail_attachment_preview_service as converter

    convert = pytest.fail
    monkeypatch.setattr(converter, "build_office_preview_artifact", convert)

    context = {
        "scope": PREVIEW_SCOPE_DOCFLOW,
        "owner_user_id": 9,
        "source_payload": {"task_ref": "task-1", "file_ref": "file-1"},
        "preview_url": "/preview.pdf",
    }
    assert preview_service.get_state(**context)["status"] == PREVIEW_STATUS_QUEUED
    job = preview_service.claim_next_job(worker_id="preview-worker-1")
    assert job is not None
    assert preview_service.process_job(job) == PREVIEW_STATUS_READY

    ready = preview_service.get_ready_artifact(**context)
    assert ready["preview_kind"] == "pdf"
    assert ready["source_kind"] == "pdf"
    assert Path(ready["path"]).read_bytes() == b"%PDF-source"


def test_terminal_conversion_failure_is_reported(monkeypatch, preview_service):
    monkeypatch.setenv("DOCUMENT_PREVIEW_MAX_ATTEMPTS", "1")
    monkeypatch.setattr(
        preview_service,
        "_load_source",
        lambda _job: ("memo.docx", "application/msword", b"broken"),
    )

    from backend.services import mail_attachment_preview_service as converter

    monkeypatch.setattr(
        converter,
        "build_office_preview_artifact",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("conversion failed")),
    )
    context = {
        "scope": PREVIEW_SCOPE_MAIL,
        "owner_user_id": 7,
        "source_payload": {
            "message_id": "message-2",
            "attachment_ref": "attachment-2",
            "mailbox_id": "",
        },
        "preview_url": "/preview.pdf",
    }
    preview_service.get_state(**context)
    job = preview_service.claim_next_job(worker_id="preview-worker-1")
    assert job is not None
    assert preview_service.process_job(job) == PREVIEW_STATUS_FAILED

    failed = preview_service.get_state(**context)
    assert failed["status"] == PREVIEW_STATUS_FAILED
    assert "conversion failed" in failed["error"]
