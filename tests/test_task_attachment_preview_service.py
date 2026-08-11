from __future__ import annotations

import importlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

hub_module = importlib.import_module("backend.services.hub_service")
preview_module = importlib.import_module("backend.services.task_attachment_preview_service")
mail_preview_module = importlib.import_module("backend.services.mail_attachment_preview_service")
worker_module = importlib.import_module("start_preview_worker")


@pytest.fixture
def task_preview_env(temp_dir, monkeypatch):
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_ENABLED", "1")
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_MAX_BYTES", str(25 * 1024 * 1024))
    db_path = Path(temp_dir) / "task-preview.sqlite3"
    hub = hub_module.HubService(database_url=f"sqlite:///{db_path}")
    hub.data_dir = Path(temp_dir) / "data"
    hub.task_attachments_root = hub.data_dir / "hub_task_attachments"
    hub.task_attachment_previews_root = hub.data_dir / "hub_task_attachment_previews"
    hub.task_attachments_root.mkdir(parents=True, exist_ok=True)
    hub.task_attachment_previews_root.mkdir(parents=True, exist_ok=True)
    service = preview_module.TaskAttachmentPreviewService(
        hub=hub,
        artifacts_root=hub.task_attachment_previews_root,
    )
    return {"hub": hub, "service": service}


def _add_attachment(env, *, attachment_id: str = "attachment-1", filename: str = "report.docx") -> Path:
    hub = env["hub"]
    task_id = "task-1"
    relative_path = f"hub_task_attachments/{task_id}/{attachment_id}_{filename}"
    source_path = hub.data_dir / relative_path
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(b"office-source")
    with hub._lock, hub._connect() as conn:
        conn.execute(
            f"""
            INSERT INTO {hub._TASK_ATTACH_TABLE}
            (id, task_id, scope, file_name, file_path, file_mime, file_size,
             uploaded_by_user_id, uploaded_by_username, uploaded_at)
            VALUES (?, ?, 'task', ?, ?, ?, ?, 1, 'tester', ?)
            """,
            (
                attachment_id,
                task_id,
                filename,
                relative_path,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                len(b"office-source"),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()
    return source_path


def test_task_preview_is_queued_lazily_for_existing_attachment(task_preview_env):
    _add_attachment(task_preview_env)
    service = task_preview_env["service"]

    state = service.get_state(
        task_id="task-1",
        attachment_id="attachment-1",
        preview_pdf_path="/preview/pdf",
    )

    assert state == {
        "status": preview_module.PREVIEW_STATUS_QUEUED,
        "attachment_id": "attachment-1",
        "retry_after_ms": service.poll_interval_ms,
    }


def test_task_preview_worker_claims_and_atomically_publishes_pdf(task_preview_env, monkeypatch):
    _add_attachment(task_preview_env)
    service = task_preview_env["service"]
    service.get_state(
        task_id="task-1",
        attachment_id="attachment-1",
        preview_pdf_path="/preview/pdf",
    )
    artifact = mail_preview_module.PreviewArtifact(
        pdf_bytes=b"%PDF-ready",
        pdf_filename="report.pdf",
        source_kind="word",
        page_count=2,
        sheets=[],
    )
    monkeypatch.setattr(mail_preview_module, "build_office_preview_artifact", lambda **_kwargs: artifact)

    job = service.claim_next_job(worker_id="task-worker")
    assert job is not None
    assert job.attachment_id == "attachment-1"
    assert service.process_job(job) == preview_module.PREVIEW_STATUS_READY

    state = service.get_ready_artifact(
        task_id="task-1",
        attachment_id="attachment-1",
        preview_pdf_path="/preview/pdf",
    )
    assert state["status"] == preview_module.PREVIEW_STATUS_READY
    assert state["page_count"] == 2
    assert Path(state["path"]).read_bytes() == b"%PDF-ready"
    assert list(task_preview_env["hub"].task_attachment_previews_root.rglob("*.tmp")) == []


def test_task_preview_worker_reclaims_expired_lease(task_preview_env):
    _add_attachment(task_preview_env)
    service = task_preview_env["service"]
    service.get_state(
        task_id="task-1",
        attachment_id="attachment-1",
        preview_pdf_path="/preview/pdf",
    )
    first = service.claim_next_job(worker_id="worker-a")
    assert first is not None
    assert service.claim_next_job(worker_id="worker-b") is None

    expired = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    hub = task_preview_env["hub"]
    with hub._lock, hub._connect() as conn:
        conn.execute(
            f"UPDATE {hub._TASK_ATTACHMENT_PREVIEWS_TABLE} SET lease_expires_at = ? WHERE attachment_id = ?",
            (expired, "attachment-1"),
        )
        conn.commit()

    second = service.claim_next_job(worker_id="worker-b")
    assert second is not None
    assert second.attempt_count == 2
    assert second.lease_owner == "worker-b"


def test_task_preview_rejects_non_office_attachment(task_preview_env):
    _add_attachment(task_preview_env, filename="archive.zip")
    hub = task_preview_env["hub"]
    with hub._lock, hub._connect() as conn:
        conn.execute(
            f"UPDATE {hub._TASK_ATTACH_TABLE} SET file_mime = 'application/zip' WHERE id = 'attachment-1'"
        )
        conn.commit()

    with pytest.raises(ValueError, match="not supported"):
        task_preview_env["service"].get_state(
            task_id="task-1",
            attachment_id="attachment-1",
            preview_pdf_path="/preview/pdf",
        )


def test_standalone_preview_worker_polls_task_queue(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(
        worker_module,
        "chat_attachment_preview_service",
        SimpleNamespace(process_next_job=lambda **_kwargs: calls.append("chat") or False),
    )
    monkeypatch.setattr(
        worker_module,
        "task_attachment_preview_service",
        SimpleNamespace(process_next_job=lambda **_kwargs: calls.append("task") or True),
    )

    assert worker_module._process_next_preview_job(worker_id="worker-1") is True
    assert calls == ["chat", "task"]


def test_standalone_preview_worker_owns_remote_and_my_files_queues(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(
        worker_module,
        "chat_attachment_preview_service",
        SimpleNamespace(process_next_job=lambda **_kwargs: calls.append("chat") or False),
    )
    monkeypatch.setattr(
        worker_module,
        "task_attachment_preview_service",
        SimpleNamespace(process_next_job=lambda **_kwargs: calls.append("task") or False),
    )
    monkeypatch.setattr(
        worker_module,
        "document_preview_job_service",
        SimpleNamespace(process_next_job=lambda **_kwargs: calls.append("mail-docflow") or False),
    )
    monkeypatch.setattr(
        worker_module,
        "my_files_service",
        SimpleNamespace(process_next_preview_job=lambda: calls.append("my-files") or True),
    )

    assert worker_module._process_next_preview_job(worker_id="worker-1") is True
    assert calls == ["chat", "task", "mail-docflow", "my-files"]
