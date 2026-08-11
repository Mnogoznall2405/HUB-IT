from __future__ import annotations

import asyncio
import importlib
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

models = importlib.import_module("backend.chat.models")
preview_module = importlib.import_module("backend.chat.chat_attachment_preview_service")
chat_db_module = importlib.import_module("backend.chat.db")
persistence_module = importlib.import_module("backend.chat.message_persistence")
mail_preview_module = importlib.import_module("backend.services.mail_attachment_preview_service")
routes_module = importlib.import_module("backend.api.v1.chat.attachments")
worker_module = importlib.import_module("start_preview_worker")


@pytest.fixture
def preview_env(temp_dir, monkeypatch):
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_ENABLED", "1")
    monkeypatch.setenv("MAIL_OFFICE_PREVIEW_MAX_BYTES", str(25 * 1024 * 1024))
    db_path = Path(temp_dir) / "chat-preview.sqlite3"
    raw_engine = create_engine(f"sqlite:///{db_path}", future=True)

    @event.listens_for(raw_engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    engine = raw_engine.execution_options(schema_translate_map={models.CHAT_SCHEMA: None})
    models.Base.metadata.create_all(engine)
    session_maker = sessionmaker(bind=engine, expire_on_commit=False, future=True)

    @contextmanager
    def session_factory():
        session = session_maker()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    attachments_root = Path(temp_dir) / "attachments"
    artifacts_root = Path(temp_dir) / "previews"
    service = preview_module.ChatAttachmentPreviewService(
        session_factory=session_factory,
        attachments_root=lambda: attachments_root,
        artifacts_root=lambda: artifacts_root,
    )

    now = datetime.now(timezone.utc)
    with session_factory() as session:
        session.add(
            models.ChatConversation(
                id="conversation-1",
                kind="direct",
                created_by_user_id=1,
                created_at=now,
                updated_at=now,
            )
        )

    yield {
        "service": service,
        "session_factory": session_factory,
        "attachments_root": attachments_root,
        "artifacts_root": artifacts_root,
    }
    raw_engine.dispose()


def _add_attachment(
    env,
    *,
    attachment_id: str = "attachment-1",
    filename: str = "report.docx",
    mime_type: str = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    media_kind: str | None = None,
):
    now = datetime.now(timezone.utc)
    with env["session_factory"]() as session:
        message = models.ChatMessage(
            id=f"message-{attachment_id}",
            conversation_id="conversation-1",
            sender_user_id=1,
            kind="file",
            body="",
            conversation_seq=1,
            created_at=now,
        )
        attachment = models.ChatMessageAttachment(
            id=attachment_id,
            message_id=message.id,
            conversation_id="conversation-1",
            storage_name=f"{attachment_id}_{filename}",
            file_name=filename,
            mime_type=mime_type,
            media_kind=media_kind,
            file_size=128,
            uploaded_by_user_id=1,
            created_at=now,
        )
        session.add(message)
        session.add(attachment)
        session.flush()
        env["service"].enqueue_in_session(session=session, attachment=attachment, now=now)
    return attachment_id, f"message-{attachment_id}"


def test_file_message_persistence_enqueues_office_preview_in_same_transaction(preview_env):
    now = datetime.now(timezone.utc)
    persistence = persistence_module.ChatFileMessagePersistence(
        session_factory=preview_env["session_factory"],
        require_membership=lambda *, session, conversation_id, current_user_id: session.get(
            models.ChatConversation, conversation_id
        ),
        lock_conversation_for_write=lambda *, session, conversation_id: session.get(
            models.ChatConversation, conversation_id
        ),
        conversation_member_ids=lambda session, conversation_id: [1],
        resolve_reply_message=lambda **_kwargs: None,
        build_message_payload_for_members=lambda **kwargs: {"id": kwargs["message"].id},
        now=lambda: now,
    )
    result = persistence.persist_file_message(
        current_user_id=1,
        conversation_id="conversation-1",
        body="report",
        prepared=[
            {
                "attachment_id": "attachment-persisted",
                "storage_name": "attachment-persisted_report.docx",
                "file_name": "report.docx",
                "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "file_size": 128,
            }
        ],
    )

    with preview_env["session_factory"]() as session:
        attachment = session.get(models.ChatMessageAttachment, "attachment-persisted")
        preview = session.get(models.ChatAttachmentPreview, "attachment-persisted")
    assert result.message_id
    assert attachment is not None
    assert preview is not None
    assert preview.status == preview_module.PREVIEW_STATUS_QUEUED


def test_claim_uses_lease_and_expired_job_can_be_reclaimed(preview_env):
    attachment_id, _message_id = _add_attachment(preview_env)
    service = preview_env["service"]

    first = service.claim_next_job(worker_id="worker-a")
    assert first is not None
    assert first.attachment_id == attachment_id
    assert first.attempt_count == 1
    assert service.claim_next_job(worker_id="worker-b") is None

    with preview_env["session_factory"]() as session:
        row = session.get(models.ChatAttachmentPreview, attachment_id)
        row.lease_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    second = service.claim_next_job(worker_id="worker-b")
    assert second is not None
    assert second.attempt_count == 2
    assert second.lease_owner == "worker-b"


def test_worker_atomically_publishes_ready_artifact(preview_env, monkeypatch):
    attachment_id, _message_id = _add_attachment(preview_env)
    service = preview_env["service"]
    source_dir = preview_env["attachments_root"] / "conversation-1"
    source_dir.mkdir(parents=True)
    source_path = source_dir / "attachment-1_report.docx"
    source_path.write_bytes(b"office-source")

    artifact = mail_preview_module.PreviewArtifact(
        pdf_bytes=b"%PDF-ready",
        pdf_filename="report.pdf",
        source_kind="word",
        page_count=2,
        sheets=[],
    )
    monkeypatch.setattr(
        mail_preview_module,
        "build_office_preview_artifact",
        lambda **_kwargs: artifact,
    )

    job = service.claim_next_job(worker_id="worker-ready")
    assert job is not None
    assert service.process_job(job) == preview_module.PREVIEW_STATUS_READY

    with preview_env["session_factory"]() as session:
        row = session.get(models.ChatAttachmentPreview, attachment_id)
        state = service.get_ready_artifact_in_session(
            session=session,
            attachment=session.get(models.ChatMessageAttachment, attachment_id),
            preview_pdf_path="/preview/pdf",
        )
    assert row.status == preview_module.PREVIEW_STATUS_READY
    assert state["status"] == preview_module.PREVIEW_STATUS_READY
    assert Path(state["path"]).read_bytes() == b"%PDF-ready"
    assert list(preview_env["artifacts_root"].rglob("*.tmp")) == []


def test_worker_generates_chat_image_variants(preview_env):
    attachment_id, _message_id = _add_attachment(
        preview_env,
        attachment_id="attachment-image",
        filename="photo.png",
        mime_type="image/png",
        media_kind="image",
    )
    source_dir = preview_env["attachments_root"] / "conversation-1"
    source_dir.mkdir(parents=True)
    source_path = source_dir / "attachment-image_photo.png"
    Image.new("RGB", (640, 480), "#336699").save(source_path, format="PNG")

    job = preview_env["service"].claim_next_job(worker_id="worker-image")
    assert job is not None
    assert job.attachment_id == attachment_id
    assert job.preview_kind == "image"
    assert preview_env["service"].process_job(job) == preview_module.PREVIEW_STATUS_READY

    variants_dir = source_dir / ".variants"
    assert (variants_dir / "attachment-image-thumb.png").is_file()
    assert (variants_dir / "attachment-image-preview.png").is_file()


def test_worker_retries_then_marks_terminal_failure(preview_env, monkeypatch):
    attachment_id, _message_id = _add_attachment(preview_env)
    monkeypatch.setenv("CHAT_ATTACHMENT_PREVIEW_MAX_ATTEMPTS", "2")
    service = preview_env["service"]

    first = service.claim_next_job(worker_id="worker-a")
    assert first is not None
    assert service.process_job(first) == preview_module.PREVIEW_STATUS_QUEUED
    with preview_env["session_factory"]() as session:
        row = session.get(models.ChatAttachmentPreview, attachment_id)
        row.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    second = service.claim_next_job(worker_id="worker-b")
    assert second is not None
    assert service.process_job(second) == preview_module.PREVIEW_STATUS_FAILED
    with preview_env["session_factory"]() as session:
        row = session.get(models.ChatAttachmentPreview, attachment_id)
    assert row.status == preview_module.PREVIEW_STATUS_FAILED
    assert "missing" in row.last_error.lower()


def test_preview_route_returns_202_until_worker_is_ready(monkeypatch):
    class ChatApiStub:
        chat_service = SimpleNamespace(get_attachment_preview=lambda **_kwargs: None)

        async def _run_chat_call(self, _callable, **_kwargs):
            return {"status": "queued", "retry_after_ms": 750}

        def _raise_chat_http_error(self, exc):
            raise exc

    monkeypatch.setattr(routes_module, "chat_api", lambda: ChatApiStub())
    response = asyncio.run(
        routes_module.get_chat_attachment_preview(
            "message-1",
            "attachment-1",
            current_user=SimpleNamespace(id=1),
        )
    )
    assert response.status_code == 202
    assert response.headers["retry-after"] == "1"


def test_preview_worker_concurrency_is_bounded(monkeypatch):
    monkeypatch.setenv("PREVIEW_WORKER_CONCURRENCY", "99")
    assert worker_module._positive_int_env("PREVIEW_WORKER_CONCURRENCY", 2) == 8

    monkeypatch.setenv("PREVIEW_WORKER_CONCURRENCY", "invalid")
    assert worker_module._positive_int_env("PREVIEW_WORKER_CONCURRENCY", 2) == 2


def test_legacy_schema_bootstrap_creates_preview_queue_in_runtime_schema(temp_dir):
    db_path = Path(temp_dir) / "legacy-preview.sqlite3"
    raw_engine = create_engine(f"sqlite:///{db_path}", future=True)
    engine = raw_engine.execution_options(schema_translate_map={models.CHAT_SCHEMA: None})
    models.Base.metadata.create_all(
        engine,
        tables=[
            models.ChatConversation.__table__,
            models.ChatMessage.__table__,
            models.ChatMessageAttachment.__table__,
        ],
    )

    chat_db_module._ensure_chat_attachment_preview_table(engine)

    from sqlalchemy import inspect

    assert inspect(engine).has_table("chat_attachment_previews", schema=None)
    raw_engine.dispose()
