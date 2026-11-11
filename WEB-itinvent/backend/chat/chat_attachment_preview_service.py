"""Durable background generation of file previews for Chat attachments."""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable
from uuid import uuid4

from sqlalchemy import and_, or_, select, update

from backend.chat.db import chat_write_session
from backend.chat.models import ChatAttachmentPreview, ChatMessageAttachment


logger = logging.getLogger("backend.chat.attachment_preview")

PREVIEW_STATUS_QUEUED = "queued"
PREVIEW_STATUS_PROCESSING = "processing"
PREVIEW_STATUS_READY = "ready"
PREVIEW_STATUS_FAILED = "failed"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_text(value: object, default: str = "") -> str:
    normalized = str(value or "").strip()
    return normalized or default


def _positive_int_env(name: str, default: int, *, minimum: int = 1, maximum: int = 86_400) -> int:
    try:
        value = int(str(os.getenv(name, default) or default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _default_attachments_root() -> Path:
    from backend.services.hub_service import hub_service

    return Path(hub_service.data_dir) / "chat_message_attachments"


def _default_artifacts_root() -> Path:
    from backend.services.hub_service import hub_service

    return Path(hub_service.data_dir) / "chat_attachment_previews"


@dataclass(frozen=True)
class ChatAttachmentPreviewJob:
    attachment_id: str
    message_id: str
    conversation_id: str
    storage_name: str
    file_name: str
    mime_type: str
    preview_kind: str
    file_size: int
    width: int | None
    height: int | None
    attempt_count: int
    lease_owner: str


class ChatAttachmentPreviewService:
    """Persistent queue; LibreOffice is called only by ``process_next_job``."""

    def __init__(
        self,
        *,
        session_factory: Callable = chat_write_session,
        attachments_root: Callable[[], Path] = _default_attachments_root,
        artifacts_root: Callable[[], Path] = _default_artifacts_root,
    ) -> None:
        self._session_factory = session_factory
        self._attachments_root = attachments_root
        self._artifacts_root = artifacts_root

    @property
    def max_attempts(self) -> int:
        fallback = _positive_int_env("PREVIEW_MAX_ATTEMPTS", 3, maximum=20)
        return _positive_int_env("CHAT_ATTACHMENT_PREVIEW_MAX_ATTEMPTS", fallback, maximum=20)

    @property
    def lease_seconds(self) -> int:
        fallback = _positive_int_env("PREVIEW_LEASE_SEC", 240, minimum=30, maximum=3600)
        return _positive_int_env("CHAT_ATTACHMENT_PREVIEW_LEASE_SEC", fallback, minimum=30, maximum=3600)

    @property
    def poll_interval_ms(self) -> int:
        fallback = _positive_int_env("PREVIEW_POLL_INTERVAL_MS", 500, minimum=50, maximum=10_000)
        return _positive_int_env("CHAT_ATTACHMENT_PREVIEW_POLL_INTERVAL_MS", fallback, minimum=50, maximum=10_000)

    @staticmethod
    def _preview_kind(attachment: ChatMessageAttachment) -> str:
        mime_type = _normalize_text(getattr(attachment, "mime_type", None)).lower()
        if mime_type.startswith("image/"):
            return "image"
        if mime_type.startswith("video/"):
            return "video"

        from backend.services.mail_attachment_preview_service import (
            classify_office_source,
            is_office_preview_enabled,
            office_preview_max_bytes,
        )

        if not is_office_preview_enabled():
            return ""
        if int(getattr(attachment, "file_size", 0) or 0) > office_preview_max_bytes():
            return ""
        return classify_office_source(
            filename=_normalize_text(getattr(attachment, "file_name", None)),
            content_type=_normalize_text(getattr(attachment, "mime_type", None)),
        )

    def enqueue_in_session(
        self,
        *,
        session,
        attachment: ChatMessageAttachment,
        now: datetime | None = None,
        requeue_ready: bool = False,
    ) -> ChatAttachmentPreview | None:
        """Create one idempotent queue row inside the caller's transaction."""

        preview_kind = self._preview_kind(attachment)
        if not preview_kind:
            return None
        attachment_id = _normalize_text(getattr(attachment, "id", None))
        if not attachment_id:
            raise ValueError("attachment.id is required")
        row = session.get(ChatAttachmentPreview, attachment_id)
        if row is not None:
            if requeue_ready and preview_kind in {"image", "video"} and row.status == PREVIEW_STATUS_READY:
                queued_at = now or _utc_now()
                row.status = PREVIEW_STATUS_QUEUED
                row.next_attempt_at = queued_at
                row.lease_owner = None
                row.lease_expires_at = None
                row.last_error = "Published media preview is missing; queued for rebuild"
                row.updated_at = queued_at
            return row
        queued_at = now or _utc_now()
        row = ChatAttachmentPreview(
            attachment_id=attachment_id,
            status=PREVIEW_STATUS_QUEUED,
            attempt_count=0,
            next_attempt_at=queued_at,
            created_at=queued_at,
            updated_at=queued_at,
        )
        session.add(row)
        return row

    def _artifact_path(self, artifact_rel_path: str) -> Path:
        root = Path(self._artifacts_root()).resolve()
        path = (root / _normalize_text(artifact_rel_path)).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Invalid preview artifact path") from exc
        return path

    def _source_path(self, job: ChatAttachmentPreviewJob) -> Path:
        root = Path(self._attachments_root()).resolve()
        path = (root / job.conversation_id / job.storage_name).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Invalid attachment storage path") from exc
        return path

    def delete_conversation_artifacts(self, conversation_id: str) -> None:
        """Remove published artifacts after the conversation rows are deleted."""

        normalized = _normalize_text(conversation_id)
        if not normalized or Path(normalized).name != normalized:
            return
        root = Path(self._artifacts_root()).resolve()
        target = (root / normalized).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            return
        shutil.rmtree(target, ignore_errors=True)

    def get_state_in_session(
        self,
        *,
        session,
        attachment: ChatMessageAttachment,
        preview_pdf_path: str,
    ) -> dict:
        preview_kind = self._preview_kind(attachment)
        if preview_kind in {"image", "video"}:
            raise ValueError("Attachment type is not supported for Office preview.")
        row = self.enqueue_in_session(session=session, attachment=attachment)
        if row is None:
            raise ValueError("Attachment type is not supported for Office preview.")

        if row.status == PREVIEW_STATUS_READY:
            artifact_path = self._artifact_path(row.artifact_rel_path)
            if not artifact_path.is_file():
                now = _utc_now()
                row.status = PREVIEW_STATUS_QUEUED
                row.next_attempt_at = now
                row.lease_owner = None
                row.lease_expires_at = None
                row.last_error = "Published preview artifact is missing; queued for rebuild"
                row.updated_at = now

        state = {
            "status": _normalize_text(row.status, PREVIEW_STATUS_QUEUED),
            "attachment_id": _normalize_text(attachment.id),
        }
        if row.status == PREVIEW_STATUS_READY:
            try:
                sheets = json.loads(_normalize_text(row.sheets_json, "[]"))
            except (TypeError, ValueError, json.JSONDecodeError):
                sheets = []
            state.update(
                {
                    "preview_kind": "office_pdf",
                    "source_kind": _normalize_text(row.source_kind),
                    "source_filename": _normalize_text(attachment.file_name, "attachment.bin"),
                    "pdf_filename": _normalize_text(row.pdf_filename, "attachment.pdf"),
                    "page_count": int(row.page_count or 0),
                    "sheets": sheets if isinstance(sheets, list) else [],
                    "preview_url": _normalize_text(preview_pdf_path),
                }
            )
        elif row.status == PREVIEW_STATUS_FAILED:
            state["error"] = _normalize_text(row.last_error, "Preview generation failed")
        else:
            state["retry_after_ms"] = self.poll_interval_ms
        return state

    def get_ready_artifact_in_session(
        self,
        *,
        session,
        attachment: ChatMessageAttachment,
        preview_pdf_path: str,
    ) -> dict:
        state = self.get_state_in_session(
            session=session,
            attachment=attachment,
            preview_pdf_path=preview_pdf_path,
        )
        if state["status"] != PREVIEW_STATUS_READY:
            return state
        row = session.get(ChatAttachmentPreview, _normalize_text(attachment.id))
        if row is None:
            return {"status": PREVIEW_STATUS_QUEUED, "retry_after_ms": self.poll_interval_ms}
        return {
            **state,
            "path": str(self._artifact_path(row.artifact_rel_path)),
            "pdf_filename": _normalize_text(row.pdf_filename, "attachment.pdf"),
        }

    def claim_next_job(self, *, worker_id: str | None = None) -> ChatAttachmentPreviewJob | None:
        now = _utc_now()
        lease_owner = _normalize_text(worker_id) or uuid4().hex
        with self._session_factory() as session:
            query = (
                select(ChatAttachmentPreview)
                .where(
                    or_(
                        and_(
                            ChatAttachmentPreview.status == PREVIEW_STATUS_QUEUED,
                            ChatAttachmentPreview.next_attempt_at <= now,
                        ),
                        and_(
                            ChatAttachmentPreview.status == PREVIEW_STATUS_PROCESSING,
                            ChatAttachmentPreview.lease_expires_at.is_not(None),
                            ChatAttachmentPreview.lease_expires_at <= now,
                        ),
                    )
                )
                .order_by(ChatAttachmentPreview.next_attempt_at.asc(), ChatAttachmentPreview.created_at.asc())
                .limit(1)
            )
            bind = session.get_bind()
            if str(getattr(getattr(bind, "dialect", None), "name", "")).lower() == "postgresql":
                query = query.with_for_update(skip_locked=True)
            row = session.execute(query).scalar_one_or_none()
            if row is None:
                return None
            attachment = session.get(ChatMessageAttachment, row.attachment_id)
            if attachment is None:
                session.delete(row)
                return None
            row.status = PREVIEW_STATUS_PROCESSING
            row.attempt_count = int(row.attempt_count or 0) + 1
            row.lease_owner = lease_owner
            row.lease_expires_at = now + timedelta(seconds=self.lease_seconds)
            row.last_error = ""
            row.updated_at = now
            session.flush()
            preview_kind = self._preview_kind(attachment)
            if not preview_kind:
                session.delete(row)
                return None
            return ChatAttachmentPreviewJob(
                attachment_id=_normalize_text(attachment.id),
                message_id=_normalize_text(attachment.message_id),
                conversation_id=_normalize_text(attachment.conversation_id),
                storage_name=_normalize_text(attachment.storage_name),
                file_name=_normalize_text(attachment.file_name, "attachment.bin"),
                mime_type=_normalize_text(attachment.mime_type, "application/octet-stream"),
                preview_kind=preview_kind,
                file_size=int(attachment.file_size or 0),
                width=int(attachment.width) if attachment.width is not None else None,
                height=int(attachment.height) if attachment.height is not None else None,
                attempt_count=int(row.attempt_count or 0),
                lease_owner=lease_owner,
            )

    def _mark_ready(
        self,
        *,
        job: ChatAttachmentPreviewJob,
        artifact_rel_path: str = "",
        pdf_filename: str = "",
        source_kind: str = "",
        page_count: int = 0,
        sheets: list | None = None,
    ) -> bool:
        now = _utc_now()
        with self._session_factory() as session:
            result = session.execute(
                update(ChatAttachmentPreview)
                .where(
                    ChatAttachmentPreview.attachment_id == job.attachment_id,
                    ChatAttachmentPreview.status == PREVIEW_STATUS_PROCESSING,
                    ChatAttachmentPreview.lease_owner == job.lease_owner,
                )
                .values(
                    status=PREVIEW_STATUS_READY,
                    artifact_rel_path=artifact_rel_path,
                    pdf_filename=_normalize_text(pdf_filename),
                    source_kind=_normalize_text(source_kind),
                    page_count=int(page_count or 0),
                    sheets_json=json.dumps(list(sheets or []), ensure_ascii=False),
                    last_error="",
                    lease_owner=None,
                    lease_expires_at=None,
                    next_attempt_at=now,
                    updated_at=now,
                    ready_at=now,
                )
            )
            return bool(result.rowcount)

    def _renew_lease(self, job: ChatAttachmentPreviewJob) -> bool:
        now = _utc_now()
        with self._session_factory() as session:
            result = session.execute(
                update(ChatAttachmentPreview)
                .where(
                    ChatAttachmentPreview.attachment_id == job.attachment_id,
                    ChatAttachmentPreview.status == PREVIEW_STATUS_PROCESSING,
                    ChatAttachmentPreview.lease_owner == job.lease_owner,
                )
                .values(
                    lease_expires_at=now + timedelta(seconds=self.lease_seconds),
                    updated_at=now,
                )
            )
            return bool(result.rowcount)

    def _start_lease_heartbeat(
        self,
        job: ChatAttachmentPreviewJob,
    ) -> tuple[threading.Event, threading.Thread]:
        stop_event = threading.Event()
        interval = max(5.0, float(self.lease_seconds) / 3.0)

        def _heartbeat() -> None:
            while not stop_event.wait(interval):
                try:
                    if not self._renew_lease(job):
                        return
                except Exception:
                    logger.exception(
                        "chat preview lease heartbeat failed attachment_id=%s",
                        job.attachment_id,
                    )

        thread = threading.Thread(
            target=_heartbeat,
            name=f"chat-preview-lease-{job.attachment_id[:12]}",
            daemon=True,
        )
        thread.start()
        return stop_event, thread

    def _mark_failure(self, *, job: ChatAttachmentPreviewJob, error: BaseException) -> str:
        now = _utc_now()
        terminal = int(job.attempt_count) >= self.max_attempts
        status = PREVIEW_STATUS_FAILED if terminal else PREVIEW_STATUS_QUEUED
        retry_delay = min(300, 2 ** max(0, int(job.attempt_count) - 1))
        with self._session_factory() as session:
            session.execute(
                update(ChatAttachmentPreview)
                .where(
                    ChatAttachmentPreview.attachment_id == job.attachment_id,
                    ChatAttachmentPreview.status == PREVIEW_STATUS_PROCESSING,
                    ChatAttachmentPreview.lease_owner == job.lease_owner,
                )
                .values(
                    status=status,
                    next_attempt_at=now if terminal else now + timedelta(seconds=retry_delay),
                    lease_owner=None,
                    lease_expires_at=None,
                    last_error=_normalize_text(error)[:2000] or type(error).__name__,
                    updated_at=now,
                )
            )
        return status

    def process_job(self, job: ChatAttachmentPreviewJob) -> str:
        """Generate one claimed attachment preview outside the Chat API."""

        from backend.services.mail_attachment_preview_service import build_office_preview_artifact

        temp_path: Path | None = None
        heartbeat_stop, heartbeat_thread = self._start_lease_heartbeat(job)

        def _stop_heartbeat() -> None:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=1.0)

        try:
            source_path = self._source_path(job)
            if not source_path.is_file():
                raise FileNotFoundError("Attachment source file is missing")
            if job.preview_kind in {"image", "video"}:
                from types import SimpleNamespace

                from backend.chat.attachment_media import ChatAttachmentMedia

                attachment = SimpleNamespace(
                    id=job.attachment_id,
                    storage_name=job.storage_name,
                    mime_type=job.mime_type,
                    width=job.width,
                    height=job.height,
                )
                media = ChatAttachmentMedia(attachments_root=self._attachments_root, logger=logger)
                if job.preview_kind == "image":
                    for variant in ("thumb", "preview"):
                        media.ensure_image_variant(
                            conversation_id=job.conversation_id,
                            attachment=attachment,
                            source_path=source_path,
                            variant=variant,
                        )
                else:
                    media.ensure_video_poster_variant(
                        conversation_id=job.conversation_id,
                        attachment=attachment,
                        source_path=source_path,
                    )
                _stop_heartbeat()
                if not self._mark_ready(job=job, source_kind=job.preview_kind):
                    logger.warning("chat preview lease was lost attachment_id=%s", job.attachment_id)
                    return PREVIEW_STATUS_QUEUED
                return PREVIEW_STATUS_READY

            content = source_path.read_bytes()
            artifact = build_office_preview_artifact(
                filename=job.file_name,
                content_type=job.mime_type,
                content=content,
            )
            artifact_rel_path = f"{job.conversation_id}/{job.attachment_id}.pdf"
            artifact_path = self._artifact_path(artifact_rel_path)
            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = artifact_path.with_name(f"{artifact_path.name}.{uuid4().hex}.tmp")
            with temp_path.open("xb") as handle:
                handle.write(artifact.pdf_bytes)
                handle.flush()
                os.fsync(handle.fileno())
            temp_path.replace(artifact_path)
            temp_path = None
            _stop_heartbeat()
            if not self._mark_ready(
                job=job,
                artifact_rel_path=artifact_rel_path,
                pdf_filename=artifact.pdf_filename,
                source_kind=artifact.source_kind,
                page_count=artifact.page_count,
                sheets=list(artifact.sheets or []),
            ):
                logger.warning("chat preview lease was lost attachment_id=%s", job.attachment_id)
                return PREVIEW_STATUS_QUEUED
            return PREVIEW_STATUS_READY
        except Exception as exc:
            logger.warning(
                "chat preview generation failed attachment_id=%s attempt=%s error=%s",
                job.attachment_id,
                job.attempt_count,
                exc,
            )
            _stop_heartbeat()
            return self._mark_failure(job=job, error=exc)
        finally:
            _stop_heartbeat()
            if temp_path is not None:
                try:
                    temp_path.unlink(missing_ok=True)
                except OSError:
                    pass

    def process_next_job(self, *, worker_id: str | None = None) -> bool:
        job = self.claim_next_job(worker_id=worker_id)
        if job is None:
            return False
        self.process_job(job)
        return True


chat_attachment_preview_service = ChatAttachmentPreviewService()
