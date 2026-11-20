from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.appdb.db import app_session, get_app_engine
from backend.appdb.models import AppDocumentPreviewJob
from backend.services.document_preview_job_service import (
    PREVIEW_SCOPE_DOCFLOW,
    PREVIEW_SCOPE_MAIL,
    PREVIEW_SCOPE_WAREHOUSE_1C,
    PREVIEW_STATUS_FAILED,
    PREVIEW_STATUS_QUEUED,
    PREVIEW_STATUS_READY,
    DocumentPreviewJobService,
    DocumentPreviewJob,
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


def test_warehouse_preview_worker_loads_the_attachment_from_its_registrar(monkeypatch, preview_service):
    from backend.services.warehouse_1c_service import warehouse_1c_service

    async def fake_get_movement_file(registrar_ref, file_ref):
        assert registrar_ref == "registrar-1"
        assert file_ref == "file-1"
        return {
            "name": "act.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "content": b"office-source",
        }

    monkeypatch.setattr(warehouse_1c_service, "get_movement_file", fake_get_movement_file)
    job = DocumentPreviewJob(
        id="preview-1",
        scope=PREVIEW_SCOPE_WAREHOUSE_1C,
        owner_user_id=11,
        source_payload={"registrar_ref": "registrar-1", "file_ref": "file-1"},
        attempt_count=1,
        lease_owner="worker-1",
    )

    assert preview_service._load_source(job) == (
        "act.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        b"office-source",
    )


def test_warehouse_preview_job_keeps_registrar_and_file_in_its_resource_key(preview_service):
    context = {
        "scope": PREVIEW_SCOPE_WAREHOUSE_1C,
        "owner_user_id": 11,
        "source_payload": {"registrar_ref": "registrar-1", "file_ref": "file-1"},
        "preview_url": "/warehouse-preview.pdf",
    }

    assert preview_service.get_state(**context)["status"] == PREVIEW_STATUS_QUEUED
    job = preview_service.claim_next_job(worker_id="preview-worker-1")

    assert job is not None
    assert job.scope == PREVIEW_SCOPE_WAREHOUSE_1C
    assert job.source_payload == {"registrar_ref": "registrar-1", "file_ref": "file-1"}


def test_cleanup_expired_removes_dead_lease_processing_job_and_its_artifact(
    preview_service, tmp_path
):
    context = {
        "scope": PREVIEW_SCOPE_MAIL,
        "owner_user_id": 7,
        "source_payload": {
            "message_id": "message-stuck",
            "attachment_ref": "attachment-stuck",
            "mailbox_id": "mailbox-1",
        },
        "preview_url": "/preview.pdf",
    }
    preview_service.get_state(**context)
    dead_job = preview_service.claim_next_job(worker_id="dead-worker")
    assert dead_job is not None

    live_context = {
        **context,
        "source_payload": {
            "message_id": "message-live",
            "attachment_ref": "attachment-live",
            "mailbox_id": "mailbox-1",
        },
    }
    preview_service.get_state(**live_context)
    live_job = preview_service.claim_next_job(worker_id="live-worker")
    assert live_job is not None

    # Orphan file left by a worker that crashed after writing the artifact
    # but before _mark_ready recorded artifact_rel_path.
    stale_artifact = tmp_path / "artifacts" / PREVIEW_SCOPE_MAIL / f"{dead_job.id}.pdf"
    stale_artifact.parent.mkdir(parents=True, exist_ok=True)
    stale_artifact.write_bytes(b"%PDF-stale")

    now = datetime.now(timezone.utc)
    with app_session(preview_service._database()) as session:
        dead_row = session.get(AppDocumentPreviewJob, dead_job.id)
        dead_row.expires_at = now - timedelta(hours=1)
        dead_row.lease_expires_at = now - timedelta(minutes=1)
        live_row = session.get(AppDocumentPreviewJob, live_job.id)
        live_row.expires_at = now - timedelta(hours=1)

    preview_service.cleanup_expired()

    with app_session(preview_service._database()) as session:
        assert session.get(AppDocumentPreviewJob, dead_job.id) is None
        assert session.get(AppDocumentPreviewJob, live_job.id) is not None
    assert not stale_artifact.exists()


def test_preview_worker_cleanup_loop_invokes_document_cleanup(monkeypatch):
    """MAIL-40: retention enforcement must be wired into the worker loop —
    cleanup_expired is the only path that deletes expired rows/artifacts."""
    import importlib
    import threading

    worker_module = importlib.import_module("start_preview_worker")
    calls: list[int] = []
    stop_event = threading.Event()

    def fake_cleanup() -> int:
        calls.append(1)
        if len(calls) >= 2:
            stop_event.set()
        return 0

    monkeypatch.setattr(
        worker_module,
        "document_preview_job_service",
        SimpleNamespace(cleanup_expired=fake_cleanup),
    )

    worker_module._run_cleanup_loop(stop_event=stop_event, interval_seconds=1)

    assert len(calls) >= 2
